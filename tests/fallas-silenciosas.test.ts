/**
 * La familia de bugs que no tira error.
 *
 * Todos estos pasaron los 83 tests anteriores sin despeinarse: el codigo
 * devolvia ok, la fila quedaba como enviada y la pantalla se pintaba verde,
 * mientras del otro lado no habia pasado nada. Cada test de aca abajo falla
 * con el codigo anterior al arreglo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import {
  organizations,
  users,
  pipelines,
  stages,
  contents,
  instagramAccounts,
  automations,
  automationSteps,
  automationWaits,
  keywords,
  leads,
  messages,
  events,
} from '@/db/schema';
import { authFor } from '@/server/services/automations';
import { ingestInteraction, recordReaction } from '@/server/services/ingest';

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgId: string;
let contentId: string;
let keywordId: string;
let flowId: string;

beforeAll(async () => {
  db = await setupTestDb();

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Silencio', slug: 'silencio' })
    .returning();
  orgId = org.id;

  await db.insert(users).values({ orgId, name: 'Closer', email: 'c@silencio.test', role: 'closer' });

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId, name: 'Ventas', isDefault: true })
    .returning();
  await db.insert(stages).values([
    { pipelineId: pipeline.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 },
    { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 1 },
  ]);

  const [content] = await db
    .insert(contents)
    .values({ orgId, title: 'Reel', type: 'reel', igMediaId: 'MEDIA_S' })
    .returning();
  contentId = content.id;

  const [flow] = await db
    .insert(automations)
    .values({ orgId, name: 'Entrega', trigger: 'ig_dm_keyword', active: true })
    .returning();
  flowId = flow.id;
  await db.insert(automationSteps).values({
    automationId: flow.id,
    position: 0,
    type: 'send_dm',
    nodeId: 'dm',
    config: { text: 'Ahi va el recurso' },
  });

  const [kw] = await db
    .insert(keywords)
    .values({ orgId, word: 'GUIA', channel: 'ig_dm', automationId: flow.id, resourceName: 'Guia' })
    .returning();
  keywordId = kw.id;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(() => {
  delete process.env.DRY_RUN_OUTBOUND;
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete(instagramAccounts).where(eq(instagramAccounts.orgId, orgId));
});

describe('credenciales de la cuenta', () => {
  it('no entrega credenciales de una cuenta que dice estar conectada pero no tiene token', async () => {
    // El caso peligroso: la persona cree que esta en vivo. Antes authFor
    // devolvia { token: null } —truthy— y el guard `if (!auth)` de la bandeja
    // y de los flujos no se disparaba nunca; mas adentro el cliente simulaba
    // y el DM quedaba guardado como enviado.
    await db.insert(instagramAccounts).values({
      orgId,
      igUserId: 'IG_ROTA',
      username: 'rota',
      connected: true,
      accessToken: null,
    });

    expect(await authFor(orgId)).toBeNull();
  });

  it('sigue permitiendo el modo simulado cuando la cuenta no figura conectada', async () => {
    // Esto NO se rompe: es una funcion del producto. La pantalla ya avisa.
    await db.insert(instagramAccounts).values({
      orgId,
      igUserId: 'IG_SIMULADA',
      username: 'simulada',
      connected: false,
      accessToken: null,
    });

    const auth = await authFor(orgId);
    expect(auth).not.toBeNull();
    expect(auth?.token).toBeNull();
    expect(auth?.igUserId).toBe('IG_SIMULADA');
  });
});

describe('un DM simulado no es un DM enviado', () => {
  it('lo guarda como "simulated", no como "sent"', async () => {
    await db.insert(instagramAccounts).values({
      orgId,
      igUserId: 'IG_SIM',
      username: 'sim',
      connected: false,
    });

    const result = await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'GUIA',
      igUserId: 'LEAD_SIM',
      igUsername: 'lead.sim',
      igMediaId: 'MEDIA_S',
    });

    const salientes = await db
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, result.lead.id), eq(messages.direction, 'outbound')));

    expect(salientes.length).toBeGreaterThan(0);
    for (const m of salientes) {
      expect(m.status).toBe('simulated');
      expect(m.status).not.toBe('sent');
    }
  });
});

describe('esperas de flujo que ya no sirven', () => {
  it('una espera vencida no se come la palabra clave del mensaje', async () => {
    // Antes: existia la fila de espera -> resumed = true -> el paso 7 quedaba
    // bloqueado y el recurso no se entregaba nunca. Y el lead no veia ningun
    // error: la conversacion se veia perfectamente normal.
    await db.insert(instagramAccounts).values({
      orgId,
      igUserId: 'IG_ESPERA',
      username: 'espera',
      connected: false,
    });

    const [lead] = await db
      .insert(leads)
      .values({ orgId, igUserId: 'LEAD_ESPERA', igUsername: 'lead.espera' })
      .returning();

    await db.insert(automationWaits).values({
      orgId,
      leadId: lead.id,
      automationId: flowId,
      nodeId: 'dm',
      expiresAt: new Date(Date.now() - 60_000), // vencida hace un minuto
    });

    await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'GUIA',
      igUserId: 'LEAD_ESPERA',
    });

    const tipos = (
      await db.select().from(events).where(eq(events.leadId, lead.id))
    ).map((e) => e.type);

    expect(tipos).toContain('keyword_triggered');
  });
});

describe('reacciones a un DM', () => {
  it('quedan registradas y no devuelven un id de lead vacio', async () => {
    const [lead] = await db
      .insert(leads)
      .values({ orgId, igUserId: 'LEAD_REACCION', igUsername: 'lead.reaccion' })
      .returning();

    const leadId = await recordReaction({
      orgId,
      igUserId: 'LEAD_REACCION',
      emoji: '❤️',
      action: 'react',
      messageExternalId: 'mid.9',
    });

    expect(leadId).toBe(lead.id);

    const registrados = await db.select().from(events).where(eq(events.leadId, lead.id));
    const reaccion = registrados.find(
      (e) => (e.payload as { kind?: string } | null)?.kind === 'reaction',
    );
    expect(reaccion).toBeDefined();
    expect((reaccion?.payload as { emoji?: string }).emoji).toBe('❤️');
  });

  it('no inventa un lead cuando reacciona alguien de quien no hay registro', async () => {
    expect(await recordReaction({ orgId, igUserId: 'DESCONOCIDO', emoji: '👍' })).toBeNull();
  });
});
