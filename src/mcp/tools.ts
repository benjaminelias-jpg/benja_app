import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contents, products, users, keywords as keywordsTable, type Organization } from '@/db/schema';
import { getDefaultPipeline } from '@/server/context';
import { listLeads, getLead, moveLeadToStage, addTags } from '@/server/services/leads';
import { getLeadTimeline } from '@/server/services/events';
import { recordSale, bookMeeting, listUpcomingMeetings } from '@/server/services/commerce';
import {
  getContentPerformance,
  getKpis,
  getFunnel,
  getKeywordPerformance,
  getCloserPerformance,
  getStaleLeads,
  getSilentContent,
  defaultRange,
} from '@/server/services/analytics';
import {
  listConversations,
  getConversation,
  listThreadMessages,
  sendReply,
} from '@/server/services/inbox';
import { listAutomations, simulateAutomation } from '@/server/services/automations';
import { messagingWindow } from '@/server/integrations/instagram';
import { slugify } from '@/lib/ids';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';

/**
 * Servidor MCP del CRM.
 *
 * Expone el CRM como herramientas para que un Claude conectado pueda leerlo y
 * operarlo: "¿qué reel generó más ventas este mes?", "pasame los leads
 * estancados", "respondele a este lead", "registrá la venta de Camila".
 *
 * Todas las herramientas quedan acotadas a UNA organizacion, la del token con
 * el que se conecto: una clave no puede leer datos de otra cuenta.
 */

export const MCP_SERVER_NAME = 'hook-crm';
export const MCP_SERVER_VERSION = '1.0.0';

/** Texto de respuesta de una herramienta. */
function texto(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function fecha(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

function rangoDesdeDias(dias?: number) {
  return defaultRange(dias && dias > 0 ? dias : 30);
}

export function buildMcpServer(org: Organization): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: [
        `Estás conectado al CRM de Instagram de "${org.name}".`,
        'Lo que distingue a este CRM: cada lead, reunión y venta queda atribuida',
        'a la pieza de contenido que trajo al lead. Para preguntas de tipo',
        '"¿qué contenido funciona?" usá `reporte_de_atribucion`, que ya resuelve',
        'la atribución; no intentes deducirla cruzando leads a mano.',
        `La moneda de la cuenta es ${org.currency}. Los importes se manejan en centavos.`,
      ].join(' '),
    },
  );

  /* ---------------------------------------------------------------- *
   * Analítica
   * ---------------------------------------------------------------- */

  server.registerTool(
    'reporte_de_atribucion',
    {
      title: 'Reporte de atribución por contenido',
      description:
        'La pregunta central del CRM: qué pieza de contenido generó cada lead, reunión y venta. ' +
        'Devuelve por contenido las views, leads, leads por 1.000 views, reuniones, ventas e ingresos. ' +
        'Usala siempre que pregunten qué contenido funciona, qué reel vende o de dónde viene la facturación.',
      inputSchema: {
        dias: z.number().int().positive().max(365).optional().describe('Ventana en días (30 por defecto)'),
        limite: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ dias, limite }) => {
      const range = rangoDesdeDias(dias);
      const rows = await getContentPerformance(org.id, range, { includeUnattributed: true });
      const top = rows.slice(0, limite ?? 15);

      if (top.length === 0) return texto('No hay contenido con datos en ese período.');

      const lineas = top.map((row) => {
        const partes = [
          `• ${row.title}${row.contentId ? '' : ' (leads sin contenido de origen)'}`,
          `  tipo=${row.type} views=${formatNumber(row.views, true)} leads=${row.leads}`,
          `  reus=${row.meetingsBooked} ventas=${row.sales} ingresos=${formatMoney(row.revenueCents, org.currency)}`,
          `  leads/1k views=${row.leadsPer1kViews.toFixed(2)} lead→venta=${formatPercent(row.leadToSale, 1)}`,
          row.hook ? `  gancho: "${row.hook}"` : null,
          row.contentId ? `  id=${row.contentId}` : null,
        ].filter(Boolean);
        return partes.join('\n');
      });

      return texto(
        [
          `Atribución de los últimos ${dias ?? 30} días — ${org.name}`,
          `(las tasas se calculan sobre la cohorte de leads que entró en el período)`,
          '',
          ...lineas,
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'resumen_del_negocio',
    {
      title: 'Resumen y embudo',
      description:
        'KPIs del período (leads, conversaciones, reuniones, ventas, ingresos) y el embudo completo ' +
        'con la conversión de cada paso. Para "cómo venimos", "cómo cerró el mes" o "cuál es mi embudo".',
      inputSchema: { dias: z.number().int().positive().max(365).optional() },
    },
    async ({ dias }) => {
      const range = rangoDesdeDias(dias);
      const [kpis, funnel] = await Promise.all([
        getKpis(org.id, range),
        getFunnel(org.id, range),
      ]);

      const pasos = funnel.map(
        (step) =>
          `  ${step.label.padEnd(24)} ${String(step.count).padStart(5)}  ` +
          `${formatPercent(step.stepRate, 0)} del paso previo · ${formatPercent(step.totalRate, 0)} del total`,
      );

      return texto(
        [
          `Resumen de ${org.name} — últimos ${dias ?? 30} días`,
          '',
          `Leads: ${kpis.leads}   Conversaciones: ${kpis.engagedLeads}`,
          `Reuniones agendadas: ${kpis.meetingsBooked}   realizadas: ${kpis.meetingsHeld}   no-show: ${kpis.noShows}`,
          `Ventas: ${kpis.sales}   Ingresos: ${formatMoney(kpis.revenueCents, org.currency)}`,
          kpis.adSpendCents > 0
            ? `Inversión en pauta registrada: ${formatMoney(kpis.adSpendCents, org.currency)}`
            : '',
          '',
          'Embudo:',
          ...pasos,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'rendimiento_por_palabra_clave',
    {
      title: 'Rendimiento por palabra clave',
      description:
        'Qué automatización de "comentá X y te mando Y" trae más leads y más dinero.',
      inputSchema: { dias: z.number().int().positive().max(365).optional() },
    },
    async ({ dias }) => {
      const rows = await getKeywordPerformance(org.id, rangoDesdeDias(dias ?? 90));
      if (rows.length === 0) return texto('No hay palabras clave configuradas.');
      return texto(
        rows
          .map(
            (row) =>
              `• ${row.word} (${row.channel}) → ${row.contentTitle ?? 'sin contenido'}\n` +
              `  disparos=${row.triggers} leads=${row.leads} ventas=${row.sales} ingresos=${formatMoney(row.revenueCents, org.currency)}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'rendimiento_del_equipo',
    {
      title: 'Rendimiento por closer',
      description: 'Reuniones realizadas, ventas, ingresos y tasa de cierre de cada persona del equipo.',
      inputSchema: { dias: z.number().int().positive().max(365).optional() },
    },
    async ({ dias }) => {
      const rows = await getCloserPerformance(org.id, rangoDesdeDias(dias));
      if (rows.length === 0) return texto('No hay datos del equipo en ese período.');
      return texto(
        rows
          .map(
            (row) =>
              `• ${row.name}: ${row.meetingsHeld} reus realizadas, ${row.sales} ventas, ` +
              `${formatMoney(row.revenueCents, org.currency)}, cierre ${formatPercent(row.closeRate, 0)}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'detectar_problemas',
    {
      title: 'Leads estancados y contenido mudo',
      description:
        'Dos fugas típicas: leads sin movimiento más tiempo del permitido en su etapa, y contenido ' +
        'con muchas views que no generó un solo lead.',
      inputSchema: {},
    },
    async () => {
      const [stale, silent] = await Promise.all([
        getStaleLeads(org.id, 15),
        getSilentContent(org.id, 8),
      ]);

      const bloques: string[] = [];

      bloques.push(
        stale.length === 0
          ? 'Leads estancados: ninguno.'
          : `Leads estancados (${stale.length}):\n` +
              stale
                .map(
                  (row) =>
                    `  • ${row.lead.fullName ?? '@' + row.lead.igUsername} — ${row.stage.name}, ` +
                    `sin moverse desde ${fecha(row.lead.stageChangedAt)} (id=${row.lead.id})`,
                )
                .join('\n'),
      );

      bloques.push(
        silent.length === 0
          ? 'Contenido mudo: ninguno, todo generó leads.'
          : `Contenido con views y cero leads (${silent.length}):\n` +
              silent
                .map((row) => `  • ${row.title} — ${formatNumber(row.views, true)} views (id=${row.id})`)
                .join('\n'),
      );

      return texto(bloques.join('\n\n'));
    },
  );

  /* ---------------------------------------------------------------- *
   * Leads
   * ---------------------------------------------------------------- */

  server.registerTool(
    'buscar_leads',
    {
      title: 'Buscar leads',
      description:
        'Busca leads por nombre, usuario de Instagram o email, con filtros por etapa, origen y contenido de origen.',
      inputSchema: {
        texto: z.string().optional().describe('Nombre, @usuario o email'),
        etapa: z.string().optional().describe('Id de la etapa'),
        contenidoId: z.string().optional().describe('Solo leads que vinieron de este contenido'),
        limite: z.number().int().positive().max(100).optional(),
      },
    },
    async (args) => {
      const { rows, total } = await listLeads({
        orgId: org.id,
        search: args.texto,
        stageId: args.etapa,
        contentId: args.contenidoId,
        limit: args.limite ?? 25,
      });

      if (rows.length === 0) return texto('Ningún lead coincide con esa búsqueda.');

      return texto(
        [
          `${rows.length} de ${total} leads:`,
          ...rows.map(
            (row) =>
              `• ${row.lead.fullName ?? '@' + row.lead.igUsername} (@${row.lead.igUsername ?? '—'}) ` +
              `— ${row.stage?.name ?? 'sin etapa'}, vino de "${row.content?.title ?? 'sin atribuir'}"` +
              (row.lead.revenueCents > 0 ? `, ${formatMoney(row.lead.revenueCents, org.currency)}` : '') +
              `\n  id=${row.lead.id}`,
          ),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'ver_lead',
    {
      title: 'Ficha de un lead',
      description: 'Todo sobre un lead: datos, etapa, contenido de origen y su historial completo.',
      inputSchema: { leadId: z.string() },
    },
    async ({ leadId }) => {
      const row = await getLead(org.id, leadId);
      if (!row) return texto(`No existe el lead ${leadId}.`);

      const timeline = await getLeadTimeline(leadId, 30);

      return texto(
        [
          `${row.lead.fullName ?? '@' + row.lead.igUsername}`,
          `@${row.lead.igUsername ?? '—'} · ${row.lead.email ?? 'sin email'} · ${row.lead.country ?? '—'}`,
          `Etapa: ${row.stage?.name ?? '—'} · Responsable: ${row.owner?.name ?? 'sin asignar'}`,
          `Origen: ${row.lead.source} · Vino de: ${row.content?.title ?? 'sin atribuir'}`,
          `Ingresos: ${formatMoney(row.lead.revenueCents, org.currency)}`,
          row.lead.tags.length > 0 ? `Etiquetas: ${row.lead.tags.join(', ')}` : '',
          Object.keys(row.lead.customFields ?? {}).length > 0
            ? `Campos: ${JSON.stringify(row.lead.customFields)}`
            : '',
          row.lead.notes ? `Notas: ${row.lead.notes}` : '',
          '',
          'Historial:',
          ...timeline.map(
            (entry) =>
              `  ${fecha(entry.event.occurredAt)}  ${entry.event.type}` +
              (entry.content ? ` · ${entry.content.title}` : '') +
              (entry.event.valueCents !== 0
                ? ` · ${formatMoney(entry.event.valueCents, org.currency)}`
                : ''),
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'mover_lead_de_etapa',
    {
      title: 'Mover un lead de etapa',
      description:
        'Cambia la etapa de un lead en el pipeline. Usá `listar_etapas` antes para saber los ids disponibles.',
      inputSchema: { leadId: z.string(), etapaId: z.string() },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ leadId, etapaId }) => {
      const row = await getLead(org.id, leadId);
      if (!row) return texto(`No existe el lead ${leadId}.`);
      const updated = await moveLeadToStage({ leadId, stageId: etapaId, source: 'mcp' });
      const after = await getLead(org.id, updated.id);
      return texto(`Listo: ${row.lead.fullName ?? leadId} quedó en "${after?.stage?.name ?? etapaId}".`);
    },
  );

  server.registerTool(
    'etiquetar_lead',
    {
      title: 'Etiquetar un lead',
      description: 'Agrega etiquetas a un lead.',
      inputSchema: { leadId: z.string(), etiquetas: z.array(z.string()).min(1) },
    },
    async ({ leadId, etiquetas }) => {
      // addTags busca el lead solo por id, sin mirar la organizacion, y
      // devuelve void: no distingue "etiquete" de "no habia lead". Sin este
      // guard la herramienta contestaba "Etiquetas agregadas" siempre, incluso
      // etiquetando leads de otra cuenta. Sus vecinas ya validaban asi.
      const row = await getLead(org.id, leadId);
      if (!row) return texto(`No existe el lead ${leadId}.`);
      await addTags(leadId, etiquetas);
      return texto(`Etiquetas agregadas a ${row.lead.fullName ?? leadId}: ${etiquetas.join(', ')}.`);
    },
  );

  server.registerTool(
    'listar_etapas',
    {
      title: 'Etapas del pipeline',
      description: 'Las etapas del pipeline con sus ids, para poder mover leads.',
      inputSchema: {},
    },
    async () => {
      const data = await getDefaultPipeline(org.id);
      if (!data) return texto('No hay pipeline configurado.');
      return texto(
        [
          `Pipeline "${data.pipeline.name}":`,
          ...data.stages.map((stage) => `  ${stage.position}. ${stage.name} (tipo=${stage.kind}, id=${stage.id})`),
        ].join('\n'),
      );
    },
  );

  /* ---------------------------------------------------------------- *
   * Comercial
   * ---------------------------------------------------------------- */

  server.registerTool(
    'registrar_venta',
    {
      title: 'Registrar una venta',
      description:
        'Cierra una venta para un lead. El CRM la acredita automáticamente al contenido que trajo a ese lead, ' +
        'así que no hace falta indicarlo.',
      inputSchema: {
        leadId: z.string(),
        importe: z.number().positive().describe(`Importe en ${org.currency} (no en centavos)`),
        productoId: z.string().optional(),
        closerId: z.string().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async ({ leadId, importe, productoId, closerId }) => {
      const row = await getLead(org.id, leadId);
      if (!row) return texto(`No existe el lead ${leadId}.`);

      const deal = await recordSale({
        orgId: org.id,
        leadId,
        amountCents: Math.round(importe * 100),
        productId: productoId ?? null,
        ownerId: closerId ?? null,
        source: 'mcp',
      });

      const db = await getDb();
      const [content] = deal.contentId
        ? await db.select({ title: contents.title }).from(contents).where(eq(contents.id, deal.contentId)).limit(1)
        : [];

      return texto(
        `Venta registrada: ${formatMoney(deal.amountCents, deal.currency)} para ` +
          `${row.lead.fullName ?? leadId}. Acreditada a "${content?.title ?? 'sin contenido atribuido'}".`,
      );
    },
  );

  server.registerTool(
    'agendar_reunion',
    {
      title: 'Agendar una reunión',
      description: 'Crea una reunión para un lead, atribuida al contenido que lo trajo.',
      inputSchema: {
        leadId: z.string(),
        cuando: z.string().describe('Fecha y hora en ISO 8601, ej: 2026-03-01T15:00:00Z'),
        titulo: z.string().optional(),
        closerId: z.string().optional(),
      },
    },
    async ({ leadId, cuando, titulo, closerId }) => {
      const scheduledAt = new Date(cuando);
      if (Number.isNaN(scheduledAt.getTime())) {
        return texto(`"${cuando}" no es una fecha válida. Usá formato ISO 8601.`);
      }
      // bookMeeting no filtra por organizacion: con el id de otra cuenta
      // insertaba la cita igual, con nuestro orgId encima de su lead.
      const row = await getLead(org.id, leadId);
      if (!row) return texto(`No existe el lead ${leadId}.`);
      const appointment = await bookMeeting({
        orgId: org.id,
        leadId,
        scheduledAt,
        title: titulo,
        ownerId: closerId ?? null,
        source: 'mcp',
      });
      return texto(`Reunión agendada para ${fecha(appointment.scheduledAt)} (id=${appointment.id}).`);
    },
  );

  server.registerTool(
    'proximas_reuniones',
    {
      title: 'Próximas reuniones',
      description: 'Las reuniones agendadas que todavía no ocurrieron.',
      inputSchema: { limite: z.number().int().positive().max(50).optional() },
    },
    async ({ limite }) => {
      const rows = await listUpcomingMeetings(org.id, limite ?? 10);
      if (rows.length === 0) return texto('No hay reuniones agendadas.');
      return texto(
        rows
          .map(
            (row) =>
              `• ${fecha(row.appointment.scheduledAt)} — ${row.lead.fullName ?? '@' + row.lead.igUsername}` +
              (row.owner?.name ? ` con ${row.owner.name}` : '') +
              (row.content?.title ? `\n  vino de: ${row.content.title}` : ''),
          )
          .join('\n'),
      );
    },
  );

  /* ---------------------------------------------------------------- *
   * Contenido
   * ---------------------------------------------------------------- */

  server.registerTool(
    'listar_contenido',
    {
      title: 'Catálogo de contenido',
      description: 'Las piezas de contenido registradas, con sus ids para usar en otras herramientas.',
      inputSchema: { limite: z.number().int().positive().max(100).optional() },
    },
    async ({ limite }) => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(contents)
        .where(and(eq(contents.orgId, org.id), eq(contents.archived, false)))
        .orderBy(desc(contents.publishedAt))
        .limit(limite ?? 30);

      if (rows.length === 0) return texto('No hay contenido registrado.');
      return texto(
        rows
          .map(
            (row) =>
              `• [${row.type}] ${row.title} — ${formatNumber(row.views, true)} views, publicado ${fecha(row.publishedAt)}\n` +
              `  id=${row.id}${row.refCode ? ` ref=${row.refCode}` : ''}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'crear_contenido',
    {
      title: 'Registrar contenido',
      description:
        'Da de alta una pieza de contenido. Sirve para lo que no está en Instagram: un podcast, ' +
        'una newsletter, una colaboración.',
      inputSchema: {
        titulo: z.string().min(1),
        tipo: z.enum(['reel', 'post', 'carousel', 'story', 'live', 'ad', 'external']).optional(),
        gancho: z.string().optional(),
        angulo: z.string().optional(),
        link: z.string().optional(),
        views: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => {
      const db = await getDb();
      const [created] = await db
        .insert(contents)
        .values({
          orgId: org.id,
          title: args.titulo,
          type: args.tipo ?? 'reel',
          hook: args.gancho ?? null,
          angle: args.angulo ?? null,
          permalink: args.link ?? null,
          views: args.views ?? 0,
          refCode: slugify(args.titulo),
          publishedAt: new Date(),
        })
        .returning();
      return texto(`Contenido creado: "${created.title}" (id=${created.id}).`);
    },
  );

  /* ---------------------------------------------------------------- *
   * Bandeja
   * ---------------------------------------------------------------- */

  server.registerTool(
    'listar_conversaciones',
    {
      title: 'Conversaciones de Instagram',
      description:
        'Los chats de la bandeja, ordenados por actividad. Marca cuáles están dentro de la ventana ' +
        'de 24 h de Instagram, que es el único momento en que se puede responder.',
      inputSchema: {
        soloSinLeer: z.boolean().optional(),
        limite: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ soloSinLeer, limite }) => {
      const rows = await listConversations({
        orgId: org.id,
        onlyUnread: soloSinLeer,
        limit: limite ?? 20,
      });
      if (rows.length === 0) return texto('No hay conversaciones.');

      return texto(
        rows
          .map((row) => {
            const window = messagingWindow(row.conversation.lastInboundAt);
            return (
              `• ${row.lead.fullName ?? '@' + row.lead.igUsername}` +
              (row.conversation.unreadCount > 0 ? ` (${row.conversation.unreadCount} sin leer)` : '') +
              `\n  "${row.conversation.lastMessagePreview ?? ''}"` +
              `\n  ${window.open ? `ventana abierta, ${Math.floor(window.hoursLeft)} h` : 'ventana cerrada: no se puede responder'}` +
              ` · id=${row.conversation.id}`
            );
          })
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'leer_conversacion',
    {
      title: 'Leer un chat',
      description: 'Los mensajes de una conversación, del más viejo al más nuevo.',
      inputSchema: { conversacionId: z.string(), limite: z.number().int().positive().max(100).optional() },
    },
    async ({ conversacionId, limite }) => {
      const row = await getConversation(org.id, conversacionId);
      if (!row) return texto(`No existe la conversación ${conversacionId}.`);

      const thread = await listThreadMessages(conversacionId, limite ?? 40);
      const window = messagingWindow(row.conversation.lastInboundAt);

      return texto(
        [
          `Chat con ${row.lead.fullName ?? '@' + row.lead.igUsername} (lead id=${row.lead.id})`,
          `Etapa: ${row.stage?.name ?? '—'} · vino de: ${row.content?.title ?? 'sin atribuir'}`,
          window.open ? `Ventana abierta: ${window.reason}` : `ATENCIÓN: ${window.reason}`,
          '',
          ...thread.map(
            (message) =>
              `${message.direction === 'inbound' ? 'LEAD' : 'NOSOTROS'} ${fecha(message.sentAt)}: ` +
              `${message.body ?? '(adjunto)'}` +
              (message.status === 'failed' ? ' [NO SE ENVIÓ]' : ''),
          ),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'responder_dm',
    {
      title: 'Responder un DM',
      description:
        'Manda un mensaje directo por Instagram desde el CRM. Falla a propósito si la ventana de 24 h ' +
        'está cerrada o si el texto pasa los 1000 bytes que permite Meta.',
      inputSchema: { conversacionId: z.string(), mensaje: z.string().min(1) },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ conversacionId, mensaje }) => {
      const result = await sendReply({ orgId: org.id, conversationId: conversacionId, text: mensaje });
      if (!result.ok) return texto(`No se envió: ${result.error}`);
      return texto(
        result.dryRun
          ? 'Guardado en el CRM. No salió a Instagram porque la cuenta no tiene token configurado.'
          : 'Mensaje enviado.',
      );
    },
  );

  /* ---------------------------------------------------------------- *
   * Automatizaciones
   * ---------------------------------------------------------------- */

  server.registerTool(
    'listar_flujos',
    {
      title: 'Flujos de automatización',
      description: 'Los flujos configurados, con sus pasos y si están activos.',
      inputSchema: {},
    },
    async () => {
      const rows = await listAutomations(org.id);
      if (rows.length === 0) return texto('No hay flujos configurados.');
      return texto(
        rows
          .map(
            ({ automation, steps }) =>
              `• ${automation.name} [${automation.active ? 'activo' : 'pausado'}] — ` +
              `disparador=${automation.trigger}, ${steps.length} pasos, ${automation.runsCount} ejecuciones\n` +
              `  pasos: ${steps.map((step) => step.type).join(' → ')}\n` +
              `  id=${automation.id}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'probar_flujo',
    {
      title: 'Probar un flujo en seco',
      description:
        'Recorre un flujo sin mandar nada ni tocar ningún lead, y devuelve paso a paso qué haría ' +
        'y qué rama tomaría. Útil para revisar un flujo antes de activarlo.',
      inputSchema: {
        flujoId: z.string(),
        respuestaDePrueba: z.string().optional().describe('Qué respondería el lead, para probar las ramas'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ flujoId, respuestaDePrueba }) => {
      const { rows } = await listLeads({ orgId: org.id, limit: 1 });
      if (rows.length === 0) return texto('No hay ningún lead contra el cual simular.');

      const result = await simulateAutomation(flujoId, {
        orgId: org.id,
        lead: rows[0].lead,
        text: respuestaDePrueba ?? 'ya facturo unos 3k al mes',
        commentId: 'COMENTARIO_DE_PRUEBA',
        source: 'mcp-prueba',
      });

      return texto(
        [
          `Prueba en seco (nada se envió ni se modificó). Estado final: ${result.status}`,
          '',
          ...result.steps.map(
            (step, index) => `  ${index + 1}. ${step.type} → ${step.status}${step.detail ? `: ${step.detail}` : ''}`,
          ),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'listar_palabras_clave',
    {
      title: 'Palabras clave',
      description: 'Las palabras que disparan flujos, con el contenido y el recurso de cada una.',
      inputSchema: {},
    },
    async () => {
      const db = await getDb();
      const rows = await db
        .select({ keyword: keywordsTable, content: { title: contents.title } })
        .from(keywordsTable)
        .leftJoin(contents, eq(keywordsTable.contentId, contents.id))
        .where(eq(keywordsTable.orgId, org.id));

      if (rows.length === 0) return texto('No hay palabras clave configuradas.');
      return texto(
        rows
          .map(
            (row) =>
              `• ${row.keyword.word} (${row.keyword.channel}, ${row.keyword.matchType})` +
              ` → ${row.content?.title ?? 'sin contenido'}` +
              `\n  recurso: ${row.keyword.resourceName ?? '—'} · disparos: ${row.keyword.triggeredCount}` +
              ` · ${row.keyword.active ? 'activa' : 'pausada'} · id=${row.keyword.id}`,
          )
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'crear_palabra_clave',
    {
      title: 'Crear palabra clave',
      description:
        'Ata una palabra a un contenido y, opcionalmente, al flujo que debe dispararse. Sin palabra clave, ' +
        'los leads que lleguen por ese contenido entran sin atribución.',
      inputSchema: {
        palabra: z.string().min(1),
        contenidoId: z.string().optional(),
        flujoId: z.string().optional(),
        canal: z.enum(['ig_comment', 'ig_dm', 'ig_story']).optional(),
        recursoUrl: z.string().optional(),
      },
    },
    async (args) => {
      const db = await getDb();
      const [created] = await db
        .insert(keywordsTable)
        .values({
          orgId: org.id,
          word: args.palabra,
          contentId: args.contenidoId ?? null,
          automationId: args.flujoId ?? null,
          channel: args.canal ?? 'ig_comment',
          resourceUrl: args.recursoUrl ?? null,
          matchType: 'exact',
          active: true,
        })
        .returning();
      return texto(`Palabra clave "${created.word}" creada (id=${created.id}).`);
    },
  );

  /* ---------------------------------------------------------------- *
   * Referencias
   * ---------------------------------------------------------------- */

  server.registerTool(
    'listar_equipo_y_productos',
    {
      title: 'Equipo y productos',
      description: 'Ids del equipo y del catálogo de productos, para usar en registrar_venta y agendar_reunion.',
      inputSchema: {},
    },
    async () => {
      const db = await getDb();
      const [team, catalog] = await Promise.all([
        db.select().from(users).where(eq(users.orgId, org.id)),
        db.select().from(products).where(eq(products.orgId, org.id)),
      ]);

      return texto(
        [
          'Equipo:',
          ...team.map((member) => `  • ${member.name} (${member.role}) id=${member.id}`),
          '',
          'Productos:',
          ...catalog.map(
            (product) => `  • ${product.name} — ${formatMoney(product.priceCents, product.currency)} id=${product.id}`,
          ),
        ].join('\n'),
      );
    },
  );

  return server;
}
