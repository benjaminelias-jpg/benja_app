/**
 * Reintenta las entregas salientes vencidas.
 *
 *   npm run webhooks:retry
 *
 * En un servidor siempre despierto los reintentos salen solos. En serverless el
 * proceso puede morir antes de completarlos, así que conviene apuntar un cron
 * a este script o a POST /api/webhooks/outbound/retry.
 */
import { closeDb } from './client';
import { deliverPending } from '../server/services/outbound';

async function main() {
  const result = await deliverPending(100);
  console.log(`Entregas reintentadas: ${result.intentos}`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
