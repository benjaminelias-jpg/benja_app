import Link from 'next/link';
import { getCurrentOrg, getDefaultPipeline } from '@/server/context';
import { listLeads } from '@/server/services/leads';
import { getSourceBreakdown, defaultRange } from '@/server/services/analytics';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge, Avatar } from '@/components/ui';
import { BarCell } from '@/components/charts';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';
import type { LeadSource } from '@/db/schema';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

const SOURCE_LABELS: Record<string, string> = {
  ig_comment: 'Comentario',
  ig_dm: 'Mensaje directo',
  ig_story_reply: 'Respuesta a story',
  ig_mention: 'Mencion',
  ig_ad: 'Anuncio',
  ig_bio_link: 'Link en bio',
  manychat: 'ManyChat',
  webhook: 'Webhook',
  form: 'Formulario',
  manual: 'Carga manual',
  import: 'Importacion',
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stageId?: string; page?: string; source?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(0, Number(params.page ?? 0) || 0);
  const org = await getCurrentOrg();
  const pipelineData = await getDefaultPipeline(org.id);

  const [{ rows, total }, sources] = await Promise.all([
    listLeads({
      orgId: org.id,
      search: params.q,
      stageId: params.stageId,
      source: params.source as LeadSource | undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    getSourceBreakdown(org.id, defaultRange(90)),
  ]);

  const maxSourceLeads = Math.max(1, ...sources.map((row) => row.leads));
  const pages = Math.ceil(total / PAGE_SIZE);

  function hrefWith(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    const merged = { ...params, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, String(value));
    }
    return `/leads?${next.toString()}`;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Leads</h1>
        <p className="mt-1 text-sm text-ink-2">{formatNumber(total)} contactos</p>
      </header>

      {/* Filtros: una sola fila, arriba de la tabla. */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Buscar por usuario, nombre o email"
          aria-label="Buscar leads"
          className="h-9 min-w-[240px] flex-1 rounded-lg bg-surface px-3 text-sm text-ink hairline placeholder:text-muted"
        />
        <select
          name="stageId"
          defaultValue={params.stageId ?? ''}
          aria-label="Filtrar por etapa"
          className="h-9 rounded-lg bg-surface px-2.5 text-sm text-ink-2 hairline"
        >
          <option value="">Todas las etapas</option>
          {pipelineData?.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <select
          name="source"
          defaultValue={params.source ?? ''}
          aria-label="Filtrar por origen"
          className="h-9 rounded-lg bg-surface px-2.5 text-sm text-ink-2 hairline"
        >
          <option value="">Todos los origenes</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-lg px-3 text-sm font-medium text-white"
          style={{ background: 'var(--series-1)' }}
        >
          Filtrar
        </button>
        {params.q || params.stageId || params.source ? (
          <Link href="/leads" className="h-9 rounded-lg px-3 py-2 text-sm text-ink-2 hover:text-ink">
            Limpiar
          </Link>
        ) : null}
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Ningun lead coincide" hint="Proba quitando filtros." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="26%">Lead</Th>
                <Th>Etapa</Th>
                <Th>Vino de</Th>
                <Th>Origen</Th>
                <Th>Responsable</Th>
                <Th align="right">Ingresos</Th>
                <Th align="right">Actividad</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lead.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={row.lead.fullName ?? row.lead.igUsername ?? '?'}
                        src={row.lead.profilePicUrl}
                        size={30}
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/leads/${row.lead.id}`}
                          className="block truncate font-medium text-ink hover:underline"
                        >
                          {row.lead.fullName ?? `@${row.lead.igUsername}`}
                        </Link>
                        <p className="truncate text-xs text-muted">
                          {row.lead.igUsername ? `@${row.lead.igUsername}` : (row.lead.email ?? '—')}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>{row.stage ? <Badge color={row.stage.color}>{row.stage.name}</Badge> : '—'}</Td>
                  <Td>
                    {row.content ? (
                      <Link
                        href={`/contenido/${row.content.id}`}
                        className="line-clamp-1 text-xs hover:underline"
                      >
                        {row.content.title}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">Sin atribuir</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-xs">{SOURCE_LABELS[row.lead.source] ?? row.lead.source}</span>
                  </Td>
                  <Td>
                    <span className="text-xs">{row.owner?.name ?? '—'}</span>
                  </Td>
                  <Td align="right">
                    {row.lead.revenueCents > 0 ? (
                      <span className="font-medium" style={{ color: 'var(--good-text)' }}>
                        {formatMoney(row.lead.revenueCents, org.currency, true)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="text-xs text-muted">
                      {timeAgo(row.lead.lastInteractionAt ?? row.lead.createdAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-xs" aria-label="Paginacion">
            <span className="text-muted">
              Pagina {page + 1} de {pages}
            </span>
            <span className="flex gap-2">
              {page > 0 ? (
                <Link href={hrefWith({ page: String(page - 1) })} className="rounded-md bg-surface-2 px-2.5 py-1.5 text-ink-2 hover:text-ink">
                  Anterior
                </Link>
              ) : null}
              {page + 1 < pages ? (
                <Link href={hrefWith({ page: String(page + 1) })} className="rounded-md bg-surface-2 px-2.5 py-1.5 text-ink-2 hover:text-ink">
                  Siguiente
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="De donde llegan los leads" hint="Ultimos 90 dias, por canal de entrada" />
        <Table>
          <thead>
            <tr>
              <Th>Origen</Th>
              <Th align="right" width="180px">Leads</Th>
              <Th align="right">Ventas</Th>
              <Th align="right">Ingresos</Th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.source}>
                <Td>{SOURCE_LABELS[row.source] ?? row.source}</Td>
                <Td align="right">
                  <BarCell value={row.leads} max={maxSourceLeads} label={formatNumber(row.leads)} />
                </Td>
                <Td align="right">{formatNumber(row.sales)}</Td>
                <Td align="right">{formatMoney(row.revenueCents, org.currency, true)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
