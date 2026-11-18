import { env } from '@/lib/env';

/**
 * Cliente de la Instagram Graph API.
 *
 * Si no hay token configurado, el cliente entra en modo `dry-run`: registra
 * la llamada y devuelve exito simulado. Asi se puede probar el embudo completo
 * (comentario -> DM -> lead -> reunion -> venta) sin conectar una cuenta real.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export interface IgResult<T = unknown> {
  ok: boolean;
  dryRun: boolean;
  data?: T;
  error?: string;
}

async function igRequest<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null } = {},
): Promise<IgResult<T>> {
  const token = init.token ?? env.instagramToken;

  if (!token || env.dryRunOutbound) {
    return {
      ok: true,
      dryRun: true,
      data: { simulated: true, path, body: init.body } as T,
    };
  }

  const url = new URL(`${GRAPH_BASE}${path}`);
  url.searchParams.set('access_token', token);

  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      return { ok: false, dryRun: false, error: json?.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, dryRun: false, data: json };
  } catch (error) {
    return { ok: false, dryRun: false, error: (error as Error).message };
  }
}

/** DM directo a un usuario con el que ya existe una conversacion abierta. */
export async function sendDirectMessage(params: {
  igAccountId: string;
  recipientIgId: string;
  text: string;
  token?: string | null;
}): Promise<IgResult> {
  return igRequest(`/${params.igAccountId}/messages`, {
    method: 'POST',
    token: params.token,
    body: {
      recipient: { id: params.recipientIgId },
      message: { text: params.text },
    },
  });
}

/**
 * Respuesta privada a un comentario.
 *
 * Es el mecanismo exacto del "comenta X y te mando el recurso": Meta permite
 * abrir un DM contestando a un comentario, incluso sin conversacion previa,
 * dentro de los 7 dias posteriores al comentario.
 */
export async function sendPrivateReply(params: {
  igAccountId: string;
  commentId: string;
  text: string;
  token?: string | null;
}): Promise<IgResult> {
  return igRequest(`/${params.igAccountId}/messages`, {
    method: 'POST',
    token: params.token,
    body: {
      recipient: { comment_id: params.commentId },
      message: { text: params.text },
    },
  });
}

/** Respuesta publica dentro del hilo de comentarios. */
export async function replyToComment(params: {
  commentId: string;
  text: string;
  token?: string | null;
}): Promise<IgResult> {
  return igRequest(`/${params.commentId}/replies`, {
    method: 'POST',
    token: params.token,
    body: { message: params.text },
  });
}

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

/** Trae las publicaciones recientes de la cuenta para importarlas como contenidos. */
export async function fetchRecentMedia(params: {
  igAccountId: string;
  token?: string | null;
  limit?: number;
}): Promise<IgResult<{ data: IgMedia[] }>> {
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
  return igRequest<{ data: IgMedia[] }>(
    `/${params.igAccountId}/media?fields=${fields}&limit=${params.limit ?? 25}`,
    { token: params.token },
  );
}

export interface IgInsight {
  name: string;
  values: Array<{ value: number }>;
}

/** Metricas de una publicacion: reproducciones, alcance, guardados, compartidos. */
export async function fetchMediaInsights(params: {
  mediaId: string;
  token?: string | null;
  isReel?: boolean;
}): Promise<IgResult<{ data: IgInsight[] }>> {
  const metrics = params.isReel
    ? ['plays', 'reach', 'likes', 'comments', 'shares', 'saved']
    : ['impressions', 'reach', 'saved', 'shares'];
  return igRequest<{ data: IgInsight[] }>(
    `/${params.mediaId}/insights?metric=${metrics.join(',')}`,
    { token: params.token },
  );
}

/** Convierte el tipo de media de Instagram al tipo de contenido del CRM. */
export function mapMediaType(media: IgMedia): 'reel' | 'post' | 'carousel' | 'story' | 'ad' {
  if (media.media_product_type === 'REELS') return 'reel';
  if (media.media_product_type === 'STORY') return 'story';
  if (media.media_product_type === 'AD') return 'ad';
  if (media.media_type === 'CAROUSEL_ALBUM') return 'carousel';
  return 'post';
}

/** Extrae un titulo legible a partir del caption (primera linea, sin hashtags). */
export function titleFromCaption(caption: string | undefined, fallback = 'Publicacion'): string {
  if (!caption) return fallback;
  const firstLine = caption
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
