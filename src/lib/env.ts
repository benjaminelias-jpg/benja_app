/**
 * Configuracion por entorno. Todo tiene un valor por defecto que funciona
 * en local sin configurar nada: la app arranca con PGlite y sin tokens de Meta.
 */
export const env = {
  get databaseUrl(): string | undefined {
    const url = process.env.DATABASE_URL?.trim();
    return url && url.length > 0 ? url : undefined;
  },
  get pgliteDataDir(): string {
    return process.env.PGLITE_DATA_DIR?.trim() || '.data/pgdata';
  },
  get appUrl(): string {
    return process.env.APP_URL?.trim() || 'http://localhost:3000';
  },
  // --- Camino instagram_login (graph.instagram.com) ---
  get instagramAppId(): string | undefined {
    return process.env.INSTAGRAM_APP_ID?.trim() || undefined;
  },
  get instagramAppSecret(): string | undefined {
    return process.env.INSTAGRAM_APP_SECRET?.trim() || undefined;
  },

  // --- Camino unified_login (graph.facebook.com, Facebook Login for Business) ---
  get metaAppId(): string | undefined {
    return process.env.META_APP_ID?.trim() || undefined;
  },
  get metaConfigId(): string | undefined {
    return process.env.META_CONFIG_ID?.trim() || undefined;
  },

  /** Cual de los dos caminos ofrece la UI por defecto. */
  get defaultConnectionMethod(): 'instagram_login' | 'unified_login' {
    return process.env.INSTAGRAM_CONNECTION_METHOD === 'unified_login'
      ? 'unified_login'
      : 'instagram_login';
  },

  /** Token del handshake GET que Meta hace al registrar el webhook de Instagram. */
  get metaVerifyToken(): string {
    return process.env.META_VERIFY_TOKEN?.trim() || 'hookcrm-dev-verify';
  },
  /** App Secret de Meta: valida la firma X-Hub-Signature-256 de cada entrega. */
  get metaAppSecret(): string | undefined {
    return process.env.META_APP_SECRET?.trim() || undefined;
  },
  get instagramToken(): string | undefined {
    return process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || undefined;
  },
  get manychatApiKey(): string | undefined {
    return process.env.MANYCHAT_API_KEY?.trim() || undefined;
  },
  /** Secreto compartido simple para los webhooks de ManyChat (header x-hook-secret). */
  get manychatWebhookSecret(): string | undefined {
    return process.env.MANYCHAT_WEBHOOK_SECRET?.trim() || undefined;
  },
  /**
   * Si no hay credenciales de Instagram, los envios se registran pero no salen
   * a la red. Permite probar todo el flujo end-to-end sin cuenta conectada.
   */
  get dryRunOutbound(): boolean {
    if (process.env.DRY_RUN_OUTBOUND === 'false') return false;
    if (process.env.DRY_RUN_OUTBOUND === 'true') return true;
    return !process.env.INSTAGRAM_ACCESS_TOKEN;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};
