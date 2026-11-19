/**
 * Aplica las migraciones pendientes.
 *
 *   npm run db:migrate
 */
import { migrate } from './migrate-runner';

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fallo la migracion:', error);
    process.exit(1);
  });
