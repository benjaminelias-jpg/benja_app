import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  keywords,
  products,
  events,
  leads,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Test de integracion del flujo que define al producto:
 *
 *   comentario en un reel -> lead con contenido atribuido -> automatizacion
 *   -> reunion -> venta -> el reporte acredita la venta a ESE reel.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgId: string;
let contentA: string;
let contentB: string;
let keywordId: string;
let productId: string;
let stageIds: Record<string, string> = {};

beforeAll(async () => {
  db = await setupTestDb();

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Test Infoproductos', slug: 'test-info', currency: 'USD' })
    .returning();
  orgId = org.id;

  await db
    .insert(users)
    .values({ orgId, name: 'Closer Uno', email: 'closer@test.com', role: 'closer' });

  await db.insert(instagramAccounts).values({
    orgId,
    igUserId: 'IG_ACCOUNT_1',
    username: 'cuenta.test',
    // Sin token es modo simulado: el embudo corre entero y los DM quedan
    // marcados 'simulated'. Ponerle connected: true sin token seria la misma
    // mentira que tenia el seed.
    connected: false,
  });

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId, name: 'Ventas', isDefault: true })
    .returning();

  const createdStages = await db
    .insert(stages)
    .values([
      { pipelineId: pipeline.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 },
      { pipelineId: pipeline.id, name: 'Conversando', key: 'conversando', kind: 'contacted', position: 1 },
      { pipelineId: pipeline.id, name: 'Reu', key: 'reu', kind: 'meeting', position: 2 },
      { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 3 },
      { pipelineId: pipeline.id, name: 'Perdido', key: 'perdido', kind: 'lost', position: 4 },
    ])
    .returning();
  stageIds = Object.fromEntries(createdStages.map((stage) => [stage.key, stage.id]));

  const createdContents = await db
    .insert(contents)
    .values([
      { orgId, title: 'Reel que convierte', type: 'reel', igMediaId: 'MEDIA_A', refCode: 'reel-a', views: 100_000, publishedAt: new Date(Date.now() - 10 * 86_400_000) },
      { orgId, title: 'Reel que no convierte', type: 'reel', igMediaId: 'MEDIA_B', refCode: 'reel-b', views: 500_000, publishedAt: new Date(Date.now() - 9 * 86_400_000) },
    ])
    .returning();
  contentA = createdContents[0].id;
  contentB = createdContents[1].id;

  const [automation] = await db
    .insert(automations)
    .values({ orgId, name: 'Entrega', trigger: 'ig_comment_keyword', active: true })
    .returning();

  await db.insert(automationSteps).values([
    { automationId: automation.id, position: 0, type: 'send_resource', config: { text: 'Toma {{nombre}}: {{link}}' } },
    { automationId: automation.id, position: 1, type: 'add_tag', config: { tags: ['recurso'] } },
    { automationId: automation.id, position: 2, type: 'set_stage', config: { stageKey: 'conversando' } },
  ]);

  const [keyword] = await db
    .insert(keywords)
    .values({
      orgId,
      contentId: contentA,
      automationId: automation.id,
      word: 'GUIA',
      matchType: 'exact',
      channel: 'ig_comment',
      resourceName: 'La guia',
      resourceUrl: 'https://test.com/guia',
    })
    .returning();
  keywordId = keyword.id;

  const [product] = await db
    .insert(products)
    .values({ orgId, name: 'Mentoria', type: 'mentoria', priceCents: 149_700 })
    .returning();
  productId = product.id;
});

afterAll(async () => {
  await teardownTestDb();
});

describe('ingesta de un comentario con keyword', () => {
  it('crea el lead, lo atribuye al reel y ejecuta la automatizacion', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    const result = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'GUIA porfa!',
      igUserId: 'IG_1',
      igUsername: 'camila.test',
      fullName: 'Camila Test',
      igMediaId: 'MEDIA_A',
      commentId: 'CMT_1',
      messageExternalId: 'CMT_1',
    });

    expect(result.leadCreated).toBe(true);
    expect(result.content?.id).toBe(contentA);
    expect(result.keyword?.id).toBe(keywordId);
    expect(result.lead.firstTouchContentId).toBe(contentA);

    // La automatizacion movio al lead a "Conversando" y lo etiqueto.
    expect(result.lead.stageId).toBe(stageIds.conversando);
    expect(result.lead.tags).toContain('recurso');

    const logged = await db
      .select()
      .from(events)
      .where(and(eq(events.orgId, orgId), eq(events.leadId, result.lead.id)));
    const types = logged.map((event) => event.type);

    expect(types).toContain('lead_created');
    expect(types).toContain('comment_received');
    expect(types).toContain('keyword_triggered');
    expect(types).toContain('resource_sent');

    // Todo evento de este lead queda acreditado al reel correcto.
    expect(logged.every((event) => event.contentId === contentA)).toBe(true);
  });

  it('no duplica el lead si el mismo usuario vuelve a comentar', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');
    const again = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'GUIA',
      igUserId: 'IG_1',
      igUsername: 'camila.test',
      igMediaId: 'MEDIA_B',
      messageExternalId: 'CMT_2',
    });

    expect(again.leadCreated).toBe(false);

    // El primer touch nunca se reescribe; el ultimo si.
    expect(again.lead.firstTouchContentId).toBe(contentA);
    expect(again.lead.lastTouchContentId).toBe(contentB);
  });

  it('resuelve el contenido por la keyword aunque el payload no traiga media', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');
    const result = await ingestInteraction({
      orgId,
      source: 'manychat',
      text: 'guia',
      manychatSubscriberId: 'MC_77',
      igUsername: 'otro.user',
    });
    expect(result.content?.id).toBe(contentA);
  });
});

describe('conversiones y atribucion de ingresos', () => {
  it('atribuye reunion y venta al contenido del primer touch', async () => {
    const { ingestInteraction, ingestConversion } = await import('@/server/services/ingest');

    const { lead } = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'GUIA',
      igUserId: 'IG_2',
      igUsername: 'martin.test',
      igMediaId: 'MEDIA_A',
      messageExternalId: 'CMT_3',
    });

    const meeting = await ingestConversion({
      orgId,
      kind: 'meeting',
      leadId: lead.id,
      scheduledAt: new Date(Date.now() + 2 * 86_400_000),
      externalId: 'cal_1',
    });
    expect(meeting.appointment?.contentId).toBe(contentA);

    const sale = await ingestConversion({
      orgId,
      kind: 'sale',
      leadId: lead.id,
      amountCents: 149_700,
      productId,
      externalId: 'htm_1',
    });

    expect(sale.deal?.contentId).toBe(contentA);
    expect(sale.deal?.amountCents).toBe(149_700);

    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.stageId).toBe(stageIds.venta);
    expect(updated.status).toBe('won');
    expect(updated.revenueCents).toBe(149_700);
  });

  it('es idempotente: el mismo externalId no cobra dos veces', async () => {
    const { ingestConversion } = await import('@/server/services/ingest');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_2'));

    const repeat = await ingestConversion({
      orgId,
      kind: 'sale',
      leadId: lead.id,
      amountCents: 149_700,
      productId,
      externalId: 'htm_1',
    });

    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after.revenueCents).toBe(149_700);
    expect(repeat.deal?.id).toBeDefined();

    const saleEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.leadId, lead.id), eq(events.type, 'sale')));
    expect(saleEvents).toHaveLength(1);
  });

  it('no retrocede el pipeline cuando llega un evento tardio', async () => {
    const { ingestConversion } = await import('@/server/services/ingest');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_2'));

    await ingestConversion({
      orgId,
      kind: 'meeting',
      leadId: lead.id,
      scheduledAt: new Date(Date.now() + 5 * 86_400_000),
      externalId: 'cal_tardio',
    });

    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after.stageId).toBe(stageIds.venta);
  });
});

describe('reporte de rendimiento por contenido', () => {
  it('acredita los ingresos al reel que trajo al lead', async () => {
    const { getContentPerformance, getKpis, getFunnel } = await import('@/server/services/analytics');
    const range = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) };

    const rows = await getContentPerformance(orgId, range);
    const reelA = rows.find((row) => row.contentId === contentA);
    const reelB = rows.find((row) => row.contentId === contentB);

    expect(reelA).toBeDefined();
    expect(reelA!.revenueCents).toBe(149_700);
    expect(reelA!.sales).toBe(1);
    expect(reelA!.leads).toBeGreaterThanOrEqual(2);
    expect(reelA!.meetingsBooked).toBeGreaterThanOrEqual(1);

    // El reel B tuvo mas views pero no genero ingresos: justamente lo que el
    // producto tiene que dejar en evidencia.
    expect(reelB!.revenueCents).toBe(0);
    expect(reelB!.views).toBeGreaterThan(reelA!.views);

    // Leads por 1.000 views compara reels de tamanos distintos.
    expect(reelA!.leadsPer1kViews).toBeGreaterThan(reelB!.leadsPer1kViews);

    const kpis = await getKpis(orgId, range);
    expect(kpis.sales).toBe(1);
    expect(kpis.revenueCents).toBe(149_700);

    const funnel = await getFunnel(orgId, range);
    expect(funnel[0].key).toBe('leads');
    expect(funnel.at(-1)!.count).toBe(1);
    expect(funnel.at(-1)!.totalRate).toBeGreaterThan(0);
  });

  it('expone los ingresos por keyword', async () => {
    const { getKeywordPerformance } = await import('@/server/services/analytics');
    const range = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const rows = await getKeywordPerformance(orgId, range);
    const guia = rows.find((row) => row.word === 'GUIA');
    expect(guia).toBeDefined();
    expect(guia!.triggers).toBeGreaterThanOrEqual(3);
    expect(guia!.revenueCents).toBe(149_700);
  });
});

describe('tasas de conversion sobre cohorte', () => {
  it('nunca pasan del 100% aunque compren leads de periodos anteriores', async () => {
    const { ingestInteraction, ingestConversion } = await import('@/server/services/ingest');
    const { getContentPerformance } = await import('@/server/services/analytics');

    // Contenido propio de este test, para que los conteos no arrastren leads
    // creados por los casos anteriores.
    const [aislado] = await db
      .insert(contents)
      .values({ orgId, title: 'Reel aislado', type: 'reel', igMediaId: 'MEDIA_C', views: 10_000 })
      .returning();

    // Lead viejo (fuera de la ventana) que compra hoy.
    const viejo = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      igUserId: 'IG_VIEJO',
      igUsername: 'lead.viejo',
      contentId: aislado.id,
      occurredAt: new Date(Date.now() - 60 * 86_400_000),
    });
    await ingestConversion({
      orgId,
      kind: 'sale',
      leadId: viejo.lead.id,
      amountCents: 100_000,
      externalId: 'venta_vieja',
    });

    // Lead nuevo (dentro de la ventana) que tambien compra hoy.
    const nuevo = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      igUserId: 'IG_NUEVO',
      igUsername: 'lead.nuevo',
      contentId: aislado.id,
    });
    await ingestConversion({
      orgId,
      kind: 'sale',
      leadId: nuevo.lead.id,
      amountCents: 100_000,
      externalId: 'venta_nueva',
    });

    // Ventana corta: deja fuera al lead viejo pero incluye su venta.
    const range = { from: new Date(Date.now() - 7 * 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const rows = await getContentPerformance(orgId, range);
    const reel = rows.find((row) => row.contentId === aislado.id)!;

    // Dos ventas en la ventana y un solo lead nuevo: el calculo ingenuo daria 200%.
    expect(reel.leads).toBe(1);
    expect(reel.sales).toBe(2);
    expect(reel.leadToSale).toBeLessThanOrEqual(1);

    // La cohorte describe al lead que entro en el periodo: entro y compro.
    expect(reel.cohortLeads).toBe(1);
    expect(reel.cohortSales).toBe(1);
    expect(reel.leadToSale).toBe(1);

    // Los ingresos si son los cobrados en la ventana: las dos ventas.
    expect(reel.revenueCents).toBe(200_000);
  });
});

describe('eventos fechados en el futuro', () => {
  it('no entran en los reportes, y por eso nada debe generarlos', async () => {
    const { recordEvent } = await import('@/server/services/events');
    const { getContentPerformance, defaultRange } = await import('@/server/services/analytics');

    const [futuro] = await db
      .insert(contents)
      .values({ orgId, title: 'Reel del futuro', type: 'reel', views: 1000 })
      .returning();

    // Una venta "cerrada" mañana: no es un ingreso, es un dato mal fechado.
    await recordEvent({
      orgId,
      contentId: futuro.id,
      type: 'sale',
      valueCents: 500_000,
      occurredAt: new Date(Date.now() + 2 * 86_400_000),
      dedupeKey: 'venta-del-futuro',
    });

    // El rango por defecto termina ahora: el evento queda afuera.
    const rows = await getContentPerformance(orgId, defaultRange(30));
    const reel = rows.find((row) => row.contentId === futuro.id)!;
    expect(reel.revenueCents).toBe(0);
    expect(reel.sales).toBe(0);

    // Ampliando la ventana hacia adelante sí aparece: el evento existe, el
    // problema es su fecha. Por eso el seed nunca fecha nada en el futuro.
    const ampliado = await getContentPerformance(orgId, {
      from: new Date(Date.now() - 30 * 86_400_000),
      to: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(ampliado.find((row) => row.contentId === futuro.id)!.revenueCents).toBe(500_000);
  });
});
