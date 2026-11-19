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
  mediaUrl?: string | null;
  mediaType?: string | null;
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
              {message.mediaUrl ? <Attachment url={message.mediaUrl} type={message.mediaType} /> : null}
              {message.body ? (
                <p className="text-sm whitespace-pre-line">{message.body}</p>
              ) : !message.mediaUrl ? (
                <p className="text-sm italic opacity-70">(adjunto)</p>
              ) : null}
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

/**
 * Un audio tiene que poder escucharse en el hilo.
 * Mostrar "(adjunto)" obliga a abrir Instagram para saber que se mando.
 */
function Attachment({ url, type }: { url: string; type?: string | null }) {
  if (type === 'audio') {
    return <audio controls src={url} className="mb-1 h-9 w-[240px] max-w-full" />;
  }

  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Imagen enviada" className="mb-1 max-h-64 rounded-lg" />
      </a>
    );
  }

  if (type === 'video') {
    return <video controls src={url} className="mb-1 max-h-64 rounded-lg" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-1.5 text-sm underline"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
      </svg>
      Ver archivo
    </a>
  );
}
