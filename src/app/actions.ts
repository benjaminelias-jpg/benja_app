'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentOrg } from '@/server/context';
import { moveLeadToStage, assignOwner, addTags } from '@/server/services/leads';
import { toggleAutomation } from '@/server/services/automations';
import { getLead } from '@/server/services/leads';

/** Mueve un lead de etapa desde el tablero o la ficha. */
export async function moveLeadAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  const stageId = String(formData.get('stageId') ?? '');
  if (!leadId || !stageId) return;

  const org = await getCurrentOrg();
  const lead = await getLead(org.id, leadId);
  if (!lead) return;

  await moveLeadToStage({ leadId, stageId, source: 'crm-ui' });
  revalidatePath('/pipeline');
  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/');
}

export async function assignOwnerAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  const ownerId = String(formData.get('ownerId') ?? '');
  if (!leadId) return;
  await assignOwner(leadId, ownerId || null);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/pipeline');
}

export async function addTagAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '');
  const tag = String(formData.get('tag') ?? '').trim();
  if (!leadId || !tag) return;
  await addTags(leadId, [tag]);
  revalidatePath(`/leads/${leadId}`);
}

export async function toggleAutomationAction(formData: FormData) {
  const automationId = String(formData.get('automationId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!automationId) return;
  await toggleAutomation(automationId, active);
  revalidatePath('/automatizaciones');
}
