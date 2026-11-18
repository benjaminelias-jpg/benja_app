'use client';

import { useMemo, useState } from 'react';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';

/* ------------------------------------------------------------------ *
 * Serie temporal
 * ------------------------------------------------------------------ */

export interface SeriesPoint {
  day: string;
  value: number;
}

/**
 * Area + linea de una sola serie, con cruceta y tooltip al pasar el mouse.
 *
 * Una serie por grafico a proposito: leads por dia e ingresos por dia tienen
 * escalas incomparables, y un grafico de doble eje haria ver correlaciones que
 * no existen. Dos graficos apilados comparten el eje de tiempo y no mienten.
 */
export function TimeSeriesChart({
  points,
  label,
  // Los componentes de servidor no pueden pasar funciones a los de cliente,
  // asi que el formato viaja como dato y se resuelve aqui.
  format = 'number',
  unit,
  currency = 'USD',
  color = 'var(--series-1)',
  height = 150,
}: {
  points: SeriesPoint[];
  label: string;
  format?: 'number' | 'money';
  unit?: string;
  currency?: string;
  color?: string;
  height?: number;
}) {
  const formatValue = (value: number) =>
    format === 'money'
      ? formatMoney(Math.round(value * 100), currency)
      : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 720;
  const padding = { top: 12, right: 8, bottom: 22, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const { max, coords, ticks } = useMemo(() => {
    const values = points.map((point) => point.value);
    const rawMax = Math.max(1, ...values);
    const niceMax = niceCeil(rawMax);
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;

    return {
      max: niceMax,
      coords: points.map((point, index) => ({
        x: padding.left + index * step,
        y: padding.top + plotHeight - (point.value / niceMax) * plotHeight,
        ...point,
      })),
      ticks: [0, niceMax / 2, niceMax],
    };
  }, [points, plotWidth, plotHeight, padding.left, padding.top]);

  if (points.length === 0) {
    return <p className="py-8 text-center text-xs text-muted">Sin datos en el periodo.</p>;
  }

  const linePath = coords.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const areaPath = `${linePath} L${coords.at(-1)!.x},${padding.top + plotHeight} L${coords[0].x},${padding.top + plotHeight} Z`;
  const gradientId = `grad-${label.replace(/\W/g, '')}`;
  const active = hoverIndex !== null ? coords[hoverIndex] : null;

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width;
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 1;
    const index = Math.round((relative - padding.left) / step);
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${points.length} dias`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grilla recesiva */}
        {ticks.map((tick) => {
          const y = padding.top + plotHeight - (tick / max) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fill="var(--muted)"
                className="tabular"
              >
                {formatNumber(tick, true)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active ? (
          <g>
            <line
              x1={active.x}
              x2={active.x}
              y1={padding.top}
              y2={padding.top + plotHeight}
              stroke="var(--axis)"
              strokeWidth="1"
            />
            {/* Anillo de 2px del color de la superficie para separar el punto del area */}
            <circle cx={active.x} cy={active.y} r="5" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
          </g>
        ) : null}

        {/* Eje temporal: solo primera, media y ultima marca */}
        {[0, Math.floor(points.length / 2), points.length - 1]
          .filter((index, position, list) => list.indexOf(index) === position)
          .map((index) => (
            <text
              key={index}
              x={coords[index].x}
              y={height - 6}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fontSize="10"
              fill="var(--muted)"
            >
              {shortDate(points[index].day)}
            </text>
          ))}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg bg-surface px-2.5 py-1.5 text-xs shadow-lg hairline"
          style={{
            left: `${(active.x / width) * 100}%`,
            transform: `translateX(${active.x > width * 0.7 ? '-105%' : '8px'})`,
          }}
        >
          <p className="font-medium text-ink">{formatValue(active.value)}</p>
          <p className="text-[11px] text-muted">{longDate(active.day)}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Embudo
 * ------------------------------------------------------------------ */

const FUNNEL_RAMP = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)', 'var(--ramp-5)'];

export interface FunnelDatum {
  key: string;
  label: string;
  count: number;
  stepRate: number;
  totalRate: number;
}

/**
 * Embudo como barras horizontales con rampa ordinal de un solo tono.
 * El ancho codifica el volumen; el porcentaje de caida va como etiqueta directa,
 * porque es el numero que de verdad se mira.
 */
export function FunnelChart({ steps }: { steps: FunnelDatum[] }) {
  const max = Math.max(1, ...steps.map((step) => step.count));

  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => {
        const width = Math.max(1.5, (step.count / max) * 100);
        const color = FUNNEL_RAMP[Math.min(index, FUNNEL_RAMP.length - 1)];
        return (
          <li key={step.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-ink-2">{step.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="tabular font-semibold text-ink">{formatNumber(step.count)}</span>
                {index > 0 ? (
                  <span className="tabular text-muted">{formatPercent(step.stepRate, 0)} del paso previo</span>
                ) : (
                  <span className="text-muted">100%</span>
                )}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${width}%`, background: color }}
                title={`${step.label}: ${step.count}`}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * Barra en linea para tablas
 * ------------------------------------------------------------------ */

export function BarCell({
  value,
  max,
  label,
  color = 'var(--series-1)',
}: {
  value: number;
  max: number;
  label: string;
  color?: string;
}) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2" title={label}>
      <span className="tabular text-ink">{label}</span>
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

function niceCeil(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const stepped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return stepped * magnitude;
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(date);
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: 'long' }).format(date);
}
