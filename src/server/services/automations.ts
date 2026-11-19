import { and, eq, asc, sql, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  automations,
  automationSteps,
  automationRuns,
  automationWaits,
  instagramAccounts,
  messages,
  conversations,
  stages,
  users,
  leads,
  type Automation,
  type AutomationStep,
  type Content,
  type Keyword,
  type Lead,
} from '@/db/schema';
import { recordEvent } from './events';
import { addTags, removeTags, assignOwner, setCustomFields, moveLeadToStage } from './leads';
import { bookMeeting, recordSale } from './commerce';
import {
  sendText,
  sendMedia,
  sendPrivateReply,
  sendQuickReplies,
  sendSenderAction,
  replyToComment,
  validateMedia,
  type IgAuth,
  type MediaType,
  type QuickReply,
} from '../integrations/instagram';
import { addManychatTag, setManychatField } from '../integrations/manychat';

/**
 * Motor de flujos conversacionales.
 *
 * Equivale a un flujo de ManyChat, con tres diferencias que importan:
 *
 * 1. Es un GRAFO, no una lista: cada nodo declara a cual sigue, y un nodo
 *    `condition` elige entre varias salidas. Eso es lo que permite "si ya
 *    factura → invitalo a una call; si no → mandale el curso barato".
 * 2. Un nodo `ask_question` PAUSA el flujo y guarda la espera. El proximo DM
 *    del lead la resuelve y el flujo sigue desde donde quedo.
 * 3. Todo paso arrastra el `contentId` del disparador, asi que lo que haga el
 *    flujo sigue siendo atribuible al reel que lo origino.
 */

/** Tope de nodos por ejecucion: un flujo mal armado no puede colgar el proceso. */
const MAX_NODES_PER_RUN = 50;

/** Cuanto vive una espera antes de darse por abandonada. */
const WAIT_TTL_HOURS = 72;

export interface AutomationContext {
  orgId: string;
  lead: Lead;
  content?: Content | null;
  keyword?: Keyword | null;
  /** Id del comentario de Instagram, si el disparador fue un comentario. */
  commentId?: string | null;
  /** Texto que disparo el flujo, o la ultima respuesta del lead al reanudar. */
  text?: string | null;
  source?: string;
  /** Si es true no se envia nada a Instagram: sirve para el boton "Probar". */
  simulate?: boolean;
}

export interface StepLogEntry {
  nodeId: string;
  position: number;
  type: AutomationStep['type'];
  status: 'done' | 'skipped' | 'failed' | 'waiting';
  detail?: string;
  dryRun?: boolean;
}

export interface RunResult {
  runId: string;
  status: 'completed' | 'failed' | 'skipped' | 'waiting';
  steps: StepLogEntry[];
}

/* ------------------------------------------------------------------ *
 * Plantillas de texto
 * ------------------------------------------------------------------ */

/** Sustituye {{variables}} en los textos de los pasos. */
export function renderTemplate(template: string, context: AutomationContext): string {
  const custom = (context.lead.customFields ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {
    nombre: context.lead.fullName?.split(' ')[0] ?? context.lead.igUsername ?? 'hola',
    nombrecompleto: context.lead.fullName ?? context.lead.igUsername ?? '',
    usuario: context.lead.igUsername ? `@${context.lead.igUsername}` : '',
    username: context.lead.igUsername ?? '',
    email: context.lead.email ?? '',
    contenido: context.content?.title ?? '',
    recurso: context.keyword?.resourceName ?? '',
    link: context.keyword?.resourceUrl ?? '',
    palabra: context.keyword?.word ?? '',
    respuesta: context.text ?? '',
  };

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const lower = key.toLowerCase();
    if (values[lower] !== undefined) return values[lower];
    // {{campo.lo_que_sea}} lee de los campos personalizados del lead.
    if (lower.startsWith('campo.')) {
      const value = custom[key.slice(6)];
      return value === undefined || value === null ? match : String(value);
    }
    return match;
  });
}

/* ------------------------------------------------------------------ *
 * Recorrido del grafo
 * ------------------------------------------------------------------ */

interface FlowGraph {
  steps: AutomationStep[];
  byNodeId: Map<string, AutomationStep>;
  entry: AutomationStep | undefined;
  /**
   * true si el flujo declara aristas. Un flujo viejo sin aristas se ejecuta
   * como lista; uno con aristas se ejecuta como grafo, y ahi un paso sin
   * salida es el FINAL de esa rama.
   */
  isGraph: boolean;
}

async function loadGraph(automationId: string): Promise<FlowGraph> {
  const db = await getDb();
  const steps = await db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.automationId, automationId))
    .orderBy(asc(automationSteps.position));

  const byNodeId = new Map<string, AutomationStep>();
  for (const step of steps) {
    byNodeId.set(step.nodeId ?? step.id, step);
  }

  const isGraph = steps.some(
    (step) => Boolean(step.nextNodeId) || ((step.branches as unknown[])?.length ?? 0) > 0,
  );

  return { steps, byNodeId, entry: steps[0], isGraph };
}

/**
 * Nodo siguiente.
 *
 * En un grafo, un paso sin `nextNodeId` TERMINA la rama. Caer al siguiente paso
 * por posicion seria un error silencioso: el final de la rama "si" continuaria
 * dentro de la rama "no", y las dos ramas harian lo mismo.
 *
 * La caida por posicion existe solo para flujos viejos sin ninguna arista.
 */
function nextStep(graph: FlowGraph, current: AutomationStep): AutomationStep | undefined {
  if (current.nextNodeId) {
    return graph.byNodeId.get(current.nextNodeId);
  }
  if (graph.isGraph) return undefined;

  const index = graph.steps.findIndex((step) => step.id === current.id);
  return index >= 0 ? graph.steps[index + 1] : undefined;
}

function nodeKey(step: AutomationStep): string {
  return step.nodeId ?? step.id;
}

/* ------------------------------------------------------------------ *
 * Ejecucion
 * ------------------------------------------------------------------ */

export async function runAutomation(
  automationId: string,
  context: AutomationContext,
): Promise<RunResult> {
  const db = await getDb();

  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, automationId))
    .limit(1);

  if (!automation || !automation.active) {
    return { runId: '', status: 'skipped', steps: [] };
  }

  const graph = await loadGraph(automation.id);
  if (!graph.entry) return { runId: '', status: 'skipped', steps: [] };

  const [run] = await db
    .insert(automationRuns)
    .values({
      orgId: context.orgId,
      automationId: automation.id,
      leadId: context.lead.id,
      keywordId: context.keyword?.id ?? null,
      contentId: context.content?.id ?? null,
      status: 'running',
    })
    .returning();

  const result = await walk(graph, graph.entry, context, automation, run.id, []);

  await finishRun(run.id, automation.id, result, context);
  return { runId: run.id, ...result };
}

/**
 * Ejecuta el flujo en seco: no manda DMs, no mueve etapas, no crea eventos.
 *
 * Es el boton "Probar" del constructor. Sin esto, la unica forma de saber si un
 * flujo funciona es mandarselo a un lead real y ver que pasa.
 */
export async function simulateAutomation(
  automationId: string,
  context: Omit<AutomationContext, 'simulate'>,
): Promise<RunResult> {
  const db = await getDb();
  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, automationId))
    .limit(1);
  if (!automation) return { runId: '', status: 'skipped', steps: [] };

  const graph = await loadGraph(automation.id);
  if (!graph.entry) {
    return {
      runId: '',
      status: 'skipped',
      steps: [
        {
          nodeId: 'entry',
          position: -1,
          type: 'notify',
          status: 'skipped',
          detail: 'El flujo no tiene ningun paso.',
        },
      ],
    };
  }

  const result = await walk(graph, graph.entry, { ...context, simulate: true }, automation, '', []);
  return { runId: '', ...result };
}

/**
 * Reanuda un flujo que estaba esperando la respuesta del lead.
 * Lo llama la ingesta cuando entra un DM y hay una espera abierta.
 */
export async function resumeAutomation(
  waitId: string,
  reply: string,
  lead: Lead,
): Promise<RunResult | null> {
  const db = await getDb();

  const [wait] = await db
    .select()
    .from(automationWaits)
    .where(eq(automationWaits.id, waitId))
    .limit(1);
  if (!wait) return null;

  // La espera se consume siempre: si algo falla, el lead no queda atascado.
  await db.delete(automationWaits).where(eq(automationWaits.id, wait.id));

  if (wait.expiresAt && new Date(wait.expiresAt) < new Date()) {
    return { runId: wait.runId ?? '', status: 'skipped', steps: [] };
  }

  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, wait.automationId))
    .limit(1);
  if (!automation || !automation.active) return null;

  // La respuesta queda guardada como campo del lead para poder condicionar.
  if (wait.saveAs) {
    await setCustomFields(lead.id, { [wait.saveAs]: reply });
  }

  const graph = await loadGraph(automation.id);
  const waitingNode = graph.byNodeId.get(wait.nodeId);
  if (!waitingNode) return null;

  const resumeFrom = nextStep(graph, waitingNode);
  if (!resumeFrom) {
    return { runId: wait.runId ?? '', status: 'completed', steps: [] };
  }

  const [freshLead] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);

  const context: AutomationContext = {
    orgId: wait.orgId,
    lead: freshLead ?? lead,
    text: reply,
    source: 'resume',
  };

  const runId = wait.runId ?? '';
  const result = await walk(graph, resumeFrom, context, automation, runId, []);
  if (runId) await finishRun(runId, automation.id, result, context, true);
  return { runId, ...result };
}

async function walk(
  graph: FlowGraph,
  start: AutomationStep,
  context: AutomationContext,
  automation: Automation,
  runId: string,
  log: StepLogEntry[],
): Promise<{ status: RunResult['status']; steps: StepLogEntry[] }> {
  let current: AutomationStep | undefined = start;
  let guard = 0;

  while (current && guard < MAX_NODES_PER_RUN) {
    guard += 1;

    // `condition` no "hace" nada: solo elige por donde seguir.
    if (current.type === 'condition') {
      const { matched, label } = evaluateCondition(current, context);
      log.push({
        nodeId: nodeKey(current),
        position: current.position,
        type: current.type,
        status: 'done',
        detail: `${label} → ${matched ? 'si' : 'no'}`,
      });
      current = branchTarget(graph, current, matched);
      continue;
    }

    let entry: StepLogEntry;
    try {
      entry = await executeStep(current, context, automation, runId);
    } catch (error) {
      entry = {
        nodeId: nodeKey(current),
        position: current.position,
        type: current.type,
        status: 'failed',
        detail: (error as Error).message,
      };
    }

    log.push(entry);

    if (entry.status === 'failed') return { status: 'failed', steps: log };
    // Un `ask_question` corta aqui: el flujo sigue cuando el lead responda.
    if (entry.status === 'waiting') return { status: 'waiting', steps: log };

    current = nextStep(graph, current);
  }

  if (guard >= MAX_NODES_PER_RUN) {
    log.push({
      nodeId: 'guard',
      position: -1,
      type: 'notify',
      status: 'failed',
      detail: `El flujo supero ${MAX_NODES_PER_RUN} nodos: puede tener un ciclo.`,
    });
    return { status: 'failed', steps: log };
  }

  return { status: 'completed', steps: log };
}

function branchTarget(
  graph: FlowGraph,
  step: AutomationStep,
  matched: boolean,
): AutomationStep | undefined {
  const branches = (step.branches ?? []) as Array<{ when?: string; goTo?: string }>;
  const wanted = matched ? 'true' : 'false';
  const branch = branches.find((item) => item.when === wanted);
  if (branch?.goTo) {
    const target = graph.byNodeId.get(branch.goTo);
    if (target) return target;
  }
  // Sin rama definida para ese lado, el "si" sigue derecho y el "no" corta.
  return matched ? nextStep(graph, step) : undefined;
}

async function finishRun(
  runId: string,
  automationId: string,
  result: { status: RunResult['status']; steps: StepLogEntry[] },
  context: AutomationContext,
  isResume = false,
): Promise<void> {
  const db = await getDb();

  await db
    .update(automationRuns)
    .set({
      status: result.status === 'skipped' ? 'skipped' : result.status,
      stepsLog: result.steps,
      error:
        result.status === 'failed' ? (result.steps.at(-1)?.detail ?? 'error desconocido') : null,
      finishedAt: result.status === 'waiting' ? null : new Date(),
    })
    .where(eq(automationRuns.id, runId));

  if (isResume) return;

  await db
    .update(automations)
    .set({ runsCount: sql`${automations.runsCount} + 1` })
    .where(eq(automations.id, automationId));

  await recordEvent({
    orgId: context.orgId,
    leadId: context.lead.id,
    contentId: context.content?.id ?? null,
    keywordId: context.keyword?.id ?? null,
    automationId,
    type: 'automation_run',
    source: context.source ?? 'automation',
    payload: { steps: result.steps.length, status: result.status },
  });
}

/* ------------------------------------------------------------------ *
 * Condiciones
 * ------------------------------------------------------------------ */

export interface ConditionCheck {
  field: string;
  op: 'contains' | 'not_contains' | 'equals' | 'exists' | 'gt' | 'lt';
  value?: string;
}

/**
 * Evalua la condicion de un nodo contra el lead y su ultima respuesta.
 * Se mantiene deliberadamente simple: lo que un infoproductor necesita
 * condicionar es "¿que respondio?", "¿tiene tal etiqueta?", "¿cuantos
 * seguidores?". Nada de expresiones arbitrarias.
 */
export function evaluateCondition(
  step: Pick<AutomationStep, 'config'>,
  context: AutomationContext,
): { matched: boolean; label: string } {
  const config = (step.config ?? {}) as { checks?: ConditionCheck[]; match?: 'all' | 'any' };
  const checks = config.checks ?? [];
  if (checks.length === 0) return { matched: true, label: 'sin condiciones' };

  const results = checks.map((check) => evaluateCheck(check, context));
  const matched = config.match === 'any' ? results.some(Boolean) : results.every(Boolean);
  const label = checks
    .map((check) => `${check.field} ${check.op} ${check.value ?? ''}`.trim())
    .join(config.match === 'any' ? ' o ' : ' y ');

  return { matched, label };
}

function evaluateCheck(check: ConditionCheck, context: AutomationContext): boolean {
  const lead = context.lead;
  const custom = (lead.customFields ?? {}) as Record<string, unknown>;

  let actual: unknown;
  switch (check.field) {
    case 'respuesta':
      actual = context.text ?? '';
      break;
    case 'etiqueta':
      actual = lead.tags;
      break;
    case 'origen':
      actual = lead.source;
      break;
    case 'seguidores':
      actual = lead.followersCount ?? 0;
      break;
    case 'email':
      actual = lead.email ?? '';
      break;
    case 'ingresos':
      actual = lead.revenueCents;
      break;
    default:
      actual = check.field.startsWith('campo.') ? custom[check.field.slice(6)] : undefined;
  }

  const expected = (check.value ?? '').toLowerCase();
  const normalize = (value: unknown) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  switch (check.op) {
    case 'exists':
      return Array.isArray(actual) ? actual.length > 0 : actual !== undefined && actual !== null && actual !== '';
    case 'equals':
      return normalize(actual) === normalize(expected);
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((item) => normalize(item) === normalize(expected))
        : normalize(actual).includes(normalize(expected));
    case 'not_contains':
      return Array.isArray(actual)
        ? !actual.some((item) => normalize(item) === normalize(expected))
        : !normalize(actual).includes(normalize(expected));
    case 'gt':
      return Number(actual) > Number(check.value);
    case 'lt':
      return Number(actual) < Number(check.value);
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Ejecucion de un nodo
 * ------------------------------------------------------------------ */

async function executeStep(
  step: AutomationStep,
  context: AutomationContext,
  automation: Automation,
  runId: string,
): Promise<StepLogEntry> {
  const db = await getDb();
  const config = (step.config ?? {}) as Record<string, unknown>;
  const base = { nodeId: nodeKey(step), position: step.position, type: step.type };

  switch (step.type) {
    case 'send_dm':
    case 'send_resource':
    case 'ask_question': {
      const fallback =
        step.type === 'send_resource'
          ? 'Listo {{nombre}}, aca lo tenes: {{link}}'
          : step.type === 'ask_question'
            ? '{{nombre}}, una pregunta rapida para ayudarte mejor:'
            : 'Hola {{nombre}}!';
      const text = renderTemplate((config.text as string) ?? fallback, context);

      // Botones de respuesta rapida: evitan tener que adivinar que quiso decir
      // el lead, porque la respuesta vuelve como un valor exacto.
      const options = toQuickReplies(config.quickReplies);

      const sent = await deliverDm(text, context, automation, step.type, options);
      if (sent.status === 'failed' || sent.status === 'skipped') {
        return { ...base, status: sent.status, detail: sent.detail, dryRun: sent.dryRun };
      }

      if (step.type === 'ask_question') {
        if (context.simulate) {
          return {
            ...base,
            status: 'waiting',
            detail: `(prueba) esperaria la respuesta → ${(config.saveAs as string) ?? 'ultima_respuesta'}`,
            dryRun: true,
          };
        }
        // Se registra la espera y el flujo se detiene hasta que el lead conteste.
        await db
          .delete(automationWaits)
          .where(eq(automationWaits.leadId, context.lead.id));
        await db.insert(automationWaits).values({
          orgId: context.orgId,
          leadId: context.lead.id,
          automationId: automation.id,
          runId: runId || null,
          nodeId: nodeKey(step),
          saveAs: (config.saveAs as string) ?? 'ultima_respuesta',
          contentId: context.content?.id ?? null,
          keywordId: context.keyword?.id ?? null,
          expiresAt: new Date(Date.now() + WAIT_TTL_HOURS * 3_600_000),
        });
        return {
          ...base,
          status: 'waiting',
          detail: `Esperando respuesta → ${(config.saveAs as string) ?? 'ultima_respuesta'}`,
          dryRun: sent.dryRun,
        };
      }

      return { ...base, status: 'done', detail: text.slice(0, 120), dryRun: sent.dryRun };
    }

    case 'send_image':
    case 'send_audio':
    case 'send_video':
    case 'send_file': {
      const url = config.url as string | undefined;
      const mediaType = STEP_MEDIA_TYPE[step.type] ?? 'file';
      if (!url) return { ...base, status: 'skipped', detail: `Sin URL de ${mediaType}` };

      // Se valida antes de llamar a Meta: un formato que no acepta falla con un
      // error opaco y el mensaje queda guardado como si se hubiera enviado.
      const problem = validateMedia(mediaType, url);
      if (problem) return { ...base, status: 'failed', detail: problem };

      const auth = await authFor(context.orgId);
      if (!auth) return { ...base, status: 'skipped', detail: 'No hay cuenta de Instagram' };
      if (context.simulate) return { ...base, status: 'done', detail: url, dryRun: true };

      const result = await sendMedia(auth, {
        recipientIgId: context.lead.igUserId ?? '',
        type: mediaType,
        url,
      });

      await recordMediaMessage(context, automation, mediaType, url, result.ok, result.error);

      return {
        ...base,
        status: result.ok ? 'done' : 'failed',
        detail: result.ok ? url : result.error,
        dryRun: result.dryRun,
      };
    }

    case 'typing': {
      const auth = await authFor(context.orgId);
      if (!auth) return { ...base, status: 'skipped', detail: 'No hay cuenta de Instagram' };
      if (context.simulate) return { ...base, status: 'done', detail: 'escribiendo...', dryRun: true };

      const result = await sendSenderAction(auth, {
        recipientIgId: context.lead.igUserId ?? '',
        action: (config.action as 'typing_on') ?? 'typing_on',
      });
      return {
        ...base,
        status: result.ok ? 'done' : 'failed',
        detail: String(config.action ?? 'typing_on'),
        dryRun: result.dryRun,
      };
    }

    case 'reply_comment': {
      if (!context.commentId) {
        return { ...base, status: 'skipped', detail: 'El disparador no fue un comentario' };
      }
      const text = renderTemplate((config.text as string) ?? 'Te lo mande por DM 📩', context);
      const auth = await authFor(context.orgId);
      if (!auth) return { ...base, status: 'skipped', detail: 'No hay cuenta de Instagram' };
      if (context.simulate) return { ...base, status: 'done', detail: text, dryRun: true };

      const result = await replyToComment(auth, { commentId: context.commentId, text });
      return {
        ...base,
        status: result.ok ? 'done' : 'failed',
        detail: result.ok ? text : result.error,
        dryRun: result.dryRun,
      };
    }

    case 'add_tag': {
      const tags = toStringArray(config.tags ?? config.tag);
      if (!context.simulate) {
        await addTags(context.lead.id, tags);
        if (context.lead.manychatSubscriberId) {
          for (const tag of tags) await addManychatTag(context.lead.manychatSubscriberId, tag);
        }
      }
      return { ...base, status: 'done', detail: tags.join(', ') };
    }

    case 'remove_tag': {
      const tags = toStringArray(config.tags ?? config.tag);
      if (!context.simulate) await removeTags(context.lead.id, tags);
      return { ...base, status: 'done', detail: tags.join(', ') };
    }

    case 'set_stage': {
      const stageKey = config.stageKey as string | undefined;
      let target = config.stageId as string | undefined;

      if (!target && stageKey && context.lead.pipelineId) {
        const [found] = await db
          .select()
          .from(stages)
          .where(and(eq(stages.pipelineId, context.lead.pipelineId), eq(stages.key, stageKey)))
          .limit(1);
        target = found?.id;
      }
      if (!target) return { ...base, status: 'skipped', detail: 'Etapa no encontrada' };

      if (!context.simulate) {
        await moveLeadToStage({
          leadId: context.lead.id,
          stageId: target,
          source: `automation:${automation.name}`,
        });
        if (context.lead.manychatSubscriberId) {
          await setManychatField(context.lead.manychatSubscriberId, 'crm_stage', stageKey ?? target);
        }
      }
      return { ...base, status: 'done', detail: stageKey ?? target };
    }

    case 'set_field': {
      const fields = (config.fields as Record<string, unknown>) ?? {};
      if (!context.simulate) await setCustomFields(context.lead.id, fields);
      return { ...base, status: 'done', detail: Object.keys(fields).join(', ') };
    }

    case 'assign_owner': {
      let ownerId = config.ownerId as string | undefined;
      if (!ownerId && config.strategy === 'round_robin') {
        ownerId = await pickRoundRobinOwner(context.orgId);
      }
      if (!ownerId) return { ...base, status: 'skipped', detail: 'Sin responsable disponible' };
      if (!context.simulate) await assignOwner(context.lead.id, ownerId);
      return { ...base, status: 'done', detail: ownerId };
    }

    case 'create_appointment': {
      const whenRaw = config.scheduledAt as string | undefined;
      const scheduledAt = whenRaw ? new Date(whenRaw) : new Date(Date.now() + 86_400_000);
      if (!context.simulate) {
        await bookMeeting({
          orgId: context.orgId,
          leadId: context.lead.id,
          scheduledAt,
          title: (config.title as string) ?? 'Llamada de diagnostico',
          source: `automation:${automation.name}`,
          contentId: context.content?.id ?? null,
        });
      }
      return { ...base, status: 'done', detail: scheduledAt.toISOString() };
    }

    case 'create_deal': {
      const amountCents = Number(config.amountCents ?? 0);
      if (!context.simulate) {
        await recordSale({
          orgId: context.orgId,
          leadId: context.lead.id,
          amountCents,
          productId: (config.productId as string) ?? null,
          source: `automation:${automation.name}`,
          contentId: context.content?.id ?? null,
        });
      }
      return { ...base, status: 'done', detail: `${amountCents} centavos` };
    }

    case 'http_request': {
      const url = config.url as string | undefined;
      if (!url) return { ...base, status: 'skipped', detail: 'Sin URL' };
      if (context.simulate) return { ...base, status: 'done', detail: url, dryRun: true };
      try {
        const response = await fetch(url, {
          method: (config.method as string) ?? 'POST',
          headers: { 'content-type': 'application/json', ...(config.headers as object) },
          body: JSON.stringify({
            lead: {
              id: context.lead.id,
              igUsername: context.lead.igUsername,
              email: context.lead.email,
              tags: context.lead.tags,
            },
            content: context.content ? { id: context.content.id, title: context.content.title } : null,
            keyword: context.keyword?.word ?? null,
            reply: context.text ?? null,
          }),
        });
        return { ...base, status: response.ok ? 'done' : 'failed', detail: `HTTP ${response.status}` };
      } catch (error) {
        return { ...base, status: 'failed', detail: (error as Error).message };
      }
    }

    case 'wait': {
      // Las esperas por tiempo necesitan un worker de cola: el webhook tiene que
      // responder en milisegundos. `ask_question` si pausa de verdad, porque lo
      // que la reanuda es un evento entrante, no un temporizador.
      return {
        ...base,
        status: 'skipped',
        detail: `Espera de ${config.minutes ?? 0} min: requiere worker de cola`,
      };
    }

    case 'notify':
      return { ...base, status: 'done', detail: (config.message as string) ?? 'notificacion' };

    default:
      return { ...base, status: 'skipped', detail: 'Tipo de paso no soportado' };
  }
}

/* ------------------------------------------------------------------ *
 * Envio de DM desde un flujo
 * ------------------------------------------------------------------ */

async function deliverDm(
  text: string,
  context: AutomationContext,
  automation: Automation,
  stepType: AutomationStep['type'],
  quickReplies: QuickReply[] = [],
): Promise<{ status: 'done' | 'failed' | 'skipped'; detail?: string; dryRun?: boolean }> {
  const db = await getDb();
  const auth = await authFor(context.orgId);
  if (!auth) return { status: 'skipped', detail: 'No hay cuenta de Instagram conectada' };

  if (context.simulate) {
    return { status: 'done', detail: text.slice(0, 120), dryRun: true };
  }

  // Si venimos de un comentario, la respuesta privada es la via correcta: abre
  // el DM aunque el lead nunca haya escrito antes.
  const result = context.commentId
    ? await sendPrivateReply(auth, { commentId: context.commentId, text })
    : quickReplies.length > 0
      ? await sendQuickReplies(auth, {
          recipientIgId: context.lead.igUserId ?? '',
          text,
          options: quickReplies,
        })
      : await sendText(auth, { recipientIgId: context.lead.igUserId ?? '', text });

  const conversationId = await ensureConversationId(context.orgId, context.lead.id, auth);

  await db.insert(messages).values({
    orgId: context.orgId,
    leadId: context.lead.id,
    conversationId,
    contentId: context.content?.id ?? null,
    direction: 'outbound',
    channel: 'ig_dm',
    body: text,
    automatedBy: automation.id,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : (result.error ?? null),
    externalId: result.data?.message_id ?? null,
  });

  if (conversationId) {
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastOutboundAt: new Date(),
        lastMessagePreview: text.slice(0, 140),
      })
      .where(eq(conversations.id, conversationId));
  }

  await recordEvent({
    orgId: context.orgId,
    leadId: context.lead.id,
    contentId: context.content?.id ?? null,
    keywordId: context.keyword?.id ?? null,
    automationId: automation.id,
    type: stepType === 'send_resource' ? 'resource_sent' : 'dm_sent',
    channel: 'ig_dm',
    source: context.source ?? 'automation',
    payload: { text, dryRun: result.dryRun },
  });

  return {
    status: result.ok ? 'done' : 'failed',
    detail: result.ok ? text.slice(0, 120) : result.error,
    dryRun: result.dryRun,
  };
}

/** Credenciales de la cuenta de Instagram de la organizacion. */
export async function authFor(orgId: string): Promise<IgAuth | null> {
  const db = await getDb();
  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.orgId, orgId))
    .orderBy(desc(instagramAccounts.connected))
    .limit(1);
  if (!account) return null;
  return {
    token: account.accessToken,
    igUserId: account.igUserId,
    method: account.connectionMethod,
  };
}

async function ensureConversationForLead(orgId: string, leadId: string): Promise<string | null> {
  const auth = await authFor(orgId);
  if (!auth) return null;
  return ensureConversationId(orgId, leadId, auth);
}

async function ensureConversationId(
  orgId: string,
  leadId: string,
  auth: IgAuth,
): Promise<string | null> {
  const db = await getDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), eq(conversations.leadId, leadId)))
    .limit(1);
  if (existing) return existing.id;

  const [account] = await db
    .select({ id: instagramAccounts.id })
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.orgId, orgId), eq(instagramAccounts.igUserId, auth.igUserId)))
    .limit(1);

  const [created] = await db
    .insert(conversations)
    .values({ orgId, leadId, igAccountId: account?.id ?? null })
    .onConflictDoNothing()
    .returning();
  return created?.id ?? null;
}

const STEP_MEDIA_TYPE: Partial<Record<AutomationStep['type'], MediaType>> = {
  send_image: 'image',
  send_audio: 'audio',
  send_video: 'video',
  send_file: 'file',
};

/** Normaliza la configuracion de botones, venga como lista o como texto. */
function toQuickReplies(value: unknown): QuickReply[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return { title: item, payload: item };
        const option = item as { title?: string; payload?: string };
        if (!option.title) return null;
        return { title: option.title, payload: option.payload || option.title };
      })
      .filter((item): item is QuickReply => item !== null);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((title) => ({ title, payload: title }));
  }
  return [];
}

/** Deja el adjunto enviado en el hilo, para que la bandeja lo muestre. */
async function recordMediaMessage(
  context: AutomationContext,
  automation: Automation,
  type: MediaType,
  url: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  const db = await getDb();
  const conversationId = await ensureConversationForLead(context.orgId, context.lead.id);

  await db.insert(messages).values({
    orgId: context.orgId,
    leadId: context.lead.id,
    conversationId,
    contentId: context.content?.id ?? null,
    direction: 'outbound',
    channel: 'ig_dm',
    body: null,
    mediaUrl: url,
    attachments: [{ type, url }],
    automatedBy: automation.id,
    status: ok ? 'sent' : 'failed',
    error: ok ? null : (error ?? null),
  });

  if (conversationId) {
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastOutboundAt: new Date(),
        lastMessagePreview: `(${type})`,
      })
      .where(eq(conversations.id, conversationId));
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

/** Reparte leads entre los responsables activos, de forma equilibrada. */
async function pickRoundRobinOwner(orgId: string): Promise<string | undefined> {
  const db = await getDb();
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.active, true)))
    .orderBy(asc(users.createdAt));
  if (candidates.length === 0) return undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(eq(automationRuns.orgId, orgId));

  return candidates[(count ?? 0) % candidates.length].id;
}

/* ------------------------------------------------------------------ *
 * Esperas abiertas
 * ------------------------------------------------------------------ */

/** Espera abierta de un lead, si la hay. La consulta la ingesta en cada DM. */
export async function pendingWaitForLead(leadId: string) {
  const db = await getDb();
  const [wait] = await db
    .select()
    .from(automationWaits)
    .where(eq(automationWaits.leadId, leadId))
    .limit(1);
  return wait ?? null;
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

export async function listAutomations(orgId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.orgId, orgId))
    .orderBy(asc(automations.createdAt));

  const allSteps = await db.select().from(automationSteps).orderBy(asc(automationSteps.position));

  return rows.map((automation) => ({
    automation,
    steps: allSteps.filter((step) => step.automationId === automation.id),
  }));
}

export async function getAutomation(orgId: string, automationId: string) {
  const db = await getDb();
  const [automation] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.orgId, orgId), eq(automations.id, automationId)))
    .limit(1);
  if (!automation) return null;

  const steps = await db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.automationId, automation.id))
    .orderBy(asc(automationSteps.position));

  return { automation, steps };
}

export async function listRecentRuns(orgId: string, limit = 20) {
  const db = await getDb();
  return db
    .select({ run: automationRuns, automation: { name: automations.name } })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .where(eq(automationRuns.orgId, orgId))
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
}

export async function toggleAutomation(automationId: string, active: boolean) {
  const db = await getDb();
  await db.update(automations).set({ active }).where(eq(automations.id, automationId));
}
