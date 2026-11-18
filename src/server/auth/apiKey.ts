import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { apiKeys, organizations, type Organization } from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { randomToken } from '@/lib/ids';

/**
 * Autenticacion de la API publica mediante clave.
 *
 * La clave en claro solo existe en el momento de crearla; en base solo queda
 * su SHA-256. Formato: `hk_live_<32 caracteres>`.
 */

export interface AuthResult {
  org: Organization;
  apiKeyId: string;
}

export async function createApiKey(orgId: string, name: string) {
  const db = await getDb();
  const secret = randomToken(32);
  const plain = `hk_live_${secret}`;
  const [record] = await db
    .insert(apiKeys)
    .values({
      orgId,
      name,
      prefix: plain.slice(0, 12),
      hash: sha256(plain),
    })
    .returning();
  // `plain` solo se devuelve aqui: no vuelve a ser recuperable.
  return { apiKey: record, plain };
}

export async function authenticateRequest(request: Request): Promise<AuthResult | null> {
  const header = request.headers.get('authorization') ?? request.headers.get('x-api-key');
  if (!header) return null;

  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const db = await getDb();
  const [record] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, sha256(token)), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!record) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id));

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, record.orgId))
    .limit(1);
  if (!org) return null;

  return { org, apiKeyId: record.id };
}

export async function listApiKeys(orgId: string) {
  const db = await getDb();
  return db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId));
}

export async function revokeApiKey(apiKeyId: string) {
  const db = await getDb();
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, apiKeyId));
}
