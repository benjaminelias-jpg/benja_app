'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { leads } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { bookMeeting, recordSale, setMeetingOutcome } from '@/server/services/commerce';

/** Agenda una reunión a mano. Queda atribuida al contenido que trajo al lead. */
export async function bookMeetingAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  const whenRaw = String(formData.get('scheduledAt') ?? '');
  if (!leadId || !whenRaw) return;

  const scheduledAt = new Date(whenRaw);
  if (Number.isNaN(scheduledAt.getTime())) return;

  const org = await getCurrentOrg();
  await bookMeeting({
    orgId: org.id,
    leadId,
    scheduledAt,
    title: String(formData.get('title') ?? '') || 'Llamada de diagnostico',
    ownerId: String(formData.get('ownerId') ?? '') || null,
    source: 'crm-manual',
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/');
}

export async function setMeetingOutcomeAction(formData: FormData) {
  const appointmentId = String(formData.get('appointmentId') ?? '');
  const leadId = String(formData.get('leadId') ?? '');
  const status = String(formData.get('status') ?? 'held') as 'held' | 'no_show';
  if (!appointmentId) return;

  await setMeetingOutcome({ appointmentId, status });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/');
}

/** Registra una venta a mano, con la misma atribución que una venta por webhook. */
export async function recordSaleAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  if (!leadId || !amount) return;

  const org = await getCurrentOrg();
  await recordSale({
    orgId: org.id,
    leadId,
    amountCents: Math.round(amount * 100),
    productId: String(formData.get('productId') ?? '') || null,
    ownerId: String(formData.get('ownerId') ?? '') || null,
    source: 'crm-manual',
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/');
  revalidatePath('/contenido');
}

export async function saveNotesAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  if (!leadId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .update(leads)
    .set({ notes: String(formData.get('notes') ?? ''), updatedAt: new Date() })
    .where(and(eq(leads.orgId, org.id), eq(leads.id, leadId)));
  revalidatePath(`/leads/${leadId}`);
}
