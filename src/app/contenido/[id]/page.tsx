import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentOrg } from '@/server/context';
import {
  defaultRange,
  getContentById,
  getContentDailyMetrics,
  getSingleContentPerformance,
  getFunnel,
  listKeywordsForContent,
} from '@/server/services/analytics';
import { listLeads } from '@/server/services/leads';
import {
  Card,
  SectionTitle,
  StatTile,
  Table,
  Th,
  Td,
  EmptyState,
  ContentTypeBadge,
  Badge,
  Avatar,
} from '@/components/ui';
import { TimeSeriesChart, FunnelChart } from '@/components/charts';
import { formatMoney, formatNumber, formatPercent, formatDate, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ContenidoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const content = await getContentById(org.id, id);
  if (!content) notFound();

  // Ventana amplia: un reel de hace dos meses sigue generando ventas hoy.
  const range = defaultRange(180);

  const [performance, funnel, daily, keywords, leads] = await Promise.all([
    getSingleContentPerformance(org.id, id, range),
    getFunnel(org.id, range, id),
    getContentDailyMetrics(id),
    listKeywordsForContent(id),
    listLeads({ orgId: org.id, contentId: id, limit: 12 }),
  ]);

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted">
        <Link href="/contenido" className="hover:underline">
          Contenido
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-2">{content.title}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ContentTypeBadge type={content.type} />
            <Badge>{content.funnelStage.toUpperCase()}</Badge>
            {content.angle ? <Badge>{content.angle}</Badge> : null}
            {content.refCode ? (
              <Badge color="var(--series-1)">ref: {content.refCode}</Badge>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{content.title}</h1>
          {content.hook ? (
            <p className="mt-2 text-sm text-ink-2">
              <span className="text-muted">Gancho: </span>“{content.hook}”
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            Publicado {formatDate(content.publishedAt)}
            {content.igMediaId ? ` · media ${content.igMediaId}` : ''}
          </p>
        </div>
        {content.permalink ? (
          <a
            href={content.permalink}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-ink-2 hairline hover:text-ink"
          >
            Ver en Instagram ↗
          </a>
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Views" value={formatNumber(content.views, true)} />
        <StatTile
          label="Leads"
          value={formatNumber(performance?.leads ?? 0)}
          sublabel={
            content.views > 0
              ? `${(performance?.leadsPer1kViews ?? 0).toFixed(2)} por 1k views`
              : undefined
          }
        />
        <StatTile label="Reuniones" value={formatNumber(performance?.meetingsBooked ?? 0)} />
        <StatTile
          label="Ventas"
          value={formatNumber(performance?.sales ?? 0)}
          sublabel={
            performance && performance.leads > 0
              ? `${formatPercent(performance.leadToSale, 1)} de los leads`
              : undefined
          }
        />
        <StatTile
          label="Ingresos"
          value={formatMoney(performance?.revenueCents ?? 0, org.currency, true)}
          sublabel={
            content.adSpendCents > 0
              ? `inversion ${formatMoney(content.adSpendCents, org.currency, true)}`
              : undefined
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle title="Curva de views" hint="Como se distribuyo el alcance dia a dia" />
          {daily.length === 0 ? (
            <EmptyState title="Sin metricas diarias" hint="Se completan al sincronizar con la Graph API." />
          ) : (
            <TimeSeriesChart
              points={daily.map((point) => ({ day: point.day, value: point.views }))}
              label="Views por dia"
              unit="views"
            />
          )}
        </Card>

        <Card>
          <SectionTitle title="Embudo de este contenido" />
          <FunnelChart steps={funnel} />
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Palabras clave asociadas"
          hint="Las automatizaciones de 'responde X y te mando Y' que cuelgan de este contenido"
        />
        {keywords.length === 0 ? (
          <EmptyState
            title="Este contenido no tiene palabra clave"
            hint="Sin keyword, los leads que lleguen no se van a poder atribuir a esta pieza."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Palabra</Th>
                <Th>Canal</Th>
                <Th>Recurso</Th>
                <Th align="right">Disparos</Th>
                <Th align="center">Estado</Th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((keyword) => (
                <tr key={keyword.id}>
                  <Td>
                    <span className="font-mono text-xs font-medium text-ink">{keyword.word}</span>
                  </Td>
                  <Td>
                    <span className="text-xs">{channelLabel(keyword.channel)}</span>
                  </Td>
                  <Td>
                    <span className="text-xs text-muted">{keyword.resourceName ?? '—'}</span>
                  </Td>
                  <Td align="right">{formatNumber(keyword.triggeredCount)}</Td>
                  <Td align="center">
                    <Badge color={keyword.active ? 'var(--good)' : 'var(--muted)'}>
                      {keyword.active ? 'Activa' : 'Pausada'}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle
          title={`Leads que vinieron de aqui (${formatNumber(leads.total)})`}
          hint="Primer contacto atribuido a este contenido"
        />
        {leads.rows.length === 0 ? (
          <EmptyState title="Todavia ningun lead" />
        ) : (
          <ul className="divide-y divide-[var(--grid)]">
            {leads.rows.map((row) => (
              <li key={row.lead.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={row.lead.fullName ?? row.lead.igUsername ?? '?'} src={row.lead.profilePicUrl} size={30} />
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${row.lead.id}`} className="block truncate text-sm font-medium text-ink hover:underline">
                    {row.lead.fullName ?? `@${row.lead.igUsername}`}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    @{row.lead.igUsername} · {timeAgo(row.lead.createdAt)}
                  </p>
                </div>
                {row.stage ? <Badge color={row.stage.color}>{row.stage.name}</Badge> : null}
                {row.lead.revenueCents > 0 ? (
                  <span className="tabular text-sm font-medium" style={{ color: 'var(--good-text)' }}>
                    {formatMoney(row.lead.revenueCents, org.currency, true)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    ig_comment: 'Comentario',
    ig_dm: 'Mensaje directo',
    ig_story: 'Respuesta a story',
    web: 'Web',
    email: 'Email',
    whatsapp: 'WhatsApp',
    system: 'Sistema',
  };
  return labels[channel] ?? channel;
}
