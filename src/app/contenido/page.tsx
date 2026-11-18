import Link from 'next/link';
import { getCurrentOrg } from '@/server/context';
import { defaultRange, getContentPerformance, getKeywordPerformance } from '@/server/services/analytics';
import { Card, SectionTitle, Table, Th, Td, EmptyState, ContentTypeBadge, Badge } from '@/components/ui';
import { BarCell } from '@/components/charts';
import { RangePicker } from '@/components/range-picker';
import { NewContentForm } from '@/components/content-form';
import { formatMoney, formatNumber, formatPercent, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SORTS = {
  ingresos: 'Ingresos',
  leads: 'Leads',
  eficiencia: 'Leads / 1k views',
  cierre: 'Lead a venta',
} as const;

type SortKey = keyof typeof SORTS;

export default async function ContenidoPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; orden?: string }>;
}) {
  const params = await searchParams;
  const days = Number(params.dias ?? 30) || 30;
  const sort = (params.orden as SortKey) in SORTS ? (params.orden as SortKey) : 'ingresos';
  const range = defaultRange(days);
  const org = await getCurrentOrg();

  const [rows, keywords] = await Promise.all([
    getContentPerformance(org.id, range, { includeUnattributed: true }),
    getKeywordPerformance(org.id, range),
  ]);

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'leads':
        return b.leads - a.leads;
      case 'eficiencia':
        return b.leadsPer1kViews - a.leadsPer1kViews;
      case 'cierre':
        return b.leadToSale - a.leadToSale;
      default:
        return b.revenueCents - a.revenueCents;
    }
  });

  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenueCents));
  const totals = rows.reduce(
    (acc, row) => ({
      leads: acc.leads + row.leads,
      sales: acc.sales + row.sales,
      revenue: acc.revenue + row.revenueCents,
      views: acc.views + row.views,
    }),
    { leads: 0, sales: 0, revenue: 0, views: 0 },
  );
  const unattributed = rows.find((row) => row.contentId === null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Contenido</h1>
          <p className="mt-1 text-sm text-ink-2">
            Cada fila responde: ¿cuanto facturo este contenido?
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangePicker current={days} />
          <NewContentForm />
        </div>
      </header>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <SectionTitle
            title={`${formatNumber(rows.length)} piezas · ${formatNumber(totals.leads)} leads · ${formatMoney(totals.revenue, org.currency, true)}`}
            hint={`Ultimos ${days} dias · ventana de atribucion de ${org.attributionWindowDays} dias`}
          />
          <nav className="mb-4 flex gap-1 text-xs" aria-label="Ordenar por">
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <Link
                key={key}
                href={`/contenido?dias=${days}&orden=${key}`}
                aria-current={key === sort ? 'true' : undefined}
                className={
                  key === sort
                    ? 'rounded-md bg-surface-2 px-2.5 py-1.5 font-medium text-ink'
                    : 'rounded-md px-2.5 py-1.5 text-ink-2 hover:text-ink'
                }
              >
                {SORTS[key]}
              </Link>
            ))}
          </nav>
        </div>

        <div className="px-5 pb-5">
          {sorted.length === 0 ? (
            <EmptyState title="Sin contenido registrado" hint="Importa tus publicaciones o crealas desde la API." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th width="30%">Contenido</Th>
                  <Th align="right">Views</Th>
                  <Th align="right">Leads</Th>
                  <Th align="right">L / 1k</Th>
                  <Th align="right">Reus</Th>
                  <Th align="right">Ventas</Th>
                  <Th align="right">Lead→venta</Th>
                  <Th align="right" width="150px">Ingresos</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.contentId ?? 'sin-atribuir'} className="group">
                    <Td>
                      <div className="flex items-start gap-2">
                        <ContentTypeBadge type={row.type} />
                        <div className="min-w-0">
                          {row.contentId ? (
                            <Link
                              href={`/contenido/${row.contentId}`}
                              className="line-clamp-1 font-medium text-ink hover:underline"
                            >
                              {row.title}
                            </Link>
                          ) : (
                            <span className="font-medium text-muted">{row.title}</span>
                          )}
                          <p className="line-clamp-1 text-[11px] text-muted">
                            {row.hook ?? (row.contentId ? '—' : 'Leads sin contenido de origen')}
                            {row.publishedAt ? ` · ${formatDate(row.publishedAt)}` : ''}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td align="right">{row.views > 0 ? formatNumber(row.views, true) : '—'}</Td>
                    <Td align="right">{formatNumber(row.leads)}</Td>
                    <Td align="right">
                      {row.views > 0 ? row.leadsPer1kViews.toFixed(2) : '—'}
                    </Td>
                    <Td align="right">{formatNumber(row.meetingsBooked)}</Td>
                    <Td align="right">{formatNumber(row.sales)}</Td>
                    <Td align="right">{row.leads > 0 ? formatPercent(row.leadToSale, 1) : '—'}</Td>
                    <Td align="right">
                      <BarCell
                        value={row.revenueCents}
                        max={maxRevenue}
                        label={formatMoney(row.revenueCents, org.currency, true)}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      {unattributed && unattributed.leads > 0 ? (
        <Card>
          <div className="flex items-start gap-3">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--warning)"
              strokeWidth="2"
              className="mt-0.5 shrink-0"
              aria-hidden
            >
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-ink">
                Atencion: {formatNumber(unattributed.leads)}{' '}
                {unattributed.leads === 1 ? 'lead sin contenido de origen' : 'leads sin contenido de origen'}
              </p>
              <p className="mt-1 text-xs text-ink-2">
                Llegaron sin referencia a ninguna publicacion. Para cerrar el hueco, asocia una
                palabra clave a cada contenido o manda <code className="rounded bg-surface-2 px-1">ig_media_id</code>{' '}
                desde ManyChat en el webhook.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle
          title="Palabras clave"
          hint="Que automatizacion de 'responde X' trae mas dinero"
        />
        {keywords.length === 0 ? (
          <EmptyState title="Sin palabras clave configuradas" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Palabra</Th>
                <Th>Contenido</Th>
                <Th>Recurso entregado</Th>
                <Th align="right">Disparos</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Ventas</Th>
                <Th align="right">Ingresos</Th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((row) => (
                <tr key={row.keywordId}>
                  <Td>
                    <span className="font-mono text-xs font-medium text-ink">{row.word}</span>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 text-xs">{row.contentTitle ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 text-xs text-muted">{row.resourceName ?? '—'}</span>
                  </Td>
                  <Td align="right">{formatNumber(row.triggers)}</Td>
                  <Td align="right">{formatNumber(row.leads)}</Td>
                  <Td align="right">{formatNumber(row.sales)}</Td>
                  <Td align="right">
                    <span className="font-medium text-ink">
                      {formatMoney(row.revenueCents, org.currency, true)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="pb-4 text-xs text-muted">
        <Badge>Como se calcula</Badge>{' '}
        Un lead se acredita al contenido de su <strong>primer contacto</strong>. Las reuniones y
        ventas heredan esa atribucion mientras ocurran dentro de la ventana de{' '}
        {org.attributionWindowDays} dias; pasado ese plazo, se usa el ultimo contenido que lo toco.
        Los <strong>conteos</strong> son de lo que paso en el periodo; la columna{' '}
        <strong>lead→venta</strong> se calcula sobre la cohorte de leads que entraron en el periodo,
        para que nunca pase del 100% por ventas de leads mas viejos.
      </p>
    </div>
  );
}
