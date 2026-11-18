/**
 * Aplica las migraciones SQL de ./drizzle contra la base configurada.
 * Funciona igual con PGlite (local) y con Postgres (produccion).
 *
 *   npm run db:migrate
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../lib/env';

async function main() {
  const folder = 'drizzle';

  if (env.databaseUrl) {
    const [{ drizzle }, { migrate }, pgModule] = await Promise.all([
      import('drizzle-orm/node-postgres'),
      import('drizzle-orm/node-postgres/migrator'),
      import('pg'),
    ]);
    const Pool = pgModule.default?.Pool ?? pgModule.Pool;
    const pool = new Pool({ connectionString: env.databaseUrl });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: folder });
    await pool.end();
    console.log('Migraciones aplicadas sobre Postgres remoto.');
    return;
  }

  // PGlite no crea directorios padre: nos aseguramos de que existan.
  if (!env.pgliteDataDir.startsWith('memory://')) {
    mkdirSync(dirname(env.pgliteDataDir), { recursive: true });
  }

  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  const client = await PGlite.create({ dataDir: env.pgliteDataDir });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  await client.close();
  console.log(`Migraciones aplicadas sobre PGlite (${env.pgliteDataDir}).`);
}

main().catch((error) => {
  console.error('Fallo la migracion:', error);
  process.exit(1);
});
