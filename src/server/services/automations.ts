import { and, eq, asc, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  automations,
  automationSteps,
  automationRuns,
  instagramAccounts,
  messages,
  stages,
  users,
  type Automation,
  type AutomationStep,
  type Content,
  type Keyword,
  type Lead,
} from '@/db/schema';
import { recordEvent } from './events';
import { addTags, removeTags, assignOwner, setCustomFields, moveLeadToStage } from './leads';
import { bookMeeting, recordSale } from './commerce';
import { sendDirectMessage, sendPrivateReply, replyToComment } from '../integrations/instagram';
import { addManychatTag, setManychatField } from '../integrations/manychat';

/**
 * Motor de automatizaciones.
 *
 * Una automatizacion es una lista ordenada de pasos que se ejecutan sobre un
 * lead. Equivale a un flujo de ManyChat, con dos diferencias importantes:
 * cada paso queda registrado en `automation_runs`, y todos los pasos arrastran
 * el `contentId` del disparador, de modo que lo que haga el flujo sigue siendo
 * atribuible al reel que lo origino.
 */

export interface AutomationContext {
  orgId: string;
  lead: Lead;
  content?: Content | null;
  keyword?: Keyword | null;
  /** Id del comentario de Instagram, si el disparador fue un comentario. */
  commentId?: string | null;
  /** Texto que disparo la automatizacion. */
  text?: string | null;
  source?: string;
}

export interface StepLogEntry {
  position: number;
  type: AutomationStep['type'];
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
  dryRun?: boolean;
}

export interface RunResult {
  runId: string;
  status: 'completed' | 'failed' | 'skipped';
  steps: StepLogEntry[];
}

/** Sustituye variables tipo {{nombre}} en los textos de los pasos. */
export function renderTemplate(template: string, context: AutomationContext): string {
  const values: Record<string, string> = {
    nombre: context.lead.fullName ?? context.lead.igUsername ?? 'hola',
    usuario: context.lead.igUsername ? `@${context.lead.igUsername}` : '',
    username: context.lead.igUsername ?? '',
    email: context.lead.email ?? '',
    contenido: context.content?.title ?? '',
    recurso: context.keyword?.resourceName ?? '',
    link: context.keyword?.resourceUrl ?? '',
    palabra: context.keyword?.word ?? '',
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value !== undefined ? value : match;
  });
}

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

  const steps = await db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.automationId, automation.id))
    .orderBy(asc(automationSteps.position));

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

  const log: StepLogEntry[] = [];
  let failed = false;

  for (const step of steps) {
    try {
      const entry = await executeStep(step, context, automation);
      log.push(entry);
      if (entry.status === 'failed') {
        failed = true;
        break;
      }
    } catch (error) {
      log.push({
        position: step.position,
        type: step.type,
        status: 'failed',
        detail: (error as Error).message,
      });
      failed = true;
      break;
    }
  }

  await db
    .update(automationRuns)
    .set({
      status: failed ? 'failed' : 'completed',
      stepsLog: log,
      error: failed ? (log.at(-1)?.detail ?? 'error desconocido') : null,
      finishedAt: new Date(),
    })
    .where(eq(automationRuns.id, run.id));

  await db
    .update(automations)
    .set({ runsCount: sql`${automations.runsCount} + 1` })
    .where(eq(automations.id, automation.id));

  await recordEvent({
    orgId: context.orgId,
    leadId: context.lead.id,
    contentId: context.content?.id ?? null,
    keywordId: context.keyword?.id ?? null,
    automationId: automation.id,
    type: 'automation_run',
    source: context.source ?? 'automation',
    payload: { automation: automation.name, steps: log.length, failed },
  });

  return { runId: run.id, status: failed ? 'failed' : 'completed', steps: log };
}

async function executeStep(
  step: AutomationStep,
  context: AutomationContext,
  automation: Automation,
): Promise<StepLogEntry> {
  const db = await getDb();
  const config = step.config as Record<string, never> & Record<string, unknown>;
  const base = { position: step.position, type: step.type };

  switch (step.type) {
    case 'send_dm':
    case 'send_resource': {
      const template =
        (config.text as string) ??
        (step.type === 'send_resource'
          ? 'Listo {{nombre}}, aca lo tenes: {{link}}'
          : 'Hola {{nombre}}!');
      const text = renderTemplate(template, context);

      const [account] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.orgId, context.orgId))
        .limit(1);

      if (!account) {
        return { ...base, status: 'skipped', detail: 'No hay cuenta de Instagram conectada' };
      }

      // Si venimos de un comentario, la respuesta privada es la via correcta:
      // abre el DM aunque nunca hayan escrito antes.
      const result = context.commentId
        ? await sendPrivateReply({
            igAccountId: account.igUserId,
            commentId: context.commentId,
            text,
            token: account.accessToken,
          })
        : await sendDirectMessage({
            igAccountId: account.igUserId,
            recipientIgId: context.lead.igUserId ?? '',
            text,
            token: account.accessToken,
          });

      await db.insert(messages).values({
        orgId: context.orgId,
        leadId: context.lead.id,
        contentId: context.content?.id ?? null,
        direction: 'outbound',
        channel: 'ig_dm',
        body: text,
        automatedBy: automation.id,
      });

      await recordEvent({
        orgId: context.orgId,
        leadId: context.lead.id,
        contentId: context.content?.id ?? null,
        keywordId: context.keyword?.id ?? null,
        automationId: automation.id,
        type: step.type === 'send_resource' ? 'resource_sent' : 'dm_sent',
        channel: 'ig_dm',
        source: context.source ?? 'automation',
        payload: { text, dryRun: result.dryRun },
      });

      return {
        ...base,
        status: result.ok ? 'done' : 'failed',
        detail: result.ok ? text.slice(0, 120) : result.error,
        dryRun: result.dryRun,
      };
    }

    case 'reply_comment': {
      if (!context.commentId) {
        return { ...base, status: 'skipped', detail: 'El disparador no fue un comentario' };
      }
      const text = renderTemplate((config.text as string) ?? 'Te lo mande por DM 📩', context);
      const [account] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.orgId, context.orgId))
        .limit(1);
      const result = await replyToComment({
        commentId: context.commentId,
        text,
        token: account?.accessToken,
      });
      return {
        ...base,
        status: result.ok ? 'done' : 'failed',
        detail: text,
        dryRun: result.dryRun,
      };
    }

    case 'add_tag': {
      const tags = toStringArray(config.tags ?? config.tag);
      await addTags(context.lead.id, tags);
      if (context.lead.manychatSubscriberId) {
        for (const tag of tags) await addManychatTag(context.lead.manychatSubscriberId, tag);
      }
      return { ...base, status: 'done', detail: tags.join(', ') };
    }

    case 'remove_tag': {
      const tags = toStringArray(config.tags ?? config.tag);
      await removeTags(context.lead.id, tags);
      return { ...base, status: 'done', detail: tags.join(', ') };
    }

    case 'set_stage': {
      const stageKey = config.stageKey as string | undefined;
      const stageId = config.stageId as string | undefined;

      let target = stageId;
      if (!target && stageKey && context.lead.pipelineId) {
        const [found] = await db
          .select()
          .from(stages)
          .where(and(eq(stages.pipelineId, context.lead.pipelineId), eq(stages.key, stageKey)))
          .limit(1);
        target = found?.id;
      }
      if (!target) return { ...base, status: 'skipped', detail: 'Etapa no encontrada' };

      await moveLeadToStage({
        leadId: context.lead.id,
        stageId: target,
        source: `automation:${automation.name}`,
      });
      if (context.lead.manychatSubscriberId) {
        await setManychatField(context.lead.manychatSubscriberId, 'crm_stage', stageKey ?? target);
      }
      return { ...base, status: 'done', detail: stageKey ?? target };
    }

    case 'set_field': {
      const fields = (config.fields as Record<string, unknown>) ?? {};
      await setCustomFields(context.lead.id, fields);
      return { ...base, status: 'done', detail: Object.keys(fields).join(', ') };
    }

    case 'assign_owner': {
      let ownerId = config.ownerId as string | undefined;
      if (!ownerId && config.strategy === 'round_robin') {
        ownerId = await pickRoundRobinOwner(context.orgId);
      }
      if (!ownerId) return { ...base, status: 'skipped', detail: 'Sin responsable disponible' };
      await assignOwner(context.lead.id, ownerId);
      return { ...base, status: 'done', detail: ownerId };
    }

    case 'create_appointment': {
      const whenRaw = config.scheduledAt as string | undefined;
      const scheduledAt = whenRaw ? new Date(whenRaw) : new Date(Date.now() + 86_400_000);
      await bookMeeting({
        orgId: context.orgId,
        leadId: context.lead.id,
        scheduledAt,
        title: (config.title as string) ?? 'Llamada de diagnostico',
        source: `automation:${automation.name}`,
        contentId: context.content?.id ?? null,
      });
      return { ...base, status: 'done', detail: scheduledAt.toISOString() };
    }

    case 'create_deal': {
      const amountCents = Number(config.amountCents ?? 0);
      await recordSale({
        orgId: context.orgId,
        leadId: context.lead.id,
        amountCents,
        productId: (config.productId as string) ?? null,
        source: `automation:${automation.name}`,
        contentId: context.content?.id ?? null,
      });
      return { ...base, status: 'done', detail: `${amountCents} centavos` };
    }

    case 'http_request': {
      const url = config.url as string | undefined;
      if (!url) return { ...base, status: 'skipped', detail: 'Sin URL' };
      try {
        const response = await fetch(url, {
          method: (config.method as string) ?? 'POST',
          headers: { 'content-type': 'application/json', ...(config.headers as object) },
          body: JSON.stringify({
            lead: {
              id: context.lead.id,
              igUsername: context.lead.igUsername,
              email: context.lead.email,
            },
            content: context.content ? { id: context.content.id, title: context.content.title } : null,
            keyword: context.keyword?.word ?? null,
          }),
        });
        return {
          ...base,
          status: response.ok ? 'done' : 'failed',
          detail: `HTTP ${response.status}`,
        };
      } catch (error) {
        return { ...base, status: 'failed', detail: (error as Error).message };
      }
    }

    case 'wait': {
      // Las esperas necesitan un worker de cola persistente. Se registran como
      // omitidas en vez de bloquear el webhook, que debe responder en milisegundos.
      return {
        ...base,
        status: 'skipped',
        detail: `Espera de ${config.minutes ?? 0} min: requiere worker de cola`,
      };
    }

    case 'notify': {
      return { ...base, status: 'done', detail: (config.message as string) ?? 'notificacion' };
    }

    default:
      return { ...base, status: 'skipped', detail: 'Tipo de paso no soportado' };
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

/** Reparte leads entre los closers activos, de forma equilibrada. */
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
 * Consultas
 * ------------------------------------------------------------------ */

export async function listAutomations(orgId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.orgId, orgId))
    .orderBy(asc(automations.createdAt));

  const allSteps = await db
    .select()
    .from(automationSteps)
    .orderBy(asc(automationSteps.position));

  return rows.map((automation) => ({
    automation,
    steps: allSteps.filter((step) => step.automationId === automation.id),
  }));
}

export async function listRecentRuns(orgId: string, limit = 20) {
  const db = await getDb();
  return db
    .select({ run: automationRuns, automation: { name: automations.name } })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .where(eq(automationRuns.orgId, orgId))
    .orderBy(sql`${automationRuns.startedAt} DESC`)
    .limit(limit);
}

export async function toggleAutomation(automationId: string, active: boolean) {
  const db = await getDb();
  await db.update(automations).set({ active }).where(eq(automations.id, automationId));
}
