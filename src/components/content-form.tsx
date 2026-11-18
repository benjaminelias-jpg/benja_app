'use client';

import { useState } from 'react';
import { createContentAction, updateContentAction } from '@/app/contenido/actions';

const TYPES = [
  { value: 'reel', label: 'Reel' },
  { value: 'post', label: 'Post' },
  { value: 'carousel', label: 'Carrusel' },
  { value: 'story', label: 'Story' },
  { value: 'live', label: 'Vivo' },
  { value: 'ad', label: 'Anuncio' },
  { value: 'external', label: 'Externo (podcast, newsletter…)' },
];

const STAGES = [
  { value: 'tofu', label: 'TOFU — atrae' },
  { value: 'mofu', label: 'MOFU — educa' },
  { value: 'bofu', label: 'BOFU — vende' },
];

export function NewContentForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-2 text-sm font-medium text-white"
        style={{ background: 'var(--series-1)' }}
      >
        Nuevo contenido
      </button>
    );
  }

  return (
    <form
      action={createContentAction}
      className="grid w-full gap-2 rounded-xl bg-surface p-4 hairline sm:grid-cols-2 lg:grid-cols-3"
    >
      <Field label="Título" span>
        <input name="title" required autoFocus placeholder="El error que te hace perder leads" className={inputClass} />
      </Field>
      <Field label="Tipo">
        <select name="type" defaultValue="reel" className={inputClass}>
          {TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Gancho (primeros 3 segundos)" span>
        <input name="hook" placeholder="Si tus DMs están llenos y no vendés…" className={inputClass} />
      </Field>
      <Field label="Ángulo">
        <input name="angle" placeholder="dolor, autoridad, contraintuitivo…" className={inputClass} />
      </Field>
      <Field label="Etapa del embudo">
        <select name="funnelStage" defaultValue="tofu" className={inputClass}>
          {STAGES.map((stage) => (
            <option key={stage.value} value={stage.value}>{stage.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Link del post">
        <input name="permalink" placeholder="https://instagram.com/reel/…" className={inputClass} />
      </Field>
      <Field label="ID de media de Instagram">
        <input name="igMediaId" placeholder="1784100…" className={inputClass} />
      </Field>
      <Field label="Views">
        <input name="views" type="number" defaultValue={0} className={inputClass} />
      </Field>
      <Field label="Inversión en pauta">
        <input name="adSpend" type="number" step="0.01" defaultValue={0} className={inputClass} />
      </Field>
      <Field label="Publicado">
        <input name="publishedAt" type="date" className={inputClass} />
      </Field>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" className="h-9 rounded-lg px-3 text-sm font-medium text-white" style={{ background: 'var(--series-1)' }}>
          Crear
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-3 text-sm text-ink-2 hover:text-ink">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Edición de lo que la Graph API no sabe: gancho, ángulo, etapa, inversión. */
export function EditContentForm({
  contentId,
  title,
  hook,
  angle,
  funnelStage,
  adSpendCents,
}: {
  contentId: string;
  title: string;
  hook: string | null;
  angle: string | null;
  funnelStage: string;
  adSpendCents: number;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-ink-2 hairline hover:text-ink"
      >
        Editar
      </button>
    );
  }

  return (
    <form action={updateContentAction} className="grid w-full gap-2 rounded-xl bg-surface p-4 hairline sm:grid-cols-2">
      <input type="hidden" name="contentId" value={contentId} />
      <Field label="Título" span>
        <input name="title" defaultValue={title} className={inputClass} />
      </Field>
      <Field label="Gancho" span>
        <input name="hook" defaultValue={hook ?? ''} className={inputClass} />
      </Field>
      <Field label="Ángulo">
        <input name="angle" defaultValue={angle ?? ''} className={inputClass} />
      </Field>
      <Field label="Etapa del embudo">
        <select name="funnelStage" defaultValue={funnelStage} className={inputClass}>
          {STAGES.map((stage) => (
            <option key={stage.value} value={stage.value}>{stage.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Inversión en pauta">
        <input name="adSpend" type="number" step="0.01" defaultValue={adSpendCents / 100} className={inputClass} />
      </Field>
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" className="h-9 rounded-lg px-3 text-sm font-medium text-white" style={{ background: 'var(--series-1)' }}>
          Guardar
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-3 text-sm text-ink-2 hover:text-ink">
          Cancelar
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'h-9 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline placeholder:text-muted';

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}
