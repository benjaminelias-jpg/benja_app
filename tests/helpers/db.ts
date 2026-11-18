/**
 * Base de datos efimera para los tests: PGlite en memoria.
 * Cada suite arranca con el esquema recien migrado y sin datos.
 */
process.env.PGLITE_DATA_DIR = 'memory://hookcrm-test';
delete process.env.DATABASE_URL;

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';

let instance: PGlite | null = null;

export async function setupTestDb() {
  const client = await PGlite.create({ dataDir: 'memory://hookcrm-test' });
  instance = client;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });

  // El cliente compartido de la app apunta a esta misma instancia.
  const globalForDb = globalThis as unknown as { __hookCrmDb?: Promise<unknown> };
  globalForDb.__hookCrmDb = Promise.resolve(db);

  return db;
}

export async function teardownTestDb() {
  const globalForDb = globalThis as unknown as { __hookCrmDb?: Promise<unknown> };
  globalForDb.__hookCrmDb = undefined;
  await instance?.close();
  instance = null;
}
