'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { Avatar } from '@/components/ui';
import { timeAgo } from '@/lib/format';

export function ConversationRow({
  id,
  name,
  username,
  avatarUrl,
  preview,
  at,
  unread,
  stageName,
  stageColor,
  windowOpen,
  status,
}: {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  preview: string | null;
  at: Date | string | null;
  unread: number;
  stageName: string | null;
  stageColor: string | null;
  windowOpen: boolean;
  status: string;
}) {
  const params = useParams<{ id?: string }>();
  const active = params?.id === id;

  return (
    <li>
      <Link
        href={`/inbox/${id}`}
        aria-current={active ? 'page' : undefined}
        className={clsx(
          'flex gap-2.5 border-b border-[var(--grid)] px-4 py-3 transition-colors',
          active ? 'bg-surface-2' : 'hover:bg-surface-2',
        )}
      >
        <Avatar name={name} src={avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={clsx(
                'truncate text-sm',
                unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-2',
              )}
            >
              {name}
            </span>
            <span className="shrink-0 text-[10px] text-muted">{timeAgo(at)}</span>
          </div>

          <p
            className={clsx(
              'mt-0.5 line-clamp-1 text-xs',
              unread > 0 ? 'text-ink-2' : 'text-muted',
            )}
          >
            {preview ?? (username ? `@${username}` : 'Sin mensajes')}
          </p>

          <div className="mt-1.5 flex items-center gap-1.5">
            {unread > 0 ? (
              <span
                className="rounded-full px-1.5 text-[10px] font-semibold text-white"
                style={{ background: 'var(--series-1)' }}
              >
                {unread}
              </span>
            ) : null}
            {stageName ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: stageColor ?? 'var(--muted)' }}
                  aria-hidden
                />
                {stageName}
              </span>
            ) : null}
            {status === 'closed' ? (
              <span className="text-[10px] text-muted">· cerrada</span>
            ) : !windowOpen ? (
              // Sin ventana no se puede responder: conviene verlo desde la lista.
              <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--serious)' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                24 h vencidas
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
