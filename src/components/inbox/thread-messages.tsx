'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { formatDateTime } from '@/lib/format';

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  sentAt: string;
  status: string;
  error: string | null;
  automated: boolean;
}

/** Hilo de mensajes. Arranca abajo, como cualquier chat. */
export function ThreadMessages({ messages }: { messages: ThreadMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-muted">
          Todavía no hay mensajes en este hilo. Si la conversación existe en Instagram, usá
          “Sincronizar” para traerla.
        </p>
      </div>
    );
  }

  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
      <ol className="mx-auto flex max-w-2xl flex-col gap-2">
        {messages.map((message) => {
          const outbound = message.direction === 'outbound';
          const failed = message.status === 'failed';
          return (
            <li
              key={message.id}
              className={clsx(
                'max-w-[78%] rounded-2xl px-3.5 py-2',
                outbound ? 'ml-auto rounded-br-sm text-white' : 'rounded-bl-sm bg-surface hairline',
              )}
              style={outbound ? { background: failed ? 'var(--critical)' : 'var(--series-1)' } : undefined}
            >
              <p className="text-sm whitespace-pre-line">{message.body ?? '(adjunto)'}</p>
              <p
                className={clsx(
                  'mt-1 flex items-center gap-1.5 text-[10px]',
                  outbound ? 'text-white/75' : 'text-muted',
                )}
              >
                {formatDateTime(message.sentAt)}
                {message.automated ? ' · automático' : ''}
                {failed ? ` · no se envió: ${message.error ?? 'error'}` : ''}
              </p>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
