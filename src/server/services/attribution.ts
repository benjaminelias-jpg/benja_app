import { and, eq, or, isNull, desc, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contents, keywords, leads, attributionTouches, type Keyword, type Content } from '@/db/schema';

/**
 * Referencia flexible a una pieza de contenido.
 *
 * Los webhooks nunca mandan lo mismo: ManyChat manda el id del post, un link en
 * bio manda un `ref`, Calendly no manda nada. Esta funcion acepta cualquiera de
 * esas pistas y devuelve el contenido del CRM.
 */
export interface ContentRef {
  orgId: string;
  contentId?: string | null;
  igMediaId?: string | null;
  refCode?: string | null;
  permalink?: string | null;
  keywordId?: string | null;
}

export async function resolveContent(ref: ContentRef): Promise<Content | null> {
  const db = await getDb();

  if (ref.contentId) {
    const [found] = await db
      .select()
      .from(contents)
      .where(and(eq(contents.orgId, ref.orgId), eq(contents.id, ref.contentId)))
      .limit(1);
    if (found) return found;
  }

  if (ref.igMediaId) {
    const [found] = await db
      .select()
      .from(contents)
      .where(and(eq(contents.orgId, ref.orgId), eq(contents.igMediaId, ref.igMediaId)))
      .limit(1);
    if (found) return found;
  }

  if (ref.refCode) {
    const [found] = await db
      .select()
      .from(contents)
      .where(and(eq(contents.orgId, ref.orgId), eq(contents.refCode, ref.refCode)))
      .limit(1);
    if (found) return found;
  }

  if (ref.permalink) {
    const [found] = await db
      .select()
      .from(contents)
      .where(and(eq(contents.orgId, ref.orgId), eq(contents.permalink, ref.permalink)))
      .limit(1);
    if (found) return found;
  }

  // Ultimo recurso: la keyword que se disparo sabe a que contenido pertenece.
  if (ref.keywordId) {
    const [row] = await db
      .select({ content: contents })
      .from(keywords)
      .leftJoin(contents, eq(keywords.contentId, contents.id))
      .where(eq(keywords.id, ref.keywordId))
      .limit(1);
    if (row?.content) return row.content;
  }

  return null;
}

/** Normaliza texto para comparar keywords: sin acentos, sin signos, minusculas. */
export function normalizeKeyword(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decide si un mensaje dispara una keyword.
 *
 * Es la regla de negocio mas sensible del producto: si esto falla, el lead
 * entra sin contenido atribuido y se pierde la trazabilidad de la venta.
 */
export function keywordMatches(keyword: Pick<Keyword, 'word' | 'matchType'>, text: string): boolean {
  const haystack = normalizeKeyword(text);
  const needle = normalizeKeyword(keyword.word);
  if (!needle) return false;

  switch (keyword.matchType) {
    case 'exact':
      // "exact" se interpreta como palabra completa, no como mensaje completo:
      // la gente escribe "QUIERO!!" o "quiero porfa" y espera que funcione.
      return new RegExp(`(^|\\s)${escapeRegExp(needle)}($|\\s)`, 'u').test(haystack);
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'contains':
      return haystack.includes(needle);
    case 'regex':
      try {
        return new RegExp(keyword.word, 'iu').test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Busca la keyword activa que coincide con un mensaje.
 *
 * Prioriza las keywords atadas al contenido donde ocurrio la interaccion:
 * si "QUIERO" existe en tres reels distintos, gana la del reel comentado.
 */
export async function findMatchingKeyword(params: {
  orgId: string;
  text: string;
  channel?: Keyword['channel'];
  contentId?: string | null;
}): Promise<Keyword | null> {
  if (!params.text?.trim()) return null;
  const db = await getDb();

  const candidates = await db
    .select()
    .from(keywords)
    .where(
      and(
        eq(keywords.orgId, params.orgId),
        eq(keywords.active, true),
        params.channel ? eq(keywords.channel, params.channel) : undefined,
      ),
    );

  const matching = candidates.filter((keyword) => keywordMatches(keyword, params.text));
  if (matching.length === 0) return null;

  if (params.contentId) {
    const scoped = matching.find((keyword) => keyword.contentId === params.contentId);
    if (scoped) return scoped;
  }

  // Sin pista de contenido: gana la mas especifica (exact > starts_with > contains > regex).
  const priority: Record<Keyword['matchType'], number> = {
    exact: 0,
    starts_with: 1,
    contains: 2,
    regex: 3,
  };
  return matching.sort((a, b) => priority[a.matchType] - priority[b.matchType])[0];
}

/** Suma uno al contador de disparos de la keyword. */
export async function incrementKeywordCounter(keywordId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(keywords)
    .set({ triggeredCount: sql`${keywords.triggeredCount} + 1` })
    .where(eq(keywords.id, keywordId));
}

/**
 * Contenido al que se le atribuye una conversion de este lead.
 *
 * Modelo: first-touch con ventana. El contenido que trajo al lead se lleva el
 * credito mientras la conversion ocurra dentro de la ventana de atribucion de
 * la organizacion; pasado ese plazo, se usa el ultimo contenido que lo toco.
 */
export async function attributedContentForLead(
  leadId: string,
  options: { at?: Date; windowDays?: number } = {},
): Promise<string | null> {
  const db = await getDb();
  const [lead] = await db
    .select({
      first: leads.firstTouchContentId,
      last: leads.lastTouchContentId,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!lead) return null;
  if (!lead.first) return lead.last ?? null;

  const windowDays = options.windowDays ?? 90;
  const at = options.at ?? new Date();
  const elapsedDays = (at.getTime() - new Date(lead.createdAt).getTime()) / 86_400_000;

  if (elapsedDays <= windowDays) return lead.first;
  return lead.last ?? lead.first;
}

/** Todos los contactos del lead con contenido, para el detalle del lead. */
export async function touchesForLead(leadId: string) {
  const db = await getDb();
  return db
    .select({
      touch: attributionTouches,
      content: { id: contents.id, title: contents.title, type: contents.type },
    })
    .from(attributionTouches)
    .leftJoin(contents, eq(attributionTouches.contentId, contents.id))
    .where(eq(attributionTouches.leadId, leadId))
    .orderBy(desc(attributionTouches.occurredAt));
}

/** Contenidos sin keyword asociada: huecos de trazabilidad que conviene cerrar. */
export async function contentsWithoutKeywords(orgId: string) {
  const db = await getDb();
  return db
    .select({ id: contents.id, title: contents.title, type: contents.type })
    .from(contents)
    .leftJoin(keywords, eq(keywords.contentId, contents.id))
    .where(and(eq(contents.orgId, orgId), eq(contents.archived, false), isNull(keywords.id)))
    .limit(20);
}

export { or };
