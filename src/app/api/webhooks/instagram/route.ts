import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { verifyMetaSignature } from '@/lib/crypto';
import { getCurrentOrg } from '@/server/context';
import { ingestInteraction } from '@/server/services/ingest';
import { completeDelivery, headersToObject, logDelivery } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de Instagram (Meta).
 *
 * GET  -> handshake de verificacion que Meta hace al registrar la URL.
 * POST -> entregas: comentarios, DMs, respuestas a stories y menciones.
 *
 * Ruta a registrar en la app de Meta:  https://<tu-dominio>/api/webhooks/instagram
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === env.metaVerifyToken) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('Token de verificacion invalido', { status: 403 });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  // El cuerpo crudo es imprescindible: la firma de Meta se calcula sobre el
  // texto exacto, no sobre el JSON reserializado.
  const rawBody = await request.text();
  const headers = headersToObject(request.headers);

  if (env.metaAppSecret) {
    const valid = verifyMetaSignature(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      env.metaAppSecret,
    );
    if (!valid) {
      return NextResponse.json({ error: 'Firma invalida' }, { status: 401 });
    }
  }

  let payload: InstagramWebhookBody;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookBody;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const delivery = await logDelivery({ provider: 'instagram', headers, payload });

  try {
    const org = await getCurrentOrg();
    const results: Array<{ leadId: string; type: string }> = [];

    for (const entry of payload.entry ?? []) {
      // --- Comentarios y menciones -----------------------------------
      for (const change of entry.changes ?? []) {
        if (change.field === 'comments') {
          const value = change.value ?? {};
          if (!value.from?.id) continue;
          const result = await ingestInteraction({
            orgId: org.id,
            source: 'ig_comment',
            text: value.text ?? null,
            igUserId: value.from.id,
            igUsername: value.from.username ?? null,
            igMediaId: value.media?.id ?? null,
            commentId: value.id ?? null,
            messageExternalId: value.id ?? null,
            occurredAt: entry.time ? new Date(entry.time * 1000) : undefined,
          });
          results.push({ leadId: result.lead.id, type: 'comment' });
        }

        if (change.field === 'mentions') {
          const value = change.value ?? {};
          if (!value.from?.id) continue;
          const result = await ingestInteraction({
            orgId: org.id,
            source: 'ig_mention',
            text: value.text ?? null,
            igUserId: value.from.id,
            igUsername: value.from.username ?? null,
            igMediaId: value.media_id ?? value.media?.id ?? null,
            messageExternalId: value.comment_id ?? value.id ?? null,
          });
          results.push({ leadId: result.lead.id, type: 'mention' });
        }
      }

      // --- Mensajes directos, stories y ecos -------------------------
      for (const messaging of entry.messaging ?? []) {
        const senderId = messaging.sender?.id;
        if (!senderId) continue;

        // Un eco es un DM que mandamos nosotros, posiblemente desde el celular.
        // No genera lead, pero SI tiene que aparecer en la bandeja: si no, el
        // CRM muestra media conversacion y el equipo responde dos veces.
        if (messaging.message?.is_echo || senderId === entry.id) {
          const recipientId = messaging.recipient?.id;
          if (recipientId && messaging.message?.text) {
            const mirrored = await mirrorOutboundEcho({
              orgId: org.id,
              igUserId: recipientId,
              text: messaging.message.text,
              mid: messaging.message.mid ?? null,
              at: messaging.timestamp ? new Date(messaging.timestamp) : new Date(),
            });
            if (mirrored) results.push({ leadId: mirrored, type: 'echo' });
          }
          continue;
        }

        // Acuse de lectura: no es un mensaje, no debe crear eventos.
        if (messaging.read) continue;

        // Reaccion a un mensaje: se registra como evento, sin texto.
        if (messaging.reaction) {
          results.push({ leadId: '', type: 'reaction' });
          continue;
        }

        const storyId = messaging.message?.reply_to?.story?.id;
        const attachments = messaging.message?.attachments ?? [];
        const text =
          messaging.message?.text ??
          (attachments.length > 0 ? `(${attachments[0]?.type ?? 'adjunto'})` : null);

        const result = await ingestInteraction({
          orgId: org.id,
          source: storyId ? 'ig_story_reply' : 'ig_dm',
          text,
          igUserId: senderId,
          igMediaId: storyId ?? null,
          messageExternalId: messaging.message?.mid ?? null,
          replyToMid: messaging.message?.reply_to?.mid ?? null,
          occurredAt: messaging.timestamp ? new Date(messaging.timestamp) : undefined,
        });
        results.push({ leadId: result.lead.id, type: storyId ? 'story_reply' : 'dm' });
      }
    }

    await completeDelivery(delivery.id, {
      status: results.length > 0 ? 'processed' : 'ignored',
      leadId: results[0]?.leadId ?? null,
      durationMs: Date.now() - startedAt,
    });

    // Meta reintenta si no respondemos 200 rapido: siempre confirmamos recepcion.
    return NextResponse.json({ received: true, processed: results.length });
  } catch (error) {
    await completeDelivery(delivery.id, {
      status: 'failed',
      error: (error as Error).message,
      durationMs: Date.now() - startedAt,
    });
    console.error('[webhook:instagram]', error);
    return NextResponse.json({ received: true, error: 'procesamiento fallido' }, { status: 200 });
  }
}

/* ------------------------------------------------------------------ *
 * Forma del payload de Meta (subconjunto que usamos)
 * ------------------------------------------------------------------ */

/**
 * Refleja en la bandeja un DM que la cuenta envio por fuera del CRM.
 * Solo actualiza si el lead ya existe: un eco no es motivo para crear uno.
 */
async function mirrorOutboundEcho(params: {
  orgId: string;
  igUserId: string;
  text: string;
  mid: string | null;
  at: Date;
}): Promise<string | null> {
  const { getDb } = await import('@/db/client');
  const { leads, messages } = await import('@/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const { attachMessageToConversation } = await import('@/server/services/inbox');

  const db = await getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, params.orgId), eq(leads.igUserId, params.igUserId)))
    .limit(1);
  if (!lead) return null;

  const conversationId = await attachMessageToConversation({
    orgId: params.orgId,
    leadId: lead.id,
    direction: 'outbound',
    preview: params.text,
    occurredAt: params.at,
  });

  await db
    .insert(messages)
    .values({
      orgId: params.orgId,
      leadId: lead.id,
      conversationId,
      direction: 'outbound',
      channel: 'ig_dm',
      body: params.text,
      externalId: params.mid,
      sentAt: params.at,
      status: 'sent',
    })
    .onConflictDoNothing();

  return lead.id;
}

interface InstagramWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        id?: string;
        comment_id?: string;
        text?: string;
        media_id?: string;
        from?: { id?: string; username?: string };
        media?: { id?: string; media_product_type?: string };
      };
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{ type?: string; payload?: { url?: string } }>;
        reply_to?: { mid?: string; story?: { id?: string; url?: string } };
      };
      read?: { mid?: string };
      reaction?: { mid?: string; action?: string; reaction?: string; emoji?: string };
    }>;
  }>;
}
