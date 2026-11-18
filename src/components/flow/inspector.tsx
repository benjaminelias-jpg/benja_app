'use client';

import { CONDITION_FIELDS, CONDITION_OPS, specFor, type FieldSpec } from './node-catalog';
import type { AutomationStepType } from '@/db/schema';

export interface InspectorOptions {
  stages: Array<{ value: string; label: string }>;
  users: Array<{ value: string; label: string }>;
  products: Array<{ value: string; label: string }>;
}

interface ConditionRow {
  field: string;
  op: string;
  value?: string;
}

/**
 * Panel de configuracion del paso seleccionado.
 *
 * Arma el formulario desde el catalogo, asi que un tipo de paso nuevo no
 * necesita UI nueva: declara sus campos y aparece solo.
 */
export function Inspector({
  stepType,
  config,
  onChange,
  onDelete,
  options,
}: {
  stepType: AutomationStepType;
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onDelete: () => void;
  options: InspectorOptions;
}) {
  const spec = specFor(stepType);

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function optionsFor(field: FieldSpec) {
    if (field.key === 'stageKey') return options.stages;
    if (field.key === 'ownerId') return options.users;
    if (field.key === 'productId') return options.products;
    return field.options ?? [];
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{spec.label}</h2>
        <p className="mt-1 text-[11px] text-muted">{spec.description}</p>
      </header>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {spec.fields.map((field) => (
          <div key={field.key}>
            <label className="mb-1 block text-[11px] font-medium text-ink-2" htmlFor={`f-${field.key}`}>
              {field.label}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={`f-${field.key}`}
                rows={4}
                value={String(config[field.key] ?? '')}
                onChange={(event) => set(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="scroll-thin w-full resize-y rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline placeholder:text-muted"
              />
            ) : field.type === 'select' ? (
              <select
                id={`f-${field.key}`}
                value={String(config[field.key] ?? '')}
                onChange={(event) => set(field.key, event.target.value)}
                className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline"
              >
                <option value="">Elegir…</option>
                {optionsFor(field).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'tags' ? (
              <input
                id={`f-${field.key}`}
                value={
                  Array.isArray(config[field.key])
                    ? (config[field.key] as string[]).join(', ')
                    : String(config[field.key] ?? '')
                }
                onChange={(event) =>
                  set(
                    field.key,
                    event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
                placeholder={field.placeholder}
                className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline placeholder:text-muted"
              />
            ) : field.type === 'number' ? (
              <input
                id={`f-${field.key}`}
                type="number"
                value={String(config[field.key] ?? '')}
                onChange={(event) => set(field.key, Number(event.target.value))}
                placeholder={field.placeholder}
                className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline"
              />
            ) : field.type === 'json' ? (
              <JsonField
                value={config[field.key]}
                onChange={(value) => set(field.key, value)}
                placeholder={field.placeholder}
              />
            ) : field.type === 'conditions' ? (
              <ConditionsField
                value={(config[field.key] as ConditionRow[]) ?? []}
                onChange={(value) => set(field.key, value)}
              />
            ) : (
              <input
                id={`f-${field.key}`}
                value={String(config[field.key] ?? '')}
                onChange={(event) => set(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline placeholder:text-muted"
              />
            )}

            {field.help ? <p className="mt-1 text-[10px] text-muted">{field.help}</p> : null}
          </div>
        ))}

        {spec.fields.length === 0 ? (
          <p className="text-xs text-muted">Este paso no tiene nada que configurar.</p>
        ) : null}
      </div>

      <footer className="border-t border-[var(--border)] px-4 py-3">
        <button
          type="button"
          onClick={onDelete}
          className="w-full rounded-lg px-3 py-2 text-xs font-medium hairline"
          style={{ color: 'var(--critical)' }}
        >
          Eliminar este paso
        </button>
      </footer>
    </div>
  );
}

function JsonField({
  value,
  onChange,
  placeholder,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <textarea
      rows={4}
      defaultValue={text}
      placeholder={placeholder}
      onBlur={(event) => {
        // Se valida al salir del campo, no en cada tecla: escribir JSON letra a
        // letra genera estados invalidos a proposito.
        try {
          onChange(JSON.parse(event.target.value || '{}'));
          event.target.setCustomValidity('');
        } catch {
          event.target.setCustomValidity('JSON inválido');
          event.target.reportValidity();
        }
      }}
      className="scroll-thin w-full resize-y rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[11px] text-ink hairline"
    />
  );
}

function ConditionsField({
  value,
  onChange,
}: {
  value: ConditionRow[];
  onChange: (value: ConditionRow[]) => void;
}) {
  function update(index: number, patch: Partial<ConditionRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <div key={index} className="rounded-lg bg-surface-2 p-2 hairline">
          <select
            value={row.field}
            onChange={(event) => update(index, { field: event.target.value })}
            className="mb-1 w-full rounded-md bg-surface px-2 py-1 text-[11px] text-ink hairline"
            aria-label="Campo"
          >
            {CONDITION_FIELDS.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>

          <div className="flex gap-1">
            <select
              value={row.op}
              onChange={(event) => update(index, { op: event.target.value })}
              className="w-[46%] rounded-md bg-surface px-2 py-1 text-[11px] text-ink hairline"
              aria-label="Operador"
            >
              {CONDITION_OPS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <input
              value={row.value ?? ''}
              onChange={(event) => update(index, { value: event.target.value })}
              disabled={row.op === 'exists'}
              placeholder="valor"
              aria-label="Valor"
              className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1 text-[11px] text-ink hairline disabled:opacity-40"
            />
          </div>

          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="mt-1 text-[10px] text-muted hover:text-ink"
          >
            Quitar
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, { field: 'respuesta', op: 'contains', value: '' }])}
        className="w-full rounded-lg border border-dashed border-[var(--axis)] px-2 py-1.5 text-[11px] text-ink-2 hover:text-ink"
      >
        + Agregar condición
      </button>
    </div>
  );
}
