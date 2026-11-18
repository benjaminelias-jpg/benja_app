'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { sendReplyAction, type ComposerState } from '@/app/inbox/actions';

const MAX_BYTES = 1000;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Caja de respuesta.
 *
 * Avisa ANTES de escribir si la ventana de 24 h está cerrada o si falta el id
 * de Instagram, en vez de dejar redactar un mensaje que la API va a rechazar.
 */
export function Composer({
  conversationId,
  windowOpen,
  windowReason,
  hasIgId,
  simulated,
  profileUrl,
  directUrl,
}: {
  conversationId: string;
  windowOpen: boolean;
  windowReason: string;
  hasIgId: boolean;
  simulated: boolean;
  igThreadId?: string | null;
  profileUrl: string | null;
  directUrl: string | null;
}) {
  const [state, action, pending] = useActionState<ComposerState, FormData>(sendReplyAction, {});
  const [text, setText] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const bytes = byteLength(text);
  const blocked = !windowOpen || !hasIgId;

  useEffect(() => {
    if (state.ok) setText('');
  }, [state.ok]);

  return (
    <div className="border-t border-[var(--border)] bg-surface px-5 py-3">
      <div className="mx-auto max-w-2xl">
        {blocked ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--surface-2)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--serious)" strokeWidth="2" className="mt-px shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span className="text-ink-2">
              {hasIgId ? windowReason : 'Este lead no tiene id de Instagram: no se le puede escribir por DM.'}
              {profileUrl ? (
                <>
                  {' '}
                  Podés escribirle{' '}
                  <a href={profileUrl} target="_blank" rel="noreferrer" className="underline">
                    desde su perfil
                  </a>
                  .
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        {state.error ? (
          <p className="mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--critical)' }}>
            {state.error}
          </p>
        ) : null}

        {state.ok && state.dryRun ? (
          <p className="mb-2 text-[11px] text-muted">
            Guardado en el CRM. No salió a Instagram porque no hay token configurado.
          </p>
        ) : null}

        <form ref={formRef} action={action} className="flex items-end gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <textarea
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter envía, Shift+Enter hace salto de línea.
              if (event.key === 'Enter' && !event.shiftKey && !blocked && text.trim()) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            rows={2}
            disabled={blocked || pending}
            placeholder={blocked ? 'No se puede responder por DM ahora' : 'Escribí tu respuesta…'}
            aria-label="Mensaje"
            className="scroll-thin min-h-[46px] flex-1 resize-y rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink hairline placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={blocked || pending || !text.trim() || bytes > MAX_BYTES}
            className="h-[46px] shrink-0 rounded-xl px-4 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--series-1)' }}
          >
            {pending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>

        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted">
          <span>
            {windowOpen ? windowReason : ''}
            {simulated ? ' · modo simulado' : ''}
          </span>
          <span className="flex items-center gap-2">
            <span className={bytes > MAX_BYTES ? 'font-semibold' : ''} style={bytes > MAX_BYTES ? { color: 'var(--critical)' } : undefined}>
              {bytes}/{MAX_BYTES} bytes
            </span>
            {directUrl ? (
              <a
                href={directUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink hover:underline"
                title="Atajo no oficial: Meta no documenta una URL para abrir un hilo concreto, puede dejar de funcionar"
              >
                Abrir en Instagram ↗
              </a>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
