/**
 * Datos de ejemplo de un negocio de infoproductos real.
 *
 * No inserta filas sueltas en `events`: simula interacciones de verdad a traves
 * del mismo pipeline de ingesta que usan los webhooks. Por eso los numeros del
 * dashboard son coherentes entre si y sirven para validar que la atribucion
 * funciona de punta a punta.
 *
 *   npm run db:seed
 */
import { sql } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import {
  organizations,
  users,
  instagramAccounts,
  contents,
  contentMetricsDaily,
  pipelines,
  stages,
  products,
  automations,
  automationSteps,
  keywords,
  webhookEndpoints,
} from './schema';
import { ingestInteraction, ingestConversion } from '../server/services/ingest';
import { moveLeadToStage } from '../server/services/leads';
import { setMeetingOutcome } from '../server/services/commerce';
import { randomToken } from '../lib/ids';

/** PRNG determinista: el mismo seed produce siempre el mismo negocio de ejemplo. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260218);
const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const chance = (probability: number) => rand() < probability;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
/** Nada puede ocurrir en el futuro: rompe las ventanas de tiempo y los reportes. */
const noLaterThanNow = (date: Date) => (date.getTime() > Date.now() ? new Date() : date);

const NOMBRES = [
  'Camila Rossi', 'Martin Duarte', 'Sofia Benitez', 'Lucas Fernandez', 'Valentina Gomez',
  'Mateo Silva', 'Julieta Paz', 'Nicolas Herrera', 'Agustina Lopez', 'Tomas Medina',
  'Brenda Castro', 'Facundo Rios', 'Micaela Ortiz', 'Ivan Morales', 'Rocio Vera',
  'Santiago Nunez', 'Florencia Diaz', 'Joaquin Peralta', 'Antonella Ruiz', 'Gonzalo Vidal',
  'Milagros Sosa', 'Emiliano Cruz', 'Paula Aguirre', 'Bruno Ferreyra', 'Carla Dominguez',
  'Ezequiel Romero', 'Delfina Acosta', 'Ramiro Suarez', 'Abril Navarro', 'Lautaro Campos',
];
const PAISES = ['AR', 'MX', 'ES', 'CO', 'CL', 'PE', 'UY', 'US'];

function usernameFor(name: string, index: number): string {
  const [first, last] = name.toLowerCase().split(' ');
  const styles = [
    `${first}.${last}`,
    `${first}${last}`,
    `${first}_${last?.[0] ?? 'x'}`,
    `${first}${index}`,
  ];
  return styles[index % styles.length].replace(/[^a-z0-9._]/g, '');
}

async function main() {
  const db = await getDb();

  console.log('Limpiando datos previos...');
  // TRUNCATE con CASCADE: el orden de las FKs deja de importar.
  await db.execute(sql`
    TRUNCATE TABLE
      events, attribution_touches, messages, automation_runs, automation_steps, automations,
      webhook_deliveries, webhook_endpoints, api_keys, deals, appointments, products,
      keywords, content_metrics_daily, contents, leads, stages, pipelines,
      instagram_accounts, users, organizations
    RESTART IDENTITY CASCADE
  `);

  /* ---------------------------------------------------------------- *
   * Organizacion, equipo y cuenta de Instagram
   * ---------------------------------------------------------------- */
  console.log('Creando organizacion y equipo...');
  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Academia Escala',
      slug: 'academia-escala',
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'USD',
      attributionWindowDays: 90,
    })
    .returning();

  const team = await db
    .insert(users)
    .values([
      { orgId: org.id, name: 'Benja Elias', email: 'benja@academiaescala.com', role: 'owner' },
      { orgId: org.id, name: 'Sofi Ramirez', email: 'sofi@academiaescala.com', role: 'setter' },
      { orgId: org.id, name: 'Martin Quiroga', email: 'martin@academiaescala.com', role: 'closer' },
      { orgId: org.id, name: 'Lucia Bravo', email: 'lucia@academiaescala.com', role: 'closer' },
    ])
    .returning();

  const closers = team.filter((member) => member.role === 'closer' || member.role === 'owner');

  await db.insert(instagramAccounts).values({
    orgId: org.id,
    igUserId: '17841400000000001',
    username: 'benja.escala',
    name: 'Benja | Escala tu infoproducto',
    followersCount: 48_300,
    connected: true,
    webhookVerifyToken: 'hookcrm-dev-verify',
    lastSyncedAt: new Date(),
  });

  /* ---------------------------------------------------------------- *
   * Pipeline
   * ---------------------------------------------------------------- */
  console.log('Creando pipeline...');
  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId: org.id, name: 'Ventas high-ticket', isDefault: true })
    .returning();

  const pipelineStages = await db
    .insert(stages)
    .values([
      { pipelineId: pipeline.id, name: 'Lead nuevo', key: 'nuevo', kind: 'new', position: 0, color: '#64748b', staleAfterDays: 2 },
      { pipelineId: pipeline.id, name: 'Conversando', key: 'conversando', kind: 'contacted', position: 1, color: '#0ea5e9', staleAfterDays: 3 },
      { pipelineId: pipeline.id, name: 'Calificado', key: 'calificado', kind: 'qualified', position: 2, color: '#8b5cf6', staleAfterDays: 4 },
      { pipelineId: pipeline.id, name: 'Reu agendada', key: 'reu', kind: 'meeting', position: 3, color: '#f59e0b', staleAfterDays: 5 },
      { pipelineId: pipeline.id, name: 'Oferta presentada', key: 'oferta', kind: 'offer', position: 4, color: '#ec4899', staleAfterDays: 4 },
      { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 5, color: '#10b981', staleAfterDays: 30 },
      { pipelineId: pipeline.id, name: 'Perdido', key: 'perdido', kind: 'lost', position: 6, color: '#ef4444', staleAfterDays: 90 },
    ])
    .returning();

  const stageByKey = Object.fromEntries(pipelineStages.map((stage) => [stage.key, stage]));

  /* ---------------------------------------------------------------- *
   * Productos
   * ---------------------------------------------------------------- */
  const catalog = await db
    .insert(products)
    .values([
      { orgId: org.id, name: 'Mentoria Escala 1:1', type: 'mentoria', priceCents: 299_700 },
      { orgId: org.id, name: 'Programa Escala Grupal', type: 'curso', priceCents: 149_700 },
      { orgId: org.id, name: 'Curso Reels que Venden', type: 'curso', priceCents: 19_700 },
      { orgId: org.id, name: 'Comunidad Escala', type: 'comunidad', priceCents: 4_700 },
    ])
    .returning();

  /* ---------------------------------------------------------------- *
   * Contenidos: la materia prima de la atribucion
   * ---------------------------------------------------------------- */
  console.log('Creando contenidos...');
  const contentSeeds = [
    { title: 'El error que te hace perder 9 de cada 10 leads', type: 'reel' as const, hook: 'Si tus DMs estan llenos y no vendes, es por esto', angle: 'dolor', funnelStage: 'tofu' as const, views: 412_000, publishedDaysAgo: 54, leadWeight: 26, meetingRate: 0.28, closeRate: 0.21, keyword: 'ERROR' },
    { title: 'Mi guion de DM que agenda 4 reus por dia', type: 'reel' as const, hook: 'Este guion de 6 lineas me agenda 4 llamadas diarias', angle: 'contraintuitivo', funnelStage: 'mofu' as const, views: 287_000, publishedDaysAgo: 41, leadWeight: 24, meetingRate: 0.41, closeRate: 0.27, keyword: 'GUION' },
    { title: 'Como cobrar 3000 USD sin audiencia enorme', type: 'reel' as const, hook: 'No necesitas 100k seguidores para cobrar 3k', angle: 'autoridad', funnelStage: 'bofu' as const, views: 194_500, publishedDaysAgo: 33, leadWeight: 18, meetingRate: 0.46, closeRate: 0.34, keyword: 'ESCALA' },
    { title: 'Plantilla de oferta irresistible', type: 'carousel' as const, hook: '7 bloques que convierten una oferta tibia en un si', angle: 'recurso', funnelStage: 'mofu' as const, views: 86_400, publishedDaysAgo: 28, leadWeight: 14, meetingRate: 0.3, closeRate: 0.18, keyword: 'PLANTILLA' },
    { title: 'Reel viral que no vendio nada (analisis)', type: 'reel' as const, hook: '1.2M de views y cero ventas: que paso', angle: 'contraintuitivo', funnelStage: 'tofu' as const, views: 1_240_000, publishedDaysAgo: 22, leadWeight: 5, meetingRate: 0.08, closeRate: 0.05, keyword: 'ANALISIS' },
    { title: 'Los 3 filtros para calificar un lead', type: 'reel' as const, hook: 'Deja de hablar con gente que nunca te va a comprar', angle: 'dolor', funnelStage: 'mofu' as const, views: 158_200, publishedDaysAgo: 18, leadWeight: 16, meetingRate: 0.38, closeRate: 0.29, keyword: 'FILTROS' },
    { title: 'Story: detras de camara de una venta de 3k', type: 'story' as const, hook: 'Te muestro la conversacion completa', angle: 'prueba social', funnelStage: 'bofu' as const, views: 21_800, publishedDaysAgo: 14, leadWeight: 9, meetingRate: 0.52, closeRate: 0.38, keyword: 'VENTA' },
    { title: 'Carrusel: 5 metricas que miro cada lunes', type: 'carousel' as const, hook: 'Si no mides esto, estas adivinando', angle: 'autoridad', funnelStage: 'mofu' as const, views: 64_300, publishedDaysAgo: 11, leadWeight: 11, meetingRate: 0.26, closeRate: 0.2, keyword: 'METRICAS' },
    { title: 'Reel: por que tu lead magnet no convierte', type: 'reel' as const, hook: 'Tu PDF gratis es el problema', angle: 'dolor', funnelStage: 'tofu' as const, views: 231_700, publishedDaysAgo: 8, leadWeight: 17, meetingRate: 0.22, closeRate: 0.16, keyword: 'IMAN' },
    { title: 'Anuncio: masterclass de captacion organica', type: 'ad' as const, hook: 'Masterclass gratis: 30 leads por semana sin pauta', angle: 'oferta', funnelStage: 'bofu' as const, views: 98_000, publishedDaysAgo: 6, leadWeight: 13, meetingRate: 0.35, closeRate: 0.22, keyword: 'MASTERCLASS', adSpendCents: 142_000 },
    { title: 'Reel: la pregunta que cierra la llamada', type: 'reel' as const, hook: 'Hace esta pregunta en el minuto 20', angle: 'contraintuitivo', funnelStage: 'bofu' as const, views: 76_900, publishedDaysAgo: 4, leadWeight: 8, meetingRate: 0.44, closeRate: 0.31, keyword: 'PREGUNTA' },
    { title: 'Post: resultados de alumnos en 90 dias', type: 'post' as const, hook: 'De 0 a 11k USD/mes en 90 dias', angle: 'prueba social', funnelStage: 'bofu' as const, views: 44_100, publishedDaysAgo: 2, leadWeight: 6, meetingRate: 0.4, closeRate: 0.3, keyword: 'RESULTADOS' },
  ];

  const createdContents = await db
    .insert(contents)
    .values(
      contentSeeds.map((seed, index) => ({
        orgId: org.id,
        igMediaId: `178${String(41000000000000 + index * 7919)}`,
        type: seed.type,
        title: seed.title,
        hook: seed.hook,
        angle: seed.angle,
        funnelStage: seed.funnelStage,
        caption: `${seed.hook}\n\nComenta ${seed.keyword} y te lo mando por DM.`,
        permalink: `https://www.instagram.com/reel/HC${index}X${index * 7}/`,
        refCode: seed.keyword.toLowerCase(),
        publishedAt: daysAgo(seed.publishedDaysAgo),
        views: seed.views,
        reach: Math.round(seed.views * between(0.62, 0.81)),
        likes: Math.round(seed.views * between(0.018, 0.045)),
        commentsCount: Math.round(seed.views * between(0.0012, 0.0045)),
        shares: Math.round(seed.views * between(0.004, 0.012)),
        saves: Math.round(seed.views * between(0.006, 0.019)),
        adSpendCents: seed.adSpendCents ?? 0,
        tags: [seed.angle, seed.funnelStage],
      })),
    )
    .returning();

  // Curva diaria de cada contenido: el 60% de las views caen en las primeras 48 h.
  console.log('Generando metricas diarias...');
  const metricRows = [];
  for (let index = 0; index < createdContents.length; index += 1) {
    const content = createdContents[index];
    const seed = contentSeeds[index];
    const span = Math.min(seed.publishedDaysAgo, 14);
    let remaining = content.views;
    for (let day = 0; day < span; day += 1) {
      const share = day === 0 ? 0.38 : day === 1 ? 0.22 : Math.max(0.01, 0.4 / (day + 1) ** 1.6);
      const dayViews = Math.round(Math.min(remaining, content.views * share));
      remaining -= dayViews;
      const date = new Date(daysAgo(seed.publishedDaysAgo - day));
      metricRows.push({
        contentId: content.id,
        day: date.toISOString().slice(0, 10),
        views: dayViews,
        reach: Math.round(dayViews * 0.72),
        likes: Math.round(dayViews * 0.03),
        commentsCount: Math.round(dayViews * 0.002),
        shares: Math.round(dayViews * 0.007),
        saves: Math.round(dayViews * 0.011),
      });
    }
  }
  if (metricRows.length > 0) await db.insert(contentMetricsDaily).values(metricRows);

  /* ---------------------------------------------------------------- *
   * Automatizaciones y keywords
   * ---------------------------------------------------------------- */
  console.log('Creando automatizaciones...');
  const [entregaRecurso] = await db
    .insert(automations)
    .values({
      orgId: org.id,
      name: 'Entrega de recurso + calificacion',
      description:
        'Responde el comentario, manda el recurso por DM, etiqueta al lead y lo mueve a Conversando.',
      trigger: 'ig_comment_keyword',
      triggerConfig: { channel: 'ig_comment' },
      active: true,
    })
    .returning();

  // Flujo con ramificacion y espera de respuesta: muestra lo que un flujo
  // lineal no puede hacer. El nodo n6 bifurca segun lo que conteste el lead.
  await db.insert(automationSteps).values([
    {
      automationId: entregaRecurso.id, position: 0, type: 'reply_comment',
      nodeId: 'n1', nextNodeId: 'n2', canvasX: 120, canvasY: 40,
      config: { text: 'Te lo mando por DM ahora mismo 📩' },
    },
    {
      automationId: entregaRecurso.id, position: 1, type: 'send_resource',
      nodeId: 'n2', nextNodeId: 'n3', canvasX: 120, canvasY: 180,
      config: { text: 'Hola {{nombre}}! Aca tenes {{recurso}}: {{link}}' },
    },
    {
      automationId: entregaRecurso.id, position: 2, type: 'add_tag',
      nodeId: 'n3', nextNodeId: 'n4', canvasX: 120, canvasY: 320,
      config: { tags: ['recurso-entregado'] },
    },
    {
      automationId: entregaRecurso.id, position: 3, type: 'assign_owner',
      nodeId: 'n4', nextNodeId: 'n5', canvasX: 120, canvasY: 460,
      config: { strategy: 'round_robin' },
    },
    {
      automationId: entregaRecurso.id, position: 4, type: 'ask_question',
      nodeId: 'n5', nextNodeId: 'n6', canvasX: 120, canvasY: 600,
      config: {
        text: 'Una pregunta rapida {{nombre}}: ¿ya estas vendiendo tu infoproducto o recien empezas?',
        saveAs: 'facturacion',
      },
    },
    {
      automationId: entregaRecurso.id, position: 5, type: 'condition',
      nodeId: 'n6', canvasX: 120, canvasY: 740,
      config: {
        match: 'any',
        checks: [
          { field: 'respuesta', op: 'contains', value: 'factur' },
          { field: 'respuesta', op: 'contains', value: 'vendo' },
          { field: 'respuesta', op: 'contains', value: 'vendiendo' },
        ],
      },
      branches: [
        { when: 'true', goTo: 'n7' },
        { when: 'false', goTo: 'n9' },
      ],
    },
    {
      automationId: entregaRecurso.id, position: 6, type: 'send_dm',
      nodeId: 'n7', nextNodeId: 'n8', canvasX: -140, canvasY: 900,
      config: {
        text: 'Buenisimo {{nombre}}. Agenda aca un diagnostico de 20 min: https://cal.com/academiaescala/diagnostico',
      },
    },
    {
      automationId: entregaRecurso.id, position: 7, type: 'set_stage',
      nodeId: 'n8', canvasX: -140, canvasY: 1040,
      config: { stageKey: 'calificado' },
    },
    {
      automationId: entregaRecurso.id, position: 8, type: 'add_tag',
      nodeId: 'n9', nextNodeId: 'n10', canvasX: 400, canvasY: 900,
      config: { tags: ['esta-empezando'] },
    },
    {
      automationId: entregaRecurso.id, position: 9, type: 'set_stage',
      nodeId: 'n10', canvasX: 400, canvasY: 1040,
      config: { stageKey: 'conversando' },
    },
  ]);

  const [invitacionCall] = await db
    .insert(automations)
    .values({
      orgId: org.id,
      name: 'Pedido de agenda por DM',
      description: 'Para quien escribe AGENDA por privado: manda el link y lo marca como calificado.',
      trigger: 'ig_dm_keyword',
      triggerConfig: { channel: 'ig_dm' },
      active: true,
    })
    .returning();

  await db.insert(automationSteps).values([
    {
      automationId: invitacionCall.id, position: 0, type: 'send_dm',
      nodeId: 'm1', nextNodeId: 'm2', canvasX: 120, canvasY: 40,
      config: { text: 'Listo {{nombre}}, agenda aca: https://cal.com/academiaescala/diagnostico' },
    },
    {
      automationId: invitacionCall.id, position: 1, type: 'set_stage',
      nodeId: 'm2', nextNodeId: 'm3', canvasX: 120, canvasY: 180,
      config: { stageKey: 'calificado' },
    },
    {
      automationId: invitacionCall.id, position: 2, type: 'add_tag',
      nodeId: 'm3', canvasX: 120, canvasY: 320,
      config: { tags: ['pidio-agenda'] },
    },
  ]);

  const createdKeywords = await db
    .insert(keywords)
    .values(
      contentSeeds.map((seed, index) => ({
        orgId: org.id,
        contentId: createdContents[index].id,
        automationId: entregaRecurso.id,
        word: seed.keyword,
        matchType: 'exact' as const,
        channel: 'ig_comment' as const,
        resourceName: `Recurso: ${seed.title}`,
        resourceUrl: `https://academiaescala.com/r/${seed.keyword.toLowerCase()}`,
        active: true,
      })),
    )
    .returning();

  await db.insert(keywords).values({
    orgId: org.id,
    automationId: invitacionCall.id,
    word: 'AGENDA',
    matchType: 'contains',
    channel: 'ig_dm',
    resourceName: 'Link de agenda',
    resourceUrl: 'https://cal.com/academiaescala/diagnostico',
    active: true,
  });

  /* ---------------------------------------------------------------- *
   * Endpoints de webhook
   * ---------------------------------------------------------------- */
  await db.insert(webhookEndpoints).values([
    {
      orgId: org.id,
      slug: 'calendly',
      name: 'Calendly - reunion agendada',
      provider: 'calendly',
      secret: randomToken(24),
      mapping: {
        kind: '=meeting',
        email: 'payload.invitee.email',
        fullName: 'payload.invitee.name',
        scheduledAt: 'payload.event.start_time',
        externalId: 'payload.event.uri',
      },
    },
    {
      orgId: org.id,
      slug: 'hotmart',
      name: 'Hotmart - compra aprobada',
      provider: 'hotmart',
      secret: randomToken(24),
      mapping: {
        kind: '=sale',
        email: 'data.buyer.email',
        fullName: 'data.buyer.name',
        amount: 'data.purchase.price.value',
        currency: 'data.purchase.price.currency_value',
        externalId: 'data.purchase.transaction',
      },
    },
    {
      orgId: org.id,
      slug: 'cal-com',
      name: 'Cal.com - no show',
      provider: 'cal_com',
      secret: randomToken(24),
      mapping: {
        kind: '=no_show',
        email: 'payload.attendees.0.email',
        externalId: 'payload.uid',
      },
    },
  ]);

  /* ---------------------------------------------------------------- *
   * Simulacion de 60 dias de actividad
   * ---------------------------------------------------------------- */
  console.log('Simulando 60 dias de leads, reuniones y ventas...');

  // Reparto ponderado de leads por contenido.
  const weighted: number[] = [];
  contentSeeds.forEach((seed, index) => {
    for (let i = 0; i < seed.leadWeight; i += 1) weighted.push(index);
  });

  const TOTAL_LEADS = 186;
  let meetings = 0;
  let sales = 0;

  for (let i = 0; i < TOTAL_LEADS; i += 1) {
    const contentIndex = pick(weighted);
    const seed = contentSeeds[contentIndex];
    const content = createdContents[contentIndex];
    const keyword = createdKeywords[contentIndex];

    // El lead llega entre el dia de publicacion y 12 dias despues.
    const ageDays = Math.max(
      0.2,
      seed.publishedDaysAgo - between(0, Math.min(12, seed.publishedDaysAgo)),
    );
    const createdAt = daysAgo(ageDays);

    const name = NOMBRES[i % NOMBRES.length];
    const username = usernameFor(name, i);

    const { lead } = await ingestInteraction({
      orgId: org.id,
      source: 'ig_comment',
      text: keyword.word,
      igUserId: `IG${100_000 + i}`,
      igUsername: username,
      fullName: name,
      followersCount: Math.round(between(180, 14_000)),
      igMediaId: content.igMediaId,
      commentId: `COMMENT_${i}`,
      messageExternalId: `COMMENT_${i}`,
      occurredAt: createdAt,
    });

    // El flujo quedo esperando respuesta: este DM lo reanuda y la condicion
    // decide por que rama sigue.
    const respondio = chance(0.55);
    if (respondio) {
      await ingestInteraction({
        orgId: org.id,
        source: 'ig_dm',
        text: chance(0.5)
          ? 'Ya facturo unos 2k al mes pero estoy estancado'
          : 'Recien estoy empezando, todavia no vendi nada',
        igUserId: `IG${100_000 + i}`,
        igUsername: username,
        messageExternalId: `DM_${i}`,
        occurredAt: noLaterThanNow(new Date(createdAt.getTime() + between(0.2, 2) * 86_400_000)),
      });
    }

    // Algunos escriben despues pidiendo la agenda: ahi ya no hay espera abierta,
    // asi que dispara la keyword y su propio flujo.
    if (respondio && chance(0.3)) {
      await ingestInteraction({
        orgId: org.id,
        source: 'ig_dm',
        text: 'AGENDA, quiero la call',
        igUserId: `IG${100_000 + i}`,
        igUsername: username,
        messageExternalId: `DM2_${i}`,
        occurredAt: noLaterThanNow(new Date(createdAt.getTime() + between(2, 4) * 86_400_000)),
      });
    }

    // Reunion.
    if (chance(seed.meetingRate)) {
      meetings += 1;
      const bookedAt = new Date(createdAt.getTime() + between(0.5, 4) * 86_400_000);
      const scheduledAt = new Date(bookedAt.getTime() + between(1, 5) * 86_400_000);
      const owner = pick(closers);

      const { appointment } = await ingestConversion({
        orgId: org.id,
        kind: 'meeting',
        leadId: lead.id,
        scheduledAt,
        ownerId: owner.id,
        externalId: `cal_${i}`,
        source: 'calendly',
        occurredAt: bookedAt,
      });

      // Solo resolvemos las reuniones cuya fecha ya paso.
      if (appointment && scheduledAt.getTime() < Date.now()) {
        const attended = chance(0.72);
        await setMeetingOutcome({
          appointmentId: appointment.id,
          status: attended ? 'held' : 'no_show',
          occurredAt: scheduledAt,
        });

        if (attended) {
          if (chance(seed.closeRate)) {
            sales += 1;
            const product = chance(0.42)
              ? catalog[0]
              : chance(0.55)
                ? catalog[1]
                : chance(0.7)
                  ? catalog[2]
                  : catalog[3];
            await ingestConversion({
              orgId: org.id,
              kind: 'sale',
              leadId: lead.id,
              amountCents: product.priceCents,
              currency: 'USD',
              productId: product.id,
              ownerId: owner.id,
              externalId: `hotmart_${i}`,
              source: 'hotmart',
              occurredAt: new Date(scheduledAt.getTime() + between(0.1, 3) * 86_400_000),
            });
          } else if (chance(0.5)) {
            // Vio la oferta y la esta pensando.
            await moveLeadToStage({
              leadId: lead.id,
              stageId: stageByKey.oferta.id,
              source: 'seed',
              occurredAt: new Date(scheduledAt.getTime() + 3_600_000),
            });
          } else if (chance(0.45)) {
            await moveLeadToStage({
              leadId: lead.id,
              stageId: stageByKey.perdido.id,
              source: 'seed',
              occurredAt: new Date(scheduledAt.getTime() + 86_400_000),
            });
          }
        }
      }
    } else if (chance(0.18)) {
      // Leads que se enfrian sin llegar a reunion.
      await moveLeadToStage({
        leadId: lead.id,
        stageId: stageByKey.perdido.id,
        source: 'seed',
        occurredAt: new Date(createdAt.getTime() + between(3, 9) * 86_400_000),
      });
    } else if (chance(0.3)) {
      await moveLeadToStage({
        leadId: lead.id,
        stageId: stageByKey.calificado.id,
        source: 'seed',
        occurredAt: new Date(createdAt.getTime() + between(0.5, 3) * 86_400_000),
      });
    }

    if ((i + 1) % 40 === 0) console.log(`  ${i + 1}/${TOTAL_LEADS} leads simulados`);
  }

  console.log('');
  console.log('Listo.');
  console.log(`  Organizacion : ${org.name}`);
  console.log(`  Contenidos   : ${createdContents.length}`);
  console.log(`  Keywords     : ${createdKeywords.length + 1}`);
  console.log(`  Leads        : ${TOTAL_LEADS}`);
  console.log(`  Reuniones    : ${meetings}`);
  console.log(`  Ventas       : ${sales}`);
  console.log('');
  console.log('Arranca la app con:  npm run dev');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Fallo el seed:', error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
