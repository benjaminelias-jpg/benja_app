/**
 * Esquema de base de datos de Hook CRM.
 *
 * Idea central: TODO lo que pasa con un lead queda registrado en `events`,
 * y cada evento arrastra el `contentId` que lo origino. Asi, una venta
 * registrada 40 dias despues sigue sabiendo de que reel vino el lead.
 *
 * Dialecto: PostgreSQL (local = PGlite embebido, produccion = cualquier Postgres).
 * El dinero se guarda SIEMPRE en centavos (integer) para evitar errores de coma flotante.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  date,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { newId } from '../lib/ids';

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'closer', 'setter', 'viewer']);

export const contentTypeEnum = pgEnum('content_type', [
  'reel',
  'post',
  'carousel',
  'story',
  'live',
  'ad',
  'external',
]);

export const funnelStageEnum = pgEnum('funnel_stage', ['tofu', 'mofu', 'bofu']);

export const leadSourceEnum = pgEnum('lead_source', [
  'ig_comment',
  'ig_dm',
  'ig_story_reply',
  'ig_mention',
  'ig_ad',
  'ig_bio_link',
  'manychat',
  'webhook',
  'form',
  'manual',
  'import',
]);

export const leadStatusEnum = pgEnum('lead_status', ['active', 'won', 'lost', 'unsubscribed']);

/**
 * `kind` es lo que permite que la analitica funcione con pipelines personalizados:
 * el usuario puede llamar a la etapa "Call agendada" o "Reu", pero si su kind
 * es `meeting`, el embudo la cuenta como reunion.
 */
export const stageKindEnum = pgEnum('stage_kind', [
  'new',
  'contacted',
  'qualified',
  'meeting',
  'offer',
  'won',
  'lost',
]);

export const eventTypeEnum = pgEnum('event_type', [
  'lead_created',
  'keyword_triggered',
  'resource_sent',
  'comment_received',
  'dm_received',
  'dm_sent',
  'story_reply',
  'mention',
  'stage_changed',
  'meeting_booked',
  'meeting_held',
  'meeting_no_show',
  'offer_made',
  'sale',
  'refund',
  'lost',
  'tag_added',
  'field_updated',
  'automation_run',
  'unsubscribed',
  'custom',
]);

export const channelEnum = pgEnum('channel', [
  'ig_dm',
  'ig_comment',
  'ig_story',
  'email',
  'whatsapp',
  'phone',
  'web',
  'system',
]);

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'held',
  'no_show',
  'canceled',
  'rescheduled',
]);

export const dealStatusEnum = pgEnum('deal_status', ['open', 'won', 'lost', 'refunded']);

export const productTypeEnum = pgEnum('product_type', [
  'curso',
  'mentoria',
  'comunidad',
  'servicio',
  'evento',
  'otro',
]);

export const automationTriggerEnum = pgEnum('automation_trigger', [
  'ig_comment_keyword',
  'ig_dm_keyword',
  'ig_story_reply',
  'ig_mention',
  'manychat_event',
  'webhook',
  'stage_change',
  'manual',
]);

export const automationStepEnum = pgEnum('automation_step_type', [
  'send_dm',
  'reply_comment',
  'send_resource',
  'add_tag',
  'remove_tag',
  'set_stage',
  'set_field',
  'assign_owner',
  'create_appointment',
  'create_deal',
  'http_request',
  'wait',
  'notify',
]);

export const runStatusEnum = pgEnum('run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const webhookProviderEnum = pgEnum('webhook_provider', [
  'manychat',
  'instagram',
  'calendly',
  'cal_com',
  'hotmart',
  'stripe',
  'typeform',
  'zapier',
  'make',
  'custom',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'received',
  'processed',
  'ignored',
  'failed',
]);

export const matchTypeEnum = pgEnum('match_type', ['exact', 'contains', 'starts_with', 'regex']);

export const touchTypeEnum = pgEnum('touch_type', ['first', 'assist', 'last']);

/* ------------------------------------------------------------------ *
 * Organizacion y equipo
 * ------------------------------------------------------------------ */

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => newId('org')),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  currency: text('currency').notNull().default('USD'),
  /** Ventana de atribucion en dias: cuanto tiempo un contenido se lleva el credito de una venta. */
  attributionWindowDays: integer('attribution_window_days').notNull().default(90),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('usr')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: userRoleEnum('role').notNull().default('closer'),
    avatarUrl: text('avatar_url'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_org_email_idx').on(t.orgId, t.email)],
);

/* ------------------------------------------------------------------ *
 * Instagram
 * ------------------------------------------------------------------ */

export const instagramAccounts = pgTable(
  'instagram_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('iga')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    igUserId: text('ig_user_id').notNull(),
    username: text('username').notNull(),
    name: text('name'),
    profilePicUrl: text('profile_pic_url'),
    followersCount: integer('followers_count').notNull().default(0),
    /** Token de pagina/IG. En produccion debe vivir cifrado o en un secret manager. */
    accessToken: text('access_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** Token que Meta envia en el handshake GET del webhook. */
    webhookVerifyToken: text('webhook_verify_token'),
    connected: boolean('connected').notNull().default(false),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ig_accounts_user_idx').on(t.orgId, t.igUserId)],
);

/**
 * Contenido = la unidad de atribucion. Un reel, un post, una story, un anuncio
 * o incluso una fuente externa ("podcast", "newsletter") usando type=external.
 */
export const contents = pgTable(
  'contents',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cnt')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    igAccountId: text('ig_account_id').references(() => instagramAccounts.id, {
      onDelete: 'set null',
    }),
    igMediaId: text('ig_media_id'),
    type: contentTypeEnum('type').notNull().default('reel'),
    title: text('title').notNull(),
    caption: text('caption'),
    permalink: text('permalink'),
    thumbnailUrl: text('thumbnail_url'),
    /** El gancho de los primeros 3 segundos: lo que de verdad se quiere comparar. */
    hook: text('hook'),
    /** Angulo del mensaje: "dolor", "autoridad", "contraintuitivo", etc. */
    angle: text('angle'),
    funnelStage: funnelStageEnum('funnel_stage').notNull().default('tofu'),
    /** Codigo corto para trackear links en bio / CTAs: hookcrm.app/r/<refCode> */
    refCode: text('ref_code'),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // Metricas agregadas (ultimo snapshot conocido desde la Graph API)
    views: integer('views').notNull().default(0),
    reach: integer('reach').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    commentsCount: integer('comments_count').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    saves: integer('saves').notNull().default(0),
    /** Inversion publicitaria asociada, en centavos (si el contenido se pauto). */
    adSpendCents: integer('ad_spend_cents').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contents_media_idx').on(t.orgId, t.igMediaId),
    uniqueIndex('contents_ref_idx').on(t.orgId, t.refCode),
    index('contents_published_idx').on(t.orgId, t.publishedAt),
  ],
);

/** Serie temporal de metricas por contenido, para ver la curva de un reel. */
export const contentMetricsDaily = pgTable(
  'content_metrics_daily',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cmd')),
    contentId: text('content_id')
      .notNull()
      .references(() => contents.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
    reach: integer('reach').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    commentsCount: integer('comments_count').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    saves: integer('saves').notNull().default(0),
  },
  (t) => [uniqueIndex('content_metrics_day_idx').on(t.contentId, t.day)],
);

/* ------------------------------------------------------------------ *
 * Pipelines
 * ------------------------------------------------------------------ */

export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey().$defaultFn(() => newId('pip')),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stages = pgTable(
  'stages',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('stg')),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    kind: stageKindEnum('kind').notNull().default('new'),
    position: integer('position').notNull().default(0),
    color: text('color').notNull().default('#6366f1'),
    /** Dias sin movimiento tras los cuales el lead se marca como estancado. */
    staleAfterDays: integer('stale_after_days').notNull().default(7),
  },
  (t) => [uniqueIndex('stages_key_idx').on(t.pipelineId, t.key)],
);

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('lead')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Identidad en Instagram
    igUserId: text('ig_user_id'),
    igUsername: text('ig_username'),
    profilePicUrl: text('profile_pic_url'),
    followersCount: integer('followers_count'),

    // Identidad fuera de Instagram
    fullName: text('full_name'),
    email: text('email'),
    phone: text('phone'),
    country: text('country'),
    timezone: text('timezone'),

    // Origen y atribucion (desnormalizado a proposito: la consulta mas comun del CRM)
    source: leadSourceEnum('source').notNull().default('ig_dm'),
    firstTouchContentId: text('first_touch_content_id').references(() => contents.id, {
      onDelete: 'set null',
    }),
    lastTouchContentId: text('last_touch_content_id').references(() => contents.id, {
      onDelete: 'set null',
    }),
    firstTouchKeywordId: text('first_touch_keyword_id'),

    // Estado comercial
    pipelineId: text('pipeline_id').references(() => pipelines.id, { onDelete: 'set null' }),
    stageId: text('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    status: leadStatusEnum('status').notNull().default('active'),
    score: integer('score').notNull().default(0),
    /** Suma de ventas ganadas, en centavos. Se recalcula al cerrar un deal. */
    revenueCents: integer('revenue_cents').notNull().default(0),

    // Integraciones externas
    manychatSubscriberId: text('manychat_subscriber_id'),
    externalId: text('external_id'),

    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    notes: text('notes'),

    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_ig_user_idx').on(t.orgId, t.igUserId),
    uniqueIndex('leads_manychat_idx').on(t.orgId, t.manychatSubscriberId),
    index('leads_stage_idx').on(t.orgId, t.stageId),
    index('leads_first_touch_idx').on(t.orgId, t.firstTouchContentId),
    index('leads_created_idx').on(t.orgId, t.createdAt),
    index('leads_owner_idx').on(t.orgId, t.ownerId),
  ],
);

/**
 * Cada contacto de un lead con una pieza de contenido.
 * Permite atribucion multi-touch sin perder el first/last touch rapido de `leads`.
 */
export const attributionTouches = pgTable(
  'attribution_touches',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('tch')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    contentId: text('content_id').references(() => contents.id, { onDelete: 'cascade' }),
    keywordId: text('keyword_id'),
    type: touchTypeEnum('type').notNull().default('assist'),
    channel: channelEnum('channel').notNull().default('ig_dm'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('touches_lead_idx').on(t.leadId),
    index('touches_content_idx').on(t.contentId, t.occurredAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Palabras clave y automatizaciones (el "ManyChat propio")
 * ------------------------------------------------------------------ */

export const automations = pgTable('automations', {
  id: text('id').primaryKey().$defaultFn(() => newId('aut')),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  trigger: automationTriggerEnum('trigger').notNull().default('ig_comment_keyword'),
  triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  runsCount: integer('runs_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const automationSteps = pgTable(
  'automation_steps',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('stp')),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    type: automationStepEnum('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('steps_automation_idx').on(t.automationId, t.position)],
);

/**
 * "Responde X y te paso el recurso Y": la keyword ata un contenido concreto
 * con una automatizacion y con el recurso entregado.
 */
export const keywords = pgTable(
  'keywords',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('kw')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    automationId: text('automation_id').references(() => automations.id, { onDelete: 'set null' }),
    word: text('word').notNull(),
    matchType: matchTypeEnum('match_type').notNull().default('exact'),
    /** Donde escucha: comentario, DM, respuesta a story. */
    channel: channelEnum('channel').notNull().default('ig_comment'),
    resourceName: text('resource_name'),
    resourceUrl: text('resource_url'),
    active: boolean('active').notNull().default(true),
    triggeredCount: integer('triggered_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('keywords_word_idx').on(t.orgId, t.word),
    index('keywords_content_idx').on(t.contentId),
  ],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('run')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    keywordId: text('keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    status: runStatusEnum('status').notNull().default('pending'),
    stepsLog: jsonb('steps_log').$type<unknown[]>().notNull().default([]),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('runs_automation_idx').on(t.automationId, t.startedAt)],
);

/* ------------------------------------------------------------------ *
 * Conversaciones
 * ------------------------------------------------------------------ */

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('msg')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    direction: messageDirectionEnum('direction').notNull(),
    channel: channelEnum('channel').notNull().default('ig_dm'),
    body: text('body'),
    mediaUrl: text('media_url'),
    /** Si lo envio una automatizacion y no una persona. */
    automatedBy: text('automated_by').references(() => automations.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_lead_idx').on(t.leadId, t.sentAt),
    uniqueIndex('messages_external_idx').on(t.orgId, t.externalId),
  ],
);

/* ------------------------------------------------------------------ *
 * Reuniones, productos y ventas
 * ------------------------------------------------------------------ */

export const appointments = pgTable(
  'appointments',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('apt')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** Contenido atribuido en el momento de agendar (congelado). */
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull().default('Llamada de diagnostico'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    status: appointmentStatusEnum('status').notNull().default('scheduled'),
    source: text('source'),
    meetingUrl: text('meeting_url'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_lead_idx').on(t.leadId),
    index('appointments_date_idx').on(t.orgId, t.scheduledAt),
    uniqueIndex('appointments_external_idx').on(t.orgId, t.externalId),
  ],
);

export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => newId('prd')),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: productTypeEnum('type').notNull().default('curso'),
  priceCents: integer('price_cents').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('dl')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Contenido atribuido en el momento de la venta (congelado). */
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    status: dealStatusEnum('status').notNull().default('open'),
    paymentPlan: text('payment_plan'),
    source: text('source'),
    externalId: text('external_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('deals_lead_idx').on(t.leadId),
    index('deals_content_idx').on(t.orgId, t.contentId),
    index('deals_closed_idx').on(t.orgId, t.closedAt),
    uniqueIndex('deals_external_idx').on(t.orgId, t.externalId),
  ],
);

/* ------------------------------------------------------------------ *
 * Eventos: la fuente de verdad de la atribucion
 * ------------------------------------------------------------------ */

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('evt')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    /** Contenido al que se le atribuye este evento. */
    contentId: text('content_id').references(() => contents.id, { onDelete: 'set null' }),
    keywordId: text('keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
    automationId: text('automation_id').references(() => automations.id, { onDelete: 'set null' }),
    dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    appointmentId: text('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    type: eventTypeEnum('type').notNull(),
    channel: channelEnum('channel').notNull().default('system'),
    source: text('source'),
    /** Valor economico del evento en centavos (ventas, reembolsos en negativo). */
    valueCents: integer('value_cents').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Clave de idempotencia: impide duplicar un evento si el webhook se reenvia. */
    dedupeKey: text('dedupe_key'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_dedupe_idx').on(t.orgId, t.dedupeKey),
    index('events_lead_idx').on(t.leadId, t.occurredAt),
    index('events_content_type_idx').on(t.orgId, t.contentId, t.type),
    index('events_type_date_idx').on(t.orgId, t.type, t.occurredAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Integraciones entrantes
 * ------------------------------------------------------------------ */

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('whe')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    provider: webhookProviderEnum('provider').notNull().default('custom'),
    /** Secreto compartido: se valida por HMAC o por header segun el proveedor. */
    secret: text('secret').notNull(),
    /**
     * Mapeo campo-origen -> campo-CRM para proveedores arbitrarios.
     * Ej: { "lead.email": "payload.contact.email", "event.type": "sale" }
     */
    mapping: jsonb('mapping').$type<Record<string, unknown>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    deliveriesCount: integer('deliveries_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('webhook_slug_idx').on(t.slug)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('whd')),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id').references(() => webhookEndpoints.id, { onDelete: 'set null' }),
    provider: webhookProviderEnum('provider').notNull().default('custom'),
    status: deliveryStatusEnum('status').notNull().default('received'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    payload: jsonb('payload').$type<unknown>().notNull().default({}),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
    error: text('error'),
    durationMs: integer('duration_ms'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('deliveries_received_idx').on(t.receivedAt), index('deliveries_status_idx').on(t.status)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('key')),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Prefijo visible para identificar la clave en la UI (hk_live_abcd...). */
    prefix: text('prefix').notNull(),
    /** SHA-256 de la clave completa. La clave en claro solo se muestra al crearla. */
    hash: text('hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.hash)],
);

/* ------------------------------------------------------------------ *
 * Relaciones (para las consultas con `db.query...`)
 * ------------------------------------------------------------------ */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  leads: many(leads),
  contents: many(contents),
  pipelines: many(pipelines),
}));

export const contentsRelations = relations(contents, ({ one, many }) => ({
  org: one(organizations, { fields: [contents.orgId], references: [organizations.id] }),
  igAccount: one(instagramAccounts, {
    fields: [contents.igAccountId],
    references: [instagramAccounts.id],
  }),
  keywords: many(keywords),
  dailyMetrics: many(contentMetricsDaily),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  org: one(organizations, { fields: [leads.orgId], references: [organizations.id] }),
  stage: one(stages, { fields: [leads.stageId], references: [stages.id] }),
  pipeline: one(pipelines, { fields: [leads.pipelineId], references: [pipelines.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  firstTouchContent: one(contents, {
    fields: [leads.firstTouchContentId],
    references: [contents.id],
  }),
  messages: many(messages),
  events: many(events),
  deals: many(deals),
  appointments: many(appointments),
  touches: many(attributionTouches),
}));

export const pipelinesRelations = relations(pipelines, ({ many }) => ({ stages: many(stages) }));

export const stagesRelations = relations(stages, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [stages.pipelineId], references: [pipelines.id] }),
  leads: many(leads),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  lead: one(leads, { fields: [events.leadId], references: [leads.id] }),
  content: one(contents, { fields: [events.contentId], references: [contents.id] }),
  keyword: one(keywords, { fields: [events.keywordId], references: [keywords.id] }),
}));

export const keywordsRelations = relations(keywords, ({ one }) => ({
  content: one(contents, { fields: [keywords.contentId], references: [contents.id] }),
  automation: one(automations, { fields: [keywords.automationId], references: [automations.id] }),
}));

export const automationsRelations = relations(automations, ({ many }) => ({
  steps: many(automationSteps),
  runs: many(automationRuns),
  keywords: many(keywords),
}));

export const automationStepsRelations = relations(automationSteps, ({ one }) => ({
  automation: one(automations, {
    fields: [automationSteps.automationId],
    references: [automations.id],
  }),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  lead: one(leads, { fields: [deals.leadId], references: [leads.id] }),
  content: one(contents, { fields: [deals.contentId], references: [contents.id] }),
  product: one(products, { fields: [deals.productId], references: [products.id] }),
  owner: one(users, { fields: [deals.ownerId], references: [users.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  lead: one(leads, { fields: [appointments.leadId], references: [leads.id] }),
  content: one(contents, { fields: [appointments.contentId], references: [contents.id] }),
  owner: one(users, { fields: [appointments.ownerId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  lead: one(leads, { fields: [messages.leadId], references: [leads.id] }),
}));

/* ------------------------------------------------------------------ *
 * Tipos inferidos
 * ------------------------------------------------------------------ */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type InstagramAccount = typeof instagramAccounts.$inferSelect;
export type Content = typeof contents.$inferSelect;
export type NewContent = typeof contents.$inferInsert;
export type Pipeline = typeof pipelines.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Keyword = typeof keywords.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationStep = typeof automationSteps.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type EventType = (typeof eventTypeEnum.enumValues)[number];
export type StageKind = (typeof stageKindEnum.enumValues)[number];
export type LeadSource = (typeof leadSourceEnum.enumValues)[number];
