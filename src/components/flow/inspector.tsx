'use client';

import { useRef, useState } from 'react';
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
            ) : field.type === 'media' ? (
              <MediaField
                value={String(config[field.key] ?? '')}
                mediaType={field.placeholder ?? 'file'}
                onChange={(value) => set(field.key, value)}
              />
            ) : field.type === 'buttons' ? (
              <ButtonsField
                value={(config[field.key] as Array<{ title: string; payload: string }>) ?? []}
                onChange={(value) => set(field.key, value)}
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


/**
 * Campo de archivo: se sube y queda la URL pública.
 * Instagram no recibe bytes, recibe una URL que Meta descarga, así que el
 * archivo tiene que estar alojado antes de poder mandarse.
 */
function MediaField({
  value,
  mediaType,
  onChange,
}: {
  value: string;
  mediaType: string;
  onChange: (value: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept: Record<string, string> = {
    audio: '.aac,.m4a,.wav,.mp4,audio/*',
    image: '.png,.jpg,.jpeg',
    video: '.mp4,.ogg,.avi,.mov,.webm,video/*',
    file: '.pdf',
  };

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('type', mediaType);
      const response = await fetch('/api/uploads', { method: 'POST', body });
      const json = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !json.url) {
        setError(json.error ?? 'No se pudo subir.');
        return;
      }
      onChange(json.url);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://…  (o subí un archivo)"
        className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink hairline placeholder:text-muted"
      />

      {value && mediaType === 'audio' ? (
        <audio controls src={value} className="h-8 w-full" />
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept[mediaType] ?? ''}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-lg border border-dashed border-[var(--axis)] px-2 py-1.5 text-[11px] text-ink-2 hover:text-ink disabled:opacity-50"
      >
        {uploading ? 'Subiendo…' : 'Subir archivo'}
      </button>

      {error ? (
        <p className="text-[10px]" style={{ color: 'var(--critical)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Botones de respuesta rápida. Instagram permite hasta 13 y corta a 20 caracteres. */
function ButtonsField({
  value,
  onChange,
}: {
  value: Array<{ title: string; payload: string }>;
  onChange: (value: Array<{ title: string; payload: string }>) => void;
}) {
  function update(index: number, patch: Partial<{ title: string; payload: string }>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <div key={index} className="rounded-lg bg-surface-2 p-2 hairline">
          <input
            value={row.title}
            maxLength={20}
            onChange={(event) =>
              update(index, {
                title: event.target.value,
                // El valor sigue al título mientras no se toque a mano: evita
                // configurar dos campos para el caso simple.
                payload: row.payload === row.title ? event.target.value : row.payload,
              })
            }
            placeholder="Texto del botón"
            className="mb-1 w-full rounded-md bg-surface px-2 py-1 text-[11px] text-ink hairline"
          />
          <input
            value={row.payload}
            onChange={(event) => update(index, { payload: event.target.value })}
            placeholder="Valor que vuelve (para las condiciones)"
            className="w-full rounded-md bg-surface px-2 py-1 font-mono text-[10px] text-ink-2 hairline"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="mt-1 text-[10px] text-muted hover:text-ink"
          >
            Quitar
          </button>
        </div>
      ))}

      {value.length < 13 ? (
        <button
          type="button"
          onClick={() => onChange([...value, { title: '', payload: '' }])}
          className="w-full rounded-lg border border-dashed border-[var(--axis)] px-2 py-1.5 text-[11px] text-ink-2 hover:text-ink"
        >
          + Agregar botón ({value.length}/13)
        </button>
      ) : (
        <p className="text-[10px] text-muted">Instagram permite 13 botones como máximo.</p>
      )}
    </div>
  );
}
