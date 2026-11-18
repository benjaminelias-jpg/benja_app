'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  automations,
  automationSteps,
  keywords,
  leads,
  type AutomationStepType,
  type Lead,
} from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { simulateAutomation, toggleAutomation } from '@/server/services/automations';
import { newId } from '@/lib/ids';

/* ------------------------------------------------------------------ *
 * Flujos
 * ------------------------------------------------------------------ */

export async function createAutomationAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const trigger = String(formData.get('trigger') ?? 'ig_comment_keyword');
  if (!name) return;

  const org = await getCurrentOrg();
  const db = await getDb();

  const [automation] = await db
    .insert(automations)
    .values({
      orgId: org.id,
      name,
      description: String(formData.get('description') ?? '') || null,
      trigger: trigger as 'ig_comment_keyword',
      active: false,
    })
    .returning();

  // Un flujo vacío no se puede probar ni entender: arranca con un primer paso.
  await db.insert(automationSteps).values({
    automationId: automation.id,
    position: 0,
    type: 'send_dm',
    nodeId: newId('n'),
    config: { text: 'Hola {{nombre}}! Gracias por escribir 👋' },
    canvasX: 80,
    canvasY: 80,
  });

  revalidatePath('/automatizaciones');
  redirect(`/automatizaciones/${automation.id}`);
}

export async function deleteAutomationAction(formData: FormData) {
  const automationId = String(formData.get('automationId') ?? '');
  if (!automationId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .delete(automations)
    .where(and(eq(automations.orgId, org.id), eq(automations.id, automationId)));
  revalidatePath('/automatizaciones');
  redirect('/automatizaciones');
}

export async function toggleAutomationAction(formData: FormData) {
  const automationId = String(formData.get('automationId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!automationId) return;
  await toggleAutomation(automationId, active);
  revalidatePath('/automatizaciones');
  revalidatePath(`/automatizaciones/${automationId}`);
}

export interface FlowNodePayload {
  nodeId: string;
  type: AutomationStepType;
  config: Record<string, unknown>;
  x: number;
  y: number;
  next: string | null;
  branches: Array<{ when: string; goTo: string }>;
}

export interface SaveFlowResult {
  ok: boolean;
  error?: string;
  saved?: number;
}

/**
 * Guarda el grafo completo del flujo.
 *
 * Reemplaza todos los pasos en una transaccion: es mas simple y mas seguro que
 * ir diferenciando altas, bajas y cambios, y el flujo nunca queda a medio
 * guardar con aristas que apuntan a nodos que ya no existen.
 */
export async function saveFlowAction(
  automationId: string,
  nodes: FlowNodePayload[],
  meta?: { name?: string; description?: string },
): Promise<SaveFlowResult> {
  const org = await getCurrentOrg();
  const db = await getDb();

  const [automation] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.orgId, org.id), eq(automations.id, automationId)))
    .limit(1);
  if (!automation) return { ok: false, error: 'No existe ese flujo.' };

  const ids = new Set(nodes.map((node) => node.nodeId));
  for (const node of nodes) {
    if (node.next && !ids.has(node.next)) {
      return { ok: false, error: `El paso "${node.nodeId}" apunta a un nodo que no existe.` };
    }
    for (const branch of node.branches) {
      if (branch.goTo && !ids.has(branch.goTo)) {
        return { ok: false, error: `Una rama de "${node.nodeId}" apunta a un nodo que no existe.` };
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(automationSteps).where(eq(automationSteps.automationId, automationId));
    if (nodes.length > 0) {
      await tx.insert(automationSteps).values(
        nodes.map((node, index) => ({
          automationId,
          position: index,
          type: node.type,
          config: node.config,
          nodeId: node.nodeId,
          nextNodeId: node.next,
          branches: node.branches,
          canvasX: Math.round(node.x),
          canvasY: Math.round(node.y),
        })),
      );
    }
    if (meta?.name || meta?.description !== undefined) {
      await tx
        .update(automations)
        .set({
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.description !== undefined ? { description: meta.description || null } : {}),
        })
        .where(eq(automations.id, automationId));
    }
  });

  revalidatePath('/automatizaciones');
  revalidatePath(`/automatizaciones/${automationId}`);
  return { ok: true, saved: nodes.length };
}

export interface TestResult {
  ok: boolean;
  status?: string;
  steps?: Array<{ type: string; status: string; detail?: string }>;
  error?: string;
  leadName?: string;
}

/**
 * Corre el flujo en seco contra un lead real (sin tocarlo) o uno de ejemplo.
 * Devuelve el recorrido paso a paso, incluidas las ramas que se eligieron.
 */
export async function testFlowAction(
  automationId: string,
  sampleReply: string,
): Promise<TestResult> {
  const org = await getCurrentOrg();
  const db = await getDb();

  const [existing] = await db
    .select()
    .from(leads)
    .where(eq(leads.orgId, org.id))
    .orderBy(desc(leads.createdAt))
    .limit(1);

  const lead: Lead =
    existing ??
    ({
      id: 'lead_prueba',
      orgId: org.id,
      igUserId: 'IG_PRUEBA',
      igUsername: 'lead.de.prueba',
      fullName: 'Lead de Prueba',
      email: null,
      tags: [],
      customFields: {},
      revenueCents: 0,
      followersCount: 1200,
      source: 'ig_comment',
      pipelineId: null,
      stageId: null,
    } as unknown as Lead);

  try {
    const result = await simulateAutomation(automationId, {
      orgId: org.id,
      lead,
      text: sampleReply,
      commentId: 'COMENTARIO_DE_PRUEBA',
      source: 'prueba',
    });

    return {
      ok: true,
      status: result.status,
      leadName: lead.fullName ?? lead.igUsername ?? 'lead',
      steps: result.steps.map((step) => ({
        type: step.type,
        status: step.status,
        detail: step.detail,
      })),
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ *
 * Palabras clave
 * ------------------------------------------------------------------ */

export async function createKeywordAction(formData: FormData) {
  const word = String(formData.get('word') ?? '').trim();
  if (!word) return;

  const org = await getCurrentOrg();
  const db = await getDb();

  await db.insert(keywords).values({
    orgId: org.id,
    word,
    matchType: (String(formData.get('matchType') ?? 'exact') as 'exact'),
    channel: (String(formData.get('channel') ?? 'ig_comment') as 'ig_comment'),
    contentId: String(formData.get('contentId') ?? '') || null,
    automationId: String(formData.get('automationId') ?? '') || null,
    resourceName: String(formData.get('resourceName') ?? '') || null,
    resourceUrl: String(formData.get('resourceUrl') ?? '') || null,
    active: true,
  });

  revalidatePath('/automatizaciones');
  revalidatePath('/contenido');
}

export async function updateKeywordAction(formData: FormData) {
  const keywordId = String(formData.get('keywordId') ?? '');
  if (!keywordId) return;
  const org = await getCurrentOrg();
  const db = await getDb();

  const patch: Record<string, unknown> = {};
  const word = String(formData.get('word') ?? '').trim();
  if (word) patch.word = word;
  if (formData.has('active')) patch.active = String(formData.get('active')) === 'true';
  if (formData.has('automationId')) {
    patch.automationId = String(formData.get('automationId') ?? '') || null;
  }
  if (formData.has('contentId')) patch.contentId = String(formData.get('contentId') ?? '') || null;
  if (formData.has('resourceUrl')) {
    patch.resourceUrl = String(formData.get('resourceUrl') ?? '') || null;
  }

  await db
    .update(keywords)
    .set(patch)
    .where(and(eq(keywords.orgId, org.id), eq(keywords.id, keywordId)));

  revalidatePath('/automatizaciones');
  revalidatePath('/contenido');
}

export async function deleteKeywordAction(formData: FormData) {
  const keywordId = String(formData.get('keywordId') ?? '');
  if (!keywordId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db.delete(keywords).where(and(eq(keywords.orgId, org.id), eq(keywords.id, keywordId)));
  revalidatePath('/automatizaciones');
  revalidatePath('/contenido');
}
