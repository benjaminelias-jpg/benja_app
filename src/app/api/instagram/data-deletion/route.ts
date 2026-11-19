import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { instagramAccounts } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { getMetaCredentials, redirectUri } from '@/server/integrations/instagram-oauth';
import { parseSignedRequest } from '@/lib/crypto';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Borrado de datos: Meta exige esta URL para guardar la configuracion de
 * Business login, y la llama cuando alguien pide que borres lo suyo.
 *
 * La respuesta tiene que ser JSON con `url` (una pagina donde la persona pueda
 * ver el estado) y `confirmation_code`. Acá cortamos la conexion y dejamos el
 * motivo anotado; los leads y el historial del CRM no se tocan, porque son
 * datos de tu negocio y no de la app de Meta.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get('signed_request');
  if (typeof signedRequest !== 'string') {
    return NextResponse.json({ error: 'Falta signed_request.' }, { status: 400 });
  }

  const org = await getCurrentOrg();
  const credentials = await getMetaCredentials(org.id);
  if (!credentials.appSecret) {
    return NextResponse.json({ error: 'No hay App Secret configurado.' }, { status: 503 });
  }

  const payload = parseSignedRequest(signedRequest, credentials.appSecret);
  if (!payload) {
    return NextResponse.json({ error: 'Firma invalida.' }, { status: 401 });
  }

  const db = await getDb();
  await db
    .update(instagramAccounts)
    .set({
      connected: false,
      accessToken: null,
      tokenExpiresAt: null,
      lastError: 'Se pidió el borrado de datos desde Meta. La conexión quedó cerrada.',
    })
    .where(eq(instagramAccounts.orgId, org.id));

  const code = `del_${org.id.slice(-8)}_${payload.user_id ?? 'anon'}`;

  return NextResponse.json({
    url: `${env.appUrl}/integraciones`,
    confirmation_code: code,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, redirectUri: redirectUri() });
}
