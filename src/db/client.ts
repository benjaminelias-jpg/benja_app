import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env, hardenSslMode } from '../lib/env';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Un unico cliente por proceso, cacheado en globalThis para sobrevivir al
 * hot-reload de Next en desarrollo (si no, cada recarga abriria otra conexion).
 */
const globalForDb = globalThis as unknown as {
  __hookCrmDb?: Promise<Db>;
  __hookCrmClose?: () => Promise<void>;
};

async function createClient(): Promise<Db> {
  const url = env.databaseUrl;

  // Postgres real (produccion, o local si el dev levanta uno con Docker).
  if (url) {
    const [{ drizzle }, pgModule] = await Promise.all([
      import('drizzle-orm/node-postgres'),
      import('pg'),
    ]);
    const Pool = pgModule.default?.Pool ?? pgModule.Pool;
    const pool = new Pool({
      connectionString: hardenSslMode(url),
      // En serverless cada instancia abre su propio pool: diez conexiones por
      // instancia se multiplican rapido. El pooler del proveedor es quien
      // reparte de verdad, aqui alcanza con poco y soltar lo que no se usa.
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // El `sslmode` de la cadena de conexion manda. No se desactiva la
      // verificacion del certificado: hacerlo aceptaria un intermediario.
    });
    globalForDb.__hookCrmClose = async () => {
      await pool.end();
    };
    return drizzle(pool, { schema }) as unknown as Db;
  }

  // Sin DATABASE_URL: Postgres embebido en WASM. Cero dependencias externas.
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);
  if (!env.pgliteDataDir.startsWith('memory://')) {
    mkdirSync(dirname(env.pgliteDataDir), { recursive: true });
  }
  const client = await PGlite.create({ dataDir: env.pgliteDataDir });
  globalForDb.__hookCrmClose = async () => {
    await client.close();
  };
  return drizzle(client, { schema }) as unknown as Db;
}

/** Punto de entrada unico a la base de datos. Siempre `const db = await getDb()`. */
export function getDb(): Promise<Db> {
  if (!globalForDb.__hookCrmDb) {
    globalForDb.__hookCrmDb = createClient();
  }
  return globalForDb.__hookCrmDb;
}

/** Cierra la conexion. Solo necesario en scripts y tests. */
export async function closeDb(): Promise<void> {
  if (globalForDb.__hookCrmClose) await globalForDb.__hookCrmClose();
  globalForDb.__hookCrmDb = undefined;
  globalForDb.__hookCrmClose = undefined;
}

/** True si estamos corriendo sobre el Postgres embebido. */
export function isEmbedded(): boolean {
  return !env.databaseUrl;
}

export { schema };
