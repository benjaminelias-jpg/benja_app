import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { safeCompare } from '@/lib/crypto';
import { getCurrentOrg } from '@/server/context';
import { ingestConversion, ingestInteraction } from '@/server/services/ingest';
import { completeDelivery, headersToObject, logDelivery } from '@/server/services/webhooks';
import {
  manychatPayloadSchema,
  mapManychatEvent,
  normalizeManychat,
} from '@/server/integrations/manychat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de ManyChat.
 *
 * En ManyChat se configura con el bloque "External Request" apuntando a:
 *   POST https://<tu-dominio>/api/webhooks/manychat
 *   Header:  x-hook-secret: <MANYCHAT_WEBHOOK_SECRET>
 *
 * El mismo endpoint sirve para las cuatro cosas que importan en infoproductos,
 * distinguidas por el campo `event`:
 *
 *   { "event": "keyword", "subscriber_id": "...", "ig_username": "...",
 *     "keyword": "GUIA", "ig_media_id": "178..." }      -> lead + atribucion
 *   { "event": "reu",   "scheduled_at": "2026-02-01T15:00:00Z" }  -> reunion
 *   { "event": "venta", "amount": "997", "currency": "USD" }      -> venta
 *   { "event": "no_show" }                                        -> no asistio
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const headers = headersToObject(request.headers);

  // Secreto compartido simple: ManyChat no firma con HMAC.
  if (env.manychatWebhookSecret) {
    const provided = request.headers.get('x-hook-secret') ?? '';
    if (!safeCompare(provided, env.manychatWebhookSecret)) {
      return NextResponse.json({ error: 'Secreto invalido' }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const delivery = await logDelivery({ provider: 'manychat', headers, payload: body });

  const parsed = manychatPayloadSchema.safeParse(body);
  if (!parsed.success) {
    await completeDelivery(delivery.id, {
      status: 'failed',
      error: JSON.stringify(parsed.error.issues.slice(0, 5)),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Payload invalido', issues: parsed.error.issues }, { status: 422 });
  }

  const data = normalizeManychat(parsed.data);
  const kind = mapManychatEvent(data.event);

  try {
    const org = await getCurrentOrg();

    if (kind === 'lead' || kind === 'keyword' || kind === 'custom') {
      const result = await ingestInteraction({
        orgId: org.id,
        source: 'manychat',
        // Si ManyChat manda la keyword explicita, prevalece sobre el texto libre.
        text: data.keyword ?? data.text,
        manychatSubscriberId: data.subscriberId,
        igUserId: data.igUserId,
        igUsername: data.igUsername,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        profilePicUrl: data.profilePicUrl,
        contentId: data.contentId,
        igMediaId: data.igMediaId,
        refCode: data.refCode,
        permalink: data.permalink,
        tags: data.tags,
        customFields: data.customFields,
      });

      await completeDelivery(delivery.id, {
        status: 'processed',
        leadId: result.lead.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({
        ok: true,
        leadId: result.lead.id,
        leadCreated: result.leadCreated,
        attributedContent: result.content
          ? { id: result.content.id, title: result.content.title }
          : null,
        keyword: result.keyword?.word ?? null,
      });
    }

    const conversion = await ingestConversion({
      orgId: org.id,
      kind: kind === 'refund' ? 'refund' : kind,
      manychatSubscriberId: data.subscriberId,
      igUserId: data.igUserId,
      igUsername: data.igUsername,
      email: data.email,
      fullName: data.fullName,
      scheduledAt: data.scheduledAt,
      amountCents: data.amountCents,
      currency: data.currency,
      contentId: data.contentId,
      igMediaId: data.igMediaId,
      refCode: data.refCode,
      externalId: data.subscriberId ? `mc:${data.subscriberId}:${data.event}` : null,
      source: 'manychat',
    });

    await completeDelivery(delivery.id, {
      status: 'processed',
      leadId: conversion.lead.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      leadId: conversion.lead.id,
      kind,
      dealId: conversion.deal?.id ?? null,
      appointmentId: conversion.appointment?.id ?? null,
    });
  } catch (error) {
    await completeDelivery(delivery.id, {
      status: 'failed',
      error: (error as Error).message,
      durationMs: Date.now() - startedAt,
    });
    console.error('[webhook:manychat]', error);
    return NextResponse.json({ error: 'Error procesando el evento' }, { status: 500 });
  }
}

/** ManyChat verifica la URL con un GET antes de guardarla. */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'hook-crm', webhook: 'manychat' });
}
