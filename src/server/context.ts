import { cache } from 'react';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { organizations, pipelines, stages, type Organization, type Stage } from '@/db/schema';

/**
 * Contexto de organizacion.
 *
 * Hoy la app corre en modo mono-organizacion (la primera que exista), pero todo
 * el esquema y los servicios ya llevan `orgId`, asi que pasar a multi-tenant es
 * cambiar esta funcion por una que lea la sesion del usuario.
 */
export const getCurrentOrg = cache(async (): Promise<Organization> => {
  const db = await getDb();
  const [org] = await db.select().from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  if (!org) {
    throw new Error(
      'No hay ninguna organizacion en la base de datos. Ejecuta `npm run setup` para crear datos iniciales.',
    );
  }
  return org;
});

export async function getOrgBySlug(slug: string): Promise<Organization | undefined> {
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return org;
}

/** Pipeline por defecto de la organizacion, con sus etapas ordenadas. */
export const getDefaultPipeline = cache(async (orgId: string) => {
  const db = await getDb();
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, orgId))
    .orderBy(asc(pipelines.createdAt))
    .limit(1);
  if (!pipeline) return null;
  const pipelineStages = await db
    .select()
    .from(stages)
    .where(eq(stages.pipelineId, pipeline.id))
    .orderBy(asc(stages.position));
  return { pipeline, stages: pipelineStages };
});

/**
 * Busca la primera etapa con un `kind` dado. Es lo que permite que la analitica
 * funcione aunque el usuario renombre sus etapas: "Reu agendada" o "Call" dan igual,
 * lo que importa es que su kind sea `meeting`.
 */
export function findStageByKind(allStages: Stage[], kind: Stage['kind']): Stage | undefined {
  return allStages.find((stage) => stage.kind === kind);
}
