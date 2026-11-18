import { NextRequest, NextResponse } from 'next/server';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { oauthStates } from '@/db/schema';
import { env } from '@/lib/env';
import {
  exchangeCode,
  exchangeForLongLived,
  describeOAuthError,
} from '@/server/integrations/instagram-oauth';
import { connectAccount } from '@/server/services/instagram-sync';
import type { ConnectionMethod } from '@/server/integrations/instagram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vuelta del OAuth de Instagram.
 *
 * Esta es la URL que hay que registrar en Meta como redirect:
 *   <APP_URL>/api/instagram/callback
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (message: string, ok = false) => {
    const url = new URL('/integraciones', env.appUrl);
    url.searchParams.set(ok ? 'ok' : 'error', message);
    return NextResponse.redirect(url);
  };

  const denial = describeOAuthError(params);
  if (denial) return back(denial);

  const state = params.get('state');
  const code = params.get('code');
  if (!state || !code) return back('Meta no devolvio el codigo de autorizacion.');

  const db = await getDb();

  // El state se limpia siempre: vencidos y usados no deben quedar acumulados.
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));

  const [stored] = await db.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1);
  if (!stored) {
    return back('El enlace de conexion vencio o ya se uso. Probá conectar de nuevo.');
  }
  await db.delete(oauthStates).where(eq(oauthStates.state, state));

  const method = (state.split(':')[0] as ConnectionMethod) ?? 'instagram_login';

  const exchanged = await exchangeCode(method, code);
  if (!exchanged.ok || !exchanged.accessToken) {
    return back(`No se pudo canjear el codigo: ${exchanged.error}`);
  }

  let token = exchanged.accessToken;
  let expiresIn = exchanged.expiresInSeconds;

  // El token de instagram_login dura 1 hora: hay que cambiarlo por el de 60 dias.
  if (method === 'instagram_login') {
    const longLived = await exchangeForLongLived(token);
    if (longLived.ok && longLived.accessToken) {
      token = longLived.accessToken;
      expiresIn = longLived.expiresInSeconds;
    } else {
      console.warn('[instagram] no se pudo extender el token:', longLived.error);
    }
  }

  const connected = await connectAccount({
    orgId: stored.orgId,
    method,
    token,
    expiresInSeconds: expiresIn,
    igUserId: exchanged.userId,
    scopes: exchanged.permissions,
  });

  if (!connected.ok) return back(connected.error ?? 'No se pudo conectar la cuenta.');

  return back(
    `Cuenta @${connected.account?.username} conectada. Ya podés importar tus publicaciones y la bandeja.`,
    true,
  );
}
