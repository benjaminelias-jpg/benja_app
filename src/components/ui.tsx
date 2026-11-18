import type { ReactNode } from 'react';
import clsx from 'clsx';
import { formatDelta } from '@/lib/format';

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={clsx(
        'rounded-xl bg-surface hairline shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Tile de metrica. El numero es el protagonista: sin grafico, sin color de serie.
 * La variacion lleva icono ademas de color, nunca color solo.
 */
export function StatTile({
  label,
  value,
  sublabel,
  delta,
  deltaGoodWhenUp = true,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  deltaGoodWhenUp?: boolean;
}) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta) && delta !== 0;
  const isUp = (delta ?? 0) > 0;
  const isGood = deltaGoodWhenUp ? isUp : !isUp;

  return (
    <div className="rounded-xl bg-surface hairline p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {hasDelta ? (
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: isGood ? 'var(--good-text)' : 'var(--critical)' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d={isUp ? 'M5 1 L9 7 L1 7 Z' : 'M5 9 L1 3 L9 3 Z'}
                fill="currentColor"
              />
            </svg>
            {formatDelta(delta!)}
            <span className="sr-only">{isUp ? 'subio' : 'bajo'}</span>
          </span>
        ) : null}
        {sublabel ? <span className="text-muted">{sublabel}</span> : null}
      </div>
    </div>
  );
}

export function Badge({
  children,
  color,
  subtle = true,
}: {
  children: ReactNode;
  color?: string;
  subtle?: boolean;
}) {
  const accent = color ?? 'var(--muted)';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        subtle ? 'text-ink-2' : 'text-white',
      )}
      style={
        subtle
          ? { background: 'var(--surface-2)', border: '1px solid var(--border)' }
          : { background: accent }
      }
    >
      {subtle && color ? (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} aria-hidden />
      ) : null}
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const label = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-2 hairline overflow-hidden"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        label || '??'
      )}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--axis)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-thin -mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[720px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  width,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}) {
  return (
    <th
      className={clsx(
        'border-b border-[var(--grid)] pb-2 text-[11px] font-medium text-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
      )}
      style={{ width }}
      scope="col"
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={clsx(
        'border-b border-[var(--grid)] py-2.5 text-ink-2',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Etiqueta de tipo de contenido, con icono para no depender del color. */
export function ContentTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    reel: 'Reel',
    post: 'Post',
    carousel: 'Carrusel',
    story: 'Story',
    live: 'Vivo',
    ad: 'Anuncio',
    external: 'Externo',
  };
  return <Badge>{labels[type] ?? type}</Badge>;
}
