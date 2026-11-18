/**
 * Crea una clave de API para la organizacion por defecto.
 *
 *   npm run key:create -- "Make.com"
 *
 * La clave en claro se imprime una sola vez: en base queda solo su hash.
 * Con PGlite el servidor de desarrollo debe estar detenido (un solo proceso
 * puede abrir el directorio de datos a la vez).
 */
import { asc } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { organizations } from './schema';
import { createApiKey } from '../server/auth/apiKey';

async function main() {
  const name = process.argv.slice(2).join(' ').trim() || 'Clave sin nombre';
  const db = await getDb();
  const [org] = await db.select().from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  if (!org) throw new Error('No hay organizacion. Ejecuta `npm run setup` primero.');

  const { plain } = await createApiKey(org.id, name);
  console.log('');
  console.log(`Clave creada para ${org.name}: ${name}`);
  console.log(`  ${plain}`);
  console.log('');
  console.log('Guardala ahora: no se puede volver a ver.');
  console.log('Uso:  curl -H "Authorization: Bearer <clave>" <url>');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error.message ?? error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
