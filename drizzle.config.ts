import type { Config } from 'drizzle-kit';

/**
 * Las migraciones SQL se generan siempre contra el dialecto Postgres.
 * En local corren sobre PGlite (Postgres embebido en WASM, sin instalar nada);
 * en produccion sobre cualquier Postgres (Neon, Supabase, RDS...).
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/hookcrm',
  },
  verbose: true,
  strict: false,
} satisfies Config;
