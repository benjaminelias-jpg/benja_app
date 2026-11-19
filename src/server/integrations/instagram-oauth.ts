import { env } from '@/lib/env';
import { GRAPH_VERSION, type ConnectionMethod } from './instagram';

/**
 * Flujo OAuth de Instagram, en sus dos variantes.
 *
 * Meta cambio de camino a mitad de rio y hoy conviven dos. Cual aplica depende
 * de como este dado de alta el app en el panel de desarrolladores, asi que el
 * CRM soporta ambos y el usuario elige al conectar:
 *
 *   instagram_login → OAuth en www.instagram.com, token de usuario de Instagram,
 *                     se canjea por uno de 60 dias y se puede refrescar.
 *   unified_login   → OAuth por Facebook Login for Business, token de sistema
 *                     del portafolio de negocio (BISU), vigencia definida en la
 *                     configuracion del app.
 */

export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

export const UNIFIED_LOGIN_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'instagram_manage_insights',
];

/**
 * Credenciales efectivas de la app de Meta.
 *
 * Primero la base (configurables desde la interfaz, sin redesplegar), y si no
 * hay nada ahi, las variables de entorno. Asi funciona tanto el camino facil
 * como el de quien prefiere configurarlo por entorno.
 */
export interface MetaCredentials {
  method: ConnectionMethod;
  appId: string;
  appSecret: string;
  configId?: string | null;
  /** De donde salieron, para poder explicarlo en pantalla. */
  source: 'base' | 'entorno' | 'ninguna';
}

export async function getMetaCredentials(orgId: string): Promise<MetaCredentials> {
  const { getDb } = await import('@/db/client');
  const { metaApps } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const db = await getDb();
  const [stored] = await db.select().from(metaApps).where(eq(metaApps.orgId, orgId)).limit(1);

  if (stored?.appId && stored?.appSecret) {
    return {
      method: stored.method,
      appId: stored.appId,
      appSecret: stored.appSecret,
      configId: stored.configId,
      source: 'base',
    };
  }

  const method = env.defaultConnectionMethod;
  const appId = method === 'unified_login' ? env.metaAppId : env.instagramAppId;
  const appSecret = method === 'unified_login' ? env.metaAppSecret : env.instagramAppSecret;

  if (appId && appSecret) {
    return { method, appId, appSecret, configId: env.metaConfigId, source: 'entorno' };
  }

  return { method, appId: '', appSecret: '', source: 'ninguna' };
}

export interface OAuthTokenResult {
  ok: boolean;
  accessToken?: string;
  /** Id de la cuenta de Instagram, cuando el camino lo devuelve. */
  userId?: string;
  permissions?: string[];
  expiresInSeconds?: number;
  error?: string;
}

export function redirectUri(): string {
  return `${env.appUrl.replace(/\/$/, '')}/api/instagram/callback`;
}

/** Si falta configuracion, la UI lo dice en vez de mandar al usuario a un 400 de Meta. */
export function missingConfig(credentials: MetaCredentials): string | null {
  if (!credentials.appId) return 'Falta el identificador de la app de Meta.';
  if (!credentials.appSecret) return 'Falta la clave secreta de la app de Meta.';
  if (credentials.method === 'unified_login' && !credentials.configId) {
    return 'Falta el identificador de la configuración de Facebook Login.';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Paso 1: mandar al usuario a autorizar
 * ------------------------------------------------------------------ */

export function buildAuthUrl(credentials: MetaCredentials, state: string): string {
  if (credentials.method === 'unified_login') {
    const url = new URL('https://www.facebook.com/dialog/oauth');
    url.searchParams.set('client_id', credentials.appId);
    url.searchParams.set('config_id', credentials.configId ?? '');
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('display', 'popup');
    url.searchParams.set('state', state);
    return url.toString();
  }

  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', credentials.appId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_LOGIN_SCOPES.join(','));
  url.searchParams.set('state', state);
  return url.toString();
}

/* ------------------------------------------------------------------ *
 * Paso 2: canjear el codigo por un token
 * ------------------------------------------------------------------ */

export async function exchangeCode(
  credentials: MetaCredentials,
  code: string,
): Promise<OAuthTokenResult> {
  const method = credentials.method;
  // Meta devuelve el codigo con un "#_" pegado al final que hay que sacar.
  const cleanCode = code.replace(/#_$/, '');

  if (method === 'unified_login') {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    url.searchParams.set('client_id', credentials.appId);
    url.searchParams.set('client_secret', credentials.appSecret);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('code', cleanCode);

    try {
      const response = await fetch(url);
      const json = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };
      if (!response.ok || !json.access_token) {
        return { ok: false, error: json.error?.message ?? `HTTP ${response.status}` };
      }
      return {
        ok: true,
        accessToken: json.access_token,
        expiresInSeconds: json.expires_in,
        permissions: UNIFIED_LOGIN_SCOPES,
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  // instagram_login: el canje va por POST con el cuerpo en form-data.
  const body = new URLSearchParams({
    client_id: credentials.appId,
    client_secret: credentials.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code: cleanCode,
  });

  try {
    const response = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await response.json()) as {
      // La respuesta viene envuelta en `data`, a diferencia del resto de la API.
      data?: Array<{ access_token?: string; user_id?: string; permissions?: string }>;
      access_token?: string;
      user_id?: string;
      permissions?: string;
      error_message?: string;
      error?: { message?: string };
    };

    const entry = json.data?.[0] ?? json;
    if (!response.ok || !entry.access_token) {
      return {
        ok: false,
        error: json.error_message ?? json.error?.message ?? `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      accessToken: entry.access_token,
      userId: entry.user_id ? String(entry.user_id) : undefined,
      permissions: entry.permissions ? String(entry.permissions).split(',') : undefined,
      expiresInSeconds: 3600,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ *
 * Paso 3: token largo (solo instagram_login)
 * ------------------------------------------------------------------ */

/** Canjea el token de 1 hora por uno de 60 dias. Debe hacerse en el servidor. */
export async function exchangeForLongLived(
  shortToken: string,
  appSecret: string,
): Promise<OAuthTokenResult> {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('access_token', shortToken);

  try {
    const response = await fetch(url);
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!response.ok || !json.access_token) {
      return { ok: false, error: json.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, accessToken: json.access_token, expiresInSeconds: json.expires_in };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Renueva el token de 60 dias por otros 60.
 *
 * Meta solo lo permite si el token tiene al menos 24 h de vida y no venció.
 * Un token que pasa 60 dias sin refrescarse muere y hay que volver a conectar
 * la cuenta a mano, asi que conviene refrescar bastante antes del limite.
 */
export async function refreshLongLived(longToken: string): Promise<OAuthTokenResult> {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', longToken);

  try {
    const response = await fetch(url);
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!response.ok || !json.access_token) {
      return { ok: false, error: json.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, accessToken: json.access_token, expiresInSeconds: json.expires_in };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Id del portafolio de negocio del cliente: hace falta para renovar el BISU. */
export async function getClientBusinessId(token: string): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me`);
  url.searchParams.set('fields', 'client_business_id');
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await response.json()) as { client_business_id?: string };
    return json.client_business_id ?? null;
  } catch {
    return null;
  }
}

/** Mensaje legible para el error que Meta devuelve cuando el usuario cancela. */
export function describeOAuthError(params: URLSearchParams): string | null {
  const error = params.get('error');
  if (!error) return null;
  if (params.get('error_reason') === 'user_denied') {
    return 'Cancelaste la autorizacion en Instagram. No se conecto ninguna cuenta.';
  }
  return params.get('error_description') ?? error;
}
