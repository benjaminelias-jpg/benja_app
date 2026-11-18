/** Helpers de formato. Todo el dinero viaja en centavos y se formatea aqui. */

export function formatMoney(cents: number, currency = 'USD', compact = false): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: compact || Math.abs(value) >= 1000 ? 0 : 2,
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

export function formatNumber(value: number, compact = false): string {
  return new Intl.NumberFormat('es-AR', {
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

/** Porcentaje a partir de una fraccion (0.312 -> "31,2%"). */
export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}

/** Division segura: devuelve 0 en vez de NaN/Infinity cuando no hay denominador. */
export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

/**
 * Variacion entre periodos. Arriba de 300% el porcentaje deja de leerse
 * ("7.605%" confunde), asi que se muestra como multiplicador.
 */
export function formatDelta(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const magnitude = Math.abs(fraction);
  if (magnitude >= 3) return `${(1 + magnitude).toFixed(0)}x`;
  return formatPercent(magnitude, 0);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "hace 3 d", "hace 2 h". Util para ver leads estancados de un vistazo. */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const units: Array<[number, string]> = [
    [60, 'min'],
    [3600, 'h'],
    [86_400, 'd'],
    [604_800, 'sem'],
    [2_592_000, 'mes'],
  ];
  if (seconds < 3600) return `hace ${Math.floor(seconds / units[0][0])} ${units[0][1]}`;
  if (seconds < 86_400) return `hace ${Math.floor(seconds / units[1][0])} ${units[1][1]}`;
  if (seconds < 604_800) return `hace ${Math.floor(seconds / units[2][0])} ${units[2][1]}`;
  if (seconds < 2_592_000) return `hace ${Math.floor(seconds / units[3][0])} ${units[3][1]}`;
  return `hace ${Math.floor(seconds / units[4][0])} ${units[4][1]}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '??';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
