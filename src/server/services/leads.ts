import { and, eq, sql, desc, asc, ilike, or, inArray, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  leads,
  stages,
  pipelines,
  users,
  contents,
  type Lead,
  type LeadSource,
  type Stage,
} from '@/db/schema';
import { recordEvent, registerTouch } from './events';

export interface UpsertLeadInput {
  orgId: string;
  igUserId?: string | null;
  igUsername?: string | null;
  manychatSubscriberId?: string | null;
  externalId?: string | null;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  profilePicUrl?: string | null;
  followersCount?: number | null;
  country?: string | null;
  source?: LeadSource;
  contentId?: string | null;
  keywordId?: string | null;
  tags?: string[];
  customFields?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Encuentra o crea un lead a partir de cualquier identificador disponible.
 *
 * El orden importa: el id de Instagram es el identificador fuerte (no cambia),
 * el de ManyChat es estable por suscriptor, y el email solo se usa cuando
 * la interaccion no vino de Instagram.
 */
export async function upsertLead(input: UpsertLeadInput): Promise<{ lead: Lead; created: boolean }> {
  const db = await getDb();
  const existing = await findExistingLead(input);

  if (existing) {
    // Solo completamos huecos: nunca pisamos datos ya enriquecidos a mano.
    const patch: Partial<Lead> = { updatedAt: new Date() };
    if (!existing.igUserId && input.igUserId) patch.igUserId = input.igUserId;
    if (!existing.igUsername && input.igUsername) patch.igUsername = input.igUsername;
    if (!existing.manychatSubscriberId && input.manychatSubscriberId) {
      patch.manychatSubscriberId = input.manychatSubscriberId;
    }
    if (!existing.email && input.email) patch.email = input.email;
    if (!existing.phone && input.phone) patch.phone = input.phone;
    if (!existing.fullName && input.fullName) patch.fullName = input.fullName;
    if (!existing.country && input.country) patch.country = input.country;
    if (!existing.externalId && input.externalId) patch.externalId = input.externalId;
    if (input.profilePicUrl) patch.profilePicUrl = input.profilePicUrl;
    if (typeof input.followersCount === 'number') patch.followersCount = input.followersCount;
    if (input.customFields && Object.keys(input.customFields).length > 0) {
      patch.customFields = { ...existing.customFields, ...input.customFields };
    }
    if (input.tags?.length) {
      patch.tags = Array.from(new Set([...existing.tags, ...input.tags]));
    }

    const [updated] = await db.update(leads).set(patch).where(eq(leads.id, existing.id)).returning();
    return { lead: updated, created: false };
  }

  const entry = await getEntryStage(input.orgId);

  const [created] = await db
    .insert(leads)
    .values({
      orgId: input.orgId,
      igUserId: input.igUserId ?? null,
      igUsername: input.igUsername ?? null,
      manychatSubscriberId: input.manychatSubscriberId ?? null,
      externalId: input.externalId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      fullName: input.fullName ?? null,
      profilePicUrl: input.profilePicUrl ?? null,
      followersCount: input.followersCount ?? null,
      country: input.country ?? null,
      source: input.source ?? 'ig_dm',
      firstTouchContentId: input.contentId ?? null,
      lastTouchContentId: input.contentId ?? null,
      firstTouchKeywordId: input.keywordId ?? null,
      pipelineId: entry?.pipelineId ?? null,
      stageId: entry?.stage.id ?? null,
      tags: input.tags ?? [],
      customFields: input.customFields ?? {},
      createdAt: input.occurredAt ?? new Date(),
      stageChangedAt: input.occurredAt ?? new Date(),
      lastInteractionAt: input.occurredAt ?? new Date(),
    })
    .returning();

  await recordEvent({
    orgId: input.orgId,
    leadId: created.id,
    contentId: input.contentId ?? null,
    keywordId: input.keywordId ?? null,
    type: 'lead_created',
    channel: sourceToChannel(input.source ?? 'ig_dm'),
    source: input.source ?? 'ig_dm',
    payload: { username: input.igUsername, source: input.source },
    occurredAt: input.occurredAt,
  });

  if (input.contentId) {
    await registerTouch({
      orgId: input.orgId,
      leadId: created.id,
      contentId: input.contentId,
      keywordId: input.keywordId ?? null,
      channel: sourceToChannel(input.source ?? 'ig_dm'),
      occurredAt: input.occurredAt,
    });
  }

  return { lead: created, created: true };
}

async function findExistingLead(input: UpsertLeadInput): Promise<Lead | undefined> {
  const db = await getDb();
  const conditions = [];
  if (input.igUserId) conditions.push(eq(leads.igUserId, input.igUserId));
  if (input.manychatSubscriberId) {
    conditions.push(eq(leads.manychatSubscriberId, input.manychatSubscriberId));
  }
  if (input.externalId) conditions.push(eq(leads.externalId, input.externalId));
  if (input.email) conditions.push(eq(leads.email, input.email.toLowerCase()));
  if (input.igUsername && !input.igUserId) {
    conditions.push(eq(leads.igUsername, input.igUsername));
  }
  if (conditions.length === 0) return undefined;

  const [found] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, input.orgId), or(...conditions)))
    .limit(1);
  return found;
}

function sourceToChannel(source: LeadSource) {
  switch (source) {
    case 'ig_comment':
      return 'ig_comment' as const;
    case 'ig_story_reply':
      return 'ig_story' as const;
    case 'ig_dm':
    case 'ig_mention':
    case 'manychat':
      return 'ig_dm' as const;
    case 'form':
    case 'ig_bio_link':
      return 'web' as const;
    default:
      return 'system' as const;
  }
}

/** Primera etapa del pipeline por defecto: donde cae todo lead nuevo. */
async function getEntryStage(orgId: string): Promise<{ pipelineId: string; stage: Stage } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ pipeline: pipelines, stage: stages })
    .from(pipelines)
    .innerJoin(stages, eq(stages.pipelineId, pipelines.id))
    .where(eq(pipelines.orgId, orgId))
    .orderBy(desc(pipelines.isDefault), asc(stages.position))
    .limit(1);
  if (!row) return null;
  return { pipelineId: row.pipeline.id, stage: row.stage };
}

/**
 * Mueve un lead de etapa y deja constancia en el log de eventos.
 *
 * Si la etapa destino es de tipo `won` o `lost` tambien cierra el estado del lead,
 * para que el pipeline y la analitica nunca se contradigan.
 */
export async function moveLeadToStage(params: {
  leadId: string;
  stageId: string;
  actorId?: string | null;
  source?: string;
  occurredAt?: Date;
}): Promise<Lead> {
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, params.leadId)).limit(1);
  if (!lead) throw new Error(`Lead no encontrado: ${params.leadId}`);

  const [stage] = await db.select().from(stages).where(eq(stages.id, params.stageId)).limit(1);
  if (!stage) throw new Error(`Etapa no encontrada: ${params.stageId}`);

  if (lead.stageId === stage.id) return lead;

  const [previousStage] = lead.stageId
    ? await db.select().from(stages).where(eq(stages.id, lead.stageId)).limit(1)
    : [undefined];

  const occurredAt = params.occurredAt ?? new Date();
  const status = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'active';

  const [updated] = await db
    .update(leads)
    .set({
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      status,
      stageChangedAt: occurredAt,
      lastInteractionAt: occurredAt,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, lead.id))
    .returning();

  await recordEvent({
    orgId: lead.orgId,
    leadId: lead.id,
    type: 'stage_changed',
    source: params.source ?? 'crm',
    payload: {
      from: previousStage?.name ?? null,
      fromKind: previousStage?.kind ?? null,
      to: stage.name,
      toKind: stage.kind,
      actorId: params.actorId ?? null,
    },
    occurredAt,
  });

  return updated;
}

/** Mueve el lead a la primera etapa de un tipo dado (ej: la etapa de "reunion"). */
export async function moveLeadToKind(params: {
  leadId: string;
  kind: Stage['kind'];
  source?: string;
  occurredAt?: Date;
}): Promise<Lead | null> {
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, params.leadId)).limit(1);
  if (!lead) return null;

  const pipelineId = lead.pipelineId;
  const target = pipelineId
    ? await db
        .select()
        .from(stages)
        .where(and(eq(stages.pipelineId, pipelineId), eq(stages.kind, params.kind)))
        .orderBy(asc(stages.position))
        .limit(1)
    : [];

  if (target.length === 0) return lead;

  // No retrocedemos el pipeline por un evento automatico: si el lead ya esta
  // en "venta", un webhook de "reunion agendada" no debe devolverlo atras.
  const [currentStage] = lead.stageId
    ? await db.select().from(stages).where(eq(stages.id, lead.stageId)).limit(1)
    : [undefined];

  if (currentStage && currentStage.position > target[0].position && currentStage.kind !== 'lost') {
    return lead;
  }

  return moveLeadToStage({
    leadId: lead.id,
    stageId: target[0].id,
    source: params.source,
    occurredAt: params.occurredAt,
  });
}

export async function assignOwner(leadId: string, ownerId: string | null): Promise<void> {
  const db = await getDb();
  await db.update(leads).set({ ownerId, updatedAt: new Date() }).where(eq(leads.id, leadId));
}

export async function addTags(leadId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const merged = Array.from(new Set([...lead.tags, ...tags]));
  await db.update(leads).set({ tags: merged, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await recordEvent({
    orgId: lead.orgId,
    leadId,
    type: 'tag_added',
    payload: { tags },
  });
}

export async function removeTags(leadId: string, tags: string[]): Promise<void> {
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const remaining = lead.tags.filter((tag) => !tags.includes(tag));
  await db.update(leads).set({ tags: remaining, updatedAt: new Date() }).where(eq(leads.id, leadId));
}

export async function setCustomFields(
  leadId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  await db
    .update(leads)
    .set({ customFields: { ...lead.customFields, ...fields }, updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  await recordEvent({
    orgId: lead.orgId,
    leadId,
    type: 'field_updated',
    payload: { fields },
  });
}

/* ------------------------------------------------------------------ *
 * Consultas de listado
 * ------------------------------------------------------------------ */

export interface LeadFilters {
  orgId: string;
  search?: string;
  stageId?: string;
  ownerId?: string;
  contentId?: string;
  source?: LeadSource;
  status?: Lead['status'];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listLeads(filters: LeadFilters) {
  const db = await getDb();
  const where = [eq(leads.orgId, filters.orgId)];

  if (filters.search) {
    const term = `%${filters.search}%`;
    where.push(
      or(
        ilike(leads.igUsername, term),
        ilike(leads.fullName, term),
        ilike(leads.email, term),
      )!,
    );
  }
  if (filters.stageId) where.push(eq(leads.stageId, filters.stageId));
  if (filters.ownerId) where.push(eq(leads.ownerId, filters.ownerId));
  if (filters.contentId) where.push(eq(leads.firstTouchContentId, filters.contentId));
  if (filters.source) where.push(eq(leads.source, filters.source));
  if (filters.status) where.push(eq(leads.status, filters.status));
  if (filters.from) where.push(gte(leads.createdAt, filters.from));
  if (filters.to) where.push(lte(leads.createdAt, filters.to));

  const rows = await db
    .select({
      lead: leads,
      stage: { id: stages.id, name: stages.name, color: stages.color, kind: stages.kind },
      owner: { id: users.id, name: users.name },
      content: { id: contents.id, title: contents.title, type: contents.type },
    })
    .from(leads)
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(contents, eq(leads.firstTouchContentId, contents.id))
    .where(and(...where))
    .orderBy(desc(leads.lastInteractionAt), desc(leads.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(...where));

  return { rows, total: count ?? 0 };
}

export async function getLead(orgId: string, leadId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      lead: leads,
      stage: stages,
      owner: { id: users.id, name: users.name },
      content: contents,
    })
    .from(leads)
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(contents, eq(leads.firstTouchContentId, contents.id))
    .where(and(eq(leads.orgId, orgId), eq(leads.id, leadId)))
    .limit(1);
  return row ?? null;
}

/** Leads agrupados por etapa, listo para pintar el tablero kanban. */
export async function leadsByStage(orgId: string, limitPerStage = 25) {
  const db = await getDb();
  const rows = await db
    .select({
      lead: leads,
      stage: stages,
      owner: { id: users.id, name: users.name },
      content: { id: contents.id, title: contents.title },
    })
    .from(leads)
    .innerJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(contents, eq(leads.firstTouchContentId, contents.id))
    .where(and(eq(leads.orgId, orgId), inArray(leads.status, ['active', 'won'])))
    .orderBy(asc(stages.position), desc(leads.lastInteractionAt));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.stage.id) ?? [];
    if (list.length < limitPerStage) list.push(row);
    grouped.set(row.stage.id, list);
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.stage.id, (totals.get(row.stage.id) ?? 0) + 1);
  }

  return { grouped, totals };
}
