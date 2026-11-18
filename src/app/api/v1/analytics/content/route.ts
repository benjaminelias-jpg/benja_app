import { NextRequest, NextResponse } from 'next/server';
import { getContentPerformance, getFunnel, getKpis } from '@/server/services/analytics';
import { isResponse, readRange, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/analytics/content?from=&to=
 *
 * El reporte que responde la pregunta central: de que contenido viene cada
 * lead, cada reunion y cada venta.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  try {
    const range = readRange(request.nextUrl, 30);
    const [rows, kpis, funnel] = await Promise.all([
      getContentPerformance(auth.org.id, range, { includeUnattributed: true }),
      getKpis(auth.org.id, range),
      getFunnel(auth.org.id, range),
    ]);

    return NextResponse.json({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      currency: auth.org.currency,
      kpis,
      funnel,
      content: rows,
    });
  } catch (error) {
    return serverError(error);
  }
}
