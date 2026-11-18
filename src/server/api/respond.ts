import { NextResponse } from 'next/server';
import { authenticateRequest, type AuthResult } from '@/server/auth/apiKey';
import { getCurrentOrg } from '@/server/context';
import { env } from '@/lib/env';

/**
 * Helpers compartidos por la API publica (`/api/v1/*`).
 *
 * En desarrollo, si no se manda clave, se usa la organizacion por defecto:
 * permite probar la API con curl sin configurar nada. En produccion la clave
 * es obligatoria.
 */
export async function requireAuth(request: Request): Promise<AuthResult | NextResponse> {
  const auth = await authenticateRequest(request);
  if (auth) return auth;

  if (!env.isProduction) {
    const org = await getCurrentOrg();
    return { org, apiKeyId: 'dev' };
  }

  return NextResponse.json(
    { error: 'No autorizado. Envia tu clave en el header Authorization: Bearer hk_live_...' },
    { status: 401 },
  );
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = 'No encontrado') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(error: unknown) {
  console.error('[api]', error);
  return NextResponse.json({ error: (error as Error).message ?? 'Error interno' }, { status: 500 });
}

/** Lee `from`/`to` de la query y devuelve un rango con valores por defecto. */
export function readRange(url: URL, defaultDays = 30) {
  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - defaultDays * 86_400_000);
  return { from, to };
}
