import Link from 'next/link';
import { getCurrentOrg, getDefaultPipeline } from '@/server/context';
import { leadsByStage } from '@/server/services/leads';
import { getPipelineDistribution } from '@/server/services/analytics';
import { Card, EmptyState, Avatar, Badge } from '@/components/ui';
import { StageSelect } from '@/components/stage-select';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const org = await getCurrentOrg();
  const pipelineData = await getDefaultPipeline(org.id);

  if (!pipelineData) {
    return <EmptyState title="No hay ningun pipeline configurado" hint="Ejecuta `npm run setup`." />;
  }

  const { pipeline, stages } = pipelineData;
  const [{ grouped, totals }, distribution] = await Promise.all([
    leadsByStage(org.id, 30),
    getPipelineDistribution(org.id),
  ]);

  const stageOptions = stages.map((stage) => ({ id: stage.id, name: stage.name }));
  const totalLeads = distribution.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{pipeline.name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {formatNumber(totalLeads)} leads en el embudo · cada tarjeta muestra de que contenido vino.
          </p>
        </div>
      </header>

      <div className="scroll-thin flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const leads = grouped.get(stage.id) ?? [];
          const total = totals.get(stage.id) ?? 0;
          const value = leads.reduce((sum, row) => sum + row.lead.revenueCents, 0);

          return (
            <section key={stage.id} className="flex w-[268px] shrink-0 flex-col">
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: stage.color }}
                    aria-hidden
                  />
                  {stage.name}
                </span>
                <span className="tabular text-xs text-muted">{formatNumber(total)}</span>
              </header>

              {value > 0 ? (
                <p className="mb-2 px-1 text-[11px] text-muted">
                  {formatMoney(value, org.currency, true)} facturados
                </p>
              ) : null}

              <div className="scroll-thin flex max-h-[calc(100vh-230px)] flex-col gap-2 overflow-y-auto pr-1">
                {leads.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[var(--axis)] px-3 py-6 text-center text-[11px] text-muted">
                    Vacia
                  </p>
                ) : (
                  leads.map((row) => (
                    <article key={row.lead.id} className="rounded-lg bg-surface p-3 hairline">
                      <div className="flex items-start gap-2">
                        <Avatar
                          name={row.lead.fullName ?? row.lead.igUsername ?? '?'}
                          src={row.lead.profilePicUrl}
                          size={28}
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/leads/${row.lead.id}`}
                            className="block truncate text-sm font-medium text-ink hover:underline"
                          >
                            {row.lead.fullName ?? `@${row.lead.igUsername}`}
                          </Link>
                          <p className="truncate text-[11px] text-muted">
                            @{row.lead.igUsername ?? '—'}
                          </p>
                        </div>
                      </div>

                      {row.content?.title ? (
                        <p className="mt-2 line-clamp-2 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2">
                          <span className="text-muted">Vino de: </span>
                          {row.content.title}
                        </p>
                      ) : (
                        <p className="mt-2 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">
                          Sin contenido atribuido
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
                        <span>{timeAgo(row.lead.stageChangedAt)}</span>
                        {row.lead.revenueCents > 0 ? (
                          <span className="tabular font-medium" style={{ color: 'var(--good-text)' }}>
                            {formatMoney(row.lead.revenueCents, org.currency, true)}
                          </span>
                        ) : row.owner?.name ? (
                          <span className="truncate">{row.owner.name}</span>
                        ) : null}
                      </div>

                      <div className="mt-2">
                        <StageSelect
                          leadId={row.lead.id}
                          stageId={row.lead.stageId}
                          stages={stageOptions}
                          compact
                        />
                      </div>
                    </article>
                  ))
                )}

                {total > leads.length ? (
                  <Link
                    href={`/leads?stageId=${stage.id}`}
                    className="rounded-lg bg-surface px-3 py-2 text-center text-[11px] text-ink-2 hairline hover:text-ink"
                  >
                    Ver los {formatNumber(total)} leads
                  </Link>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">Distribucion</h2>
        <div className="flex flex-wrap gap-2">
          {distribution.map((row) => (
            <Badge key={row.stageId} color={row.color}>
              {row.name}: {formatNumber(row.count)}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}
