import { z } from 'zod';
import { env } from '@/lib/env';

/**
 * Integracion con ManyChat.
 *
 * ManyChat no tiene un formato de webhook fijo: el usuario arma el payload en
 * el bloque "External Request". Por eso aceptamos un esquema laxo y luego
 * normalizamos: funciona tanto con el payload que recomienda nuestra guia como
 * con los campos crudos que manda ManyChat por defecto.
 */

export const manychatPayloadSchema = z
  .object({
    // Identificadores del suscriptor
    subscriber_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    key: z.string().optional(),
    ig_id: z.union([z.string(), z.number()]).optional(),
    ig_username: z.string().optional(),
    user_name: z.string().optional(),
    name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    profile_pic: z.string().optional(),
    profile_pic_url: z.string().optional(),

    // Contexto de la interaccion
    event: z.string().optional(),
    event_type: z.string().optional(),
    keyword: z.string().optional(),
    text: z.string().optional(),
    last_input_text: z.string().optional(),
    message: z.string().optional(),

    // Atribucion
    content_id: z.string().optional(),
    media_id: z.union([z.string(), z.number()]).optional(),
    ig_media_id: z.union([z.string(), z.number()]).optional(),
    post_id: z.union([z.string(), z.number()]).optional(),
    ref: z.string().optional(),
    ref_code: z.string().optional(),
    permalink: z.string().optional(),

    // Comercial
    amount: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional(),
    product: z.string().optional(),
    scheduled_at: z.string().optional(),
    tags: z.union([z.array(z.string()), z.string()]).optional(),

    // Campos personalizados de ManyChat
    custom_fields: z.record(z.string(), z.unknown()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ManychatPayload = z.infer<typeof manychatPayloadSchema>;

export interface NormalizedManychat {
  subscriberId: string | null;
  igUserId: string | null;
  igUsername: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  profilePicUrl: string | null;
  /** Que paso: `lead`, `keyword`, `meeting`, `sale`, `no_show`, `custom`. */
  event: string;
  keyword: string | null;
  text: string | null;
  igMediaId: string | null;
  refCode: string | null;
  permalink: string | null;
  contentId: string | null;
  amountCents: number | null;
  currency: string | null;
  product: string | null;
  scheduledAt: Date | null;
  tags: string[];
  customFields: Record<string, unknown>;
}

const str = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

/** Convierte "197", "197.00", "$197,50" o 19700 en centavos. */
export function parseAmountToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function normalizeManychat(payload: ManychatPayload): NormalizedManychat {
  const custom = { ...(payload.custom_fields ?? {}), ...(payload.customFields ?? {}) };

  const fullName =
    str(payload.name) ??
    [str(payload.first_name), str(payload.last_name)].filter(Boolean).join(' ') ??
    null;

  const rawTags = payload.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

  const scheduledRaw = str(payload.scheduled_at) ?? str(custom.scheduled_at);
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;

  return {
    subscriberId: str(payload.subscriber_id) ?? str(payload.id) ?? str(payload.key),
    igUserId: str(payload.ig_id) ?? str(custom.ig_id),
    igUsername: (str(payload.ig_username) ?? str(payload.user_name))?.replace(/^@/, '') ?? null,
    fullName: fullName && fullName.length > 0 ? fullName : null,
    email: str(payload.email)?.toLowerCase() ?? null,
    phone: str(payload.phone),
    profilePicUrl: str(payload.profile_pic) ?? str(payload.profile_pic_url),
    event: (str(payload.event) ?? str(payload.event_type) ?? 'lead').toLowerCase(),
    keyword: str(payload.keyword),
    text: str(payload.text) ?? str(payload.last_input_text) ?? str(payload.message),
    igMediaId:
      str(payload.ig_media_id) ?? str(payload.media_id) ?? str(payload.post_id) ?? str(custom.media_id),
    refCode: str(payload.ref_code) ?? str(payload.ref) ?? str(custom.ref),
    permalink: str(payload.permalink),
    contentId: str(payload.content_id) ?? str(custom.content_id),
    amountCents: parseAmountToCents(payload.amount ?? custom.amount),
    currency: str(payload.currency) ?? str(custom.currency),
    product: str(payload.product) ?? str(custom.product),
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
    tags,
    customFields: custom,
  };
}

/**
 * Traduce el nombre del evento de ManyChat a un evento del CRM.
 * Acepta sinonimos en espanol porque la gente nombra sus flujos como quiere.
 */
export function mapManychatEvent(
  event: string,
): 'lead' | 'keyword' | 'meeting' | 'meeting_held' | 'no_show' | 'sale' | 'refund' | 'custom' {
  const normalized = event.toLowerCase().replace(/[\s_-]+/g, '');

  if (['sale', 'venta', 'compra', 'purchase', 'pago', 'payment'].includes(normalized)) return 'sale';
  if (['refund', 'reembolso', 'devolucion'].includes(normalized)) return 'refund';
  if (
    ['meeting', 'reu', 'reunion', 'call', 'llamada', 'agenda', 'agendado', 'booked', 'cita'].includes(
      normalized,
    )
  ) {
    return 'meeting';
  }
  if (['meetingheld', 'asistio', 'show', 'held', 'realizada'].includes(normalized)) {
    return 'meeting_held';
  }
  if (['noshow', 'noasistio', 'ausente'].includes(normalized)) return 'no_show';
  if (['keyword', 'palabraclave', 'trigger', 'comentario', 'comment'].includes(normalized)) {
    return 'keyword';
  }
  if (['lead', 'nuevolead', 'newlead', 'suscriptor', 'subscriber', 'optin'].includes(normalized)) {
    return 'lead';
  }
  return 'custom';
}

/* ------------------------------------------------------------------ *
 * Salida hacia ManyChat
 * ------------------------------------------------------------------ */

const MANYCHAT_API = 'https://api.manychat.com';

async function manychatRequest(path: string, body: unknown) {
  if (!env.manychatApiKey) {
    return { ok: true, dryRun: true, data: { simulated: true, path, body } };
  }
  try {
    const response = await fetch(`${MANYCHAT_API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.manychatApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    return { ok: response.ok, dryRun: false, data: json };
  } catch (error) {
    return { ok: false, dryRun: false, error: (error as Error).message };
  }
}

/** Dispara un flujo de ManyChat para un suscriptor (ej: entregar el recurso). */
export function triggerManychatFlow(subscriberId: string, flowNs: string) {
  return manychatRequest('/fb/sending/sendFlow', {
    subscriber_id: subscriberId,
    flow_ns: flowNs,
  });
}

/** Escribe un campo personalizado en ManyChat (ej: etapa del CRM). */
export function setManychatField(subscriberId: string, fieldName: string, value: unknown) {
  return manychatRequest('/fb/subscriber/setCustomFieldByName', {
    subscriber_id: subscriberId,
    field_name: fieldName,
    field_value: value,
  });
}

/** Etiqueta al suscriptor en ManyChat para mantener los dos sistemas en sinc. */
export function addManychatTag(subscriberId: string, tagName: string) {
  return manychatRequest('/fb/subscriber/addTagByName', {
    subscriber_id: subscriberId,
    tag_name: tagName,
  });
}
