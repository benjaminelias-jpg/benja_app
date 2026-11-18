'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentOrg } from '@/server/context';
import {
  sendReply,
  markAsRead,
  setConversationStatus,
  assignConversation,
  getOrCreateConversationForLead,
} from '@/server/services/inbox';
import { syncInbox, syncMedia } from '@/server/services/instagram-sync';

export interface ComposerState {
  ok?: boolean;
  error?: string;
  dryRun?: boolean;
}

/**
 * Envia una respuesta desde la bandeja.
 * Devuelve estado en vez de lanzar: el composer muestra el error sin perder
 * lo que la persona escribio.
 */
export async function sendReplyAction(
  _previous: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const conversationId = String(formData.get('conversationId') ?? '');
  const text = String(formData.get('text') ?? '');
  if (!conversationId) return { error: 'Falta la conversacion.' };

  const org = await getCurrentOrg();
  const result = await sendReply({ orgId: org.id, conversationId, text });

  if (!result.ok) return { error: result.error ?? 'No se pudo enviar.' };

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath('/inbox');
  return { ok: true, dryRun: result.dryRun };
}

export async function markReadAction(conversationId: string) {
  await markAsRead(conversationId);
  revalidatePath('/inbox');
}

export async function setStatusAction(formData: FormData) {
  const conversationId = String(formData.get('conversationId') ?? '');
  const status = String(formData.get('status') ?? 'open') as 'open' | 'snoozed' | 'closed';
  if (!conversationId) return;
  await setConversationStatus(conversationId, status);
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${conversationId}`);
}

export async function assignConversationAction(formData: FormData) {
  const conversationId = String(formData.get('conversationId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!conversationId) return;
  await assignConversation(conversationId, userId || null);
  revalidatePath(`/inbox/${conversationId}`);
}

/** Abre (o crea) el chat de un lead desde su ficha. */
export async function openLeadChatAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  if (!leadId) return;
  const org = await getCurrentOrg();
  const conversationId = await getOrCreateConversationForLead(org.id, leadId);
  if (conversationId) redirect(`/inbox/${conversationId}`);
}

export async function syncInboxAction() {
  const org = await getCurrentOrg();
  const result = await syncInbox(org.id);
  revalidatePath('/inbox');
  return result;
}

export async function syncMediaAction() {
  const org = await getCurrentOrg();
  const result = await syncMedia(org.id);
  revalidatePath('/contenido');
  revalidatePath('/integraciones');
  return result;
}
