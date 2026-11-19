import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestConversion, UnknownLeadError } from '@/server/services/ingest';
import { badRequest, isResponse, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['meeting', 'meeting_held', 'no_show', 'sale', 'refund']),
  leadId: z.string().optional(),
  igUsername: z.string().optional(),
  igUserId: z.string().optional(),
  manychatSubscriberId: z.string().optional(),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  scheduledAt: z.string().optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().optional(),
  productId: z.string().optional(),
  ownerId: z.string().optional(),
  externalId: z.string().optional(),
  contentId: z.string().optional(),
  igMediaId: z.string().optional(),
  refCode: z.string().optional(),
  occurredAt: z.string().optional(),
});

/**
 * POST /api/v1/conversions
 *
 * Una sola ruta para marcar reunion, asistencia, no-show, venta o reembolso.
 * Es la que se llama desde ManyChat, Make o el checkout propio cuando algo
 * avanza en el embudo. La atribucion al contenido la resuelve el CRM.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('JSON invalido');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest('Payload invalido', parsed.error.issues);

  const data = parsed.data;
  if (!data.leadId && !data.igUsername && !data.igUserId && !data.email && !data.manychatSubscriberId) {
    return badRequest('Hace falta identificar al lead: leadId, igUsername, igUserId, email o manychatSubscriberId');
  }

  try {
    const result = await ingestConversion({
      orgId: auth.org.id,
      kind: data.kind,
      leadId: data.leadId,
      igUserId: data.igUserId,
      igUsername: data.igUsername?.replace(/^@/, ''),
      manychatSubscriberId: data.manychatSubscriberId,
      email: data.email,
      fullName: data.fullName,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      amountCents: data.amountCents ?? null,
      currency: data.currency ?? null,
      productId: data.productId ?? null,
      ownerId: data.ownerId ?? null,
      externalId: data.externalId ?? null,
      contentId: data.contentId ?? null,
      igMediaId: data.igMediaId ?? null,
      refCode: data.refCode ?? null,
      source: 'api',
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
    });

    return NextResponse.json({
      ok: true,
      kind: data.kind,
      leadId: result.lead.id,
      dealId: result.deal?.id ?? null,
      appointmentId: result.appointment?.id ?? null,
      attributedContentId: result.deal?.contentId ?? result.appointment?.contentId ?? null,
    });
  } catch (error) {
    // Un leadId que no existe es un error del que llama, no nuestro.
    if (error instanceof UnknownLeadError) return badRequest(error.message);
    return serverError(error);
  }
}
