import { getCurrentOrg } from '@/server/context';
import { countUnread } from '@/server/services/inbox';
import { getConnectedAccount } from '@/server/services/instagram-sync';

export const dynamic = 'force-dynamic';

export default async function InboxEmptyPage() {
  const org = await getCurrentOrg();
  const [unread, account] = await Promise.all([countUnread(org.id), getConnectedAccount(org.id)]);

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--axis)"
          strokeWidth="1.5"
          className="mx-auto mb-4"
          aria-hidden
        >
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
        </svg>
        <h2 className="text-sm font-semibold text-ink">Elegí una conversación</h2>
        <p className="mt-1.5 text-xs text-ink-2">
          {unread > 0
            ? `Tenés ${unread} ${unread === 1 ? 'chat sin leer' : 'chats sin leer'} a la izquierda.`
            : 'Los chats de Instagram aparecen acá, con el contenido que trajo a cada lead.'}
        </p>
        {!account?.connected ? (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs text-ink-2" style={{ background: 'var(--surface-2)' }}>
            Conectá tu cuenta de Instagram desde <strong>Integraciones</strong> para recibir y
            responder DMs reales.
          </p>
        ) : null}
      </div>
    </div>
  );
}
