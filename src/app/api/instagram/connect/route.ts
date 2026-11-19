import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { oauthStates } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { randomToken } from '@/lib/ids';
import {
  buildAuthUrl,
  missingConfig,
  redirectUri,
  getMetaCredentials,
} from '@/server/integrations/instagram-oauth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inicia la conexion con Instagram.
 *
 *   GET /api/instagram/connect
 *
 * Las credenciales salen de la base (configuradas desde la interfaz) o del
 * entorno. Guarda un `state` de un solo uso para que la respuesta de Meta no
 * pueda ser falsificada, y manda al usuario a autorizar.
 */
export async function GET(request: NextRequest) {
  const org = await getCurrentOrg();
  const credentials = await getMetaCredentials(org.id);

  const problem = missingConfig(credentials);
  if (problem) {
    const url = new URL('/integraciones', env.appUrl);
    url.searchParams.set('error', `${problem} Cargalas en la pantalla de conexión.`);
    return NextResponse.redirect(url);
  }

  const db = await getDb();
  const state = `${credentials.method}:${randomToken(24)}`;

  await db.insert(oauthStates).values({
    state,
    orgId: org.id,
    redirectTo: '/integraciones',
    // Ventana corta: un state viejo no debe seguir sirviendo.
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  console.log(`[instagram] OAuth (${credentials.method}), redirect_uri=${redirectUri()}`);
  return NextResponse.redirect(buildAuthUrl(credentials, state));
}
