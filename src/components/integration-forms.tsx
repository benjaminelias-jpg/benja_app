'use client';

import { useActionState, useState } from 'react';
import { createApiKeyAction, createEndpointAction } from '@/app/integraciones/actions';

const inputClass = 'h-9 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline';

/** La clave en claro existe una sola vez: se muestra acá y no vuelve a verse. */
export function ApiKeyCreator() {
  const [state, action, pending] = useActionState(createApiKeyAction, {});

  return (
    <div className="mt-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Nombre de la clave</span>
          <input name="name" required placeholder="Make.com" className={`${inputClass} w-48`} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-lg bg-surface-2 px-3 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
        >
          {pending ? 'Creando…' : 'Crear clave'}
        </button>
      </form>

      {state.error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--critical)' }}>{state.error}</p>
      ) : null}

      {state.plain ? (
        <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <p className="text-[11px] text-muted">Copiala ahora: no se puede volver a ver.</p>
          <code className="mt-1 block overflow-x-auto text-xs text-ink">{state.plain}</code>
        </div>
      ) : null}
    </div>
  );
}

const PROVIDERS = [
  { value: 'calendly', label: 'Calendly — reunión agendada' },
  { value: 'cal_com', label: 'Cal.com — reunión agendada' },
  { value: 'hotmart', label: 'Hotmart — compra aprobada' },
  { value: 'stripe', label: 'Stripe — checkout completado' },
  { value: 'custom', label: 'Otro (mapeo editable)' },
];

/** Alta de endpoint con el mapeo del proveedor ya cargado. */
export function EndpointCreator() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink"
      >
        Nuevo webhook
      </button>
    );
  }

  return (
    <form action={createEndpointAction} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Nombre</span>
        <input name="name" required autoFocus placeholder="Calendly" className={`${inputClass} w-40`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Proveedor</span>
        <select name="provider" defaultValue="calendly" className={`${inputClass} w-56`}>
          {PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>{provider.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="h-9 rounded-lg px-3 text-xs font-medium text-white" style={{ background: 'var(--series-1)' }}>
        Crear
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-3 text-xs text-ink-2 hover:text-ink">
        Cancelar
      </button>
    </form>
  );
}
