import { and, eq, inArray, lte, or, sql, desc, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  webhookSubscriptions,
  outboundDeliveries,
  leads,
  contents,
  stages,
  deals,
  appointments,
  keywords,
  organizations,
  type Event,
  type WebhookSubscription,
  type OutboundDelivery,
} from '@/db/schema';
import { hmacHex } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Webhooks salientes.
 *
 * `webhook_endpoints` recibe; esto manda. Es lo que permite conectar el CRM con
 * Make, Zapier, n8n, Slack o un backend propio sin que nadie tenga que
 * consultar la API: cuando entra un lead o se cierra una venta, el CRM avisa.
 *
 * El payload siempre lleva la atribucion resuelta, que es el dato que ninguna
 * otra herramienta puede calcular por su cuenta.
 */

/** Reintentos con espera creciente. Cinco intentos cubren casi dos dias. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;
const TIMEOUT_MS = 10_000;

export interface OutboundPayload {
  id: string;
  type: string;
  occurredAt: string;
  org: { id: string; name: string };
  lead?: Record<string, unknown> | null;
  content?: Record<string, unknown> | null;
  keyword?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  appointment?: Record<string, unknown> | null;
  valueCents: number;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Encolado
 * ------------------------------------------------------------------ */

/**
 * Encola el evento para cada suscripcion que lo escuche.
 *
 * Solo arma el payload si hay alguien suscrito: sin suscripciones, el costo es
 * una consulta barata y nada mas. Las entregas se intentan sin bloquear a quien
 * genero el evento, porque un webhook de Instagram tiene que responder en
 * milisegundos y el destino puede tardar segundos.
 */
const subscriptionCache = new Map<string, { hasAny: boolean; until: number }>();
const CACHE_TTL_MS = 30_000;

/** Invalida el cache tras crear, editar o borrar una suscripcion. */
export function invalidateSubscriptionCache(orgId?: string): void {
  if (orgId) subscriptionCache.delete(orgId);
  else subscriptionCache.clear();
}

async function hasSubscriptions(orgId: string): Promise<boolean> {
  const cached = subscriptionCache.get(orgId);
  if (cached && cached.until > Date.now()) return cached.hasAny;

  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.active, true)));

  const hasAny = (row?.count ?? 0) > 0;
  subscriptionCache.set(orgId, { hasAny, until: Date.now() + CACHE_TTL_MS });
  return hasAny;
}

export async function dispatchEvent(event: Event): Promise<number> {
  // Atajo barato: sin suscripciones activas, `recordEvent` no paga una consulta
  // por evento. Se llama en cada comentario, DM y cambio de etapa.
  if (!(await hasSubscriptions(event.orgId))) return 0;

  const db = await getDb();

  const subscriptions = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.orgId, event.orgId),
        eq(webhookSubscriptions.active, true),
        or(
          sql`${webhookSubscriptions.events} @> ARRAY[${event.type}]::text[]`,
          sql`${webhookSubscriptions.events} @> ARRAY['*']::text[]`,
        ),
      ),
    );

  if (subscriptions.length === 0) return 0;

  const payload = await buildPayload(event);

  const rows = await db
    .insert(outboundDeliveries)
    .values(
      subscriptions.map((subscription) => ({
        orgId: event.orgId,
        subscriptionId: subscription.id,
        eventId: event.id,
        eventType: event.type,
        payload: payload as unknown as Record<string, unknown>,
        status: 'pending' as const,
        nextAttemptAt: new Date(),
      })),
    )
    .returning();

  // Sin await: el evento no espera a que el destino conteste.
  void Promise.all(rows.map((row) => attemptDelivery(row.id))).catch((error) => {
    console.error('[outbound] fallo al entregar', error);
  });

  return rows.length;
}

/** Arma el payload con la atribucion ya resuelta. */
async function buildPayload(event: Event): Promise<OutboundPayload> {
  const db = await getDb();

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, event.orgId))
    .limit(1);

  let lead: Record<string, unknown> | null = null;
  if (event.leadId) {
    const [row] = await db
      .select({
        lead: leads,
        stage: { id: stages.id, name: stages.name, key: stages.key, kind: stages.kind },
      })
      .from(leads)
      .leftJoin(stages, eq(leads.stageId, stages.id))
      .where(eq(leads.id, event.leadId))
      .limit(1);

    if (row) {
      lead = {
        id: row.lead.id,
        igUserId: row.lead.igUserId,
        igUsername: row.lead.igUsername,
        fullName: row.lead.fullName,
        email: row.lead.email,
        phone: row.lead.phone,
        country: row.lead.country,
        followersCount: row.lead.followersCount,
        source: row.lead.source,
        status: row.lead.status,
        tags: row.lead.tags,
        customFields: row.lead.customFields,
        revenueCents: row.lead.revenueCents,
        stage: row.stage,
        createdAt: row.lead.createdAt,
      };
    }
  }

  let content: Record<string, unknown> | null = null;
  if (event.contentId) {
    const [row] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, event.contentId))
      .limit(1);
    if (row) {
      content = {
        id: row.id,
        title: row.title,
        type: row.type,
        hook: row.hook,
        angle: row.angle,
        permalink: row.permalink,
        refCode: row.refCode,
        igMediaId: row.igMediaId,
        views: row.views,
        publishedAt: row.publishedAt,
      };
    }
  }

  let keyword: Record<string, unknown> | null = null;
  if (event.keywordId) {
    const [row] = await db.select().from(keywords).where(eq(keywords.id, event.keywordId)).limit(1);
    if (row) {
      keyword = { id: row.id, word: row.word, resourceName: row.resourceName, resourceUrl: row.resourceUrl };
    }
  }

  let deal: Record<string, unknown> | null = null;
  if (event.dealId) {
    const [row] = await db.select().from(deals).where(eq(deals.id, event.dealId)).limit(1);
    if (row) {
      deal = {
        id: row.id,
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        productId: row.productId,
        closedAt: row.closedAt,
      };
    }
  }

  let appointment: Record<string, unknown> | null = null;
  if (event.appointmentId) {
    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, event.appointmentId))
      .limit(1);
    if (row) {
      appointment = {
        id: row.id,
        title: row.title,
        scheduledAt: row.scheduledAt,
        status: row.status,
        meetingUrl: row.meetingUrl,
      };
    }
  }

  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    org: { id: org?.id ?? event.orgId, name: org?.name ?? '' },
    lead,
    content,
    keyword,
    deal,
    appointment,
    valueCents: event.valueCents,
    data: event.payload ?? {},
  };
}

/* ------------------------------------------------------------------ *
 * Entrega
 * ------------------------------------------------------------------ */

export async function attemptDelivery(deliveryId: string): Promise<void> {
  const db = await getDb();

  const [delivery] = await db
    .select()
    .from(outboundDeliveries)
    .where(eq(outboundDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery || delivery.status === 'delivered' || delivery.status === 'exhausted') return;

  const [subscription] = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, delivery.subscriptionId))
    .limit(1);
  if (!subscription || !subscription.active) return;

  const attempt = delivery.attempts + 1;
  const startedAt = Date.now();
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'HookCRM-Webhook/1.0',
        'x-hook-event': delivery.eventType,
        'x-hook-delivery': delivery.id,
        'x-hook-timestamp': timestamp,
        // Se firma `timestamp.body` y no solo el cuerpo: asi una entrega
        // interceptada no se puede reenviar mas tarde como si fuera nueva.
        'x-hook-signature-256': `sha256=${hmacHex(`${timestamp}.${body}`, subscription.secret)}`,
        ...subscription.headers,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => '')).slice(0, 2000);
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (caught) {
    error = (caught as Error).name === 'AbortError' ? 'Tiempo de espera agotado' : (caught as Error).message;
  }

  const delivered = !error;
  const exhausted = !delivered && attempt >= MAX_ATTEMPTS;
  const nextAttemptAt = delivered || exhausted
    ? null
    : new Date(Date.now() + BACKOFF_MINUTES[attempt - 1] * 60_000);

  await db
    .update(outboundDeliveries)
    .set({
      status: delivered ? 'delivered' : exhausted ? 'exhausted' : 'retrying',
      attempts: attempt,
      responseStatus,
      responseBody,
      error,
      durationMs: Date.now() - startedAt,
      nextAttemptAt,
      deliveredAt: delivered ? new Date() : null,
    })
    .where(eq(outboundDeliveries.id, delivery.id));

  await db
    .update(webhookSubscriptions)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: responseStatus,
      lastError: error,
      ...(delivered
        ? { deliveredCount: sql`${webhookSubscriptions.deliveredCount} + 1` }
        : { failedCount: sql`${webhookSubscriptions.failedCount} + 1` }),
    })
    .where(eq(webhookSubscriptions.id, subscription.id));
}

/**
 * Reintenta las entregas vencidas.
 *
 * En un servidor que siempre esta despierto, los reintentos salen solos del
 * `void` de `dispatchEvent`. En serverless el proceso puede morir antes, asi
 * que esta funcion existe para que un cron la llame y nada quede colgado.
 */
export async function deliverPending(limit = 50): Promise<{ intentos: number }> {
  const db = await getDb();

  const due = await db
    .select({ id: outboundDeliveries.id })
    .from(outboundDeliveries)
    .where(
      and(
        inArray(outboundDeliveries.status, ['pending', 'retrying']),
        or(
          isNull(outboundDeliveries.nextAttemptAt),
          lte(outboundDeliveries.nextAttemptAt, new Date()),
        ),
      ),
    )
    .limit(limit);

  for (const row of due) {
    await attemptDelivery(row.id);
  }

  return { intentos: due.length };
}

/** Reintento manual desde la UI, ignorando la espera. */
export async function retryDelivery(deliveryId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(outboundDeliveries)
    .set({ status: 'retrying', nextAttemptAt: new Date(), error: null })
    .where(eq(outboundDeliveries.id, deliveryId));
  await attemptDelivery(deliveryId);
}

/* ------------------------------------------------------------------ *
 * Prueba
 * ------------------------------------------------------------------ */

/** Manda un evento de prueba para verificar la URL y la firma. */
export async function sendTestEvent(
  subscriptionId: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const db = await getDb();
  const [subscription] = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, subscriptionId))
    .limit(1);
  if (!subscription) return { ok: false, error: 'No existe esa suscripcion.' };

  const payload: OutboundPayload = {
    id: `evt_prueba_${Date.now()}`,
    type: 'sale',
    occurredAt: new Date().toISOString(),
    org: { id: subscription.orgId, name: 'Prueba' },
    lead: {
      id: 'lead_prueba',
      igUsername: 'lead.de.prueba',
      fullName: 'Lead de Prueba',
      email: 'prueba@ejemplo.com',
      tags: ['prueba'],
      stage: { name: 'Venta', key: 'venta', kind: 'won' },
    },
    content: {
      id: 'cnt_prueba',
      title: 'Reel de prueba',
      type: 'reel',
      hook: 'Este es un evento de prueba',
    },
    keyword: null,
    deal: { id: 'dl_prueba', amountCents: 149_700, currency: 'USD', status: 'won' },
    appointment: null,
    valueCents: 149_700,
    data: { prueba: true },
  };

  const [row] = await db
    .insert(outboundDeliveries)
    .values({
      orgId: subscription.orgId,
      subscriptionId: subscription.id,
      eventType: 'sale',
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      nextAttemptAt: new Date(),
    })
    .returning();

  await attemptDelivery(row.id);

  const [after] = await db
    .select()
    .from(outboundDeliveries)
    .where(eq(outboundDeliveries.id, row.id))
    .limit(1);

  return {
    ok: after?.status === 'delivered',
    status: after?.responseStatus ?? undefined,
    error: after?.error ?? undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

export async function listSubscriptions(orgId: string): Promise<WebhookSubscription[]> {
  const db = await getDb();
  return db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.orgId, orgId))
    .orderBy(webhookSubscriptions.createdAt);
}

export async function listOutboundDeliveries(orgId: string, limit = 25) {
  const db = await getDb();
  return db
    .select({
      delivery: outboundDeliveries,
      subscription: { id: webhookSubscriptions.id, name: webhookSubscriptions.name },
    })
    .from(outboundDeliveries)
    .innerJoin(
      webhookSubscriptions,
      eq(outboundDeliveries.subscriptionId, webhookSubscriptions.id),
    )
    .where(eq(outboundDeliveries.orgId, orgId))
    .orderBy(desc(outboundDeliveries.createdAt))
    .limit(limit);
}

/** Eventos a los que se puede suscribir alguien, agrupados para la UI. */
export const SUBSCRIBABLE_EVENTS: Array<{ value: string; label: string; group: string }> = [
  { value: '*', label: 'Todos los eventos', group: 'General' },
  { value: 'lead_created', label: 'Lead nuevo', group: 'Captación' },
  { value: 'keyword_triggered', label: 'Palabra clave disparada', group: 'Captación' },
  { value: 'resource_sent', label: 'Recurso entregado', group: 'Captación' },
  { value: 'comment_received', label: 'Comentario recibido', group: 'Conversación' },
  { value: 'dm_received', label: 'DM recibido', group: 'Conversación' },
  { value: 'dm_sent', label: 'DM enviado', group: 'Conversación' },
  { value: 'story_reply', label: 'Respuesta a story', group: 'Conversación' },
  { value: 'stage_changed', label: 'Cambio de etapa', group: 'Pipeline' },
  { value: 'meeting_booked', label: 'Reunión agendada', group: 'Pipeline' },
  { value: 'meeting_held', label: 'Reunión realizada', group: 'Pipeline' },
  { value: 'meeting_no_show', label: 'No asistió', group: 'Pipeline' },
  { value: 'sale', label: 'Venta cerrada', group: 'Dinero' },
  { value: 'refund', label: 'Reembolso', group: 'Dinero' },
  { value: 'tag_added', label: 'Etiqueta agregada', group: 'Pipeline' },
  { value: 'automation_run', label: 'Flujo ejecutado', group: 'Automatización' },
];

/** Fragmento de verificación de firma para mostrar en la documentación. */
export function signatureSnippet(): string {
  return `// Node.js — verificar que la entrega vino del CRM
import crypto from 'node:crypto';

function esValida(req, secreto) {
  const firma = req.headers['x-hook-signature-256'];     // "sha256=<hex>"
  const ts    = req.headers['x-hook-timestamp'];          // segundos UNIX
  const body  = req.rawBody;                              // el cuerpo SIN parsear

  // Rechazar entregas viejas: evita que una copia se reenvíe más tarde.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const esperado = 'sha256=' + crypto
    .createHmac('sha256', secreto)
    .update(\`\${ts}.\${body}\`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperado));
}`;
}

export function webhookDocsUrl(): string {
  return `${env.appUrl.replace(/\/$/, '')}/integraciones`;
}

export type { OutboundDelivery };
