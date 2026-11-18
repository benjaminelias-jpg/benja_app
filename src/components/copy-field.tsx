'use client';

import { useState } from 'react';

/** Campo de solo lectura con botón de copiar. */
export function CopyField({
  label,
  value,
  mono = true,
  multiline = false,
}: {
  label?: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // En http sin permiso de portapapeles no se puede copiar: el texto
      // igual está a la vista para seleccionarlo a mano.
      setCopied(false);
    }
  }

  return (
    <div className="mb-2">
      {label ? <p className="mb-1 text-[11px] text-muted">{label}</p> : null}
      <div className="flex items-start gap-1.5">
        <code
          className={`scroll-thin block flex-1 overflow-x-auto rounded-md bg-surface-2 px-2.5 py-2 text-[11px] text-ink-2 ${
            mono ? 'font-mono' : ''
          } ${multiline ? 'whitespace-pre' : 'whitespace-nowrap'}`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-surface-2 px-2 py-2 text-[11px] text-ink-2 hairline hover:text-ink"
          aria-label={`Copiar ${label ?? 'valor'}`}
        >
          {copied ? '✓' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
