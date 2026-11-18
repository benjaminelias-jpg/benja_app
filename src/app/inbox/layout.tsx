import Link from 'next/link';
import { getCurrentOrg } from '@/server/context';
import { listConversations, countUnread } from '@/server/services/inbox';
import { getConnectedAccount } from '@/server/services/instagram-sync';
import { messagingWindow } from '@/server/integrations/instagram';
import { Avatar, Badge } from '@/components/ui';
import { ConversationRow } from '@/components/inbox/conversation-row';
import { SyncInboxButton } from '@/components/inbox/sync-button';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * La lista de conversaciones vive en el layout, no en la pagina: asi no se
 * recarga ni pierde el scroll al abrir un chat.
 */
export default async function InboxLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params?: Promise<Record<string, string>>;
}) {
  void params;
  const org = await getCurrentOrg();
  const [rows, unread, account] = await Promise.all([
    listConversations({ orgId: org.id, limit: 60 }),
    countUnread(org.id),
    getConnectedAccount(org.id),
  ]);

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-0px)] sm:-mx-6 lg:-mx-8">
      <aside className="flex w-full max-w-[340px] shrink-0 flex-col border-r border-[var(--border)] bg-surface">
        <header className="border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-ink">
              Bandeja
              {unread > 0 ? (
                <span
                  className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  style={{ background: 'var(--series-1)' }}
                >
                  {formatNumber(unread)}
                </span>
              ) : null}
            </h1>
            <SyncInboxButton />
          </div>
          <p className="mt-1 truncate text-[11px] text-muted">
            {account?.connected
              ? `@${account.username} · conectada`
              : 'Sin cuenta conectada — los envíos quedan registrados pero no salen'}
          </p>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-ink-2">Todavía no hay conversaciones</p>
              <p className="mt-1 text-xs text-muted">
                Llegan solas por el webhook de Instagram, o podés importarlas con el botón de
                sincronizar.
              </p>
            </div>
          ) : (
            <ul>
              {rows.map((row) => {
                const window = messagingWindow(row.conversation.lastInboundAt);
                return (
                  <ConversationRow
                    key={row.conversation.id}
                    id={row.conversation.id}
                    name={row.lead.fullName ?? `@${row.lead.igUsername ?? 'lead'}`}
                    username={row.lead.igUsername}
                    avatarUrl={row.lead.profilePicUrl}
                    preview={row.conversation.lastMessagePreview}
                    at={row.conversation.lastMessageAt}
                    unread={row.conversation.unreadCount}
                    stageName={row.stage?.name ?? null}
                    stageColor={row.stage?.color ?? null}
                    windowOpen={window.open}
                    status={row.conversation.status}
                  />
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-[var(--border)] px-4 py-2">
          <Link href="/leads" className="text-[11px] text-muted hover:text-ink">
            Ver todos los leads →
          </Link>
        </footer>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-plane">{children}</section>
    </div>
  );
}

export { Avatar, Badge };
