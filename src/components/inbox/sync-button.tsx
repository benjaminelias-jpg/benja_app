'use client';

import { useState, useTransition } from 'react';
import { syncInboxAction } from '@/app/inbox/actions';

/** Baja los hilos de Instagram. Informa cuántos trajo, o por qué no trajo nada. */
export function SyncInboxButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      {message ? <span className="text-[10px] text-muted">{message}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await syncInboxAction();
            if (result.dryRun) setMessage('modo simulado');
            else if (!result.ok) setMessage(result.errors[0]?.slice(0, 40) ?? 'error');
            else setMessage(`${result.updated} mensajes`);
          })
        }
        className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2 hairline hover:text-ink disabled:opacity-50"
        title="Importar conversaciones desde Instagram"
      >
        {pending ? 'Sincronizando…' : 'Sincronizar'}
      </button>
    </span>
  );
}
