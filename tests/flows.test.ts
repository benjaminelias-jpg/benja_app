import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  conversations,
  messages,
} from '@/db/schema';
import {
  messagingWindow,
  dmByteLength,
  truncateForDm,
  igMeLink,
  profileLink,
} from '@/server/integrations/instagram';

/**
 * Flujos con ramificacion, esperas de respuesta y bandeja de entrada.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgId: string;
let contentId: string;
let flowId: string;
let stageIds: Record<string, string> = {};

beforeAll(async () => {
  db = await setupTestDb();

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Flujos Test', slug: 'flujos-test' })
    .returning();
  orgId = org.id;

  await db.insert(users).values({ orgId, name: 'Closer', email: 'c@test.com', role: 'closer' });
  await db
    .insert(instagramAccounts)
    .values({ orgId, igUserId: 'IG_CUENTA', username: 'cuenta', connected: false });

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId, name: 'Ventas', isDefault: true })
    .returning();

  const created = await db
    .insert(stages)
    .values([
      { pipelineId: pipeline.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 },
      { pipelineId: pipeline.id, name: 'Conversando', key: 'conversando', kind: 'contacted', position: 1 },
      { pipelineId: pipeline.id, name: 'Calificado', key: 'calificado', kind: 'qualified', position: 2 },
      { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 3 },
    ])
    .returning();
  stageIds = Object.fromEntries(created.map((stage) => [stage.key, stage.id]));

  const [content] = await db
    .insert(contents)
    .values({ orgId, title: 'Reel de prueba', type: 'reel', igMediaId: 'MEDIA_F', views: 50_000 })
    .returning();
  contentId = content.id;

  const [flow] = await db
    .insert(automations)
    .values({ orgId, name: 'Calificación', trigger: 'ig_comment_keyword', active: true })
    .returning();
  flowId = flow.id;

  // Flujo:  pregunta → condición →  sí: etiqueta "califica"   |   no: etiqueta "frio"
  await db.insert(automationSteps).values([
    {
      automationId: flow.id, position: 0, type: 'ask_question',
      nodeId: 'q', nextNodeId: 'cond',
      config: { text: '¿Ya facturás?', saveAs: 'facturacion' },
    },
    {
      automationId: flow.id, position: 1, type: 'condition',
      nodeId: 'cond',
      config: { match: 'any', checks: [{ field: 'respuesta', op: 'contains', value: 'factur' }] },
      branches: [
        { when: 'true', goTo: 'si' },
        { when: 'false', goTo: 'no' },
      ],
    },
    {
      automationId: flow.id, position: 2, type: 'add_tag',
      nodeId: 'si', nextNodeId: 'si2',
      config: { tags: ['califica'] },
    },
    {
      // Nodo terminal de la rama "sí": no debe continuar hacia la rama "no".
      automationId: flow.id, position: 3, type: 'set_stage',
      nodeId: 'si2',
      config: { stageKey: 'calificado' },
    },
    {
      automationId: flow.id, position: 4, type: 'add_tag',
      nodeId: 'no',
      config: { tags: ['frio'] },
    },
  ]);

  await db.insert(keywords).values({
    orgId,
    contentId,
    automationId: flow.id,
    word: 'INFO',
    matchType: 'exact',
    channel: 'ig_comment',
    resourceName: 'La guía',
    resourceUrl: 'https://test.com/guia',
  });
});

afterAll(async () => {
  await teardownTestDb();
});

describe('preguntar y esperar', () => {
  it('pausa el flujo y guarda la espera', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    const result = await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'INFO',
      igUserId: 'IG_A',
      igUsername: 'lead.a',
      igMediaId: 'MEDIA_F',
      commentId: 'C_A',
      messageExternalId: 'C_A',
    });

    const [wait] = await db
      .select()
      .from(automationWaits)
      .where(eq(automationWaits.leadId, result.lead.id));

    expect(wait).toBeDefined();
    expect(wait.nodeId).toBe('q');
    expect(wait.saveAs).toBe('facturacion');

    // El flujo no siguió: todavía no hay etiqueta de ninguna rama.
    expect(result.lead.tags).not.toContain('califica');
    expect(result.lead.tags).not.toContain('frio');
  });

  it('el DM del lead reanuda el flujo y toma la rama "sí"', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'si, ya facturo 3k al mes',
      igUserId: 'IG_A',
      messageExternalId: 'DM_A',
    });

    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));

    expect(lead.tags).toContain('califica');
    expect(lead.stageId).toBe(stageIds.calificado);
    expect((lead.customFields as Record<string, unknown>).facturacion).toBe('si, ya facturo 3k al mes');

    // La espera se consumió: un segundo DM ya no reanuda nada.
    const pending = await db
      .select()
      .from(automationWaits)
      .where(eq(automationWaits.leadId, lead.id));
    expect(pending).toHaveLength(0);
  });

  it('un nodo terminal de la rama "sí" NO cae en la rama "no"', async () => {
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    // Este es el fallo que tuvo el motor: sin `nextNodeId`, el paso final de una
    // rama seguía al paso siguiente por posición y ejecutaba la otra rama.
    expect(lead.tags).not.toContain('frio');
  });

  it('toma la rama "no" cuando la respuesta no cumple', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'INFO',
      igUserId: 'IG_B',
      igUsername: 'lead.b',
      igMediaId: 'MEDIA_F',
      commentId: 'C_B',
      messageExternalId: 'C_B',
    });

    await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'recien arranco, no vendi nada todavia',
      igUserId: 'IG_B',
      messageExternalId: 'DM_B',
    });

    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_B'));
    expect(lead.tags).toContain('frio');
    expect(lead.tags).not.toContain('califica');
    expect(lead.stageId).not.toBe(stageIds.calificado);
  });

  it('la respuesta a una pregunta no dispara una keyword suelta', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'INFO',
      igUserId: 'IG_C',
      igUsername: 'lead.c',
      igMediaId: 'MEDIA_F',
      commentId: 'C_C',
      messageExternalId: 'C_C',
    });

    // El texto contiene "INFO", que es una keyword: igual debe reanudar el flujo
    // en curso en vez de arrancar otro.
    await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'dame mas INFO porfa, recien arranco',
      igUserId: 'IG_C',
      messageExternalId: 'DM_C',
    });

    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_C'));
    expect(lead.tags).toContain('frio');

    // Una sola ejecucion: la del comentario. El DM la reanudo, no arranco otra.
    const { automationRuns } = await import('@/db/schema');
    const runs = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.leadId, lead.id));
    expect(runs).toHaveLength(1);
  });
});

describe('prueba en seco del flujo', () => {
  it('recorre el flujo sin escribir nada', async () => {
    const { simulateAutomation } = await import('@/server/services/automations');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_B'));
    const tagsBefore = [...lead.tags];

    const result = await simulateAutomation(flowId, {
      orgId,
      lead,
      text: 'ya facturo bastante',
    });

    expect(result.status).toBe('waiting');
    expect(result.steps[0].type).toBe('ask_question');
    expect(result.steps[0].dryRun).toBe(true);

    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after.tags).toEqual(tagsBefore);

    // Una simulación no deja esperas abiertas ni ejecuciones registradas.
    const waits = await db.select().from(automationWaits).where(eq(automationWaits.leadId, lead.id));
    expect(waits).toHaveLength(0);
  });
});

describe('bandeja de entrada', () => {
  it('crea el hilo y cuenta los no leídos del lado del lead', async () => {
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    const [thread] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.orgId, orgId), eq(conversations.leadId, lead.id)));

    expect(thread).toBeDefined();
    expect(thread.lastInboundAt).not.toBeNull();
    expect(thread.unreadCount).toBeGreaterThan(0);

    const thread_messages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, thread.id));
    expect(thread_messages.length).toBeGreaterThan(0);
    expect(thread_messages.some((message) => message.direction === 'outbound')).toBe(true);
  });

  it('marca como leído', async () => {
    const { markAsRead } = await import('@/server/services/inbox');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    const [thread] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, lead.id));

    await markAsRead(thread.id);
    const [after] = await db.select().from(conversations).where(eq(conversations.id, thread.id));
    expect(after.unreadCount).toBe(0);
  });

  it('rechaza responder fuera de la ventana de 24 h', async () => {
    const { sendReply } = await import('@/server/services/inbox');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    const [thread] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, lead.id));

    await db
      .update(conversations)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(conversations.id, thread.id));

    const result = await sendReply({ orgId, conversationId: thread.id, text: 'hola' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('24 h');
  });

  it('rechaza un mensaje vacío o demasiado largo', async () => {
    const { sendReply } = await import('@/server/services/inbox');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    const [thread] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, lead.id));

    await db
      .update(conversations)
      .set({ lastInboundAt: new Date() })
      .where(eq(conversations.id, thread.id));

    expect((await sendReply({ orgId, conversationId: thread.id, text: '   ' })).ok).toBe(false);

    const tooLong = 'a'.repeat(1200);
    const result = await sendReply({ orgId, conversationId: thread.id, text: tooLong });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('1000');
  });

  it('envía dentro de la ventana y lo registra en el hilo', async () => {
    const { sendReply } = await import('@/server/services/inbox');
    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_A'));
    const [thread] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.leadId, lead.id));

    await db
      .update(conversations)
      .set({ lastInboundAt: new Date() })
      .where(eq(conversations.id, thread.id));

    const result = await sendReply({
      orgId,
      conversationId: thread.id,
      text: 'Gracias por escribir!',
    });

    expect(result.ok).toBe(true);
    // Sin token de Instagram el envío queda registrado pero no sale a la red.
    expect(result.dryRun).toBe(true);

    const [after] = await db.select().from(conversations).where(eq(conversations.id, thread.id));
    expect(after.lastMessagePreview).toBe('Gracias por escribir!');
    expect(after.lastOutboundAt).not.toBeNull();
  });
});

describe('ventana de mensajería y límites de Instagram', () => {
  it('calcula la ventana de 24 h', () => {
    expect(messagingWindow(null).open).toBe(false);
    expect(messagingWindow(new Date()).open).toBe(true);
    expect(messagingWindow(new Date(Date.now() - 2 * 3_600_000)).hoursLeft).toBeCloseTo(22, 0);
    expect(messagingWindow(new Date(Date.now() - 25 * 3_600_000)).open).toBe(false);
  });

  it('mide el DM en bytes, no en caracteres', () => {
    expect(dmByteLength('hola')).toBe(4);
    // Un emoji ocupa cuatro bytes: contar caracteres dejaría pasar mensajes
    // que Instagram rechaza.
    expect(dmByteLength('🔥')).toBe(4);
    expect(truncateForDm('hola')).toBe('hola');

    const long = '🔥'.repeat(300);
    expect(dmByteLength(long)).toBeGreaterThan(1000);
    expect(dmByteLength(truncateForDm(long))).toBeLessThanOrEqual(1000);
  });

  it('arma los enlaces documentados por Meta', () => {
    expect(igMeLink('@benja.escala')).toBe('https://ig.me/benja.escala');
    expect(igMeLink('benja.escala', 'reel-42')).toBe('https://ig.me/benja.escala?ref=reel-42');
    expect(profileLink('@lead')).toBe('https://www.instagram.com/lead/');
  });
});

describe('fechas fuera de rango', () => {
  it('la ventana nunca supera las 24 h, ni con una fecha futura', () => {
    // Un reloj desfasado o un import mal fechado daban "quedan 29 h".
    const future = new Date(Date.now() + 5 * 3_600_000);
    const window = messagingWindow(future);
    expect(window.open).toBe(true);
    expect(window.hoursLeft).toBeLessThanOrEqual(24);
    expect(window.hoursLeft).toBeCloseTo(24, 0);
  });

  it('guarda el mensaje con su hora real, no con la de importacion', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');
    const hace3dias = new Date(Date.now() - 3 * 86_400_000);

    const result = await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'mensaje viejo',
      igUserId: 'IG_VIEJO_MSG',
      igUsername: 'viejo',
      messageExternalId: 'DM_VIEJO',
      occurredAt: hace3dias,
    });

    const [stored] = await db
      .select()
      .from(messages)
      .where(eq(messages.externalId, 'DM_VIEJO'));

    expect(stored).toBeDefined();
    expect(Math.abs(stored.sentAt.getTime() - hace3dias.getTime())).toBeLessThan(2000);
    expect(result.lead.id).toBeDefined();
  });
});

describe('envío de medios', () => {
  it('usa la forma de cuerpo que corresponde a cada tipo', async () => {
    const { sendMedia } = await import('@/server/integrations/instagram');
    const auth = { igUserId: 'IG_CUENTA', token: null, method: 'instagram_login' as const };

    // Sin token el cliente simula y devuelve el cuerpo que habría enviado.
    const imagen = await sendMedia(auth, {
      recipientIgId: 'IG_1',
      type: 'image',
      url: 'https://x.com/a.jpg',
    });
    const audio = await sendMedia(auth, {
      recipientIgId: 'IG_1',
      type: 'audio',
      url: 'https://x.com/a.m4a',
    });

    const cuerpoImagen = (imagen.data as { body: { message: Record<string, unknown> } }).body.message;
    const cuerpoAudio = (audio.data as { body: { message: Record<string, unknown> } }).body.message;

    // Meta usa `attachments` (lista) para imagen y `attachment` (objeto) para
    // audio, video y archivo. Confundirlas hace que el envío falle sin explicación.
    expect(Array.isArray(cuerpoImagen.attachments)).toBe(true);
    expect(cuerpoImagen.attachment).toBeUndefined();

    expect(cuerpoAudio.attachment).toBeDefined();
    expect(cuerpoAudio.attachments).toBeUndefined();
    expect((cuerpoAudio.attachment as { type: string }).type).toBe('audio');
  });

  it('rechaza formatos que Instagram no acepta, antes de llamar a la API', async () => {
    const { validateMedia } = await import('@/server/integrations/instagram');

    expect(validateMedia('audio', 'https://x.com/nota.m4a')).toBeNull();
    expect(validateMedia('audio', 'https://x.com/nota.mp3')).toContain('aac');
    expect(validateMedia('image', 'https://x.com/foto.gif')).toContain('png');
    expect(validateMedia('file', 'https://x.com/doc.docx')).toContain('pdf');

    // Meta descarga la URL: tiene que ser pública y por HTTPS.
    expect(validateMedia('audio', 'http://x.com/nota.m4a')).toContain('HTTPS');
  });

  it('deduce el tipo por la extensión', async () => {
    const { mediaTypeFromUrl } = await import('@/server/integrations/instagram');
    expect(mediaTypeFromUrl('https://x.com/a.m4a')).toBe('audio');
    expect(mediaTypeFromUrl('https://x.com/a.png')).toBe('image');
    expect(mediaTypeFromUrl('https://x.com/a.pdf')).toBe('file');
    expect(mediaTypeFromUrl('https://x.com/a.mov')).toBe('video');
    expect(mediaTypeFromUrl('https://x.com/a.xyz')).toBeNull();
    // Con parámetros de query la extensión igual se reconoce.
    expect(mediaTypeFromUrl('https://x.com/a.wav?v=2')).toBe('audio');
  });
});

describe('botones de respuesta rápida', () => {
  it('respeta los límites de Instagram', async () => {
    const { sendQuickReplies } = await import('@/server/integrations/instagram');
    const auth = { igUserId: 'IG_CUENTA', token: null, method: 'instagram_login' as const };

    const result = await sendQuickReplies(auth, {
      recipientIgId: 'IG_1',
      text: '¿Qué te interesa?',
      options: Array.from({ length: 20 }, (_, i) => ({
        title: `Opción muy larga número ${i}`,
        payload: `op_${i}`,
      })),
    });

    const message = (result.data as { body: { message: Record<string, unknown> } }).body.message;
    const botones = message.quick_replies as Array<{ title: string; content_type: string }>;

    // Meta corta en 13 botones y 20 caracteres de título.
    expect(botones).toHaveLength(13);
    expect(botones.every((b) => b.title.length <= 20)).toBe(true);
    expect(botones.every((b) => b.content_type === 'text')).toBe(true);
    expect(message.text).toBe('¿Qué te interesa?');
  });

  it('el payload del botón manda sobre el texto visible al reanudar', async () => {
    const { ingestInteraction } = await import('@/server/services/ingest');

    await ingestInteraction({
      orgId,
      source: 'ig_comment',
      text: 'INFO',
      igUserId: 'IG_BOTON',
      igUsername: 'lead.boton',
      igMediaId: 'MEDIA_F',
      commentId: 'C_BOTON',
      messageExternalId: 'C_BOTON',
    });

    // El lead toca un botón cuyo título NO contiene "factur" pero su payload sí.
    // La condición mira el payload, así que debe tomar la rama "sí".
    await ingestInteraction({
      orgId,
      source: 'ig_dm',
      text: 'Sí, ya vendo',
      quickReplyPayload: 'ya_facturo',
      igUserId: 'IG_BOTON',
      messageExternalId: 'DM_BOTON',
    });

    const [lead] = await db.select().from(leads).where(eq(leads.igUserId, 'IG_BOTON'));
    expect(lead.tags).toContain('califica');
    expect((lead.customFields as Record<string, unknown>).facturacion).toBe('ya_facturo');
  });
});

describe('acciones de remitente', () => {
  it('manda solo recipient y sender_action, sin message', async () => {
    const { sendSenderAction } = await import('@/server/integrations/instagram');
    const auth = { igUserId: 'IG_CUENTA', token: null, method: 'instagram_login' as const };

    const result = await sendSenderAction(auth, { recipientIgId: 'IG_1', action: 'typing_on' });
    const body = (result.data as { body: Record<string, unknown> }).body;

    // Meta rechaza la petición si se mezcla con un mensaje.
    expect(body.sender_action).toBe('typing_on');
    expect(body.message).toBeUndefined();
    expect(body.recipient).toEqual({ id: 'IG_1' });
  });
});
