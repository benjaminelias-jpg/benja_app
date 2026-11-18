import { NextRequest, NextResponse } from 'next/server';
import { hmacHex, safeCompare } from '@/lib/crypto';
import { ingestConversion, ingestInteraction } from '@/server/services/ingest';
import {
  applyMapping,
  completeDelivery,
  getEndpointBySlug,
  headersToObject,
  logDelivery,
  touchEndpoint,
} from '@/server/services/webhooks';
import { parseAmountToCents } from '@/server/integrations/manychat';
import type { LeadSource } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook generico y configurable.
 *
 *   POST /api/webhooks/<slug>
 *
 * Cada endpoint guarda su propio `mapping`, que traduce el payload de cualquier
 * herramienta al vocabulario del CRM sin tocar codigo. Asi se conectan Calendly,
 * Cal.com, Hotmart, Stripe, Typeform, Make o un formulario propio.
 *
 * Ejemplo de mapping para Calendly:
 *   {
 *     "kind":        "=meeting",
 *     "email":       "payload.invitee.email",
 *     "fullName":    "payload.invitee.name",
 *     "scheduledAt": "payload.event.start_time",
 *     "externalId":  "payload.event.uri"
 *   }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const startedAt = Date.now();
  const { slug } = await context.params;

  const endpoint = await getEndpointBySlug(slug);
  if (!endpoint || !endpoint.active) {
    return NextResponse.json({ error: 'Endpoint no encontrado' }, { status: 404 });
  }

  const rawBody = await request.text();
  const headers = headersToObject(request.headers);

  if (!isAuthorized(request, rawBody, endpoint.secret)) {
    return NextResponse.json({ error: 'Secreto invalido' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const delivery = await logDelivery({
    orgId: endpoint.orgId,
    endpointId: endpoint.id,
    provider: endpoint.provider,
    headers,
    payload,
  });
  await touchEndpoint(endpoint.id);

  try {
    const mapped = applyMapping(endpoint.mapping, payload);
    const kind = String(mapped.kind ?? 'lead');

    const identity = {
      igUserId: asString(mapped.igUserId),
      igUsername: asString(mapped.igUsername)?.replace(/^@/, '') ?? null,
      manychatSubscriberId: asString(mapped.manychatSubscriberId),
      email: asString(mapped.email)?.toLowerCase() ?? null,
      fullName: asString(mapped.fullName),
    };

    if (kind === 'lead' || kind === 'interaction') {
      const result = await ingestInteraction({
        orgId: endpoint.orgId,
        source: (asString(mapped.source) as LeadSource) ?? 'webhook',
        text: asString(mapped.text),
        ...identity,
        phone: asString(mapped.phone),
        contentId: asString(mapped.contentId),
        igMediaId: asString(mapped.igMediaId),
        refCode: asString(mapped.refCode),
        externalId: asString(mapped.externalId),
        customFields: isRecord(mapped.customFields) ? mapped.customFields : undefined,
      });

      await completeDelivery(delivery.id, {
        status: 'processed',
        leadId: result.lead.id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ ok: true, leadId: result.lead.id, kind });
    }

    const conversionKind = normalizeConversionKind(kind);
    if (!conversionKind) {
      await completeDelivery(delivery.id, {
        status: 'ignored',
        error: `kind desconocido: ${kind}`,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ ok: true, ignored: true, kind });
    }

    const scheduledRaw = asString(mapped.scheduledAt);
    const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;

    const result = await ingestConversion({
      orgId: endpoint.orgId,
      kind: conversionKind,
      ...identity,
      scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
      amountCents: parseAmountToCents(mapped.amount ?? mapped.amountCents),
      currency: asString(mapped.currency),
      contentId: asString(mapped.contentId),
      igMediaId: asString(mapped.igMediaId),
      refCode: asString(mapped.refCode),
      externalId: asString(mapped.externalId),
      source: endpoint.provider,
    });

    await completeDelivery(delivery.id, {
      status: 'processed',
      leadId: result.lead.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      kind: conversionKind,
      leadId: result.lead.id,
      dealId: result.deal?.id ?? null,
      appointmentId: result.appointment?.id ?? null,
    });
  } catch (error) {
    await completeDelivery(delivery.id, {
      status: 'failed',
      error: (error as Error).message,
      durationMs: Date.now() - startedAt,
    });
    console.error(`[webhook:${slug}]`, error);
    return NextResponse.json({ error: 'Error procesando el evento' }, { status: 500 });
  }
}

/** Verificacion de URL: muchas herramientas hacen un GET antes de guardar. */
export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const endpoint = await getEndpointBySlug(slug);
  if (!endpoint) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, endpoint: endpoint.name, provider: endpoint.provider });
}

/**
 * Acepta tres formas de autenticar, segun lo que soporte la herramienta origen:
 * header con el secreto, firma HMAC del cuerpo, o el secreto en la query.
 */
function isAuthorized(request: NextRequest, rawBody: string, secret: string): boolean {
  const headerSecret =
    request.headers.get('x-hook-secret') ?? request.headers.get('x-webhook-secret');
  if (headerSecret && safeCompare(headerSecret, secret)) return true;

  const signature =
    request.headers.get('x-hook-signature') ?? request.headers.get('x-signature-256');
  if (signature) {
    const clean = signature.replace(/^sha256=/, '');
    if (safeCompare(clean, hmacHex(rawBody, secret))) return true;
  }

  const querySecret = request.nextUrl.searchParams.get('secret');
  if (querySecret && safeCompare(querySecret, secret)) return true;

  return false;
}

function normalizeConversionKind(
  kind: string,
): 'meeting' | 'meeting_held' | 'no_show' | 'sale' | 'refund' | null {
  const normalized = kind.toLowerCase().replace(/[\s_-]+/g, '');
  if (['meeting', 'reu', 'reunion', 'booking', 'invitee.created'].includes(normalized)) return 'meeting';
  if (['meetingheld', 'held', 'show', 'asistio'].includes(normalized)) return 'meeting_held';
  if (['noshow', 'noasistio'].includes(normalized)) return 'no_show';
  if (['sale', 'venta', 'purchase', 'paymentsucceeded', 'checkoutcompleted'].includes(normalized)) {
    return 'sale';
  }
  if (['refund', 'reembolso', 'chargeback'].includes(normalized)) return 'refund';
  return null;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
