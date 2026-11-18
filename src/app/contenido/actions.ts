'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contents } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { slugify } from '@/lib/ids';

/** Alta manual de contenido: sirve para piezas que no están en Instagram. */
export async function createContentAction(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const org = await getCurrentOrg();
  const db = await getDb();

  const publishedRaw = String(formData.get('publishedAt') ?? '');
  const published = publishedRaw ? new Date(publishedRaw) : new Date();

  const [created] = await db
    .insert(contents)
    .values({
      orgId: org.id,
      title,
      type: (String(formData.get('type') ?? 'reel') as 'reel'),
      hook: String(formData.get('hook') ?? '') || null,
      angle: String(formData.get('angle') ?? '') || null,
      funnelStage: (String(formData.get('funnelStage') ?? 'tofu') as 'tofu'),
      permalink: String(formData.get('permalink') ?? '') || null,
      igMediaId: String(formData.get('igMediaId') ?? '') || null,
      refCode: String(formData.get('refCode') ?? '') || slugify(title),
      views: Number(formData.get('views') ?? 0) || 0,
      adSpendCents: Math.round(Number(formData.get('adSpend') ?? 0) * 100) || 0,
      publishedAt: Number.isNaN(published.getTime()) ? new Date() : published,
    })
    .returning();

  revalidatePath('/contenido');
  redirect(`/contenido/${created.id}`);
}

/**
 * Edita los campos que son del usuario, no de Instagram.
 * El gancho y el ángulo son lo que de verdad se quiere comparar entre piezas,
 * y la Graph API no los conoce: por eso nunca se pisan al sincronizar.
 */
export async function updateContentAction(formData: FormData) {
  const contentId = String(formData.get('contentId') ?? '');
  if (!contentId) return;

  const org = await getCurrentOrg();
  const db = await getDb();

  await db
    .update(contents)
    .set({
      title: String(formData.get('title') ?? '').trim() || undefined,
      hook: String(formData.get('hook') ?? '') || null,
      angle: String(formData.get('angle') ?? '') || null,
      funnelStage: (String(formData.get('funnelStage') ?? 'tofu') as 'tofu'),
      adSpendCents: Math.round(Number(formData.get('adSpend') ?? 0) * 100) || 0,
      updatedAt: new Date(),
    })
    .where(and(eq(contents.orgId, org.id), eq(contents.id, contentId)));

  revalidatePath(`/contenido/${contentId}`);
  revalidatePath('/contenido');
}

export async function archiveContentAction(formData: FormData) {
  const contentId = String(formData.get('contentId') ?? '');
  if (!contentId) return;
  const org = await getCurrentOrg();
  const db = await getDb();
  await db
    .update(contents)
    .set({ archived: true })
    .where(and(eq(contents.orgId, org.id), eq(contents.id, contentId)));
  revalidatePath('/contenido');
  redirect('/contenido');
}
