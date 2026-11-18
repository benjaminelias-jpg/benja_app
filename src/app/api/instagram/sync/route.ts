import { NextRequest, NextResponse } from 'next/server';
import { getCurrentOrg } from '@/server/context';
import { syncMedia, syncInbox } from '@/server/services/instagram-sync';
import { isResponse, requireAuth, serverError } from '@/server/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// La sincronizacion encadena muchas llamadas a Meta: necesita margen.
export const maxDuration = 120;

/**
 * POST /api/instagram/sync?what=media|inbox|all
 *
 * Pensado tanto para el boton de la UI como para un cron externo.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) return auth;

  const what = request.nextUrl.searchParams.get('what') ?? 'all';

  try {
    const result: Record<string, unknown> = {};
    if (what === 'media' || what === 'all') result.media = await syncMedia(auth.org.id);
    if (what === 'inbox' || what === 'all') result.inbox = await syncInbox(auth.org.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return serverError(error);
  }
}

/** Estado de la conexion, util para monitoreo. */
export async function GET() {
  const org = await getCurrentOrg();
  const { getConnectedAccount } = await import('@/server/services/instagram-sync');
  const account = await getConnectedAccount(org.id);
  if (!account) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: account.connected,
    username: account.username,
    method: account.connectionMethod,
    scopes: account.scopes,
    tokenExpiresAt: account.tokenExpiresAt,
    lastSyncedAt: account.lastSyncedAt,
    lastInboxSyncAt: account.lastInboxSyncAt,
    lastError: account.lastError,
  });
}
