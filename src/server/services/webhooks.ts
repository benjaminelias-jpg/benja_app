import { eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  webhookDeliveries,
  webhookEndpoints,
  type WebhookEndpoint,
  type WebhookDelivery,
} from '@/db/schema';

/**
 * Registro de entregas de webhooks.
 *
 * Cada peticion entrante se guarda entera antes de procesarse. Cuando una
 * integracion falla (y fallan a menudo: ManyChat cambia un campo, Hotmart manda
 * otro formato), el payload crudo esta ahi para depurar y reprocesar.
 */

export type Provider = WebhookEndpoint['provider'];

export async function logDelivery(params: {
  orgId?: string | null;
  endpointId?: string | null;
  provider: Provider;
  headers: Record<string, string>;
  payload: unknown;
}): Promise<WebhookDelivery> {
  const db = await getDb();
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      orgId: params.orgId ?? null,
      endpointId: params.endpointId ?? null,
      provider: params.provider,
      status: 'received',
      headers: scrubHeaders(params.headers),
      payload: params.payload,
    })
    .returning();
  return delivery;
}

export async function completeDelivery(
  deliveryId: string,
  result: {
    status: WebhookDelivery['status'];
    leadId?: string | null;
    eventId?: string | null;
    error?: string | null;
    durationMs?: number;
  },
): Promise<void> {
  const db = await getDb();
  await db
    .update(webhookDeliveries)
    .set({
      status: result.status,
      leadId: result.leadId ?? null,
      eventId: result.eventId ?? null,
      error: result.error ?? null,
      durationMs: result.durationMs ?? null,
      processedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

/** No guardamos tokens ni firmas en texto plano en el log de entregas. */
function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitive = ['authorization', 'x-hub-signature-256', 'x-hook-secret', 'cookie', 'x-api-key'];
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = sensitive.includes(key.toLowerCase()) ? '[oculto]' : value;
  }
  return result;
}

export async function getEndpointBySlug(slug: string): Promise<WebhookEndpoint | undefined> {
  const db = await getDb();
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.slug, slug))
    .limit(1);
  return endpoint;
}

export async function touchEndpoint(endpointId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: new Date(),
      deliveriesCount: sql`${webhookEndpoints.deliveriesCount} + 1`,
    })
    .where(eq(webhookEndpoints.id, endpointId));
}

export async function listEndpoints(orgId: string) {
  const db = await getDb();
  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.orgId, orgId))
    .orderBy(webhookEndpoints.createdAt);
}

export async function listRecentDeliveries(limit = 25) {
  const db = await getDb();
  return db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(limit);
}

/** Convierte los headers de una Request en objeto plano. */
export function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Lee un valor anidado de un payload con notacion de puntos.
 * Es lo que permite mapear webhooks arbitrarios: "data.buyer.email".
 */
export function readPath(payload: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
    return undefined;
  }, payload);
}

/**
 * Aplica el mapeo configurado en el endpoint sobre el payload recibido.
 *
 * El mapeo es `{ "campoDestino": "ruta.en.el.payload" }`. Un valor que empieza
 * con `=` se toma literal: `{ "kind": "=sale" }`.
 */
export function applyMapping(
  mapping: Record<string, unknown>,
  payload: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    if (typeof source !== 'string') {
      result[target] = source;
      continue;
    }
    if (source.startsWith('=')) {
      result[target] = source.slice(1);
      continue;
    }
    const value = readPath(payload, source);
    if (value !== undefined) result[target] = value;
  }
  return result;
}
