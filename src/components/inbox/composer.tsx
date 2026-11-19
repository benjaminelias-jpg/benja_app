'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { sendReplyAction, sendMediaAction, type ComposerState } from '@/app/inbox/actions';

const MAX_BYTES = 1000;

/** Los mismos limites que valida el servidor, para avisar antes de subir. */
const LIMITS: Record<string, { label: string; accept: string; maxMb: number }> = {
  audio: { label: 'audio', accept: '.aac,.m4a,.wav,.mp4,audio/*', maxMb: 25 },
  image: { label: 'imagen', accept: '.png,.jpg,.jpeg,image/png,image/jpeg', maxMb: 8 },
  video: { label: 'video', accept: '.mp4,.ogg,.avi,.mov,.webm,video/*', maxMb: 25 },
  file: { label: 'archivo', accept: '.pdf,application/pdf', maxMb: 25 },
};

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Caja de respuesta.
 *
 * Avisa ANTES de escribir si la ventana de 24 h está cerrada o si falta el id
 * de Instagram, en vez de dejar redactar un mensaje que la API va a rechazar.
 * Permite mandar notas de voz y archivos, como hace ManyChat.
 */
export function Composer({
  conversationId,
  windowOpen,
  windowReason,
  hasIgId,
  simulated,
  profileUrl,
  directUrl,
  uploadsEnabled,
}: {
  conversationId: string;
  windowOpen: boolean;
  windowReason: string;
  hasIgId: boolean;
  simulated: boolean;
  igThreadId?: string | null;
  profileUrl: string | null;
  directUrl: string | null;
  uploadsEnabled: boolean;
}) {
  const [state, action, pending] = useActionState<ComposerState, FormData>(sendReplyAction, {});
  const [mediaState, mediaAction, mediaPending] = useActionState<ComposerState, FormData>(
    sendMediaAction,
    {},
  );

  const [text, setText] = useState('');
  const [kind, setKind] = useState<keyof typeof LIMITS>('audio');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const mediaFormRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bytes = byteLength(text);
  const blocked = !windowOpen || !hasIgId;
  const busy = pending || mediaPending || uploading;
  const error = state.error ?? mediaState.error ?? uploadError;

  // La dependencia es el objeto entero, no `state.ok`.
  //
  // Entre dos envios exitosos seguidos `state.ok` va de true a true: la
  // dependencia no cambia, el efecto no vuelve a correr y el textarea queda
  // con el texto ya enviado. La persona cree que no salio y lo manda de nuevo,
  // y el lead recibe el mismo mensaje dos veces. La accion devuelve un objeto
  // nuevo en cada envio, asi que su identidad si cambia siempre.
  useEffect(() => {
    if (state.ok) setText('');
  }, [state]);

  useEffect(() => {
    if (mediaState.ok) {
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [mediaState]);

  async function upload(file: File) {
    const limit = LIMITS[kind];
    setUploadError(null);

    if (file.size > limit.maxMb * 1024 * 1024) {
      setUploadError(
        `Instagram limita ${limit.label} a ${limit.maxMb} MB y este pesa ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      );
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('type', kind);

      const response = await fetch('/api/uploads', { method: 'POST', body });
      const json = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !json.url) {
        setUploadError(json.error ?? 'No se pudo subir el archivo.');
        return;
      }
      setAttachment({ url: json.url, name: file.name });
    } catch (caught) {
      setUploadError((caught as Error).message);
    } finally {
      setUploading(false);
    }
  }

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

        {error ? (
          <p className="mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--critical)' }}>
            {error}
          </p>
        ) : null}

        {(state.ok && state.dryRun) || (mediaState.ok && mediaState.dryRun) ? (
          <p className="mb-2 text-[11px] text-muted">
            Guardado en el CRM. No salió a Instagram porque no hay token configurado.
          </p>
        ) : null}

        {/* Adjunto listo para enviar */}
        {attachment ? (
          <form ref={mediaFormRef} action={mediaAction} className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="url" value={attachment.url} />
            <input type="hidden" name="type" value={kind} />

            {kind === 'audio' ? (
              <audio controls src={attachment.url} className="h-8 max-w-[280px]" />
            ) : (
              <span className="truncate text-xs text-ink-2">{attachment.name}</span>
            )}

            <button
              type="submit"
              disabled={blocked || busy}
              className="ml-auto shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              style={{ background: 'var(--series-1)' }}
            >
              {mediaPending ? 'Enviando…' : `Enviar ${LIMITS[kind].label}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachment(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="shrink-0 text-[11px] text-muted hover:text-ink"
            >
              Quitar
            </button>
          </form>
        ) : null}

        <form ref={formRef} action={action} className="flex items-end gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />

          {/* Adjuntar */}
          <span className="flex shrink-0 items-center gap-1">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as keyof typeof LIMITS)}
              aria-label="Tipo de adjunto"
              disabled={blocked || busy}
              className="h-[46px] rounded-xl bg-surface-2 px-1.5 text-[11px] text-ink-2 hairline"
              title="Qué tipo de archivo vas a mandar"
            >
              <option value="audio">Audio</option>
              <option value="image">Imagen</option>
              <option value="video">Video</option>
              <option value="file">PDF</option>
            </select>

            <input
              ref={fileRef}
              type="file"
              accept={LIMITS[kind].accept}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              disabled={blocked || busy || !uploadsEnabled}
              onClick={() => fileRef.current?.click()}
              title={
                uploadsEnabled
                  ? `Adjuntar ${LIMITS[kind].label} (máx. ${LIMITS[kind].maxMb} MB)`
                  : 'Falta configurar el almacenamiento para subir archivos'
              }
              aria-label="Adjuntar archivo"
              className="flex h-[46px] w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-2 hairline hover:text-ink disabled:opacity-40"
            >
              {uploading ? (
                <span className="text-[10px]">…</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 1 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 1 1-2.6-2.6l8.5-8.4" />
                </svg>
              )}
            </button>
          </span>

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
            disabled={blocked || busy}
            placeholder={blocked ? 'No se puede responder por DM ahora' : 'Escribí tu respuesta…'}
            aria-label="Mensaje"
            className="scroll-thin min-h-[46px] flex-1 resize-y rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink hairline placeholder:text-muted disabled:opacity-60"
          />

          <button
            type="submit"
            disabled={blocked || busy || !text.trim() || bytes > MAX_BYTES}
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
            {!uploadsEnabled ? ' · subida de archivos no configurada' : ''}
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
