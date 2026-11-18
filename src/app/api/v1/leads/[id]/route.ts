import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getLead, moveLeadToStage, assignOwner, addTags, setCustomFields } from '@/server/services/leads';
import { getLeadTimeline } from '@/server/services/events';
import { listAppointmentsForLead, listDealsForLead } from '@/server/services/commerce';
import { badRequest, isResponse, notFound, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/leads/:id — ficha completa con timeline, reuniones y ventas. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;
  const { id } = await context.params;

  try {
    const row = await getLead(auth.org.id, id);
    if (!row) return notFound('Lead no encontrado');

    const [timeline, appointments, deals] = await Promise.all([
      getLeadTimeline(id, 50),
      listAppointmentsForLead(id),
      listDealsForLead(id),
    ]);

    return NextResponse.json({
      ...row.lead,
      stage: row.stage,
      owner: row.owner,
      attributedContent: row.content,
      timeline: timeline.map((entry) => ({ ...entry.event, content: entry.content })),
      appointments,
      deals: deals.map((entry) => ({ ...entry.deal, product: entry.product })),
    });
  } catch (error) {
    return serverError(error);
  }
}

const patchSchema = z.object({
  stageId: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

/** PATCH /api/v1/leads/:id — mueve de etapa, asigna responsable o edita campos. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('JSON invalido');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest('Payload invalido', parsed.error.issues);

  try {
    const existing = await getLead(auth.org.id, id);
    if (!existing) return notFound('Lead no encontrado');

    if (parsed.data.stageId) {
      await moveLeadToStage({ leadId: id, stageId: parsed.data.stageId, source: 'api' });
    }
    if (parsed.data.ownerId !== undefined) {
      await assignOwner(id, parsed.data.ownerId);
    }
    if (parsed.data.tags?.length) await addTags(id, parsed.data.tags);
    if (parsed.data.customFields) await setCustomFields(id, parsed.data.customFields);

    const updated = await getLead(auth.org.id, id);
    return NextResponse.json({ ...updated?.lead, stage: updated?.stage });
  } catch (error) {
    return serverError(error);
  }
}
