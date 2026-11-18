'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { webhookEndpoints } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { createApiKey, revokeApiKey } from '@/server/auth/apiKey';
import { randomToken, slugify } from '@/lib/ids';

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
