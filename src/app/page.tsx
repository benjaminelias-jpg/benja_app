import Link from 'next/link';
import { getCurrentOrg } from '@/server/context';
import {
  defaultRange,
  previousRange,
  getKpis,
  getTimeseries,
  getFunnel,
  getTopContent,
  getSilentContent,
  getStaleLeads,
} from '@/server/services/analytics';
import { listUpcomingMeetings } from '@/server/services/commerce';
import { Card, SectionTitle, StatTile, Table, Th, Td, EmptyState, ContentTypeBadge, Avatar } from '@/components/ui';
import { TimeSeriesChart, FunnelChart, BarCell } from '@/components/charts';
import { RangePicker } from '@/components/range-picker';
import { formatMoney, formatNumber, formatPercent, formatDateTime, ratio, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const days = Number(params.dias ?? 30);
  const range = defaultRange(Number.isFinite(days) && days > 0 ? days : 30);
  const org = await getCurrentOrg();

  const [kpis, previous, series, funnel, topContent, meetings, stale, silent] = await Promise.all([
    getKpis(org.id, range),
    getKpis(org.id, previousRange(range)),
    getTimeseries(org.id, range),
    getFunnel(org.id, range),
    getTopContent(org.id, range, 6),
    listUpcomingMeetings(org.id, 5),
    getStaleLeads(org.id, 5),
    getSilentContent(org.id, 3),
  ]);

  const delta = (current: number, before: number) => (before > 0 ? (current - before) / before : null);
  const maxRevenue = Math.max(1, ...topContent.map((row) => row.revenueCents));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Panel</h1>
          <p className="mt-1 text-sm text-ink-2">
            De que contenido viene cada lead, cada reunion y cada venta.
          </p>
        </div>
        <RangePicker current={days} />
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Leads captados"
          value={formatNumber(kpis.leads)}
          delta={delta(kpis.leads, previous.leads)}
          sublabel="vs periodo anterior"
        />
        <StatTile
          label="Reuniones agendadas"
          value={formatNumber(kpis.meetingsBooked)}
          delta={delta(kpis.meetingsBooked, previous.meetingsBooked)}
          sublabel={`${formatPercent(ratio(kpis.meetingsBooked, kpis.leads), 0)} de los leads`}
        />
        <StatTile
          label="Ventas"
          value={formatNumber(kpis.sales)}
          delta={delta(kpis.sales, previous.sales)}
          sublabel={`${formatPercent(ratio(kpis.sales, kpis.meetingsHeld), 0)} de las reus hechas`}
        />
        <StatTile
          label="Ingresos"
          value={formatMoney(kpis.revenueCents, org.currency, true)}
          delta={delta(kpis.revenueCents, previous.revenueCents)}
          sublabel={`${formatMoney(Math.round(ratio(kpis.revenueCents, kpis.leads)), org.currency)} por lead`}
        />
      </section>

      {/* Dos graficos apilados en vez de un doble eje: escalas incomparables. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Leads por dia" hint="Primer contacto registrado" />
          <TimeSeriesChart
            points={series.map((point) => ({ day: point.day, value: point.leads }))}
            label="Leads por dia"
            unit="leads"
          />
        </Card>
        <Card>
          <SectionTitle title="Ingresos por dia" hint="Ventas cerradas, atribuidas a su contenido" />
          <TimeSeriesChart
            points={series.map((point) => ({ day: point.day, value: point.revenueCents / 100 }))}
            label="Ingresos por dia"
            color="var(--series-3)"
            format="money"
            currency={org.currency}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <SectionTitle title="Embudo" hint={`Ultimos ${days} dias`} />
          <FunnelChart steps={funnel} />
          <p className="mt-4 border-t border-[var(--grid)] pt-3 text-xs text-muted">
            {kpis.noShows > 0
              ? `${formatNumber(kpis.noShows)} no-show en el periodo (${formatPercent(
                  ratio(kpis.noShows, kpis.meetingsBooked),
                  0,
                )} de lo agendado).`
              : 'Sin no-shows registrados en el periodo.'}
          </p>
        </Card>

        <Card>
          <SectionTitle
            title="Contenido que mas factura"
            hint="Ingresos atribuidos al contenido que trajo al lead"
            action={
              <Link href="/contenido" className="text-xs font-medium text-[var(--series-1)] hover:underline">
                Ver todo
              </Link>
            }
          />
          {topContent.length === 0 ? (
            <EmptyState title="Todavia no hay contenido con resultados" hint="Los datos aparecen cuando entra el primer lead." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Contenido</Th>
                  <Th align="right">Leads</Th>
                  <Th align="right">Reus</Th>
                  <Th align="right">Ventas</Th>
                  <Th align="right" width="150px">Ingresos</Th>
                </tr>
              </thead>
              <tbody>
                {topContent.map((row) => (
                  <tr key={row.contentId ?? 'sin-atribuir'}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <ContentTypeBadge type={row.type} />
                        {row.contentId ? (
                          <Link
                            href={`/contenido/${row.contentId}`}
                            className="line-clamp-1 font-medium text-ink hover:underline"
                          >
                            {row.title}
                          </Link>
                        ) : (
                          <span className="text-muted">{row.title}</span>
                        )}
                      </div>
                    </Td>
                    <Td align="right">{formatNumber(row.leads)}</Td>
                    <Td align="right">{formatNumber(row.meetingsBooked)}</Td>
                    <Td align="right">{formatNumber(row.sales)}</Td>
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
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Proximas reuniones" />
          {meetings.length === 0 ? (
            <EmptyState title="Sin reuniones agendadas" />
          ) : (
            <ul className="space-y-3">
              {meetings.map((row) => (
                <li key={row.appointment.id} className="flex items-start gap-2.5">
                  <Avatar name={row.lead.fullName ?? row.lead.igUsername ?? '?'} size={28} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${row.lead.id}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {row.lead.fullName ?? `@${row.lead.igUsername}`}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {formatDateTime(row.appointment.scheduledAt)}
                      {row.owner?.name ? ` · ${row.owner.name}` : ''}
                    </p>
                    {row.content?.title ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted">desde: {row.content.title}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Leads estancados" hint="Sin movimiento mas tiempo del permitido en su etapa" />
          {stale.length === 0 ? (
            <EmptyState title="Ningun lead estancado" hint="Todo el pipeline se movio a tiempo." />
          ) : (
            <ul className="space-y-3">
              {stale.map((row) => (
                <li key={row.lead.id} className="flex items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: row.stage.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${row.lead.id}`} className="block truncate text-sm text-ink hover:underline">
                      {row.lead.fullName ?? `@${row.lead.igUsername}`}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {row.stage.name} · {timeAgo(row.lead.stageChangedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Contenido mudo" hint="Publicado y con views, pero sin un solo lead" />
          {silent.length === 0 ? (
            <EmptyState title="Todo tu contenido genero leads" />
          ) : (
            <ul className="space-y-3">
              {silent.map((row) => (
                <li key={row.id}>
                  <Link href={`/contenido/${row.id}`} className="block truncate text-sm text-ink hover:underline">
                    {row.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {formatNumber(row.views, true)} views · 0 leads
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
