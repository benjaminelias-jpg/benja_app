'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';

const OPTIONS = [
  { days: 7, label: '7 d' },
  { days: 30, label: '30 d' },
  { days: 90, label: '90 d' },
];

/** Filtro de periodo. Una sola fila, arriba de los graficos. */
export function RangePicker({ current }: { current: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(days: number) {
    const next = new URLSearchParams(params.toString());
    next.set('dias', String(days));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      className="inline-flex rounded-lg bg-surface p-0.5 hairline"
      role="group"
      aria-label="Periodo"
    >
      {OPTIONS.map((option) => {
        const active = option.days === current;
        return (
          <button
            key={option.days}
            type="button"
            onClick={() => select(option.days)}
            aria-pressed={active}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
