/**
 * Segunda tanda de la auditoria: plata mal contada y datos de otra cuenta.
 *
 * Ninguno de estos tiraba error. Los reportes mostraban numeros plausibles y
 * las herramientas contestaban "listo".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import {
  organizations,
  users,
  pipelines,
  stages,
  contents,
  keywords,
  leads,
  deals,
  appointments,
  attributionTouches,
} from '@/db/schema';
import { getCloserPerformance } from '@/server/services/analytics';
import { ingestConversion, UnknownLeadError } from '@/server/services/ingest';
import { registerTouch } from '@/server/services/events';

let db: Awaited<ReturnType<typeof setupTestDb>>;
let orgA: string;
let orgB: string;
let closerId: string;
let contentId: string;
let keywordId: string;

beforeAll(async () => {
  db = await setupTestDb();

  const [a] = await db.insert(organizations).values({ name: 'Cuenta A', slug: 'cuenta-a' }).returning();
  const [b] = await db.insert(organizations).values({ name: 'Cuenta B', slug: 'cuenta-b' }).returning();
  orgA = a.id;
  orgB = b.id;

  const [closer] = await db
    .insert(users)
    .values({ orgId: orgA, name: 'Closer Uno', email: 'uno@a.test', role: 'closer' })
    .returning();
  closerId = closer.id;

  for (const org of [orgA, orgB]) {
    const [p] = await db.insert(pipelines).values({ orgId: org, name: 'Ventas', isDefault: true }).returning();
    await db.insert(stages).values([
      { pipelineId: p.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 },
      { pipelineId: p.id, name: 'Venta', key: 'venta', kind: 'won', position: 1 },
    ]);
  }

  const [content] = await db
    .insert(contents)
    .values({ orgId: orgA, title: 'Reel', type: 'reel', igMediaId: 'MEDIA_A' })
    .returning();
  contentId = content.id;

  const [kw] = await db
    .insert(keywords)
    .values({ orgId: orgA, word: 'QUIERO', channel: 'ig_dm' })
    .returning();
  keywordId = kw.id;
});

afterAll(async () => {
  await teardownTestDb();
});

describe('ingresos por closer', () => {
  beforeEach(async () => {
    await db.delete(deals).where(eq(deals.orgId, orgA));
    await db.delete(appointments).where(eq(appointments.orgId, orgA));
  });

  it('no multiplica la venta por la cantidad de reuniones', async () => {
    // Antes eran dos LEFT JOIN independientes desde users: producto
    // cartesiano. Tres reuniones y una venta de $1.000 reportaban $3.000, y
    // el closeRate seguia dando bien, asi que nada se veia raro.
    const [lead] = await db
      .insert(leads)
      .values({ orgId: orgA, igUsername: 'lead.plata' })
      .returning();

    const ahora = new Date();
    await db.insert(appointments).values([
      { orgId: orgA, leadId: lead.id, ownerId: closerId, scheduledAt: ahora, status: 'held' },
      { orgId: orgA, leadId: lead.id, ownerId: closerId, scheduledAt: ahora, status: 'held' },
      { orgId: orgA, leadId: lead.id, ownerId: closerId, scheduledAt: ahora, status: 'held' },
    ]);
    await db.insert(deals).values({
      orgId: orgA,
      leadId: lead.id,
      ownerId: closerId,
      amountCents: 100_000,
      status: 'won',
      closedAt: ahora,
    });

    const [fila] = await getCloserPerformance(orgA, {
      from: new Date(ahora.getTime() - 86_400_000),
      to: new Date(ahora.getTime() + 86_400_000),
    });

    expect(fila.meetingsHeld).toBe(3);
    expect(fila.sales).toBe(1);
    expect(fila.revenueCents).toBe(100_000); // no 300_000
  });
});

describe('conversiones por la API publica', () => {
  it('rechaza un leadId que no existe en vez de inventar un lead fantasma', async () => {
    await expect(
      ingestConversion({ orgId: orgA, kind: 'sale', leadId: 'lead_que_no_existe', amountCents: 5000 }),
    ).rejects.toBeInstanceOf(UnknownLeadError);
  });

  it('no deja escribir una venta sobre el lead de otra cuenta', async () => {
    const [ajeno] = await db
      .insert(leads)
      .values({ orgId: orgB, igUsername: 'lead.de.otro' })
      .returning();

    await expect(
      ingestConversion({ orgId: orgA, kind: 'sale', leadId: ajeno.id, amountCents: 999_999 }),
    ).rejects.toBeInstanceOf(UnknownLeadError);

    const suyos = await db.select().from(deals).where(eq(deals.leadId, ajeno.id));
    expect(suyos).toHaveLength(0);
  });
});

describe('devoluciones', () => {
  it('revierten el deal en vez de dejarlo como ganado', async () => {
    const [lead] = await db
      .insert(leads)
      .values({ orgId: orgA, igUsername: 'lead.devuelve' })
      .returning();

    await ingestConversion({ orgId: orgA, kind: 'sale', leadId: lead.id, amountCents: 50_000 });

    const [ganado] = await db.select().from(deals).where(eq(deals.leadId, lead.id));
    expect(ganado.status).toBe('won');

    await ingestConversion({ orgId: orgA, kind: 'refund', leadId: lead.id, amountCents: 50_000 });

    const [despues] = await db.select().from(deals).where(eq(deals.id, ganado.id));
    expect(despues.status).toBe('refunded');

    const [leadDespues] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(leadDespues.revenueCents).toBe(0);
  });
});

describe('atribucion de la palabra clave', () => {
  it('completa el first touch de keyword en un lead que ya existia', async () => {
    // El de contenido se rellenaba despues; el de keyword no, asi que la
    // palabra clave quedaba con $0 de ventas para siempre.
    const [lead] = await db
      .insert(leads)
      .values({ orgId: orgA, igUsername: 'lead.sin.keyword' })
      .returning();
    expect(lead.firstTouchKeywordId).toBeNull();

    // Un primer touch sin keyword (por ejemplo, vio el reel).
    await registerTouch({ orgId: orgA, leadId: lead.id, contentId });
    // Y despues si dispara la palabra clave.
    await registerTouch({ orgId: orgA, leadId: lead.id, contentId, keywordId });

    const [despues] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(despues.firstTouchKeywordId).toBe(keywordId);
    expect(despues.firstTouchContentId).toBe(contentId);

    const touches = await db
      .select()
      .from(attributionTouches)
      .where(and(eq(attributionTouches.leadId, lead.id)));
    expect(touches).toHaveLength(2);
  });
});
