import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { oauthStates } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { randomToken } from '@/lib/ids';
import { buildAuthUrl, missingConfig, redirectUri } from '@/server/integrations/instagram-oauth';
import type { ConnectionMethod } from '@/server/integrations/instagram';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inicia la conexion con Instagram.
 *
 *   GET /api/instagram/connect?method=instagram_login|unified_login
 *
 * Guarda un `state` de un solo uso para que la respuesta de Meta no pueda ser
 * falsificada, y manda al usuario a autorizar.
 */
export async function GET(request: NextRequest) {
  const method = (request.nextUrl.searchParams.get('method') ??
    env.defaultConnectionMethod) as ConnectionMethod;

  const problem = missingConfig(method);
  if (problem) {
    const url = new URL('/integraciones', env.appUrl);
    url.searchParams.set('error', `${problem}. Revisá tu .env antes de conectar.`);
    return NextResponse.redirect(url);
  }

  const org = await getCurrentOrg();
  const db = await getDb();
  const state = `${method}:${randomToken(24)}`;

  await db.insert(oauthStates).values({
    state,
    orgId: org.id,
    redirectTo: '/integraciones',
    // Ventana corta: un state viejo no debe seguir sirviendo.
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  console.log(`[instagram] iniciando OAuth (${method}), redirect_uri=${redirectUri()}`);
  return NextResponse.redirect(buildAuthUrl(method, state));
}
