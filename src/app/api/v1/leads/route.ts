import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listLeads } from '@/server/services/leads';
import { ingestInteraction } from '@/server/services/ingest';
import { badRequest, isResponse, readRange, requireAuth, serverError } from '@/server/api/respond';
import type { LeadSource } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/leads — listado con filtros. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  try {
    const url = request.nextUrl;
    const range = url.searchParams.has('from') || url.searchParams.has('to')
      ? readRange(url, 365)
      : null;

    const { rows, total } = await listLeads({
      orgId: auth.org.id,
      search: url.searchParams.get('q') ?? undefined,
      stageId: url.searchParams.get('stageId') ?? undefined,
      ownerId: url.searchParams.get('ownerId') ?? undefined,
      contentId: url.searchParams.get('contentId') ?? undefined,
      source: (url.searchParams.get('source') as LeadSource) ?? undefined,
      from: range?.from,
      to: range?.to,
      limit: Number(url.searchParams.get('limit') ?? 50),
      offset: Number(url.searchParams.get('offset') ?? 0),
    });

    return NextResponse.json({
      total,
      data: rows.map((row) => ({
        ...row.lead,
        stage: row.stage,
        owner: row.owner,
        attributedContent: row.content,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

const createLeadSchema = z.object({
  igUserId: z.string().optional(),
  igUsername: z.string().optional(),
  manychatSubscriberId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  fullName: z.string().optional(),
  source: z.string().optional(),
  text: z.string().optional(),
  contentId: z.string().optional(),
  igMediaId: z.string().optional(),
  refCode: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/v1/leads — crea o actualiza un lead.
 *
 * Pasa por el mismo pipeline de ingesta que los webhooks, asi que resuelve
 * atribucion y dispara automatizaciones igual que un comentario real.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('JSON invalido');
  }

  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) return badRequest('Payload invalido', parsed.error.issues);

  try {
    const result = await ingestInteraction({
      orgId: auth.org.id,
      source: (parsed.data.source as LeadSource) ?? 'manual',
      text: parsed.data.text,
      igUserId: parsed.data.igUserId,
      igUsername: parsed.data.igUsername?.replace(/^@/, ''),
      manychatSubscriberId: parsed.data.manychatSubscriberId,
      email: parsed.data.email,
      phone: parsed.data.phone,
      fullName: parsed.data.fullName,
      contentId: parsed.data.contentId,
      igMediaId: parsed.data.igMediaId,
      refCode: parsed.data.refCode,
      tags: parsed.data.tags,
      customFields: parsed.data.customFields,
    });

    return NextResponse.json(
      {
        leadId: result.lead.id,
        created: result.leadCreated,
        attributedContent: result.content
          ? { id: result.content.id, title: result.content.title }
          : null,
        keyword: result.keyword?.word ?? null,
      },
      { status: result.leadCreated ? 201 : 200 },
    );
  } catch (error) {
    return serverError(error);
  }
}
