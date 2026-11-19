import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { instagramAccounts } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { getMetaCredentials } from '@/server/integrations/instagram-oauth';
import { parseSignedRequest } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Desautorizacion: Meta avisa acá cuando alguien le saca los permisos a la app
 * desde Instagram o Facebook, sin pasar por el CRM.
 *
 * Meta exige esta URL para poder guardar la configuracion de Business login.
 * Pero no es un tramite: sin esto, al revocar los permisos el token muere y el
 * CRM sigue mostrando la cuenta en verde, mandando DMs que no salen. Es la
 * misma familia de problemas que venimos cerrando.
 *
 * Llega como POST form-encoded con un `signed_request` firmado con el App
 * Secret. Verificar la firma no es opcional: sin eso, cualquiera que sepa la
 * URL puede desconectarte la cuenta.
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
  // `user_id` es el id con scope de app del usuario que revoco. No siempre
  // coincide con el id profesional que guardamos, asi que si no lo
  // encontramos desconectamos la cuenta de la organizacion igual: perder la
  // conexion y avisarlo es mejor que seguir creyendo que esta viva.
  const userId = payload.user_id ? String(payload.user_id) : null;

  const porUsuario = userId
    ? await db
        .update(instagramAccounts)
        .set({
          connected: false,
          accessToken: null,
          tokenExpiresAt: null,
          lastError: 'Los permisos se revocaron desde Instagram. Volvé a conectar la cuenta.',
        })
        .where(and(eq(instagramAccounts.orgId, org.id), eq(instagramAccounts.igUserId, userId)))
        .returning()
    : [];

  if (porUsuario.length === 0) {
    await db
      .update(instagramAccounts)
      .set({
        connected: false,
        accessToken: null,
        tokenExpiresAt: null,
        lastError: 'Los permisos se revocaron desde Instagram. Volvé a conectar la cuenta.',
      })
      .where(eq(instagramAccounts.orgId, org.id));
  }

  return NextResponse.json({ ok: true });
}

/** Meta a veces pega un GET para comprobar que la URL responde. */
export function GET() {
  return NextResponse.json({ ok: true });
}
