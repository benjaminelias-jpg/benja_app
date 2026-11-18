import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentOrg, getDefaultPipeline } from '@/server/context';
import { getConversation, listThreadMessages, markAsRead } from '@/server/services/inbox';
import { getConnectedAccount } from '@/server/services/instagram-sync';
import { messagingWindow, profileLink, directThreadLink } from '@/server/integrations/instagram';
import { Avatar, Badge } from '@/components/ui';
import { StageSelect } from '@/components/stage-select';
import { Composer } from '@/components/inbox/composer';
import { ThreadMessages } from '@/components/inbox/thread-messages';
import { formatMoney, formatNumber } from '@/lib/format';
import { setStatusAction, assignConversationAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const row = await getConversation(org.id, id);
  if (!row) notFound();

  // Abrir el hilo lo marca como leído: es lo que espera cualquiera que use una bandeja.
  if (row.conversation.unreadCount > 0) await markAsRead(id);

  const db = await getDb();
  const [thread, pipelineData, team, account] = await Promise.all([
    listThreadMessages(id),
    getDefaultPipeline(org.id),
    db.select().from(users).where(and(eq(users.orgId, org.id), eq(users.active, true))),
    getConnectedAccount(org.id),
  ]);

  const lead = row.lead;
  const displayName = lead.fullName ?? (lead.igUsername ? `@${lead.igUsername}` : 'Lead');
  const window = messagingWindow(row.conversation.lastInboundAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-surface px-5 py-3">
        <Avatar name={displayName} src={lead.profilePicUrl} size={38} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/leads/${lead.id}`} className="truncate text-sm font-semibold text-ink hover:underline">
              {displayName}
            </Link>
            {row.stage ? <Badge color={row.stage.color}>{row.stage.name}</Badge> : null}
            {lead.revenueCents > 0 ? (
              <span className="tabular text-xs font-medium" style={{ color: 'var(--good-text)' }}>
                {formatMoney(lead.revenueCents, org.currency, true)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            {lead.igUsername ? (
              <a
                href={profileLink(lead.igUsername)}
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink hover:underline"
              >
                @{lead.igUsername} ↗
              </a>
            ) : null}
            {lead.followersCount ? <span>· {formatNumber(lead.followersCount, true)} seguidores</span> : null}
            {row.content ? (
              <span className="truncate">
                · vino de{' '}
                <Link href={`/contenido/${row.content.id}`} className="hover:text-ink hover:underline">
                  {row.content.title}
                </Link>
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pipelineData ? (
            <StageSelect
              leadId={lead.id}
              stageId={lead.stageId}
              stages={pipelineData.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
            />
          ) : null}

          <form action={assignConversationAction}>
            <input type="hidden" name="conversationId" value={id} />
            <select
              name="userId"
              defaultValue={row.conversation.assignedTo ?? ''}
              aria-label="Asignar conversacion"
              className="rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink hairline"
              // Un select que se envía solo evita un botón extra por fila.
              // El form nativo funciona sin JavaScript.
            >
              <option value="">Sin asignar</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <button type="submit" className="ml-1 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2 hairline hover:text-ink">
              Asignar
            </button>
          </form>

          <form action={setStatusAction}>
            <input type="hidden" name="conversationId" value={id} />
            <input
              type="hidden"
              name="status"
              value={row.conversation.status === 'closed' ? 'open' : 'closed'}
            />
            <button
              type="submit"
              className="rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2 hairline hover:text-ink"
            >
              {row.conversation.status === 'closed' ? 'Reabrir' : 'Cerrar'}
            </button>
          </form>
        </div>
      </header>

      <ThreadMessages
        messages={thread.map((message) => ({
          id: message.id,
          direction: message.direction,
          body: message.body,
          sentAt: message.sentAt.toISOString(),
          status: message.status,
          error: message.error,
          automated: Boolean(message.automatedBy),
        }))}
      />

      <Composer
        conversationId={id}
        windowOpen={window.open}
        windowReason={window.reason}
        hasIgId={Boolean(lead.igUserId)}
        simulated={!account?.accessToken}
        igThreadId={row.conversation.igThreadId}
        profileUrl={lead.igUsername ? profileLink(lead.igUsername) : null}
        directUrl={row.conversation.igThreadId ? directThreadLink(row.conversation.igThreadId) : null}
      />
    </div>
  );
}
