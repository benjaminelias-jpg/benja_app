'use client';

import { useState } from 'react';
import { createAutomationAction } from '@/app/automatizaciones/actions';

const TRIGGERS = [
  { value: 'ig_comment_keyword', label: 'Comentario con palabra clave' },
  { value: 'ig_dm_keyword', label: 'DM con palabra clave' },
  { value: 'ig_story_reply', label: 'Respuesta a story' },
  { value: 'manychat_event', label: 'Evento de ManyChat' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'manual', label: 'Manual' },
];

/** Alta de un flujo. Se despliega en línea para no sacar a nadie de la página. */
export function NewAutomationForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-2 text-sm font-medium text-white"
        style={{ background: 'var(--series-1)' }}
      >
        Nuevo flujo
      </button>
    );
  }

  return (
    <form
      action={createAutomationAction}
      className="flex w-full flex-wrap items-end gap-2 rounded-xl bg-surface p-3 hairline sm:w-auto"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Nombre</span>
        <input
          name="name"
          required
          autoFocus
          placeholder="Entrega de recurso"
          className="h-9 w-56 rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline placeholder:text-muted"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Disparador</span>
        <select
          name="trigger"
          defaultValue="ig_comment_keyword"
          className="h-9 rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline"
        >
          {TRIGGERS.map((trigger) => (
            <option key={trigger.value} value={trigger.value}>
              {trigger.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="h-9 rounded-lg px-3 text-sm font-medium text-white"
        style={{ background: 'var(--series-1)' }}
      >
        Crear
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-9 rounded-lg px-3 text-sm text-ink-2 hover:text-ink"
      >
        Cancelar
      </button>
    </form>
  );
}
