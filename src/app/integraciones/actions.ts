'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { webhookEndpoints, webhookSubscriptions, metaApps, instagramAccounts } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { createApiKey, revokeApiKey } from '@/server/auth/apiKey';
import { randomToken, slugify } from '@/lib/ids';
import {
  sendTestEvent,
  retryDelivery,
  invalidateSubscriptionCache,
} from '@/server/services/outbound';

/**
 * Crea una clave de API. La clave en claro se devuelve UNA vez: después solo
 * queda su hash, así que la UI tiene que mostrarla en ese momento.
 */
export async function createApiKeyAction(
  _previous: { plain?: string; error?: string },
  formData: FormData,
): Promise<{ plain?: string; error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Poné un nombre para identificar la clave.' };

  const org = await getCurrentOrg();
  const { plain } = await createApiKey(org.id, name);
  revalidatePath('/integraciones');
  return { plain };
}

export async function revokeApiKeyAction(formData: FormData) {
  const apiKeyId = String(formData.get('apiKeyId') ?? '');
  if (!apiKeyId) return;
  await revokeApiKey(apiKeyId);
  revalidatePath('/integraciones');
}

const PRESETS: Record<string, Record<string, unknown>> = {
  calendly: {
    kind: '=meeting',
    email: 'payload.invitee.email',
    fullName: 'payload.invitee.name',
    scheduledAt: 'payload.event.start_time',
    externalId: 'payload.event.uri',
  },
  cal_com: {
    kind: '=meeting',
    email: 'payload.attendees.0.email',
    fullName: 'payload.attendees.0.name',
    scheduledAt: 'payload.startTime',
    externalId: 'payload.uid',
  },
  hotmart: {
    kind: '=sale',
    email: 'data.buyer.email',
    fullName: 'data.buyer.name',
    amount: 'data.purchase.price.value',
    currency: 'data.purchase.price.currency_value',
    externalId: 'data.purchase.transaction',
  },
  stripe: {
    kind: '=sale',
    email: 'data.object.customer_details.email',
    amount: 'data.object.amount_total',
    currency: 'data.object.currency',
    externalId: 'data.object.id',
  },
  custom: { kind: '=lead', email: 'email', fullName: 'name' },
};

/** Alta de un endpoint con un mapeo precargado por proveedor. */
export async function createEndpointAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const provider = String(formData.get('provider') ?? 'custom');
  if (!name) return;

  const org = await getCurrentOrg();
  const db = await getDb();

  await db.insert(webhookEndpoints).values({
    orgId: org.id,
    name,
    slug: slugify(String(formData.get('slug') ?? '') || name) || randomToken(8).toLowerCase(),
    provider: provider as 'custom',
    secret: randomToken(24),
    mapping: PRESETS[provider] ?? PRESETS.custom,
  });

  revalidatePath('/integraciones');
}

export async function deleteEndpointAction(formData: FormData) {
  const endpointId = String(formData.get('endpointId') ?? '');
  if (!endpointId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, org.id), eq(webhookEndpoints.id, endpointId)));
  revalidatePath('/integraciones');
}

export async function rotateSecretAction(formData: FormData) {
  const endpointId = String(formData.get('endpointId') ?? '');
  if (!endpointId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .update(webhookEndpoints)
    .set({ secret: randomToken(24) })
    .where(and(eq(webhookEndpoints.orgId, org.id), eq(webhookEndpoints.id, endpointId)));
  revalidatePath('/integraciones');
}


/* ------------------------------------------------------------------ *
 * Webhooks salientes
 * ------------------------------------------------------------------ */

/** Alta de una suscripción: el CRM avisa a esta URL cuando pasa algo. */
export async function createSubscriptionAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim();
  if (!name || !url) return;

  // Una URL mal escrita falla en cada entrega: mejor rechazarla al crearla.
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
  } catch {
    return;
  }

  const events = formData.getAll('events').map(String).filter(Boolean);

  const org = await getCurrentOrg();
  const db = await getDb();

  await db.insert(webhookSubscriptions).values({
    orgId: org.id,
    name,
    url,
    events: events.length > 0 ? events : ['*'],
    secret: randomToken(32),
    description: String(formData.get('description') ?? '') || null,
    active: true,
  });

  invalidateSubscriptionCache(org.id);
  revalidatePath('/integraciones');
}

export async function toggleSubscriptionAction(formData: FormData) {
  const subscriptionId = String(formData.get('subscriptionId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!subscriptionId) return;

  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .update(webhookSubscriptions)
    .set({ active })
    .where(and(eq(webhookSubscriptions.orgId, org.id), eq(webhookSubscriptions.id, subscriptionId)));

  invalidateSubscriptionCache(org.id);
  revalidatePath('/integraciones');
}

export async function deleteSubscriptionAction(formData: FormData) {
  const subscriptionId = String(formData.get('subscriptionId') ?? '');
  if (!subscriptionId) return;

  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .delete(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.orgId, org.id), eq(webhookSubscriptions.id, subscriptionId)));

  invalidateSubscriptionCache(org.id);
  revalidatePath('/integraciones');
}

/** Manda un evento de prueba para verificar la URL y la firma. */
export async function testSubscriptionAction(
  _previous: { ok?: boolean; message?: string },
  formData: FormData,
): Promise<{ ok?: boolean; message?: string }> {
  const subscriptionId = String(formData.get('subscriptionId') ?? '');
  if (!subscriptionId) return { ok: false, message: 'Falta la suscripción.' };

  const result = await sendTestEvent(subscriptionId);
  revalidatePath('/integraciones');

  return result.ok
    ? { ok: true, message: `Entregado (HTTP ${result.status}).` }
    : { ok: false, message: result.error ?? `Falló (HTTP ${result.status ?? '—'}).` };
}

export async function retryDeliveryAction(formData: FormData) {
  const deliveryId = String(formData.get('deliveryId') ?? '');
  if (!deliveryId) return;
  await retryDelivery(deliveryId);
  revalidatePath('/integraciones');
}


/* ------------------------------------------------------------------ *
 * Credenciales de la app de Meta
 * ------------------------------------------------------------------ */

export interface CredentialsState {
  ok?: boolean;
  error?: string;
}

/**
 * Guarda el identificador y la clave de la app de Meta.
 *
 * Van a la base y no a variables de entorno para que cambiarlas no exija un
 * redespliegue: cargarlas una vez y apretar "Conectar" es todo.
 */
export async function saveMetaAppAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const appId = String(formData.get('appId') ?? '').trim();
  const appSecret = String(formData.get('appSecret') ?? '').trim();
  const configId = String(formData.get('configId') ?? '').trim();
  const method = String(formData.get('method') ?? 'instagram_login') as
    | 'instagram_login'
    | 'unified_login';

  if (!appId) return { error: 'Falta el identificador de la app.' };
  if (!/^\d{6,}$/.test(appId)) {
    return { error: 'El identificador de la app son solo números. Fijate que no hayas pegado otra cosa.' };
  }
  if (!appSecret || appSecret.length < 16) {
    return { error: 'La clave secreta parece incompleta. Copiala entera desde el panel de Meta.' };
  }
  if (method === 'unified_login' && !configId) {
    return { error: 'Para Unified Login hace falta el identificador de la configuración.' };
  }

  const org = await getCurrentOrg();
  const db = await getDb();

  const values = {
    orgId: org.id,
    method,
    appId,
    appSecret,
    configId: configId || null,
    updatedAt: new Date(),
    lastError: null,
  };

  await db
    .insert(metaApps)
    .values(values)
    .onConflictDoUpdate({ target: metaApps.orgId, set: values });

  revalidatePath('/integraciones');
  return { ok: true };
}

export async function forgetMetaAppAction() {
  const org = await getCurrentOrg();
  const db = await getDb();
  await db.delete(metaApps).where(eq(metaApps.orgId, org.id));
  revalidatePath('/integraciones');
}

/** Desconecta la cuenta sin borrar nada del CRM. */
export async function disconnectInstagramAction() {
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .update(instagramAccounts)
    .set({ connected: false, accessToken: null, tokenExpiresAt: null })
    .where(eq(instagramAccounts.orgId, org.id));
  revalidatePath('/integraciones');
  revalidatePath('/inbox');
}
