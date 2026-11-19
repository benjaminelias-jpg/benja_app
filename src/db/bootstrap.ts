/**
 * Deja la base lista para usar en un despliegue nuevo.
 *
 * Sin esto, una base recién migrada no tiene organización y la app muestra
 * "falta preparar la base de datos": un callejón sin salida en producción,
 * donde nadie puede correr `npm run setup`.
 *
 * Crea lo mínimo para que el CRM funcione vacío: la organización y un pipeline.
 * NO carga datos de ejemplo — eso es `npm run db:seed`, para desarrollo.
 *
 * Es idempotente: si ya hay una organización, no toca nada.
 */
import { asc } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { organizations, pipelines, stages } from './schema';

export async function bootstrap(): Promise<{ created: boolean; orgName: string }> {
  const db = await getDb();

  const [existing] = await db
    .select()
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);

  if (existing) return { created: false, orgName: existing.name };

  const [org] = await db
    .insert(organizations)
    .values({
      name: process.env.ORG_NAME?.trim() || 'Mi negocio',
      slug: 'principal',
      currency: process.env.ORG_CURRENCY?.trim() || 'USD',
    })
    .returning();

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId: org.id, name: 'Ventas', isDefault: true })
    .returning();

  // Las mismas etapas que usa el seed: lo que importa es el `kind`, porque es
  // de donde la analítica saca qué cuenta como reunión y qué como venta.
  await db.insert(stages).values([
    { pipelineId: pipeline.id, name: 'Lead nuevo', key: 'nuevo', kind: 'new', position: 0, color: '#64748b', staleAfterDays: 2 },
    { pipelineId: pipeline.id, name: 'Conversando', key: 'conversando', kind: 'contacted', position: 1, color: '#0ea5e9', staleAfterDays: 3 },
    { pipelineId: pipeline.id, name: 'Calificado', key: 'calificado', kind: 'qualified', position: 2, color: '#8b5cf6', staleAfterDays: 4 },
    { pipelineId: pipeline.id, name: 'Reu agendada', key: 'reu', kind: 'meeting', position: 3, color: '#f59e0b', staleAfterDays: 5 },
    { pipelineId: pipeline.id, name: 'Oferta presentada', key: 'oferta', kind: 'offer', position: 4, color: '#ec4899', staleAfterDays: 4 },
    { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 5, color: '#10b981', staleAfterDays: 30 },
    { pipelineId: pipeline.id, name: 'Perdido', key: 'perdido', kind: 'lost', position: 6, color: '#ef4444', staleAfterDays: 90 },
  ]);

  return { created: true, orgName: org.name };
}

// Ejecutable directo:  npm run db:bootstrap
if (process.argv[1]?.includes('bootstrap')) {
  bootstrap()
    .then((result) => {
      console.log(
        result.created
          ? `Organizacion "${result.orgName}" creada con su pipeline.`
          : `Ya existia la organizacion "${result.orgName}": no se toco nada.`,
      );
    })
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Fallo el bootstrap:', error);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
