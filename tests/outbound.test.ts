import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import {
  organizations,
  pipelines,
  stages,
  contents,
  leads,
  webhookSubscriptions,
  outboundDeliveries,
} from '@/db/schema';

/**
 * Webhooks salientes: el CRM avisando a otras herramientas.
 *
 * Se levanta un servidor HTTP de verdad en el test para ejercitar el camino
 * completo (fetch, firma, reintentos). Un mock de fetch no probaria la firma,
 * que es justo lo que el destino necesita verificar.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgId: string;
let leadId: string;
let contentId: string;

let server: HttpServer;
let baseUrl: string;

/** Lo que recibio el servidor de prueba, para inspeccionarlo. */
const received: Array<{ headers: Record<string, string>; body: string }> = [];
/** Cuantas veces seguidas debe fallar el endpoint /inestable. */
let failuresLeft = 0;

beforeAll(async () => {
  db = await setupTestDb();

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Salientes', slug: 'salientes' })
    .returning();
  orgId = org.id;

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId, name: 'Ventas', isDefault: true })
    .returning();
  await db
    .insert(stages)
    .values({ pipelineId: pipeline.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 });

  const [content] = await db
    .insert(contents)
    .values({ orgId, title: 'Reel saliente', type: 'reel', igMediaId: 'MEDIA_S' })
    .returning();
  contentId = content.id;

  const [lead] = await db
    .insert(leads)
    .values({ orgId, igUsername: 'lead.saliente', fullName: 'Lead Saliente', firstTouchContentId: content.id })
    .returning();
  leadId = lead.id;

  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers as Record<string, string>, body });

        if (req.url === '/inestable' && failuresLeft > 0) {
          failuresLeft -= 1;
          res.writeHead(500).end('boom');
          return;
        }
        if (req.url === '/roto') {
          res.writeHead(500).end('siempre falla');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await teardownTestDb();
});

async function crearSuscripcion(overrides: Partial<{ url: string; events: string[] }> = {}) {
  const [subscription] = await db
    .insert(webhookSubscriptions)
    .values({
      orgId,
      name: 'Destino de prueba',
      url: overrides.url ?? `${baseUrl}/ok`,
      events: overrides.events ?? ['sale'],
      secret: 'secreto-de-prueba',
      active: true,
    })
    .returning();
  const { invalidateSubscriptionCache } = await import('@/server/services/outbound');
  invalidateSubscriptionCache(orgId);
  return subscription;
}

describe('despacho de eventos', () => {
  it('no manda nada si no hay suscripciones', async () => {
    const { recordEvent } = await import('@/server/services/events');
    const antes = received.length;

    await recordEvent({ orgId, leadId, type: 'lead_created', contentId });
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(received.length).toBe(antes);
  });

  it('entrega el evento con la atribucion ya resuelta', async () => {
    const subscription = await crearSuscripcion();
    const { recordEvent } = await import('@/server/services/events');

    await recordEvent({
      orgId,
      leadId,
      contentId,
      type: 'sale',
      valueCents: 149_700,
      dedupeKey: 'venta-saliente-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const entrega = received.at(-1);
    expect(entrega).toBeDefined();

    const payload = JSON.parse(entrega!.body);
    expect(payload.type).toBe('sale');
    expect(payload.valueCents).toBe(149_700);
    // Lo que ninguna otra herramienta puede calcular por su cuenta:
    expect(payload.content.title).toBe('Reel saliente');
    expect(payload.lead.igUsername).toBe('lead.saliente');
    expect(payload.lead.stage).toBeDefined();

    const [delivery] = await db
      .select()
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.subscriptionId, subscription.id));
    expect(delivery.status).toBe('delivered');
    expect(delivery.responseStatus).toBe(200);
  });

  it('firma con HMAC sobre timestamp + cuerpo', async () => {
    const entrega = received.at(-1)!;
    const timestamp = entrega.headers['x-hook-timestamp'];
    const firma = entrega.headers['x-hook-signature-256'];

    expect(timestamp).toBeDefined();
    expect(firma).toMatch(/^sha256=[0-9a-f]{64}$/);

    const esperado =
      'sha256=' +
      createHmac('sha256', 'secreto-de-prueba')
        .update(`${timestamp}.${entrega.body}`)
        .digest('hex');

    expect(firma).toBe(esperado);

    // Firmar solo el cuerpo permitiria reenviar una copia vieja: el timestamp
    // tiene que entrar en la firma.
    const soloCuerpo =
      'sha256=' + createHmac('sha256', 'secreto-de-prueba').update(entrega.body).digest('hex');
    expect(firma).not.toBe(soloCuerpo);

    expect(entrega.headers['x-hook-event']).toBe('sale');
    expect(entrega.headers['x-hook-delivery']).toMatch(/^out_/);
  });

  it('solo avisa a quien se suscribio a ese evento', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    await crearSuscripcion({ events: ['meeting_booked'] });

    const { recordEvent } = await import('@/server/services/events');
    const antes = received.length;

    await recordEvent({ orgId, leadId, type: 'sale', dedupeKey: 'venta-no-escuchada' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received.length).toBe(antes);

    await recordEvent({ orgId, leadId, type: 'meeting_booked', dedupeKey: 'reu-escuchada' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received.length).toBeGreaterThan(antes);
  });

  it('el comodin * recibe todo', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    await crearSuscripcion({ events: ['*'] });

    const { recordEvent } = await import('@/server/services/events');
    const antes = received.length;

    await recordEvent({ orgId, leadId, type: 'tag_added', dedupeKey: 'etiqueta-comodin' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(received.length).toBeGreaterThan(antes);
    expect(JSON.parse(received.at(-1)!.body).type).toBe('tag_added');
  });

  it('un evento repetido por idempotencia no se vuelve a avisar', async () => {
    const { recordEvent } = await import('@/server/services/events');
    const antes = received.length;

    // Mismo dedupeKey que el test anterior: no es un evento nuevo.
    const result = await recordEvent({ orgId, leadId, type: 'tag_added', dedupeKey: 'etiqueta-comodin' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(result.created).toBe(false);
    expect(received.length).toBe(antes);
  });
});

describe('reintentos', () => {
  it('reintenta tras un fallo y marca la proxima espera', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    const subscription = await crearSuscripcion({ url: `${baseUrl}/inestable`, events: ['sale'] });
    failuresLeft = 1;

    const { recordEvent } = await import('@/server/services/events');
    await recordEvent({ orgId, leadId, type: 'sale', dedupeKey: 'venta-inestable' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const [delivery] = await db
      .select()
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.subscriptionId, subscription.id));

    expect(delivery.status).toBe('retrying');
    expect(delivery.attempts).toBe(1);
    expect(delivery.responseStatus).toBe(500);
    expect(delivery.nextAttemptAt).not.toBeNull();

    // El reintento manual ignora la espera y esta vez el destino responde bien.
    const { retryDelivery } = await import('@/server/services/outbound');
    await retryDelivery(delivery.id);

    const [after] = await db
      .select()
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.id, delivery.id));
    expect(after.status).toBe('delivered');
    expect(after.attempts).toBe(2);
  });

  it('se agota tras cinco intentos y deja de reintentar solo', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    const subscription = await crearSuscripcion({ url: `${baseUrl}/roto`, events: ['sale'] });

    const { recordEvent } = await import('@/server/services/events');
    await recordEvent({ orgId, leadId, type: 'sale', dedupeKey: 'venta-rota' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const [delivery] = await db
      .select()
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.subscriptionId, subscription.id));

    // El despacho ya consumio el intento 1; faltan cuatro para agotarla.
    const { retryDelivery, deliverPending } = await import('@/server/services/outbound');
    for (let i = 0; i < 4; i += 1) await retryDelivery(delivery.id);

    const [after] = await db
      .select()
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.id, delivery.id));

    expect(after.status).toBe('exhausted');
    expect(after.attempts).toBe(5);
    expect(after.nextAttemptAt).toBeNull();

    // Agotada ya no la toma el reintento automatico.
    const antes = received.length;
    await deliverPending(10);
    expect(received.length).toBe(antes);

    // Pero el boton "Reintentar" si la fuerza: agotarse no es definitivo para
    // una persona que acaba de arreglar el destino.
    await retryDelivery(delivery.id);
    expect(received.length).toBeGreaterThan(antes);
  });
});

describe('evento de prueba', () => {
  it('verifica la URL sin depender de que pase algo real', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    const subscription = await crearSuscripcion({ url: `${baseUrl}/ok` });

    const { sendTestEvent } = await import('@/server/services/outbound');
    const result = await sendTestEvent(subscription.id);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(JSON.parse(received.at(-1)!.body).data.prueba).toBe(true);
  });

  it('informa el fallo en vez de romper', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    const subscription = await crearSuscripcion({ url: `${baseUrl}/roto` });

    const { sendTestEvent } = await import('@/server/services/outbound');
    const result = await sendTestEvent(subscription.id);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('una suscripcion pausada no recibe eventos', async () => {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
    const subscription = await crearSuscripcion({ events: ['*'] });
    await db
      .update(webhookSubscriptions)
      .set({ active: false })
      .where(eq(webhookSubscriptions.id, subscription.id));

    const { invalidateSubscriptionCache } = await import('@/server/services/outbound');
    invalidateSubscriptionCache(orgId);

    const { recordEvent } = await import('@/server/services/events');
    const antes = received.length;
    await recordEvent({ orgId, leadId, type: 'sale', dedupeKey: 'venta-pausada' });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(received.length).toBe(antes);

    const pendientes = await db
      .select()
      .from(outboundDeliveries)
      .where(
        and(eq(outboundDeliveries.subscriptionId, subscription.id), eq(outboundDeliveries.status, 'pending')),
      );
    expect(pendientes).toHaveLength(0);
  });
});
