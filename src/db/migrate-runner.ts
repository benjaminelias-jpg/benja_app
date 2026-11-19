/**
 * Aplica las migraciones SQL de ./drizzle contra la base configurada.
 * Funciona igual con PGlite (local) y con Postgres (produccion).
 *
 * Esta la funcion reutilizable; `migrate.ts` es el ejecutable.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../lib/env';

export async function migrate(): Promise<void> {
  const folder = 'drizzle';
  const url = env.migrationDatabaseUrl;

  if (url) {
    const [{ drizzle }, { migrate: run }, pgModule] = await Promise.all([
      import('drizzle-orm/node-postgres'),
      import('drizzle-orm/node-postgres/migrator'),
      import('pg'),
    ]);
    const Pool = pgModule.default?.Pool ?? pgModule.Pool;
    const pool = new Pool({ connectionString: url });
    await run(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
    console.log(
      `Migraciones aplicadas sobre Postgres remoto${url === env.databaseUrl ? '' : ' (conexion directa, sin pooler)'}.`,
    );
    return;
  }

  // PGlite no crea directorios padre: nos aseguramos de que existan.
  if (!env.pgliteDataDir.startsWith('memory://')) {
    mkdirSync(dirname(env.pgliteDataDir), { recursive: true });
  }

  const [{ PGlite }, { drizzle }, { migrate: run }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  const client = await PGlite.create({ dataDir: env.pgliteDataDir });
  await run(drizzle(client), { migrationsFolder: folder });
  await client.close();
  console.log(`Migraciones aplicadas sobre PGlite (${env.pgliteDataDir}).`);
}
