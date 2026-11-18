import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  events,
  leads,
  attributionTouches,
  contents,
  type Event,
  type EventType,
} from '@/db/schema';

export interface RecordEventInput {
  orgId: string;
  type: EventType;
  leadId?: string | null;
  contentId?: string | null;
  keywordId?: string | null;
  automationId?: string | null;
  dealId?: string | null;
  appointmentId?: string | null;
  channel?: Event['channel'];
  source?: string | null;
  valueCents?: number;
  payload?: Record<string, unknown>;
  /** Clave de idempotencia. Si el mismo webhook llega dos veces, no se duplica el evento. */
  dedupeKey?: string | null;
  occurredAt?: Date;
}

/**
 * Registra un evento en el log inmutable.
 *
 * Es la unica puerta de entrada a `events`: toda la analitica de atribucion
 * se calcula sobre esta tabla, asi que si algo no pasa por aqui, no existe.
 *
 * Devuelve `{ event, created }`. Si `created` es false, el evento ya estaba
 * registrado con la misma `dedupeKey` y se devuelve el original.
 */
export async function recordEvent(
  input: RecordEventInput,
): Promise<{ event: Event; created: boolean }> {
  const db = await getDb();

  // Si no se pasa contenido explicito, se hereda el de la atribucion del lead.
  let contentId = input.contentId ?? null;
  if (!contentId && input.leadId) {
    contentId = await inheritContentFromLead(input.leadId);
  }

  const values = {
    orgId: input.orgId,
    leadId: input.leadId ?? null,
    contentId,
    keywordId: input.keywordId ?? null,
    automationId: input.automationId ?? null,
    dealId: input.dealId ?? null,
    appointmentId: input.appointmentId ?? null,
    type: input.type,
    channel: input.channel ?? ('system' as const),
    source: input.source ?? null,
    valueCents: input.valueCents ?? 0,
    payload: input.payload ?? {},
    dedupeKey: input.dedupeKey ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  };

  const inserted = await db
    .insert(events)
    .values(values)
    .onConflictDoNothing({ target: [events.orgId, events.dedupeKey] })
    .returning();

  if (inserted.length > 0) {
    // Los webhooks salientes salen solo de eventos NUEVOS: un reenvio idempotente
    // no debe volver a avisarle a nadie.
    await notifySubscribers(inserted[0]);
    return { event: inserted[0], created: true };
  }

  // Hubo conflicto de idempotencia: devolvemos el evento que ya existia.
  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.orgId, input.orgId), eq(events.dedupeKey, input.dedupeKey!)))
    .limit(1);

  if (!existing) {
    // Caso raro: conflicto sin fila (carrera). Reintentamos sin dedupe.
    const [fallback] = await db
      .insert(events)
      .values({ ...values, dedupeKey: null })
      .returning();
    return { event: fallback, created: true };
  }

  return { event: existing, created: false };
}

/**
 * Avisa a las integraciones suscritas. Nunca propaga su error: que un webhook
 * saliente falle no puede hacer fallar el evento que lo origino.
 */
async function notifySubscribers(event: Event): Promise<void> {
  try {
    const { dispatchEvent } = await import('./outbound');
    await dispatchEvent(event);
  } catch (error) {
    console.error('[events] no se pudo despachar el webhook saliente', error);
  }
}

/** El contenido atribuido por defecto de un lead es su primer touch. */
async function inheritContentFromLead(leadId: string): Promise<string | null> {
  const db = await getDb();
  const [lead] = await db
    .select({
      first: leads.firstTouchContentId,
      last: leads.lastTouchContentId,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  return lead?.first ?? lead?.last ?? null;
}

/**
 * Registra un punto de contacto entre un lead y una pieza de contenido.
 *
 * - El primer contacto queda como `first` y fija `leads.firstTouchContentId`.
 * - Los siguientes son `assist` y mueven `leads.lastTouchContentId`.
 *
 * Mantener las dos cosas (tabla de touches + campos desnormalizados en `leads`)
 * permite atribucion multi-touch sin pagar un JOIN en cada listado del CRM.
 */
export async function registerTouch(params: {
  orgId: string;
  leadId: string;
  contentId: string | null;
  keywordId?: string | null;
  channel?: Event['channel'];
  occurredAt?: Date;
}): Promise<void> {
  if (!params.contentId) return;
  const db = await getDb();
  const occurredAt = params.occurredAt ?? new Date();

  const [existingTouches] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attributionTouches)
    .where(eq(attributionTouches.leadId, params.leadId));

  const isFirst = (existingTouches?.count ?? 0) === 0;

  await db.insert(attributionTouches).values({
    orgId: params.orgId,
    leadId: params.leadId,
    contentId: params.contentId,
    keywordId: params.keywordId ?? null,
    type: isFirst ? 'first' : 'assist',
    channel: params.channel ?? 'ig_dm',
    occurredAt,
  });

  await db
    .update(leads)
    .set({
      lastTouchContentId: params.contentId,
      lastInteractionAt: occurredAt,
      updatedAt: new Date(),
      // El primer touch solo se fija si todavia estaba vacio: nunca se reescribe.
      ...(isFirst ? { firstTouchContentId: params.contentId } : {}),
    })
    .where(eq(leads.id, params.leadId));

  if (!isFirst) {
    await db
      .update(leads)
      .set({ firstTouchContentId: sql`coalesce(${leads.firstTouchContentId}, ${params.contentId})` })
      .where(eq(leads.id, params.leadId));
  }
}

/** Historial de eventos de un lead, del mas reciente al mas antiguo. */
export async function getLeadTimeline(leadId: string, limit = 100) {
  const db = await getDb();
  return db
    .select({
      event: events,
      content: { id: contents.id, title: contents.title, type: contents.type },
    })
    .from(events)
    .leftJoin(contents, eq(events.contentId, contents.id))
    .where(eq(events.leadId, leadId))
    .orderBy(desc(events.occurredAt))
    .limit(limit);
}
