import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  instagramAccounts,
  contents,
  leads,
  messages,
  conversations,
  type InstagramAccount,
} from '@/db/schema';
import { slugify } from '@/lib/ids';
import {
  getProfile,
  getAccountProfile,
  listMedia,
  getMediaInsights,
  listConversations as apiListConversations,
  listConversationMessageIds,
  getMessage,
  subscribeWebhooks,
  mapMediaType,
  titleFromCaption,
  insightsToMap,
  WEBHOOK_FIELDS_INSTAGRAM_LOGIN,
  WEBHOOK_FIELDS_UNIFIED_LOGIN,
  type ConnectionMethod,
  type IgAuth,
} from '../integrations/instagram';
import { refreshLongLived } from '../integrations/instagram-oauth';
import { upsertLead } from './leads';
import { attachMessageToConversation } from './inbox';

/**
 * Sincronizacion con Instagram: conectar la cuenta, importar publicaciones
 * y bajar la bandeja.
 *
 * Todo aqui es tolerante a fallos a proposito: una cuenta que perdio el token
 * o un hilo que la API no devuelve no deben romper la sincronizacion entera.
 * Lo que falla queda anotado en `lastError` y el resto sigue.
 */

export interface SyncOutcome {
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  dryRun?: boolean;
}

/* ------------------------------------------------------------------ *
 * Conexion
 * ------------------------------------------------------------------ */

export async function connectAccount(params: {
  orgId: string;
  method: ConnectionMethod;
  token: string;
  expiresInSeconds?: number;
  igUserId?: string;
  scopes?: string[];
}): Promise<{ ok: boolean; account?: InstagramAccount; error?: string }> {
  const db = await getDb();

  const auth: IgAuth = {
    token: params.token,
    igUserId: params.igUserId ?? 'me',
    method: params.method,
  };

  // El perfil confirma que el token sirve y nos da el id real de la cuenta.
  const profile = params.igUserId
    ? await getAccountProfile(auth)
    : await getProfile(auth);

  if (!profile.ok) {
    return { ok: false, error: profile.error ?? 'No se pudo leer el perfil de la cuenta.' };
  }

  const data = profile.data ?? {};
  const igUserId = String(data.user_id ?? data.id ?? params.igUserId ?? '');
  if (!igUserId) {
    return { ok: false, error: 'Meta no devolvio el id de la cuenta de Instagram.' };
  }

  const tokenExpiresAt = params.expiresInSeconds
    ? new Date(Date.now() + params.expiresInSeconds * 1000)
    : null;

  const values = {
    orgId: params.orgId,
    igUserId,
    username: data.username ?? 'desconocido',
    name: data.name ?? null,
    profilePicUrl: data.profile_picture_url ?? null,
    followersCount: data.followers_count ?? 0,
    followsCount: data.follows_count ?? 0,
    mediaCount: data.media_count ?? 0,
    accountType: data.account_type ?? null,
    accessToken: params.token,
    tokenExpiresAt,
    connected: true,
    connectionMethod: params.method,
    scopes: params.scopes ?? [],
    lastSyncedAt: new Date(),
    lastError: null,
  };

  const [account] = await db
    .insert(instagramAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [instagramAccounts.orgId, instagramAccounts.igUserId],
      set: values,
    })
    .returning();

  // Suscribir la cuenta a los webhooks. En instagram_login suele hacerse desde
  // el panel de Meta, asi que un fallo aqui no invalida la conexion.
  const fields =
    params.method === 'unified_login'
      ? WEBHOOK_FIELDS_UNIFIED_LOGIN
      : WEBHOOK_FIELDS_INSTAGRAM_LOGIN;
  const subscription = await subscribeWebhooks(
    { token: params.token, igUserId, method: params.method },
    fields,
  );
  if (!subscription.ok) {
    await db
      .update(instagramAccounts)
      .set({ lastError: `Webhooks no suscritos: ${subscription.error}` })
      .where(eq(instagramAccounts.id, account.id));
  }

  return { ok: true, account };
}

/**
 * Devuelve credenciales utilizables, renovando el token si esta por vencer.
 *
 * Meta mata un token de 60 dias que no se refresca, y recuperarlo exige volver
 * a conectar la cuenta a mano. Renovar con margen evita ese agujero.
 */
export async function ensureFreshToken(orgId: string): Promise<IgAuth | null> {
  const db = await getDb();
  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.orgId, orgId), eq(instagramAccounts.connected, true)))
    .limit(1);

  if (!account?.accessToken) return null;

  const auth: IgAuth = {
    token: account.accessToken,
    igUserId: account.igUserId,
    method: account.connectionMethod,
  };

  // El refresh automatico solo existe en el camino instagram_login.
  if (account.connectionMethod !== 'instagram_login' || !account.tokenExpiresAt) return auth;

  const daysLeft = (new Date(account.tokenExpiresAt).getTime() - Date.now()) / 86_400_000;
  if (daysLeft > 10) return auth;

  const refreshed = await refreshLongLived(account.accessToken);
  if (!refreshed.ok || !refreshed.accessToken) {
    await db
      .update(instagramAccounts)
      .set({ lastError: `No se pudo renovar el token: ${refreshed.error}` })
      .where(eq(instagramAccounts.id, account.id));
    return auth;
  }

  await db
    .update(instagramAccounts)
    .set({
      accessToken: refreshed.accessToken,
      tokenExpiresAt: refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1000)
        : null,
      lastError: null,
    })
    .where(eq(instagramAccounts.id, account.id));

  return { ...auth, token: refreshed.accessToken };
}

export async function disconnectAccount(orgId: string, accountId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(instagramAccounts)
    .set({ connected: false, accessToken: null, tokenExpiresAt: null })
    .where(and(eq(instagramAccounts.orgId, orgId), eq(instagramAccounts.id, accountId)));
}

/* ------------------------------------------------------------------ *
 * Publicaciones
 * ------------------------------------------------------------------ */

/**
 * Importa las publicaciones recientes como contenidos del CRM.
 *
 * No pisa lo que el usuario edito a mano (gancho, angulo, etapa del embudo):
 * esos campos son suyos. Solo actualiza lo que viene de Instagram.
 */
export async function syncMedia(orgId: string, limit = 25): Promise<SyncOutcome> {
  const db = await getDb();
  const auth = await ensureFreshToken(orgId);
  if (!auth) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ['No hay cuenta conectada.'] };
  }

  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.orgId, orgId), eq(instagramAccounts.igUserId, auth.igUserId)))
    .limit(1);

  const media = await listMedia(auth, limit);
  if (!media.ok) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: [media.error ?? 'error'] };
  }
  if (media.dryRun) {
    return {
      ok: true,
      imported: 0,
      updated: 0,
      skipped: 0,
      dryRun: true,
      errors: ['Modo simulado: configurá el token de Instagram para importar de verdad.'],
    };
  }

  const outcome: SyncOutcome = { ok: true, imported: 0, updated: 0, skipped: 0, errors: [] };

  for (const item of media.data?.data ?? []) {
    try {
      const type = mapMediaType(item);
      const insights = await getMediaInsights(auth, item.id, type === 'reel');
      const metrics = insights.ok ? insightsToMap(insights.data?.data) : {};

      const [existing] = await db
        .select({ id: contents.id })
        .from(contents)
        .where(and(eq(contents.orgId, orgId), eq(contents.igMediaId, item.id)))
        .limit(1);

      const fromInstagram = {
        caption: item.caption ?? null,
        permalink: item.permalink ?? null,
        thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
        publishedAt: item.timestamp ? new Date(item.timestamp) : null,
        views: metrics.views ?? metrics.plays ?? metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        likes: item.like_count ?? metrics.likes ?? 0,
        commentsCount: item.comments_count ?? metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        saves: metrics.saved ?? 0,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contents).set(fromInstagram).where(eq(contents.id, existing.id));
        outcome.updated += 1;
      } else {
        const title = titleFromCaption(item.caption, `${type} ${item.id.slice(-6)}`);
        await db.insert(contents).values({
          orgId,
          igAccountId: account?.id ?? null,
          igMediaId: item.id,
          type,
          title,
          refCode: slugify(title) || item.id.slice(-8),
          ...fromInstagram,
        });
        outcome.imported += 1;
      }
    } catch (error) {
      outcome.skipped += 1;
      outcome.errors.push(`${item.id}: ${(error as Error).message}`);
    }
  }

  await db
    .update(instagramAccounts)
    .set({ lastSyncedAt: new Date() })
    .where(eq(instagramAccounts.orgId, orgId));

  return outcome;
}

/* ------------------------------------------------------------------ *
 * Bandeja
 * ------------------------------------------------------------------ */

/**
 * Baja los hilos de Instagram y los vuelca en la bandeja del CRM.
 *
 * La API obliga a tres saltos: hilos, ids de mensajes de cada hilo, y luego
 * cada mensaje por separado. Ademas solo deja leer los 20 mensajes mas
 * recientes de cada hilo, asi que esto sirve para poblar la bandeja la primera
 * vez; el dia a dia llega por webhook.
 */
export async function syncInbox(orgId: string, maxThreads = 25): Promise<SyncOutcome> {
  const db = await getDb();
  const auth = await ensureFreshToken(orgId);
  if (!auth) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: ['No hay cuenta conectada.'] };
  }

  const threads = await apiListConversations(auth);
  if (!threads.ok) {
    return { ok: false, imported: 0, updated: 0, skipped: 0, errors: [threads.error ?? 'error'] };
  }
  if (threads.dryRun) {
    return {
      ok: true,
      imported: 0,
      updated: 0,
      skipped: 0,
      dryRun: true,
      errors: ['Modo simulado: configurá el token de Instagram para bajar la bandeja real.'],
    };
  }

  const outcome: SyncOutcome = { ok: true, imported: 0, updated: 0, skipped: 0, errors: [] };

  for (const thread of (threads.data?.data ?? []).slice(0, maxThreads)) {
    try {
      const ids = await listConversationMessageIds(auth, thread.id);
      if (!ids.ok) {
        outcome.skipped += 1;
        continue;
      }

      const messageIds = (ids.data?.messages?.data ?? []).slice(0, 20);
      let leadId: string | null = null;

      // Se recorren de mas viejo a mas nuevo para que el hilo quede en orden.
      for (const entry of [...messageIds].reverse()) {
        const detail = await getMessage(auth, entry.id);
        if (!detail.ok || !detail.data) continue;

        const message = detail.data;
        const fromId = message.from?.id;
        const isFromUs = fromId === auth.igUserId;
        const counterpart = isFromUs ? message.to?.data?.[0] : message.from;
        if (!counterpart?.id) continue;

        if (!leadId) {
          const { lead } = await upsertLead({
            orgId,
            igUserId: counterpart.id,
            igUsername: counterpart.username ?? null,
            source: 'ig_dm',
            occurredAt: message.created_time ? new Date(message.created_time) : undefined,
          });
          leadId = lead.id;
          outcome.imported += 1;
        }

        const sentAt = message.created_time ? new Date(message.created_time) : new Date();
        const conversationId = await attachMessageToConversation({
          orgId,
          leadId,
          direction: isFromUs ? 'outbound' : 'inbound',
          preview: message.message ?? '(adjunto)',
          occurredAt: sentAt,
          igThreadId: thread.id,
        });

        await db
          .insert(messages)
          .values({
            orgId,
            leadId,
            conversationId,
            direction: isFromUs ? 'outbound' : 'inbound',
            channel: 'ig_dm',
            body: message.message ?? null,
            externalId: message.id,
            sentAt,
            status: 'sent',
          })
          .onConflictDoNothing();

        outcome.updated += 1;
      }
    } catch (error) {
      outcome.skipped += 1;
      outcome.errors.push(`${thread.id}: ${(error as Error).message}`);
    }
  }

  // La sincronizacion inicial no debe dejar la bandeja llena de "sin leer".
  await db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(eq(conversations.orgId, orgId));

  await db
    .update(instagramAccounts)
    .set({ lastInboxSyncAt: new Date() })
    .where(eq(instagramAccounts.orgId, orgId));

  return outcome;
}

/** Cuenta conectada de la organizacion, si la hay. */
export async function getConnectedAccount(orgId: string): Promise<InstagramAccount | null> {
  const db = await getDb();
  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.orgId, orgId))
    .orderBy(sql`${instagramAccounts.connected} DESC`)
    .limit(1);
  return account ?? null;
}

export { leads };
