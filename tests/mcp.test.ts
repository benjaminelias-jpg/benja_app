import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb } from './helpers/db';
import {
  organizations,
  users,
  pipelines,
  stages,
  contents,
  products,
  leads,
  deals,
  conversations,
  instagramAccounts,
  type Organization,
} from '@/db/schema';

/**
 * Servidor MCP del CRM.
 *
 * Se conecta un cliente MCP real por transporte en memoria: eso ejercita el
 * registro de herramientas, los esquemas de entrada y la serializacion, que es
 * donde fallan estas cosas. Llamar a las funciones a mano no probaria nada de eso.
 */

let db: Awaited<ReturnType<typeof setupTestDb>>;
let client: Client;
let org: Organization;
let leadId: string;
let stageVentaId: string;

/** El texto que devolvio una herramienta. */
function textoDe(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? '').join('\n');
}

beforeAll(async () => {
  db = await setupTestDb();

  const [created] = await db
    .insert(organizations)
    .values({ name: 'Academia MCP', slug: 'academia-mcp', currency: 'USD' })
    .returning();
  org = created;

  await db
    .insert(users)
    .values({ orgId: org.id, name: 'Closer MCP', email: 'mcp@test.com', role: 'closer' });

  await db
    .insert(instagramAccounts)
    .values({ orgId: org.id, igUserId: 'IG_CUENTA_MCP', username: 'cuenta.mcp', connected: false });

  const [pipeline] = await db
    .insert(pipelines)
    .values({ orgId: org.id, name: 'Ventas', isDefault: true })
    .returning();

  const createdStages = await db
    .insert(stages)
    .values([
      { pipelineId: pipeline.id, name: 'Nuevo', key: 'nuevo', kind: 'new', position: 0 },
      { pipelineId: pipeline.id, name: 'Venta', key: 'venta', kind: 'won', position: 1 },
    ])
    .returning();
  stageVentaId = createdStages[1].id;

  const [content] = await db
    .insert(contents)
    .values({
      orgId: org.id,
      title: 'Reel que factura',
      type: 'reel',
      views: 120_000,
      hook: 'El gancho de prueba',
      publishedAt: new Date(Date.now() - 5 * 86_400_000),
    })
    .returning();

  await db
    .insert(products)
    .values({ orgId: org.id, name: 'Mentoria MCP', type: 'mentoria', priceCents: 149_700 });

  const [lead] = await db
    .insert(leads)
    .values({
      orgId: org.id,
      igUserId: 'IG_CAMILA_MCP',
      igUsername: 'camila.mcp',
      fullName: 'Camila MCP',
      firstTouchContentId: content.id,
      pipelineId: pipeline.id,
      stageId: createdStages[0].id,
      source: 'ig_comment',
    })
    .returning();
  leadId = lead.id;

  await db.insert(conversations).values({
    orgId: org.id,
    leadId: lead.id,
    // Ventana cerrada a proposito: el ultimo mensaje del lead fue hace 30 h.
    lastInboundAt: new Date(Date.now() - 30 * 3_600_000),
    lastMessageAt: new Date(Date.now() - 30 * 3_600_000),
  });

  const { buildMcpServer } = await import('@/mcp/tools');
  const server = buildMcpServer(org);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close().catch(() => {});
  await teardownTestDb();
});

describe('catalogo de herramientas', () => {
  it('expone las herramientas del CRM con descripcion', async () => {
    const { tools } = await client.listTools();
    const nombres = tools.map((tool) => tool.name);

    expect(nombres).toContain('reporte_de_atribucion');
    expect(nombres).toContain('buscar_leads');
    expect(nombres).toContain('registrar_venta');
    expect(nombres).toContain('responder_dm');
    expect(nombres).toContain('probar_flujo');
    expect(tools.length).toBeGreaterThanOrEqual(18);

    // Sin descripcion, el modelo no sabe cuando usar cada herramienta.
    expect(tools.every((tool) => (tool.description ?? '').length > 20)).toBe(true);
  });
});

describe('analitica por MCP', () => {
  it('devuelve el reporte de atribucion', async () => {
    const result = await client.callTool({
      name: 'reporte_de_atribucion',
      arguments: { dias: 30 },
    });
    const texto = textoDe(result);

    expect(texto).toContain('Reel que factura');
    expect(texto).toContain('Academia MCP');
    expect(texto).toContain('gancho');
  });

  it('devuelve el resumen con el embudo', async () => {
    const texto = textoDe(await client.callTool({ name: 'resumen_del_negocio', arguments: {} }));
    expect(texto).toContain('Embudo');
    expect(texto).toContain('Leads captados');
  });
});

describe('leads por MCP', () => {
  it('busca y encuentra el lead con su contenido de origen', async () => {
    const texto = textoDe(
      await client.callTool({ name: 'buscar_leads', arguments: { texto: 'camila' } }),
    );
    expect(texto).toContain('camila.mcp');
    expect(texto).toContain('Reel que factura');
    expect(texto).toContain(leadId);
  });

  it('muestra la ficha completa', async () => {
    const texto = textoDe(await client.callTool({ name: 'ver_lead', arguments: { leadId } }));
    expect(texto).toContain('Camila MCP');
    expect(texto).toContain('Historial');
  });

  it('avisa cuando el lead no existe en vez de romper', async () => {
    const texto = textoDe(
      await client.callTool({ name: 'ver_lead', arguments: { leadId: 'lead_inexistente' } }),
    );
    expect(texto).toContain('No existe');
  });

  it('mueve el lead de etapa y lo refleja en la base', async () => {
    const texto = textoDe(
      await client.callTool({
        name: 'mover_lead_de_etapa',
        arguments: { leadId, etapaId: stageVentaId },
      }),
    );
    expect(texto).toContain('Venta');

    const [after] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(after.stageId).toBe(stageVentaId);
  });
});

describe('operaciones comerciales por MCP', () => {
  it('registra una venta y la acredita al contenido de origen', async () => {
    const texto = textoDe(
      await client.callTool({ name: 'registrar_venta', arguments: { leadId, importe: 1497 } }),
    );

    expect(texto).toContain('Venta registrada');
    // El valor del CRM: la venta sabe sola de qué reel salió.
    expect(texto).toContain('Reel que factura');

    const [deal] = await db.select().from(deals).where(eq(deals.leadId, leadId));
    expect(deal.amountCents).toBe(149_700);

    const [after] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(after.revenueCents).toBe(149_700);
  });

  it('rechaza una fecha invalida al agendar', async () => {
    const texto = textoDe(
      await client.callTool({
        name: 'agendar_reunion',
        arguments: { leadId, cuando: 'el martes que viene' },
      }),
    );
    expect(texto).toContain('no es una fecha válida');
  });
});

describe('bandeja por MCP', () => {
  it('lista conversaciones marcando la ventana de 24 h', async () => {
    const texto = textoDe(await client.callTool({ name: 'listar_conversaciones', arguments: {} }));
    expect(texto).toContain('Camila MCP');
    expect(texto).toContain('ventana cerrada');
  });

  it('no deja mandar un DM fuera de la ventana', async () => {
    const [thread] = await db.select().from(conversations).where(eq(conversations.leadId, leadId));
    const texto = textoDe(
      await client.callTool({
        name: 'responder_dm',
        arguments: { conversacionId: thread.id, mensaje: 'hola' },
      }),
    );

    expect(texto).toContain('No se envió');
    expect(texto).toContain('24 h');
  });

  it('envía cuando la ventana está abierta', async () => {
    const [thread] = await db.select().from(conversations).where(eq(conversations.leadId, leadId));
    await db
      .update(conversations)
      .set({ lastInboundAt: new Date() })
      .where(eq(conversations.id, thread.id));

    const texto = textoDe(
      await client.callTool({
        name: 'responder_dm',
        arguments: { conversacionId: thread.id, mensaje: 'Gracias por escribir!' },
      }),
    );
    expect(texto).toMatch(/Guardado en el CRM|Mensaje enviado/);
  });
});

describe('referencias por MCP', () => {
  it('lista las etapas con sus ids, que es lo que pide mover_lead_de_etapa', async () => {
    const texto = textoDe(await client.callTool({ name: 'listar_etapas', arguments: {} }));
    expect(texto).toContain('Venta');
    expect(texto).toContain(stageVentaId);
  });

  it('lista equipo y productos con sus ids', async () => {
    const texto = textoDe(
      await client.callTool({ name: 'listar_equipo_y_productos', arguments: {} }),
    );
    expect(texto).toContain('Closer MCP');
    expect(texto).toContain('Mentoria MCP');
  });

  it('crea contenido desde el MCP', async () => {
    const texto = textoDe(
      await client.callTool({
        name: 'crear_contenido',
        arguments: { titulo: 'Episodio de podcast', tipo: 'external' },
      }),
    );
    expect(texto).toContain('Contenido creado');

    const rows = await db.select().from(contents).where(eq(contents.orgId, org.id));
    expect(rows.some((row) => row.title === 'Episodio de podcast')).toBe(true);
  });
});
