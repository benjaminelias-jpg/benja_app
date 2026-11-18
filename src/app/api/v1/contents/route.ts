import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { contents } from '@/db/schema';
import { listContents } from '@/server/services/analytics';
import { slugify } from '@/lib/ids';
import { badRequest, isResponse, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/contents — catalogo de contenidos registrados. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;
  try {
    return NextResponse.json({ data: await listContents(auth.org.id) });
  } catch (error) {
    return serverError(error);
  }
}

const schema = z.object({
  title: z.string().min(1),
  type: z.enum(['reel', 'post', 'carousel', 'story', 'live', 'ad', 'external']).optional(),
  igMediaId: z.string().optional(),
  permalink: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  caption: z.string().optional(),
  hook: z.string().optional(),
  angle: z.string().optional(),
  funnelStage: z.enum(['tofu', 'mofu', 'bofu']).optional(),
  refCode: z.string().optional(),
  publishedAt: z.string().optional(),
  views: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
});

/** POST /api/v1/contents — registra un contenido (reel, post, story, anuncio). */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('JSON invalido');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest('Payload invalido', parsed.error.issues);

  try {
    const db = await getDb();
    const [created] = await db
      .insert(contents)
      .values({
        orgId: auth.org.id,
        title: parsed.data.title,
        type: parsed.data.type ?? 'reel',
        igMediaId: parsed.data.igMediaId ?? null,
        permalink: parsed.data.permalink ?? null,
        thumbnailUrl: parsed.data.thumbnailUrl ?? null,
        caption: parsed.data.caption ?? null,
        hook: parsed.data.hook ?? null,
        angle: parsed.data.angle ?? null,
        funnelStage: parsed.data.funnelStage ?? 'tofu',
        refCode: parsed.data.refCode ?? slugify(parsed.data.title),
        publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : new Date(),
        views: parsed.data.views ?? 0,
        tags: parsed.data.tags ?? [],
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
