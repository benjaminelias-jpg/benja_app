import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  leads,
  appointments,
  messages,
  type Content,
  type Keyword,
  type Lead,
  type LeadSource,
} from '@/db/schema';
import { recordEvent, registerTouch } from './events';
import { upsertLead } from './leads';
import { bookMeeting, recordSale, setMeetingOutcome } from './commerce';
import {
  resolveContent,
  findMatchingKeyword,
  incrementKeywordCounter,
  type ContentRef,
} from './attribution';
import { runAutomation } from './automations';

/**
 * Punto de entrada unico para cualquier interaccion entrante.
 *
 * Instagram, ManyChat, Make, un formulario o una llamada a la API publica
 * terminan todos aqui. Centralizarlo es lo que garantiza que ningun lead entre
 * al CRM sin pasar por la resolucion de contenido y de keyword: si la
 * atribucion se calculara en cada webhook por separado, tarde o temprano una
 * via quedaria sin ella y el reporte mentiria.
 */
export interface IngestInteractionInput {
  orgId: string;
  /** Como llego la interaccion. */
  source: LeadSource;
  /** Texto del comentario, DM o respuesta a story. */
  text?: string | null;

  // Identidad
  igUserId?: string | null;
  igUsername?: string | null;
  manychatSubscriberId?: string | null;
  externalId?: string | null;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  profilePicUrl?: string | null;
  followersCount?: number | null;

  // Atribucion
  contentId?: string | null;
  igMediaId?: string | null;
  refCode?: string | null;
  permalink?: string | null;

  /** Id del comentario en Instagram: habilita la respuesta privada. */
  commentId?: string | null;
  messageExternalId?: string | null;
  tags?: string[];
  customFields?: Record<string, unknown>;
  occurredAt?: Date;
  /** Si es false, no se ejecutan automatizaciones (util para importaciones). */
  runAutomations?: boolean;
}

export interface IngestResult {
  lead: Lead;
  leadCreated: boolean;
  content: Content | null;
  keyword: Keyword | null;
  automationRunId: string | null;
}

export async function ingestInteraction(input: IngestInteractionInput): Promise<IngestResult> {
  const db = await getDb();
  const occurredAt = input.occurredAt ?? new Date();

  // 1. De que contenido viene.
  const contentRef: ContentRef = {
    orgId: input.orgId,
    contentId: input.contentId,
    igMediaId: input.igMediaId,
    refCode: input.refCode,
    permalink: input.permalink,
  };
  let content = await resolveContent(contentRef);

  // 2. Que keyword disparo, si es que disparo alguna.
  const channel = sourceToChannel(input.source);

  // Solo filtramos por canal cuando la interaccion viene de Instagram y sabemos
  // de verdad si fue comentario, DM o story. ManyChat, Make o la API mandan todo
  // por el mismo tubo: filtrar ahi haria que una keyword de comentario nunca
  // coincidiera y el lead entraria sin contenido atribuido.
  const nativeChannels: LeadSource[] = ['ig_comment', 'ig_dm', 'ig_story_reply'];
  const keywordChannel = nativeChannels.includes(input.source) ? channel : undefined;

  const keyword = input.text
    ? await findMatchingKeyword({
        orgId: input.orgId,
        text: input.text,
        channel: keywordChannel,
        contentId: content?.id ?? null,
      })
    : null;

  // Si el payload no traia pista de contenido, la keyword lo resuelve:
  // "responde GUIA" solo existe en un reel concreto.
  if (!content && keyword?.contentId) {
    content = await resolveContent({ orgId: input.orgId, contentId: keyword.contentId });
  }

  // 3. Lead: se crea o se enriquece.
  const { lead, created } = await upsertLead({
    orgId: input.orgId,
    igUserId: input.igUserId,
    igUsername: input.igUsername,
    manychatSubscriberId: input.manychatSubscriberId,
    externalId: input.externalId,
    email: input.email,
    phone: input.phone,
    fullName: input.fullName,
    profilePicUrl: input.profilePicUrl,
    followersCount: input.followersCount,
    source: input.source,
    contentId: content?.id ?? null,
    keywordId: keyword?.id ?? null,
    tags: input.tags,
    customFields: input.customFields,
    occurredAt,
  });

  // 4. Punto de contacto (solo si el lead ya existia: al crearlo ya se registro).
  if (!created && content) {
    await registerTouch({
      orgId: input.orgId,
      leadId: lead.id,
      contentId: content.id,
      keywordId: keyword?.id ?? null,
      channel,
      occurredAt,
    });
  }

  // 5. El mensaje entrante queda guardado en la conversacion.
  if (input.text) {
    await db
      .insert(messages)
      .values({
        orgId: input.orgId,
        leadId: lead.id,
        contentId: content?.id ?? null,
        direction: 'inbound',
        channel,
        body: input.text,
        externalId: input.messageExternalId ?? null,
      })
      .onConflictDoNothing();

    await recordEvent({
      orgId: input.orgId,
      leadId: lead.id,
      contentId: content?.id ?? null,
      keywordId: keyword?.id ?? null,
      type: interactionEventType(input.source),
      channel,
      source: input.source,
      payload: { text: input.text, commentId: input.commentId },
      dedupeKey: input.messageExternalId ? `msg:${input.messageExternalId}` : null,
      occurredAt,
    });
  }

  // 6. Keyword disparada: queda el evento y se ejecuta la automatizacion.
  let automationRunId: string | null = null;
  if (keyword) {
    await incrementKeywordCounter(keyword.id);
    await recordEvent({
      orgId: input.orgId,
      leadId: lead.id,
      contentId: content?.id ?? null,
      keywordId: keyword.id,
      type: 'keyword_triggered',
      channel,
      source: input.source,
      payload: { word: keyword.word, resource: keyword.resourceName },
      occurredAt,
    });

    if (input.runAutomations !== false && keyword.automationId) {
      const run = await runAutomation(keyword.automationId, {
        orgId: input.orgId,
        lead,
        content,
        keyword,
        commentId: input.commentId ?? null,
        text: input.text ?? null,
        source: input.source,
      });
      automationRunId = run.runId || null;
    }
  }

  // El lead del paso 3 puede haber quedado desactualizado si la automatizacion
  // lo movio de etapa; devolvemos la version fresca.
  const [fresh] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);

  return {
    lead: fresh ?? lead,
    leadCreated: created,
    content,
    keyword,
    automationRunId,
  };
}

function sourceToChannel(source: LeadSource) {
  switch (source) {
    case 'ig_comment':
      return 'ig_comment' as const;
    case 'ig_story_reply':
      return 'ig_story' as const;
    case 'form':
    case 'ig_bio_link':
      return 'web' as const;
    case 'webhook':
    case 'import':
    case 'manual':
      return 'system' as const;
    default:
      return 'ig_dm' as const;
  }
}

function interactionEventType(source: LeadSource) {
  switch (source) {
    case 'ig_comment':
      return 'comment_received' as const;
    case 'ig_story_reply':
      return 'story_reply' as const;
    case 'ig_mention':
      return 'mention' as const;
    default:
      return 'dm_received' as const;
  }
}

/* ------------------------------------------------------------------ *
 * Conversiones entrantes
 * ------------------------------------------------------------------ */

export interface IngestConversionInput {
  orgId: string;
  /** Que conversion ocurrio. */
  kind: 'meeting' | 'meeting_held' | 'no_show' | 'sale' | 'refund';
  /** Identidad del lead: al menos uno de estos campos. */
  leadId?: string | null;
  igUserId?: string | null;
  igUsername?: string | null;
  manychatSubscriberId?: string | null;
  email?: string | null;
  fullName?: string | null;

  scheduledAt?: Date | null;
  amountCents?: number | null;
  currency?: string | null;
  productId?: string | null;
  ownerId?: string | null;
  externalId?: string | null;
  contentId?: string | null;
  igMediaId?: string | null;
  refCode?: string | null;
  source?: string;
  occurredAt?: Date;
}

/**
 * Registra una conversion que llega desde fuera (Calendly agenda una reu,
 * Hotmart confirma un pago, ManyChat marca una venta).
 *
 * Si el lead no existe se crea, porque es preferible un lead sin contenido
 * atribuido a perder la venta del reporte.
 */
export async function ingestConversion(input: IngestConversionInput) {
  const db = await getDb();

  let lead: Lead | undefined;
  if (input.leadId) {
    [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);
  }

  if (!lead) {
    const result = await upsertLead({
      orgId: input.orgId,
      igUserId: input.igUserId,
      igUsername: input.igUsername,
      manychatSubscriberId: input.manychatSubscriberId,
      email: input.email,
      fullName: input.fullName,
      source: 'webhook',
      occurredAt: input.occurredAt,
    });
    lead = result.lead;
  }

  const content = await resolveContent({
    orgId: input.orgId,
    contentId: input.contentId,
    igMediaId: input.igMediaId,
    refCode: input.refCode,
  });

  switch (input.kind) {
    case 'meeting': {
      const appointment = await bookMeeting({
        orgId: input.orgId,
        leadId: lead.id,
        scheduledAt: input.scheduledAt ?? new Date(Date.now() + 86_400_000),
        ownerId: input.ownerId ?? null,
        source: input.source ?? 'webhook',
        externalId: input.externalId ?? null,
        contentId: content?.id ?? null,
        occurredAt: input.occurredAt,
      });
      return { lead, appointment, deal: null };
    }

    case 'meeting_held':
    case 'no_show': {
      const appointment = await findAppointment(lead.id, input.externalId);
      if (appointment) {
        await setMeetingOutcome({
          appointmentId: appointment.id,
          status: input.kind === 'meeting_held' ? 'held' : 'no_show',
          occurredAt: input.occurredAt,
        });
      } else {
        await recordEvent({
          orgId: input.orgId,
          leadId: lead.id,
          contentId: content?.id ?? null,
          type: input.kind === 'meeting_held' ? 'meeting_held' : 'meeting_no_show',
          source: input.source ?? 'webhook',
          occurredAt: input.occurredAt,
        });
      }
      return { lead, appointment, deal: null };
    }

    case 'sale': {
      const deal = await recordSale({
        orgId: input.orgId,
        leadId: lead.id,
        amountCents: input.amountCents ?? 0,
        currency: input.currency ?? undefined,
        productId: input.productId ?? null,
        ownerId: input.ownerId ?? null,
        source: input.source ?? 'webhook',
        externalId: input.externalId ?? null,
        contentId: content?.id ?? null,
        closedAt: input.occurredAt,
      });
      return { lead, appointment: null, deal };
    }

    case 'refund': {
      await recordEvent({
        orgId: input.orgId,
        leadId: lead.id,
        contentId: content?.id ?? null,
        type: 'refund',
        valueCents: -(input.amountCents ?? 0),
        source: input.source ?? 'webhook',
        occurredAt: input.occurredAt,
        dedupeKey: input.externalId ? `refund:${input.externalId}` : null,
      });
      return { lead, appointment: null, deal: null };
    }
  }
}

async function findAppointment(leadId: string, externalId?: string | null) {
  const db = await getDb();
  if (externalId) {
    const [byExternal] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.leadId, leadId), eq(appointments.externalId, externalId)))
      .limit(1);
    if (byExternal) return byExternal;
  }
  const [latest] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.leadId, leadId))
    .orderBy(desc(appointments.scheduledAt))
    .limit(1);
  return latest;
}
