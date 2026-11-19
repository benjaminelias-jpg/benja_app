/**
 * Preparación de la base en cada despliegue.
 *
 * Corre antes del build en Vercel. Si no hay `DATABASE_URL` no hace nada y deja
 * que el build siga: es preferible desplegar con una pantalla que explique qué
 * falta, a fallar el build entero por una variable sin configurar.
 */
import { closeDb } from './client';

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.warn('');
    console.warn('  Sin DATABASE_URL: no se migra nada.');
    console.warn('  Conectá un Postgres al proyecto y volvé a desplegar.');
    console.warn('');
    return;
  }

  const { migrate } = await import('./migrate-runner');
  await migrate();

  const { bootstrap } = await import('./bootstrap');
  const result = await bootstrap();
  console.log(
    result.created
      ? `Base preparada: organizacion "${result.orgName}" creada.`
      : `Base al dia: organizacion "${result.orgName}".`,
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Fallo la preparacion de la base:', error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
