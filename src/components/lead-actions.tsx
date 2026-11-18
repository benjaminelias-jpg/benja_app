'use client';

import { useState } from 'react';
import { bookMeetingAction, recordSaleAction, saveNotesAction } from '@/app/leads/actions';

const inputClass = 'h-9 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline';

/**
 * Registro manual de reunión y venta.
 *
 * Sin esto, una venta cerrada por teléfono no entra nunca al reporte, y el
 * contenido que la generó queda sin crédito.
 */
export function LeadQuickActions({
  leadId,
  team,
  products,
  currency,
}: {
  leadId: string;
  team: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; priceCents: number }>;
  currency: string;
}) {
  const [panel, setPanel] = useState<'none' | 'meeting' | 'sale'>('none');

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === 'meeting' ? 'none' : 'meeting')}
          className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink"
        >
          Agendar reunión
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === 'sale' ? 'none' : 'sale')}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white"
          style={{ background: 'var(--good)' }}
        >
          Registrar venta
        </button>
      </div>

      {panel === 'meeting' ? (
        <form action={bookMeetingAction} className="mt-3 space-y-2">
          <input type="hidden" name="leadId" value={leadId} />
          <Field label="Cuándo">
            <input name="scheduledAt" type="datetime-local" required className={inputClass} />
          </Field>
          <Field label="Título">
            <input name="title" defaultValue="Llamada de diagnóstico" className={inputClass} />
          </Field>
          <Field label="Responsable">
            <select name="ownerId" className={inputClass}>
              <option value="">Sin asignar</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </Field>
          <button type="submit" className="h-9 w-full rounded-lg text-sm font-medium text-white" style={{ background: 'var(--series-1)' }}>
            Agendar
          </button>
        </form>
      ) : null}

      {panel === 'sale' ? (
        <form action={recordSaleAction} className="mt-3 space-y-2">
          <input type="hidden" name="leadId" value={leadId} />
          <Field label="Producto">
            <select name="productId" className={inputClass}>
              <option value="">Sin producto</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {(product.priceCents / 100).toLocaleString('es-AR')} {currency}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Importe (${currency})`}>
            <input name="amount" type="number" step="0.01" required placeholder="1497" className={inputClass} />
          </Field>
          <Field label="Closer">
            <select name="ownerId" className={inputClass}>
              <option value="">Sin asignar</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </Field>
          <button type="submit" className="h-9 w-full rounded-lg text-sm font-medium text-white" style={{ background: 'var(--good)' }}>
            Registrar venta
          </button>
          <p className="text-[10px] text-muted">
            Se acredita al contenido del primer contacto de este lead.
          </p>
        </form>
      ) : null}
    </div>
  );
}

export function LeadNotes({ leadId, notes }: { leadId: string; notes: string | null }) {
  const [dirty, setDirty] = useState(false);

  return (
    <form action={saveNotesAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <textarea
        name="notes"
        rows={4}
        defaultValue={notes ?? ''}
        onChange={() => setDirty(true)}
        placeholder="Qué dijo en la call, objeciones, contexto…"
        className="scroll-thin w-full resize-y rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={!dirty}
        className="h-8 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-40"
        style={{ background: 'var(--series-1)' }}
      >
        Guardar nota
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}
