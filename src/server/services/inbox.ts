import { and, eq, desc, asc, sql, or, ilike, isNotNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  conversations,
  messages,
  leads,
  users,
  stages,
  contents,
  instagramAccounts,
  type Conversation,
} from '@/db/schema';
import { recordEvent } from './events';
import {
  sendText,
  sendMedia,
  validateMedia,
  messagingWindow,
  dmByteLength,
  MAX_DM_BYTES,
  type IgAuth,
  type MediaType,
} from '../integrations/instagram';
import { authFor } from './automations';

/**
 * Bandeja de entrada de Instagram.
 *
 * Los mensajes ya viven en `messages`; `conversations` es el hilo: quien, cuando
 * escribio por ultima vez cada lado y cuantos quedan sin leer. Separarlo es lo
 * que permite ordenar la bandeja sin recorrer todos los mensajes, y es donde
 * vive el dato del que depende todo lo demas: cuando escribio el lead por
 * ultima vez, porque de ahi sale la ventana de 24 h de Meta.
 */

/**
 * Asegura que exista el hilo del lead y lo actualiza con el ultimo mensaje.
 * Devuelve el id del hilo para guardarlo en el mensaje.
 */
export async function attachMessageToConversation(params: {
  orgId: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  preview: string;
  occurredAt?: Date;
  igThreadId?: string | null;
}): Promise<string | null> {
  const db = await getDb();
  const at = params.occurredAt ?? new Date();

  const [account] = await db
    .select({ id: instagramAccounts.id })
    .from(instagramAccounts)
    .where(eq(instagramAccounts.orgId, params.orgId))
    .limit(1);

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.orgId, params.orgId), eq(conversations.leadId, params.leadId)))
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(conversations)
      .values({
        orgId: params.orgId,
        leadId: params.leadId,
        igAccountId: account?.id ?? null,
        igThreadId: params.igThreadId ?? null,
        lastMessageAt: at,
        lastMessagePreview: params.preview.slice(0, 140),
        lastInboundAt: params.direction === 'inbound' ? at : null,
        lastOutboundAt: params.direction === 'outbound' ? at : null,
        unreadCount: params.direction === 'inbound' ? 1 : 0,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created.id;

    // Carrera: otro proceso lo creo entre el select y el insert.
    const [raced] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.orgId, params.orgId), eq(conversations.leadId, params.leadId)))
      .limit(1);
    return raced?.id ?? null;
  }

  await db
    .update(conversations)
    .set({
      lastMessageAt: at,
      lastMessagePreview: params.preview.slice(0, 140),
      ...(params.direction === 'inbound'
        ? { lastInboundAt: at, unreadCount: sql`${conversations.unreadCount} + 1`, status: 'open' as const }
        : { lastOutboundAt: at }),
      ...(params.igThreadId && !existing.igThreadId ? { igThreadId: params.igThreadId } : {}),
    })
    .where(eq(conversations.id, existing.id));

  return existing.id;
}

/* ------------------------------------------------------------------ *
 * Lectura
 * ------------------------------------------------------------------ */

export interface InboxFilters {
  orgId: string;
  search?: string;
  status?: Conversation['status'];
  assignedTo?: string;
  onlyUnread?: boolean;
  limit?: number;
}

export async function listConversations(filters: InboxFilters) {
  const db = await getDb();
  const where = [eq(conversations.orgId, filters.orgId)];

  if (filters.status) where.push(eq(conversations.status, filters.status));
  if (filters.assignedTo) where.push(eq(conversations.assignedTo, filters.assignedTo));
  if (filters.onlyUnread) where.push(sql`${conversations.unreadCount} > 0`);
  if (filters.search) {
    const term = `%${filters.search}%`;
    where.push(or(ilike(leads.igUsername, term), ilike(leads.fullName, term))!);
  }

  return db
    .select({
      conversation: conversations,
      lead: leads,
      owner: { id: users.id, name: users.name },
      stage: { id: stages.id, name: stages.name, color: stages.color },
      content: { id: contents.id, title: contents.title },
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .leftJoin(users, eq(conversations.assignedTo, users.id))
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(contents, eq(leads.firstTouchContentId, contents.id))
    .where(and(...where))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(filters.limit ?? 60);
}

export async function getConversation(orgId: string, conversationId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      conversation: conversations,
      lead: leads,
      owner: { id: users.id, name: users.name },
      stage: { id: stages.id, name: stages.name, color: stages.color },
      content: { id: contents.id, title: contents.title, type: contents.type },
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .leftJoin(users, eq(conversations.assignedTo, users.id))
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(contents, eq(leads.firstTouchContentId, contents.id))
    .where(and(eq(conversations.orgId, orgId), eq(conversations.id, conversationId)))
    .limit(1);
  return row ?? null;
}

/** Hilo del lead, creandolo si hace falta (para abrir el chat desde su ficha). */
export async function getOrCreateConversationForLead(orgId: string, leadId: string) {
  const db = await getDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), eq(conversations.leadId, leadId)))
    .limit(1);
  if (existing) return existing.id;

  const [account] = await db
    .select({ id: instagramAccounts.id })
    .from(instagramAccounts)
    .where(eq(instagramAccounts.orgId, orgId))
    .limit(1);

  const [created] = await db
    .insert(conversations)
    .values({ orgId, leadId, igAccountId: account?.id ?? null })
    .onConflictDoNothing()
    .returning();
  return created?.id ?? null;
}

export async function listThreadMessages(conversationId: string, limit = 80) {
  const db = await getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt))
    .limit(limit);
}

export async function markAsRead(conversationId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(eq(conversations.id, conversationId));
}

export async function setConversationStatus(
  conversationId: string,
  status: Conversation['status'],
): Promise<void> {
  const db = await getDb();
  await db.update(conversations).set({ status }).where(eq(conversations.id, conversationId));
}

export async function assignConversation(
  conversationId: string,
  userId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.update(conversations).set({ assignedTo: userId }).where(eq(conversations.id, conversationId));
}

export async function countUnread(orgId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), sql`${conversations.unreadCount} > 0`));
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ *
 * Envio desde la bandeja
 * ------------------------------------------------------------------ */

export interface SendOutcome {
  ok: boolean;
  messageId?: string;
  error?: string;
  dryRun?: boolean;
}

/**
 * Manda un DM escrito por una persona desde la bandeja.
 *
 * Valida la ventana de 24 h ANTES de llamar a la API: de lo contrario el
 * mensaje se escribe, se guarda y recien Instagram lo rechaza, dejando al
 * usuario creyendo que respondio.
 */
export async function sendReply(params: {
  orgId: string;
  conversationId: string;
  text: string;
  authorId?: string | null;
}): Promise<SendOutcome> {
  const db = await getDb();
  const text = params.text.trim();

  if (!text) return { ok: false, error: 'El mensaje esta vacio.' };
  if (dmByteLength(text) > MAX_DM_BYTES) {
    return {
      ok: false,
      error: `Instagram limita los DM a ${MAX_DM_BYTES} bytes y este tiene ${dmByteLength(text)}.`,
    };
  }

  const row = await getConversation(params.orgId, params.conversationId);
  if (!row) return { ok: false, error: 'No existe esa conversacion.' };

  const window = messagingWindow(row.conversation.lastInboundAt);
  if (!window.open) {
    return { ok: false, error: window.reason };
  }

  if (!row.lead.igUserId) {
    return { ok: false, error: 'Este lead no tiene id de Instagram: no se le puede escribir por DM.' };
  }

  const auth: IgAuth | null = await authFor(params.orgId);
  if (!auth) return { ok: false, error: 'No hay ninguna cuenta de Instagram conectada.' };

  const result = await sendText(auth, { recipientIgId: row.lead.igUserId, text });

  const [stored] = await db
    .insert(messages)
    .values({
      orgId: params.orgId,
      leadId: row.lead.id,
      conversationId: row.conversation.id,
      contentId: row.lead.firstTouchContentId,
      direction: 'outbound',
      channel: 'ig_dm',
      body: text,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : (result.error ?? null),
      externalId: result.data?.message_id ?? null,
    })
    .returning();

  if (result.ok) {
    await attachMessageToConversation({
      orgId: params.orgId,
      leadId: row.lead.id,
      direction: 'outbound',
      preview: text,
    });
    await recordEvent({
      orgId: params.orgId,
      leadId: row.lead.id,
      contentId: row.lead.firstTouchContentId,
      type: 'dm_sent',
      channel: 'ig_dm',
      source: 'inbox',
      payload: { text, by: params.authorId ?? null, dryRun: result.dryRun },
    });
  }

  return {
    ok: result.ok,
    messageId: stored?.id,
    error: result.error,
    dryRun: result.dryRun,
  };
}

/**
 * Manda un adjunto (audio, imagen, video o archivo) desde la bandeja.
 *
 * Es lo que hace ManyChat con las notas de voz. Valida la ventana de 24 h y el
 * formato antes de llamar a Meta, por lo mismo de siempre: un envio rechazado
 * que quedo guardado parece enviado.
 */
export async function sendMediaReply(params: {
  orgId: string;
  conversationId: string;
  type: MediaType;
  url: string;
  caption?: string | null;
}): Promise<SendOutcome> {
  const db = await getDb();

  const problem = validateMedia(params.type, params.url);
  if (problem) return { ok: false, error: problem };

  const row = await getConversation(params.orgId, params.conversationId);
  if (!row) return { ok: false, error: 'No existe esa conversacion.' };

  const window = messagingWindow(row.conversation.lastInboundAt);
  if (!window.open) return { ok: false, error: window.reason };

  if (!row.lead.igUserId) {
    return { ok: false, error: 'Este lead no tiene id de Instagram: no se le puede escribir por DM.' };
  }

  const auth: IgAuth | null = await authFor(params.orgId);
  if (!auth) return { ok: false, error: 'No hay ninguna cuenta de Instagram conectada.' };

  const result = await sendMedia(auth, {
    recipientIgId: row.lead.igUserId,
    type: params.type,
    url: params.url,
  });

  const [stored] = await db
    .insert(messages)
    .values({
      orgId: params.orgId,
      leadId: row.lead.id,
      conversationId: row.conversation.id,
      contentId: row.lead.firstTouchContentId,
      direction: 'outbound',
      channel: 'ig_dm',
      body: params.caption ?? null,
      mediaUrl: params.url,
      attachments: [{ type: params.type, url: params.url }],
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : (result.error ?? null),
      externalId: result.data?.message_id ?? null,
    })
    .returning();

  if (result.ok) {
    await attachMessageToConversation({
      orgId: params.orgId,
      leadId: row.lead.id,
      direction: 'outbound',
      preview: `(${params.type})`,
    });
    await recordEvent({
      orgId: params.orgId,
      leadId: row.lead.id,
      contentId: row.lead.firstTouchContentId,
      type: 'dm_sent',
      channel: 'ig_dm',
      source: 'inbox',
      payload: { mediaType: params.type, url: params.url, dryRun: result.dryRun },
    });
  }

  return { ok: result.ok, messageId: stored?.id, error: result.error, dryRun: result.dryRun };
}

/* ------------------------------------------------------------------ *
 * Sincronizacion con la Graph API
 * ------------------------------------------------------------------ */

/** Hilos que ya tienen id de Instagram, para no re-importarlos. */
export async function knownThreadIds(orgId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .select({ igThreadId: conversations.igThreadId })
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), isNotNull(conversations.igThreadId)));
  return new Set(rows.map((row) => row.igThreadId!).filter(Boolean));
}

export { messagingWindow };
