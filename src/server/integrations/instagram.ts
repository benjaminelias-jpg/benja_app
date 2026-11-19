import { env } from '@/lib/env';

/**
 * Cliente de la API de Instagram.
 *
 * Meta tiene hoy DOS caminos distintos para lo mismo, y no son intercambiables:
 *
 *   instagram_login  → host graph.instagram.com, token de usuario de Instagram,
 *                      OAuth en www.instagram.com, scopes `instagram_business_*`.
 *   unified_login    → host graph.facebook.com, token de sistema del portafolio
 *                      de negocio (BISU), OAuth por Facebook Login for Business,
 *                      scopes `instagram_*`.
 *
 * Toda la app habla con este modulo y nunca con un host concreto, asi que
 * cambiar de camino es cambiar un campo de la cuenta, no reescribir el CRM.
 *
 * Sin token configurado el cliente entra en modo simulado: registra la llamada
 * y devuelve exito, de modo que el embudo completo se puede probar sin conectar
 * una cuenta real.
 */

export const GRAPH_VERSION = 'v27.0';

export type ConnectionMethod = 'instagram_login' | 'unified_login' | 'manual';

export interface IgAuth {
  /** Token de acceso vigente. */
  token?: string | null;
  /** Id de la cuenta profesional de Instagram (el que va en las rutas). */
  igUserId: string;
  method?: ConnectionMethod;
}

export interface IgResult<T = unknown> {
  ok: boolean;
  /** true cuando no se llamo a la red porque no hay credenciales. */
  dryRun: boolean;
  data?: T;
  error?: string;
  /** Codigo de error de Meta, util para distinguir "fuera de ventana" de "token vencido". */
  code?: number;
}

function hostFor(method: ConnectionMethod | undefined): string {
  return method === 'unified_login'
    ? `https://graph.facebook.com/${GRAPH_VERSION}`
    : `https://graph.instagram.com/${GRAPH_VERSION}`;
}

async function graphRequest<T>(
  auth: IgAuth,
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; query?: Record<string, string> } = {},
): Promise<IgResult<T>> {
  const token = auth.token ?? env.instagramToken;

  if (!token || env.forceDryRun) {
    return { ok: true, dryRun: true, data: { simulated: true, path, body: init.body } as T };
  }

  const url = new URL(`${hostFor(auth.method)}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        // El token va en la cabecera y nunca en la URL: asi no termina en los
        // logs de acceso ni en el historial del navegador.
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const json = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: number; error_subcode?: number };
    };

    if (!response.ok || json?.error) {
      return {
        ok: false,
        dryRun: false,
        error: json?.error?.message ?? `HTTP ${response.status}`,
        code: json?.error?.code,
      };
    }
    return { ok: true, dryRun: false, data: json };
  } catch (error) {
    return { ok: false, dryRun: false, error: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ *
 * Perfil y cuentas
 * ------------------------------------------------------------------ */

export interface IgProfile {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

const PROFILE_FIELDS = [
  'user_id',
  'username',
  'name',
  'account_type',
  'profile_picture_url',
  'followers_count',
  'follows_count',
  'media_count',
].join(',');

/** Perfil de la cuenta conectada (camino instagram_login). */
export function getProfile(auth: IgAuth): Promise<IgResult<IgProfile>> {
  return graphRequest<IgProfile>(auth, '/me', { query: { fields: PROFILE_FIELDS } });
}

/**
 * Cuentas de Instagram que el token puede manejar (camino unified_login).
 * Un token de sistema cubre todas las cuentas que el cliente compartio.
 */
export function listAssignedAccounts(
  auth: IgAuth,
): Promise<IgResult<{ data: Array<{ id: string; username: string }> }>> {
  return graphRequest(
    { ...auth, method: 'unified_login' },
    '/me/assigned_instagram_accounts',
    { query: { fields: 'id,username' } },
  );
}

/** Perfil de una cuenta concreta por id (sirve en los dos caminos). */
export function getAccountProfile(auth: IgAuth): Promise<IgResult<IgProfile>> {
  return graphRequest<IgProfile>(auth, `/${auth.igUserId}`, {
    query: { fields: PROFILE_FIELDS.replace('user_id,', 'id,') },
  });
}

/* ------------------------------------------------------------------ *
 * Publicaciones
 * ------------------------------------------------------------------ */

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_product_type?: 'FEED' | 'REELS' | 'STORY' | 'AD';
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export function listMedia(
  auth: IgAuth,
  limit = 25,
): Promise<IgResult<{ data: IgMedia[]; paging?: { cursors?: { after?: string } } }>> {
  const fields = [
    'id',
    'caption',
    'media_type',
    'media_product_type',
    'media_url',
    'thumbnail_url',
    'permalink',
    'timestamp',
    'like_count',
    'comments_count',
  ].join(',');
  return graphRequest(auth, `/${auth.igUserId}/media`, {
    query: { fields, limit: String(limit) },
  });
}

export interface IgInsight {
  name: string;
  values: Array<{ value: number }>;
}

export function getMediaInsights(
  auth: IgAuth,
  mediaId: string,
  isReel: boolean,
): Promise<IgResult<{ data: IgInsight[] }>> {
  const metrics = isReel
    ? 'views,reach,likes,comments,shares,saved'
    : 'views,reach,saved,shares';
  return graphRequest(auth, `/${mediaId}/insights`, { query: { metric: metrics } });
}

/* ------------------------------------------------------------------ *
 * Conversaciones
 * ------------------------------------------------------------------ */

export interface IgConversation {
  id: string;
  updated_time?: string;
}

/**
 * Hilos de la bandeja.
 *
 * La API devuelve solo `id` y `updated_time`: para saber con quien es cada hilo
 * hay que leer sus mensajes. Los hilos en Solicitudes inactivos por mas de 30
 * dias no vienen en la lista.
 */
export function listConversations(
  auth: IgAuth,
  options: { userId?: string } = {},
): Promise<IgResult<{ data: IgConversation[] }>> {
  const query: Record<string, string> = { platform: 'instagram' };
  if (options.userId) query.user_id = options.userId;
  return graphRequest(auth, `/${auth.igUserId}/conversations`, { query });
}

export function listConversationMessageIds(
  auth: IgAuth,
  conversationId: string,
): Promise<IgResult<{ id: string; messages?: { data: Array<{ id: string; created_time: string }> } }>> {
  return graphRequest(auth, `/${conversationId}`, { query: { fields: 'messages' } });
}

export interface IgMessage {
  id: string;
  created_time?: string;
  from?: { id?: string; username?: string };
  to?: { data?: Array<{ id?: string; username?: string }> };
  message?: string;
}

/** Solo se pueden leer por id los 20 mensajes mas recientes de un hilo. */
export function getMessage(auth: IgAuth, messageId: string): Promise<IgResult<IgMessage>> {
  return graphRequest<IgMessage>(auth, `/${messageId}`, {
    query: { fields: 'id,created_time,from,to,message' },
  });
}

/* ------------------------------------------------------------------ *
 * Envio
 * ------------------------------------------------------------------ */

export interface SendResult {
  recipient_id?: string;
  message_id?: string;
}

/** Limite duro de Meta: el texto de un DM no puede pasar de 1000 bytes. */
export const MAX_DM_BYTES = 1000;

export function dmByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Recorta por bytes, no por caracteres: un emoji ocupa cuatro.
 * El espacio del "…" se descuenta ANTES de recortar; si no, el resultado
 * termina pasandose del limite justo en el caso que se queria evitar.
 */
export function truncateForDm(text: string): string {
  if (dmByteLength(text) <= MAX_DM_BYTES) return text;

  const ellipsis = '…';
  const budget = MAX_DM_BYTES - dmByteLength(ellipsis);

  let result = text;
  while (dmByteLength(result) > budget && result.length > 0) {
    result = result.slice(0, -1);
  }
  return `${result}${ellipsis}`;
}

export function sendText(
  auth: IgAuth,
  params: { recipientIgId: string; text: string; replyToMid?: string | null },
): Promise<IgResult<SendResult>> {
  const body: Record<string, unknown> = {
    recipient: { id: params.recipientIgId },
    message: { text: truncateForDm(params.text) },
  };
  if (params.replyToMid) body.reply_to = { mid: params.replyToMid };
  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, { method: 'POST', body });
}

/**
 * Respuesta privada a un comentario.
 *
 * Es el mecanismo del "comenta X y te mando el recurso": abre un DM aunque
 * nunca hayan escrito antes. Reglas de Meta: un solo mensaje por comentario,
 * dentro de los 7 dias, y los siguientes solo despues de que el lead responda.
 */
export function sendPrivateReply(
  auth: IgAuth,
  params: { commentId: string; text: string },
): Promise<IgResult<SendResult>> {
  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, {
    method: 'POST',
    body: {
      recipient: { comment_id: params.commentId },
      message: { text: truncateForDm(params.text) },
    },
  });
}

/* ------------------------------------------------------------------ *
 * Medios: imagen, audio, video y archivo
 * ------------------------------------------------------------------ */

export type MediaType = 'image' | 'audio' | 'video' | 'file';

/**
 * Limites de Meta por tipo de adjunto.
 *
 * Validar antes de enviar evita el peor caso: el mensaje se guarda en el CRM,
 * la persona cree que lo mando, y la API lo rechaza sin que nadie se entere.
 */
export const MEDIA_LIMITS: Record<
  MediaType,
  { maxBytes: number; extensions: string[]; label: string }
> = {
  image: { maxBytes: 8 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg'], label: 'imagen' },
  audio: {
    maxBytes: 25 * 1024 * 1024,
    extensions: ['aac', 'm4a', 'wav', 'mp4'],
    label: 'audio',
  },
  video: {
    maxBytes: 25 * 1024 * 1024,
    extensions: ['mp4', 'ogg', 'avi', 'mov', 'webm'],
    label: 'video',
  },
  file: { maxBytes: 25 * 1024 * 1024, extensions: ['pdf'], label: 'archivo' },
};

/** Deduce el tipo de adjunto por la extension del archivo. */
export function mediaTypeFromUrl(url: string): MediaType | null {
  const extension = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (!extension) return null;
  // `mp4` sirve para audio y para video: sin mas contexto se asume video.
  if (extension === 'mp4') return 'video';
  for (const [type, limits] of Object.entries(MEDIA_LIMITS)) {
    if (limits.extensions.includes(extension)) return type as MediaType;
  }
  return null;
}

/** Comprueba que la extension corresponda al tipo. Devuelve el motivo si no. */
export function validateMedia(type: MediaType, url: string): string | null {
  if (!/^https:\/\//i.test(url)) {
    return 'Instagram solo acepta URLs públicas por HTTPS.';
  }
  const extension = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const limits = MEDIA_LIMITS[type];
  if (extension && !limits.extensions.includes(extension)) {
    return `Para ${limits.label} Instagram acepta ${limits.extensions.join(', ')}; esta URL termina en .${extension}.`;
  }
  return null;
}

/**
 * Manda un adjunto por DM.
 *
 * Meta usa dos formas distintas y confundirlas hace que el envio falle sin
 * explicacion: la imagen va en `attachments` (lista), y audio, video y archivo
 * en `attachment` (objeto). Por eso el tipo decide la forma del cuerpo.
 */
export function sendMedia(
  auth: IgAuth,
  params: { recipientIgId: string; type: MediaType; url: string },
): Promise<IgResult<SendResult>> {
  const payload = { url: params.url };

  const message =
    params.type === 'image'
      ? { attachments: [{ type: 'image', payload }] }
      : { attachment: { type: params.type, payload } };

  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, {
    method: 'POST',
    body: { recipient: { id: params.recipientIgId }, message },
  });
}

export function sendImage(
  auth: IgAuth,
  params: { recipientIgId: string; imageUrl: string },
): Promise<IgResult<SendResult>> {
  return sendMedia(auth, { recipientIgId: params.recipientIgId, type: 'image', url: params.imageUrl });
}

/** Nota de voz o pista de audio. Es lo que ManyChat manda como audio. */
export function sendAudio(
  auth: IgAuth,
  params: { recipientIgId: string; url: string },
): Promise<IgResult<SendResult>> {
  return sendMedia(auth, { recipientIgId: params.recipientIgId, type: 'audio', url: params.url });
}

export function sendVideo(
  auth: IgAuth,
  params: { recipientIgId: string; url: string },
): Promise<IgResult<SendResult>> {
  return sendMedia(auth, { recipientIgId: params.recipientIgId, type: 'video', url: params.url });
}

export function sendFile(
  auth: IgAuth,
  params: { recipientIgId: string; url: string },
): Promise<IgResult<SendResult>> {
  return sendMedia(auth, { recipientIgId: params.recipientIgId, type: 'file', url: params.url });
}

/* ------------------------------------------------------------------ *
 * Respuestas rapidas (botones)
 * ------------------------------------------------------------------ */

export interface QuickReply {
  /** Texto del boton. Instagram lo corta a 20 caracteres. */
  title: string;
  /** Valor que vuelve por webhook cuando lo tocan. */
  payload: string;
}

/** Tope de Meta: 13 botones por mensaje. */
export const MAX_QUICK_REPLIES = 13;
export const QUICK_REPLY_TITLE_LENGTH = 20;

/**
 * Mensaje con botones de respuesta rapida.
 *
 * Es lo que evita el peor problema de un flujo por DM: preguntar en texto libre
 * y tener que adivinar que quiso decir el lead. Con botones, la respuesta vuelve
 * como un valor exacto en `message.quick_reply.payload`.
 *
 * Instagram solo admite botones de texto plano, y los recorta a 20 caracteres,
 * asi que conviene recortarlos aqui para que el titulo que se ve sea el mismo
 * que se configuro.
 */
export function sendQuickReplies(
  auth: IgAuth,
  params: { recipientIgId: string; text: string; options: QuickReply[] },
): Promise<IgResult<SendResult>> {
  const quickReplies = params.options.slice(0, MAX_QUICK_REPLIES).map((option) => ({
    content_type: 'text',
    title: option.title.slice(0, QUICK_REPLY_TITLE_LENGTH),
    payload: option.payload,
  }));

  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, {
    method: 'POST',
    body: {
      recipient: { id: params.recipientIgId },
      message: { text: truncateForDm(params.text), quick_replies: quickReplies },
    },
  });
}

/* ------------------------------------------------------------------ *
 * Acciones de remitente
 * ------------------------------------------------------------------ */

export type SenderAction = 'typing_on' | 'typing_off' | 'mark_seen';

/**
 * "Escribiendo..." y acuse de lectura.
 *
 * Un flujo que contesta al instante se nota automatico. Mostrar que la cuenta
 * esta escribiendo antes de responder es lo que hace que no lo parezca, y es
 * exactamente lo que hacen las herramientas de automatizacion.
 */
export function sendSenderAction(
  auth: IgAuth,
  params: { recipientIgId: string; action: SenderAction },
): Promise<IgResult<SendResult>> {
  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, {
    method: 'POST',
    body: { recipient: { id: params.recipientIgId }, sender_action: params.action },
  });
}

/** Respuesta publica dentro del hilo de comentarios. */
export function replyToComment(
  auth: IgAuth,
  params: { commentId: string; text: string },
): Promise<IgResult<SendResult>> {
  return graphRequest<SendResult>(auth, `/${params.commentId}/replies`, {
    method: 'POST',
    body: { message: params.text },
  });
}

export function sendReaction(
  auth: IgAuth,
  params: { recipientIgId: string; messageId: string; reaction?: string },
): Promise<IgResult<SendResult>> {
  return graphRequest<SendResult>(auth, `/${auth.igUserId}/messages`, {
    method: 'POST',
    body: {
      recipient: { id: params.recipientIgId },
      sender_action: 'react',
      payload: { message_id: params.messageId, reaction: params.reaction ?? 'love' },
    },
  });
}

/* ------------------------------------------------------------------ *
 * Webhooks
 * ------------------------------------------------------------------ */

export const WEBHOOK_FIELDS_INSTAGRAM_LOGIN = [
  'messages',
  'messaging_postbacks',
  'message_reactions',
  'messaging_referral',
  'messaging_seen',
  'comments',
  'live_comments',
];

export const WEBHOOK_FIELDS_UNIFIED_LOGIN = [
  'messages',
  'messaging_postbacks',
  'message_reactions',
  'messaging_referral',
  'messaging_seen',
  'comments',
  'live_comments',
  'mentions',
];

/** Suscribe la cuenta a los webhooks (necesario en el camino unified_login). */
export function subscribeWebhooks(auth: IgAuth, fields: string[]): Promise<IgResult> {
  return graphRequest(auth, `/${auth.igUserId}/subscribed_apps`, {
    method: 'POST',
    query: { subscribed_fields: fields.join(',') },
  });
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

export function mapMediaType(media: IgMedia): 'reel' | 'post' | 'carousel' | 'story' | 'ad' {
  if (media.media_product_type === 'REELS') return 'reel';
  if (media.media_product_type === 'STORY') return 'story';
  if (media.media_product_type === 'AD') return 'ad';
  if (media.media_type === 'CAROUSEL_ALBUM') return 'carousel';
  return 'post';
}

/** Titulo legible a partir del caption: primera linea util, sin hashtags. */
export function titleFromCaption(caption: string | undefined, fallback = 'Publicacion'): string {
  if (!caption) return fallback;
  const firstLine = caption
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

/** Convierte las insights de Meta en un objeto plano por nombre de metrica. */
export function insightsToMap(insights: IgInsight[] | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const insight of insights ?? []) {
    result[insight.name] = insight.values?.[0]?.value ?? 0;
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Ventana de mensajeria
 * ------------------------------------------------------------------ */

/** Ventana estandar para responder un mensaje del usuario. */
export const MESSAGING_WINDOW_HOURS = 24;

export interface MessagingWindow {
  open: boolean;
  /** Horas restantes; 0 si ya cerro. */
  hoursLeft: number;
  reason: string;
}

/**
 * Meta solo permite escribirle a alguien dentro de las 24 h siguientes a SU
 * ultimo mensaje. Mostrarlo en la bandeja evita el error mas comun de un CRM
 * de Instagram: redactar una respuesta que la API va a rechazar.
 */
export function messagingWindow(lastInboundAt: Date | null | undefined): MessagingWindow {
  if (!lastInboundAt) {
    return {
      open: false,
      hoursLeft: 0,
      reason: 'El lead todavia no escribio: no hay ventana abierta.',
    };
  }
  // Un reloj desfasado o un dato mal importado puede dar una fecha futura:
  // sin este piso, la ventana mostraria mas de 24 h, que no existe.
  const elapsedHours = Math.max(0, (Date.now() - new Date(lastInboundAt).getTime()) / 3_600_000);
  const hoursLeft = MESSAGING_WINDOW_HOURS - elapsedHours;
  if (hoursLeft <= 0) {
    return {
      open: false,
      hoursLeft: 0,
      reason: 'Pasaron mas de 24 h desde su ultimo mensaje: Instagram va a rechazar el envio.',
    };
  }
  return {
    open: true,
    hoursLeft,
    reason: `Quedan ${hoursLeft < 1 ? `${Math.round(hoursLeft * 60)} min` : `${Math.floor(hoursLeft)} h`} para responder.`,
  };
}

/* ------------------------------------------------------------------ *
 * Enlaces a Instagram
 * ------------------------------------------------------------------ */

/**
 * Enlace documentado por Meta: abre un hilo nuevo o existente con la cuenta
 * profesional. Es el que se pone en la bio o en un anuncio, no el que abre el
 * chat con un lead concreto.
 */
export function igMeLink(professionalUsername: string, ref?: string): string {
  const base = `https://ig.me/${professionalUsername.replace(/^@/, '')}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

/** Perfil del lead. Siempre funciona. */
export function profileLink(username: string): string {
  return `https://www.instagram.com/${username.replace(/^@/, '')}/`;
}

/**
 * Abre el hilo concreto en Instagram web.
 *
 * ATENCION: Meta no documenta ninguna URL para abrir un hilo existente. Esta
 * ruta funciona hoy en la web de Instagram pero no es oficial y puede romperse;
 * por eso la bandeja la ofrece como atajo secundario y nunca como unica via
 * para leer o responder un chat.
 */
export function directThreadLink(igThreadId: string): string {
  return `https://www.instagram.com/direct/t/${igThreadId}`;
}
