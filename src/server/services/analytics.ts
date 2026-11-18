import { sql, eq, and, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { contents, keywords, leads, stages, users } from '@/db/schema';

/**
 * Analitica de atribucion.
 *
 * Todo se calcula sobre la tabla `events`, no sobre los estados actuales de los
 * leads. Asi, si un lead cambia de etapa cinco veces, el embudo historico sigue
 * siendo correcto, y una venta registrada hoy se acredita al contenido que
 * trajo al lead hace dos meses.
 */

/** Normaliza el resultado crudo entre el driver de PGlite y el de node-postgres. */
async function rawRows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

export interface DateRange {
  from: Date;
  to: Date;
}

export function defaultRange(days = 30): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from };
}

/* ------------------------------------------------------------------ *
 * KPIs generales
 * ------------------------------------------------------------------ */

export interface Kpis {
  leads: number;
  engagedLeads: number;
  meetingsBooked: number;
  meetingsHeld: number;
  noShows: number;
  sales: number;
  revenueCents: number;
  adSpendCents: number;
}

export async function getKpis(orgId: string, range: DateRange): Promise<Kpis> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT
        count(DISTINCT CASE WHEN type = 'lead_created' THEN lead_id END)                      AS leads,
        -- Conversacion = el lead escribio un DM. El comentario y la keyword son
        -- la entrada misma, contarlos haria que este paso siempre diera 100%.
        count(DISTINCT CASE WHEN type IN ('dm_received','story_reply') THEN lead_id END) AS engaged_leads,
        count(DISTINCT CASE WHEN type = 'meeting_booked' THEN appointment_id END)             AS meetings_booked,
        count(DISTINCT CASE WHEN type = 'meeting_held' THEN appointment_id END)               AS meetings_held,
        count(DISTINCT CASE WHEN type = 'meeting_no_show' THEN appointment_id END)            AS no_shows,
        count(DISTINCT CASE WHEN type = 'sale' THEN deal_id END)                              AS sales,
        COALESCE(SUM(CASE WHEN type IN ('sale','refund') THEN value_cents ELSE 0 END), 0)     AS revenue_cents
      FROM events
      WHERE org_id = ${orgId}
        AND occurred_at >= ${range.from.toISOString()}
        AND occurred_at <= ${range.to.toISOString()}
    `,
  );

  const spend = await rawRows<{ ad_spend_cents: string | number | null }>(
    db,
    sql`
      SELECT COALESCE(SUM(ad_spend_cents), 0) AS ad_spend_cents
      FROM contents
      WHERE org_id = ${orgId}
        AND (published_at IS NULL OR published_at <= ${range.to.toISOString()})
    `,
  );

  const row = rows[0] ?? {};
  return {
    leads: num(row.leads),
    engagedLeads: num(row.engaged_leads),
    meetingsBooked: num(row.meetings_booked),
    meetingsHeld: num(row.meetings_held),
    noShows: num(row.no_shows),
    sales: num(row.sales),
    revenueCents: num(row.revenue_cents),
    adSpendCents: num(spend[0]?.ad_spend_cents),
  };
}

/* ------------------------------------------------------------------ *
 * Rendimiento por contenido: el reporte central del producto
 * ------------------------------------------------------------------ */

export interface ContentPerformanceRow {
  contentId: string | null;
  title: string;
  type: string;
  hook: string | null;
  angle: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  publishedAt: string | null;
  views: number;
  adSpendCents: number;
  leads: number;
  keywordTriggers: number;
  meetingsBooked: number;
  meetingsHeld: number;
  sales: number;
  revenueCents: number;
  /** Leads que entraron en el periodo (base de las tasas de conversion). */
  cohortLeads: number;
  cohortSales: number;
  /** Leads por cada 1.000 reproducciones: compara reels de tamanos distintos. */
  leadsPer1kViews: number;
  /** Tasas sobre la cohorte: nunca pueden pasar del 100%. */
  leadToMeeting: number;
  meetingToSale: number;
  leadToSale: number;
  revenuePerLeadCents: number;
}

export async function getContentPerformance(
  orgId: string,
  range: DateRange,
  options: { includeUnattributed?: boolean; limit?: number } = {},
): Promise<ContentPerformanceRow[]> {
  const db = await getDb();

  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      WITH agg AS (
        SELECT
          content_id,
          count(DISTINCT CASE WHEN type = 'lead_created' THEN lead_id END)           AS leads,
          count(*) FILTER (WHERE type = 'keyword_triggered')                         AS keyword_triggers,
          count(DISTINCT CASE WHEN type = 'meeting_booked' THEN appointment_id END)  AS meetings_booked,
          count(DISTINCT CASE WHEN type = 'meeting_held' THEN appointment_id END)    AS meetings_held,
          count(DISTINCT CASE WHEN type = 'sale' THEN deal_id END)                   AS sales,
          COALESCE(SUM(CASE WHEN type IN ('sale','refund') THEN value_cents ELSE 0 END), 0) AS revenue_cents
        FROM events
        WHERE org_id = ${orgId}
          AND occurred_at >= ${range.from.toISOString()}
          AND occurred_at <= ${range.to.toISOString()}
        GROUP BY content_id
      ),
      -- Las tasas de conversion se calculan sobre la COHORTE: los leads que
      -- entraron en el periodo y lo que hicieron despues. Si se midieran contra
      -- las ventas de la ventana, una venta de un lead viejo daria mas del 100%.
      cohort AS (
        SELECT
          l.first_touch_content_id AS content_id,
          count(DISTINCT l.id)                                        AS cohort_leads,
          count(DISTINCT a.id)                                        AS cohort_meetings,
          count(DISTINCT a.id) FILTER (WHERE a.status = 'held')       AS cohort_meetings_held,
          count(DISTINCT d.id) FILTER (WHERE d.status = 'won')        AS cohort_sales
        FROM leads l
        LEFT JOIN appointments a ON a.lead_id = l.id
        LEFT JOIN deals d ON d.lead_id = l.id
        WHERE l.org_id = ${orgId}
          AND l.created_at >= ${range.from.toISOString()}
          AND l.created_at <= ${range.to.toISOString()}
        GROUP BY l.first_touch_content_id
      )
      SELECT
        c.id                AS content_id,
        c.title             AS title,
        c.type::text        AS type,
        c.hook              AS hook,
        c.angle             AS angle,
        c.thumbnail_url     AS thumbnail_url,
        c.permalink         AS permalink,
        c.published_at      AS published_at,
        c.views             AS views,
        c.ad_spend_cents    AS ad_spend_cents,
        COALESCE(a.leads, 0)             AS leads,
        COALESCE(a.keyword_triggers, 0)  AS keyword_triggers,
        COALESCE(a.meetings_booked, 0)   AS meetings_booked,
        COALESCE(a.meetings_held, 0)     AS meetings_held,
        COALESCE(a.sales, 0)             AS sales,
        COALESCE(a.revenue_cents, 0)     AS revenue_cents,
        COALESCE(ch.cohort_leads, 0)          AS cohort_leads,
        COALESCE(ch.cohort_meetings, 0)       AS cohort_meetings,
        COALESCE(ch.cohort_meetings_held, 0)  AS cohort_meetings_held,
        COALESCE(ch.cohort_sales, 0)          AS cohort_sales
      FROM contents c
      LEFT JOIN agg a ON a.content_id = c.id
      LEFT JOIN cohort ch ON ch.content_id = c.id
      WHERE c.org_id = ${orgId} AND c.archived = false
      ORDER BY COALESCE(a.revenue_cents, 0) DESC, COALESCE(a.leads, 0) DESC, c.published_at DESC
      LIMIT ${options.limit ?? 200}
    `,
  );

  const mapped = rows.map(toPerformanceRow);

  if (options.includeUnattributed) {
    const orphan = await rawRows<Record<string, string | number | null>>(
      db,
      sql`
        SELECT
          count(DISTINCT CASE WHEN type = 'lead_created' THEN lead_id END)           AS leads,
          count(*) FILTER (WHERE type = 'keyword_triggered')                         AS keyword_triggers,
          count(DISTINCT CASE WHEN type = 'meeting_booked' THEN appointment_id END)  AS meetings_booked,
          count(DISTINCT CASE WHEN type = 'meeting_held' THEN appointment_id END)    AS meetings_held,
          count(DISTINCT CASE WHEN type = 'sale' THEN deal_id END)                   AS sales,
          COALESCE(SUM(CASE WHEN type IN ('sale','refund') THEN value_cents ELSE 0 END), 0) AS revenue_cents
        FROM events
        WHERE org_id = ${orgId}
          AND content_id IS NULL
          AND occurred_at >= ${range.from.toISOString()}
          AND occurred_at <= ${range.to.toISOString()}
      `,
    );
    const row = orphan[0];
    if (row && (num(row.leads) > 0 || num(row.sales) > 0)) {
      mapped.push(
        toPerformanceRow({
          ...row,
          content_id: null,
          title: 'Sin atribuir',
          type: 'external',
          views: 0,
          ad_spend_cents: 0,
          cohort_leads: row.leads ?? 0,
          cohort_sales: row.sales ?? 0,
        }),
      );
    }
  }

  return mapped;
}

function toPerformanceRow(row: Record<string, string | number | null>): ContentPerformanceRow {
  const leads = num(row.leads);
  const meetingsBooked = num(row.meetings_booked);
  const meetingsHeld = num(row.meetings_held);
  const sales = num(row.sales);
  const views = num(row.views);
  const revenueCents = num(row.revenue_cents);

  const cohortLeads = num(row.cohort_leads);
  const cohortMeetings = num(row.cohort_meetings);
  const cohortMeetingsHeld = num(row.cohort_meetings_held);
  const cohortSales = num(row.cohort_sales);

  return {
    contentId: (row.content_id as string) ?? null,
    title: (row.title as string) ?? 'Sin titulo',
    type: (row.type as string) ?? 'reel',
    hook: (row.hook as string) ?? null,
    angle: (row.angle as string) ?? null,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    permalink: (row.permalink as string) ?? null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    views,
    adSpendCents: num(row.ad_spend_cents),
    leads,
    keywordTriggers: num(row.keyword_triggers),
    meetingsBooked,
    meetingsHeld,
    sales,
    revenueCents,
    cohortLeads,
    cohortSales,
    leadsPer1kViews: views > 0 ? (leads / views) * 1000 : 0,
    leadToMeeting: cohortLeads > 0 ? cohortMeetings / cohortLeads : 0,
    meetingToSale: cohortMeetingsHeld > 0 ? cohortSales / cohortMeetingsHeld : 0,
    leadToSale: cohortLeads > 0 ? cohortSales / cohortLeads : 0,
    revenuePerLeadCents: leads > 0 ? Math.round(revenueCents / leads) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Embudo
 * ------------------------------------------------------------------ */

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** Conversion respecto al paso anterior. */
  stepRate: number;
  /** Conversion respecto al primer paso. */
  totalRate: number;
}

export async function getFunnel(
  orgId: string,
  range: DateRange,
  contentId?: string | null,
): Promise<FunnelStep[]> {
  const kpis = contentId
    ? await getContentKpis(orgId, range, contentId)
    : await getKpis(orgId, range);

  const steps = [
    { key: 'leads', label: 'Leads captados', count: kpis.leads },
    { key: 'engaged', label: 'Conversaciones', count: kpis.engagedLeads },
    { key: 'booked', label: 'Reuniones agendadas', count: kpis.meetingsBooked },
    { key: 'held', label: 'Reuniones realizadas', count: kpis.meetingsHeld },
    { key: 'sales', label: 'Ventas', count: kpis.sales },
  ];

  const first = steps[0].count || 0;
  return steps.map((step, index) => {
    const previous = index === 0 ? step.count : steps[index - 1].count;
    return {
      ...step,
      stepRate: previous > 0 ? step.count / previous : 0,
      totalRate: first > 0 ? step.count / first : 0,
    };
  });
}

async function getContentKpis(orgId: string, range: DateRange, contentId: string): Promise<Kpis> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT
        count(DISTINCT CASE WHEN type = 'lead_created' THEN lead_id END) AS leads,
        -- Conversacion = el lead escribio un DM. El comentario y la keyword son
        -- la entrada misma, contarlos haria que este paso siempre diera 100%.
        count(DISTINCT CASE WHEN type IN ('dm_received','story_reply') THEN lead_id END) AS engaged_leads,
        count(DISTINCT CASE WHEN type = 'meeting_booked' THEN appointment_id END) AS meetings_booked,
        count(DISTINCT CASE WHEN type = 'meeting_held' THEN appointment_id END)   AS meetings_held,
        count(DISTINCT CASE WHEN type = 'meeting_no_show' THEN appointment_id END) AS no_shows,
        count(DISTINCT CASE WHEN type = 'sale' THEN deal_id END)                  AS sales,
        COALESCE(SUM(CASE WHEN type IN ('sale','refund') THEN value_cents ELSE 0 END), 0) AS revenue_cents
      FROM events
      WHERE org_id = ${orgId} AND content_id = ${contentId}
        AND occurred_at >= ${range.from.toISOString()}
        AND occurred_at <= ${range.to.toISOString()}
    `,
  );
  const row = rows[0] ?? {};
  return {
    leads: num(row.leads),
    engagedLeads: num(row.engaged_leads),
    meetingsBooked: num(row.meetings_booked),
    meetingsHeld: num(row.meetings_held),
    noShows: num(row.no_shows),
    sales: num(row.sales),
    revenueCents: num(row.revenue_cents),
    adSpendCents: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Series temporales
 * ------------------------------------------------------------------ */

export interface TimeseriesPoint {
  day: string;
  leads: number;
  meetings: number;
  sales: number;
  revenueCents: number;
}

export async function getTimeseries(orgId: string, range: DateRange): Promise<TimeseriesPoint[]> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', ${range.from.toISOString()}::timestamptz),
          date_trunc('day', ${range.to.toISOString()}::timestamptz),
          interval '1 day'
        ) AS day
      ),
      agg AS (
        SELECT
          date_trunc('day', occurred_at) AS day,
          count(DISTINCT CASE WHEN type = 'lead_created' THEN lead_id END) AS leads,
          count(DISTINCT CASE WHEN type = 'meeting_booked' THEN appointment_id END) AS meetings,
          count(DISTINCT CASE WHEN type = 'sale' THEN deal_id END) AS sales,
          COALESCE(SUM(CASE WHEN type IN ('sale','refund') THEN value_cents ELSE 0 END), 0) AS revenue_cents
        FROM events
        WHERE org_id = ${orgId}
          AND occurred_at >= ${range.from.toISOString()}
          AND occurred_at <= ${range.to.toISOString()}
        GROUP BY 1
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS day,
        COALESCE(a.leads, 0)         AS leads,
        COALESCE(a.meetings, 0)      AS meetings,
        COALESCE(a.sales, 0)         AS sales,
        COALESCE(a.revenue_cents, 0) AS revenue_cents
      FROM days d
      LEFT JOIN agg a ON a.day = d.day
      ORDER BY d.day
    `,
  );

  return rows.map((row) => ({
    day: String(row.day),
    leads: num(row.leads),
    meetings: num(row.meetings),
    sales: num(row.sales),
    revenueCents: num(row.revenue_cents),
  }));
}

/* ------------------------------------------------------------------ *
 * Desgloses
 * ------------------------------------------------------------------ */

export interface KeywordPerformanceRow {
  keywordId: string;
  word: string;
  channel: string;
  resourceName: string | null;
  contentTitle: string | null;
  triggers: number;
  leads: number;
  sales: number;
  revenueCents: number;
}

export async function getKeywordPerformance(
  orgId: string,
  range: DateRange,
): Promise<KeywordPerformanceRow[]> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      WITH triggered AS (
        SELECT keyword_id, count(*) AS triggers, count(DISTINCT lead_id) AS leads
        FROM events
        WHERE org_id = ${orgId} AND type = 'keyword_triggered' AND keyword_id IS NOT NULL
          AND occurred_at >= ${range.from.toISOString()}
          AND occurred_at <= ${range.to.toISOString()}
        GROUP BY keyword_id
      ),
      -- Una venta se atribuye a la keyword que originalmente capto al lead.
      sold AS (
        SELECT l.first_touch_keyword_id AS keyword_id,
               count(DISTINCT e.deal_id) AS sales,
               COALESCE(SUM(e.value_cents), 0) AS revenue_cents
        FROM events e
        JOIN leads l ON l.id = e.lead_id
        WHERE e.org_id = ${orgId} AND e.type = 'sale'
          AND l.first_touch_keyword_id IS NOT NULL
          AND e.occurred_at >= ${range.from.toISOString()}
          AND e.occurred_at <= ${range.to.toISOString()}
        GROUP BY l.first_touch_keyword_id
      )
      SELECT
        k.id              AS keyword_id,
        k.word            AS word,
        k.channel::text   AS channel,
        k.resource_name   AS resource_name,
        c.title           AS content_title,
        COALESCE(t.triggers, 0)      AS triggers,
        COALESCE(t.leads, 0)         AS leads,
        COALESCE(s.sales, 0)         AS sales,
        COALESCE(s.revenue_cents, 0) AS revenue_cents
      FROM keywords k
      LEFT JOIN contents c ON c.id = k.content_id
      LEFT JOIN triggered t ON t.keyword_id = k.id
      LEFT JOIN sold s ON s.keyword_id = k.id
      WHERE k.org_id = ${orgId}
      ORDER BY COALESCE(s.revenue_cents, 0) DESC, COALESCE(t.triggers, 0) DESC
    `,
  );

  return rows.map((row) => ({
    keywordId: String(row.keyword_id),
    word: String(row.word),
    channel: String(row.channel),
    resourceName: (row.resource_name as string) ?? null,
    contentTitle: (row.content_title as string) ?? null,
    triggers: num(row.triggers),
    leads: num(row.leads),
    sales: num(row.sales),
    revenueCents: num(row.revenue_cents),
  }));
}

export interface SourceBreakdownRow {
  source: string;
  leads: number;
  sales: number;
  revenueCents: number;
}

export async function getSourceBreakdown(
  orgId: string,
  range: DateRange,
): Promise<SourceBreakdownRow[]> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT
        l.source::text AS source,
        count(DISTINCT l.id) AS leads,
        count(DISTINCT d.id) FILTER (WHERE d.status = 'won') AS sales,
        COALESCE(SUM(d.amount_cents) FILTER (WHERE d.status = 'won'), 0) AS revenue_cents
      FROM leads l
      LEFT JOIN deals d ON d.lead_id = l.id
      WHERE l.org_id = ${orgId}
        AND l.created_at >= ${range.from.toISOString()}
        AND l.created_at <= ${range.to.toISOString()}
      GROUP BY l.source
      ORDER BY leads DESC
    `,
  );
  return rows.map((row) => ({
    source: String(row.source),
    leads: num(row.leads),
    sales: num(row.sales),
    revenueCents: num(row.revenue_cents),
  }));
}

export interface CloserRow {
  userId: string;
  name: string;
  meetingsHeld: number;
  sales: number;
  revenueCents: number;
  closeRate: number;
}

export async function getCloserPerformance(orgId: string, range: DateRange): Promise<CloserRow[]> {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT
        u.id   AS user_id,
        u.name AS name,
        count(DISTINCT a.id) FILTER (WHERE a.status = 'held') AS meetings_held,
        count(DISTINCT d.id) FILTER (WHERE d.status = 'won')  AS sales,
        COALESCE(SUM(d.amount_cents) FILTER (WHERE d.status = 'won'), 0) AS revenue_cents
      FROM users u
      LEFT JOIN appointments a
        ON a.owner_id = u.id
       AND a.scheduled_at >= ${range.from.toISOString()}
       AND a.scheduled_at <= ${range.to.toISOString()}
      LEFT JOIN deals d
        ON d.owner_id = u.id
       AND d.closed_at >= ${range.from.toISOString()}
       AND d.closed_at <= ${range.to.toISOString()}
      WHERE u.org_id = ${orgId} AND u.active = true
      GROUP BY u.id, u.name
      ORDER BY revenue_cents DESC
    `,
  );

  return rows.map((row) => {
    const meetingsHeld = num(row.meetings_held);
    const sales = num(row.sales);
    return {
      userId: String(row.user_id),
      name: String(row.name),
      meetingsHeld,
      sales,
      revenueCents: num(row.revenue_cents),
      closeRate: meetingsHeld > 0 ? sales / meetingsHeld : 0,
    };
  });
}

/** Distribucion actual del pipeline: cuantos leads y cuanto valor hay en cada etapa. */
export async function getPipelineDistribution(orgId: string) {
  const db = await getDb();
  return db
    .select({
      stageId: stages.id,
      name: stages.name,
      kind: stages.kind,
      color: stages.color,
      position: stages.position,
      count: sql<number>`count(${leads.id})::int`,
    })
    .from(stages)
    .leftJoin(leads, and(eq(leads.stageId, stages.id), eq(leads.orgId, orgId)))
    .groupBy(stages.id, stages.name, stages.kind, stages.color, stages.position)
    .orderBy(stages.position);
}

/** Contenidos publicados recientemente que aun no generaron ningun lead. */
export async function getSilentContent(orgId: string, limit = 5) {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT c.id, c.title, c.type::text AS type, c.views, c.published_at
      FROM contents c
      WHERE c.org_id = ${orgId}
        AND c.archived = false
        AND c.published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.content_id = c.id AND e.type = 'lead_created'
        )
      ORDER BY c.views DESC
      LIMIT ${limit}
    `,
  );
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    type: String(row.type),
    views: num(row.views),
    publishedAt: row.published_at ? String(row.published_at) : null,
  }));
}

/** Leads sin movimiento mas tiempo del permitido por su etapa. */
export async function getStaleLeads(orgId: string, limit = 10) {
  const db = await getDb();
  return db
    .select({
      lead: leads,
      stage: { id: stages.id, name: stages.name, color: stages.color },
      owner: { id: users.id, name: users.name },
    })
    .from(leads)
    .innerJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(
      and(
        eq(leads.orgId, orgId),
        eq(leads.status, 'active'),
        sql`${leads.stageChangedAt} < now() - (${stages.staleAfterDays} || ' days')::interval`,
      ),
    )
    .orderBy(leads.stageChangedAt)
    .limit(limit);
}

/** Contenidos mejor valorados por ingreso, para el panel principal. */
export async function getTopContent(orgId: string, range: DateRange, limit = 5) {
  const rows = await getContentPerformance(orgId, range, { limit: 100 });
  return rows.filter((row) => row.leads > 0 || row.revenueCents > 0).slice(0, limit);
}

export async function listContents(orgId: string) {
  const db = await getDb();
  return db
    .select()
    .from(contents)
    .where(eq(contents.orgId, orgId))
    .orderBy(desc(contents.publishedAt));
}

export async function listKeywordsForContent(contentId: string) {
  const db = await getDb();
  return db.select().from(keywords).where(eq(keywords.contentId, contentId));
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ *
 * Detalle de un contenido
 * ------------------------------------------------------------------ */

export async function getContentById(orgId: string, contentId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(contents)
    .where(and(eq(contents.orgId, orgId), eq(contents.id, contentId)))
    .limit(1);
  return row ?? null;
}

/** Curva diaria de views de una publicacion. */
export async function getContentDailyMetrics(contentId: string) {
  const db = await getDb();
  const rows = await rawRows<Record<string, string | number | null>>(
    db,
    sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, views, reach, saves, shares
      FROM content_metrics_daily
      WHERE content_id = ${contentId}
      ORDER BY day
    `,
  );
  return rows.map((row) => ({
    day: String(row.day),
    views: num(row.views),
    reach: num(row.reach),
    saves: num(row.saves),
    shares: num(row.shares),
  }));
}

/** Rendimiento de un unico contenido, con las mismas metricas que la tabla general. */
export async function getSingleContentPerformance(
  orgId: string,
  contentId: string,
  range: DateRange,
): Promise<ContentPerformanceRow | null> {
  const rows = await getContentPerformance(orgId, range, { limit: 500 });
  return rows.find((row) => row.contentId === contentId) ?? null;
}
