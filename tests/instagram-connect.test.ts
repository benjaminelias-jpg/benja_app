/**
 * Que id de Instagram guardamos al conectar una cuenta.
 *
 * Meta devuelve dos identificadores distintos en este flujo:
 *
 *   - el canje del codigo devuelve un "Instagram-scoped user ID", que
 *     identifica al usuario frente a nuestra app;
 *   - /me?fields=user_id devuelve el "Instagram professional account ID",
 *     documentado asi: "This ID is value of the `id` field received in webhook
 *     notifications for this account".
 *
 * El segundo es el que va en la ruta de /<IG_ID>/messages. Guardar el primero
 * da una conexion que parece sana y falla recien al mandar el primer DM.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { organizations, instagramAccounts } from '@/db/schema';
import { connectAccount } from '@/server/services/instagram-sync';
import { buildAuthUrl, INSTAGRAM_LOGIN_SCOPES } from '@/server/integrations/instagram-oauth';

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgId: string;

/** Los dos ids son distintos, como en la vida real. */
const SCOPED_ID = '17841400000000000';
const PROFESSIONAL_ID = '99887766554433221';

beforeAll(async () => {
  db = await setupTestDb();
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Conexion', slug: 'conexion' })
    .returning();
  orgId = org.id;
});

afterAll(async () => {
  await teardownTestDb();
});

describe('conectar la cuenta de Instagram', () => {
  beforeEach(() => {
    delete process.env.DRY_RUN_OUTBOUND;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete(instagramAccounts).where(eq(instagramAccounts.orgId, orgId));
  });

  it('guarda el id profesional de /me, no el que vino del canje del codigo', async () => {
    const vistas: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        const href = String(url);
        vistas.push(href);
        // El perfil: user_id es el profesional, id es el de scope de app.
        if (href.includes('/me?') || href.includes('/me%3F') || /\/me\b/.test(href)) {
          return new Response(
            JSON.stringify({
              user_id: PROFESSIONAL_ID,
              id: SCOPED_ID,
              username: 'infoproductor',
              account_type: 'BUSINESS',
              followers_count: 1234,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const result = await connectAccount({
      orgId,
      method: 'instagram_login',
      token: 'token-largo',
      expiresInSeconds: 5184000,
      igUserId: SCOPED_ID, // lo que devolvio el canje del codigo
      scopes: INSTAGRAM_LOGIN_SCOPES,
    });

    expect(result.ok).toBe(true);
    expect(result.account?.igUserId).toBe(PROFESSIONAL_ID);
    expect(result.account?.igUserId).not.toBe(SCOPED_ID);
    expect(result.account?.username).toBe('infoproductor');

    // El perfil se pide a /me: pedirselo a /<scoped-id> devuelve el id equivocado.
    expect(vistas.some((u) => /\/me(\?|$)/.test(u))).toBe(true);

    const [guardada] = await db
      .select()
      .from(instagramAccounts)
      .where(eq(instagramAccounts.orgId, orgId));
    expect(guardada.igUserId).toBe(PROFESSIONAL_ID);
  });

  it('falla con un mensaje claro si Meta no devuelve el id profesional', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: SCOPED_ID, username: 'personal' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const result = await connectAccount({
      orgId,
      method: 'instagram_login',
      token: 'token-largo',
      igUserId: SCOPED_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/user_id/);
  });
});

describe('url de autorizacion', () => {
  const credentials = {
    method: 'instagram_login' as const,
    appId: '1234567890',
    appSecret: 'secreto',
    configId: null,
    source: 'base' as const,
  };

  it('va al login de Instagram, sin el boton de Facebook y con state', () => {
    const url = new URL(buildAuthUrl(credentials, 'instagram_login:abc123'));

    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('response_type')).toBe('code');
    // Documentado como booleano: true/false. El "0" que usan otros no figura.
    expect(url.searchParams.get('enable_fb_login')).toBe('false');
    // state protege de CSRF y Meta lo devuelve tal cual.
    expect(url.searchParams.get('state')).toBe('instagram_login:abc123');
    expect(url.searchParams.get('scope')).toBe(INSTAGRAM_LOGIN_SCOPES.join(','));
  });
});
