import { NextRequest, NextResponse } from 'next/server';
import { deliverPending } from '@/server/services/outbound';
import { isResponse, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/webhooks/outbound/retry
 *
 * Reintenta las entregas salientes vencidas. Pensado para un cron: en
 * serverless el proceso puede morir antes de completar los reintentos que
 * `dispatchEvent` lanza en segundo plano.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;
  try {
    const limite = Number(request.nextUrl.searchParams.get('limite') ?? 50);
    return NextResponse.json(await deliverPending(Number.isFinite(limite) ? limite : 50));
  } catch (error) {
    return serverError(error);
  }
}
