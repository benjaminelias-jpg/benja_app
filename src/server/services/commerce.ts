import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  appointments,
  deals,
  leads,
  products,
  organizations,
  contents,
  users,
  type Appointment,
  type Deal,
} from '@/db/schema';
import { recordEvent } from './events';
import { attributedContentForLead } from './attribution';
import { moveLeadToKind } from './leads';

/* ------------------------------------------------------------------ *
 * Reuniones
 * ------------------------------------------------------------------ */

export interface BookMeetingInput {
  orgId: string;
  leadId: string;
  scheduledAt: Date;
  title?: string;
  durationMinutes?: number;
  ownerId?: string | null;
  source?: string;
  meetingUrl?: string | null;
  externalId?: string | null;
  contentId?: string | null;
  /** Cuando se registro el agendamiento (distinto de cuando ocurre la reunion). */
  occurredAt?: Date;
}

/**
 * Agenda una reunion y la ata al contenido que trajo al lead.
 *
 * El `contentId` se congela aqui a proposito: si manana el lead vuelve por otro
 * reel, esta reunion sigue acreditada al contenido correcto.
 */
export async function bookMeeting(input: BookMeetingInput): Promise<Appointment> {
  const db = await getDb();
  const contentId =
    input.contentId ?? (await attributedContentForLead(input.leadId, { at: new Date() }));

  const existing = input.externalId
    ? await db
        .select()
        .from(appointments)
        .where(
          and(eq(appointments.orgId, input.orgId), eq(appointments.externalId, input.externalId)),
        )
        .limit(1)
    : [];

  if (existing.length > 0) {
    const [updated] = await db
      .update(appointments)
      .set({ scheduledAt: input.scheduledAt, status: 'scheduled' })
      .where(eq(appointments.id, existing[0].id))
      .returning();
    return updated;
  }

  const [appointment] = await db
    .insert(appointments)
    .values({
      orgId: input.orgId,
      leadId: input.leadId,
      contentId,
      ownerId: input.ownerId ?? null,
      title: input.title ?? 'Llamada de diagnostico',
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes ?? 30,
      source: input.source ?? 'crm',
      meetingUrl: input.meetingUrl ?? null,
      externalId: input.externalId ?? null,
      createdAt: input.occurredAt ?? new Date(),
    })
    .returning();

  await recordEvent({
    orgId: input.orgId,
    leadId: input.leadId,
    contentId,
    appointmentId: appointment.id,
    type: 'meeting_booked',
    source: input.source ?? 'crm',
    payload: { scheduledAt: input.scheduledAt.toISOString(), title: appointment.title },
    dedupeKey: input.externalId ? `meeting_booked:${input.externalId}` : null,
    occurredAt: input.occurredAt,
  });

  await moveLeadToKind({
    leadId: input.leadId,
    kind: 'meeting',
    source: input.source ?? 'crm',
    occurredAt: input.occurredAt,
  });

  return appointment;
}

/** Marca el resultado de una reunion: asistio, no asistio o se cancelo. */
export async function setMeetingOutcome(params: {
  appointmentId: string;
  status: Appointment['status'];
  occurredAt?: Date;
}): Promise<Appointment | null> {
  const db = await getDb();
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, params.appointmentId))
    .limit(1);
  if (!appointment) return null;

  const [updated] = await db
    .update(appointments)
    .set({ status: params.status })
    .where(eq(appointments.id, appointment.id))
    .returning();

  const eventType =
    params.status === 'held'
      ? ('meeting_held' as const)
      : params.status === 'no_show'
        ? ('meeting_no_show' as const)
        : null;

  if (eventType) {
    await recordEvent({
      orgId: appointment.orgId,
      leadId: appointment.leadId,
      contentId: appointment.contentId,
      appointmentId: appointment.id,
      type: eventType,
      source: 'crm',
      occurredAt: params.occurredAt,
      dedupeKey: `${eventType}:${appointment.id}`,
    });
  }

  return updated;
}

/* ------------------------------------------------------------------ *
 * Ventas
 * ------------------------------------------------------------------ */

export interface RecordSaleInput {
  orgId: string;
  leadId: string;
  amountCents: number;
  currency?: string;
  productId?: string | null;
  ownerId?: string | null;
  paymentPlan?: string | null;
  source?: string;
  externalId?: string | null;
  contentId?: string | null;
  closedAt?: Date;
}

/**
 * Registra una venta cerrada.
 *
 * Esta es la funcion que cierra el circulo del producto: la venta queda atada
 * al contenido que originalmente trajo al lead, y por eso el reporte puede
 * decir "este reel genero 4.200 USD".
 */
export async function recordSale(input: RecordSaleInput): Promise<Deal> {
  const db = await getDb();
  const closedAt = input.closedAt ?? new Date();

  const [org] = await db
    .select({ window: organizations.attributionWindowDays, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);

  const contentId =
    input.contentId ??
    (await attributedContentForLead(input.leadId, {
      at: closedAt,
      windowDays: org?.window ?? 90,
    }));

  if (input.externalId) {
    const [duplicate] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.orgId, input.orgId), eq(deals.externalId, input.externalId)))
      .limit(1);
    if (duplicate) return duplicate;
  }

  const [deal] = await db
    .insert(deals)
    .values({
      orgId: input.orgId,
      leadId: input.leadId,
      productId: input.productId ?? null,
      contentId,
      ownerId: input.ownerId ?? null,
      amountCents: input.amountCents,
      currency: input.currency ?? org?.currency ?? 'USD',
      status: 'won',
      paymentPlan: input.paymentPlan ?? null,
      source: input.source ?? 'crm',
      externalId: input.externalId ?? null,
      closedAt,
    })
    .returning();

  await recordEvent({
    orgId: input.orgId,
    leadId: input.leadId,
    contentId,
    dealId: deal.id,
    type: 'sale',
    source: input.source ?? 'crm',
    valueCents: input.amountCents,
    payload: { productId: input.productId, paymentPlan: input.paymentPlan },
    occurredAt: closedAt,
    dedupeKey: input.externalId ? `sale:${input.externalId}` : null,
  });

  await db
    .update(leads)
    .set({
      revenueCents: sql`${leads.revenueCents} + ${input.amountCents}`,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, input.leadId));

  await moveLeadToKind({
    leadId: input.leadId,
    kind: 'won',
    source: input.source ?? 'crm',
    occurredAt: closedAt,
  });

  return deal;
}

/** Devolucion: resta ingresos y deja el evento en negativo para la analitica. */
export async function recordRefund(params: {
  dealId: string;
  amountCents?: number;
  occurredAt?: Date;
}): Promise<void> {
  const db = await getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, params.dealId)).limit(1);
  if (!deal) return;

  const amount = params.amountCents ?? deal.amountCents;

  await db.update(deals).set({ status: 'refunded' }).where(eq(deals.id, deal.id));
  await db
    .update(leads)
    .set({ revenueCents: sql`${leads.revenueCents} - ${amount}` })
    .where(eq(leads.id, deal.leadId));

  await recordEvent({
    orgId: deal.orgId,
    leadId: deal.leadId,
    contentId: deal.contentId,
    dealId: deal.id,
    type: 'refund',
    valueCents: -amount,
    occurredAt: params.occurredAt,
    dedupeKey: `refund:${deal.id}`,
  });
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

export async function listUpcomingMeetings(orgId: string, limit = 10) {
  const db = await getDb();
  return db
    .select({
      appointment: appointments,
      lead: { id: leads.id, igUsername: leads.igUsername, fullName: leads.fullName },
      owner: { id: users.id, name: users.name },
      content: { id: contents.id, title: contents.title },
    })
    .from(appointments)
    .innerJoin(leads, eq(appointments.leadId, leads.id))
    .leftJoin(users, eq(appointments.ownerId, users.id))
    .leftJoin(contents, eq(appointments.contentId, contents.id))
    .where(and(eq(appointments.orgId, orgId), sql`${appointments.scheduledAt} >= now()`))
    .orderBy(appointments.scheduledAt)
    .limit(limit);
}

export async function listRecentDeals(orgId: string, limit = 10) {
  const db = await getDb();
  return db
    .select({
      deal: deals,
      lead: { id: leads.id, igUsername: leads.igUsername, fullName: leads.fullName },
      product: { id: products.id, name: products.name },
      content: { id: contents.id, title: contents.title, type: contents.type },
    })
    .from(deals)
    .innerJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(products, eq(deals.productId, products.id))
    .leftJoin(contents, eq(deals.contentId, contents.id))
    .where(and(eq(deals.orgId, orgId), eq(deals.status, 'won')))
    .orderBy(desc(deals.closedAt))
    .limit(limit);
}

export async function listAppointmentsForLead(leadId: string) {
  const db = await getDb();
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.leadId, leadId))
    .orderBy(desc(appointments.scheduledAt));
}

export async function listDealsForLead(leadId: string) {
  const db = await getDb();
  return db
    .select({ deal: deals, product: { id: products.id, name: products.name } })
    .from(deals)
    .leftJoin(products, eq(deals.productId, products.id))
    .where(eq(deals.leadId, leadId))
    .orderBy(desc(deals.createdAt));
}
