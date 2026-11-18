import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contents } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { listAutomations, listRecentRuns } from '@/server/services/automations';
import { getKeywordPerformance, defaultRange } from '@/server/services/analytics';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge } from '@/components/ui';
import { NewAutomationForm } from '@/components/flow/new-automation';
import { KeywordManager } from '@/components/flow/keyword-manager';
import { toggleAutomationAction } from './actions';
import { formatNumber, formatDateTime } from '@/lib/format';
import { specFor } from '@/components/flow/node-catalog';

export const dynamic = 'force-dynamic';

const TRIGGER_LABELS: Record<string, string> = {
  ig_comment_keyword: 'Comentario con palabra clave',
  ig_dm_keyword: 'DM con palabra clave',
  ig_story_reply: 'Respuesta a story',
  ig_mention: 'Mención',
  manychat_event: 'Evento de ManyChat',
  webhook: 'Webhook',
  stage_change: 'Cambio de etapa',
  manual: 'Manual',
};

export default async function AutomatizacionesPage() {
  const org = await getCurrentOrg();
  const db = await getDb();

  const [flows, runs, keywords, catalog] = await Promise.all([
    listAutomations(org.id),
    listRecentRuns(org.id, 15),
    getKeywordPerformance(org.id, defaultRange(90)),
    db
      .select({ id: contents.id, title: contents.title })
      .from(contents)
      .where(eq(contents.orgId, org.id)),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Automatizaciones</h1>
          <p className="mt-1 text-sm text-ink-2">
            Tu propio ManyChat: flujos con ramificación, preguntas que esperan respuesta, y la
            atribución del contenido pegada a cada paso.
          </p>
        </div>
        <NewAutomationForm />
      </header>

      {flows.length === 0 ? (
        <EmptyState
          title="Todavía no hay flujos"
          hint="Creá el primero con el botón de arriba. Arranca con un paso y lo editás en el lienzo."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {flows.map(({ automation, steps }) => {
            const hasBranching = steps.some((step) => step.type === 'condition');
            const hasWait = steps.some((step) => step.type === 'ask_question');
            return (
              <Card key={automation.id}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/automatizaciones/${automation.id}`}
                      className="text-sm font-semibold text-ink hover:underline"
                    >
                      {automation.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{automation.description}</p>
                  </div>
                  <form action={toggleAutomationAction}>
                    <input type="hidden" name="automationId" value={automation.id} />
                    <input type="hidden" name="active" value={String(!automation.active)} />
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-[11px] font-medium hairline"
                      style={{
                        background: automation.active ? 'var(--surface-2)' : 'var(--good)',
                        color: automation.active ? 'var(--ink-2)' : '#fff',
                      }}
                    >
                      {automation.active ? 'Pausar' : 'Activar'}
                    </button>
                  </form>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge color={automation.active ? 'var(--good)' : 'var(--muted)'}>
                    {automation.active ? 'Activa' : 'Pausada'}
                  </Badge>
                  <Badge>{TRIGGER_LABELS[automation.trigger] ?? automation.trigger}</Badge>
                  {hasBranching ? <Badge color="var(--series-2)">con ramas</Badge> : null}
                  {hasWait ? <Badge color="var(--series-1)">espera respuesta</Badge> : null}
                  <span className="text-[11px] text-muted">
                    {formatNumber(automation.runsCount)} ejecuciones
                  </span>
                </div>

                <ol className="space-y-1.5">
                  {steps.slice(0, 6).map((step, index) => (
                    <li key={step.id} className="flex items-start gap-2.5 text-xs">
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                        style={{ background: 'var(--ramp-3)' }}
                        aria-hidden
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{specFor(step.type).label}</span>
                        <span className="block truncate text-muted">{describeStep(step.config)}</span>
                      </span>
                    </li>
                  ))}
                  {steps.length > 6 ? (
                    <li className="pl-7 text-[11px] text-muted">+{steps.length - 6} pasos más</li>
                  ) : null}
                </ol>

                <Link
                  href={`/automatizaciones/${automation.id}`}
                  className="mt-3 inline-block text-xs font-medium text-[var(--series-1)] hover:underline"
                >
                  Editar el flujo →
                </Link>
              </Card>
            );
          })}
        </div>
      )}

      <KeywordManager
        keywords={keywords.map((keyword) => ({
          id: keyword.keywordId,
          word: keyword.word,
          channel: keyword.channel,
          contentTitle: keyword.contentTitle,
          resourceName: keyword.resourceName,
          triggers: keyword.triggers,
          leads: keyword.leads,
        }))}
        contents={catalog}
        automations={flows.map(({ automation }) => ({ id: automation.id, name: automation.name }))}
      />

      <Card>
        <SectionTitle
          title="Últimas ejecuciones"
          hint="Cada paso queda registrado, incluidos los que fallan o se omiten"
        />
        {runs.length === 0 ? (
          <EmptyState title="Sin ejecuciones todavía" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Flujo</Th>
                <Th>Estado</Th>
                <Th>Pasos</Th>
                <Th align="right">Cuándo</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, automation }) => {
                const log = (run.stepsLog as Array<{ type: string; status: string }>) ?? [];
                const failed = log.filter((entry) => entry.status === 'failed').length;
                const skipped = log.filter((entry) => entry.status === 'skipped').length;
                return (
                  <tr key={run.id}>
                    <Td>
                      <span className="text-xs font-medium text-ink">{automation.name}</span>
                    </Td>
                    <Td>
                      <Badge color={runColor(run.status)}>{runLabel(run.status)}</Badge>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {log.length} pasos
                        {failed > 0 ? ` · ${failed} con error` : ''}
                        {skipped > 0 ? ` · ${skipped} omitidos` : ''}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-xs text-muted">{formatDateTime(run.startedAt)}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function describeStep(config: Record<string, unknown>): string {
  if (typeof config.text === 'string') return config.text.slice(0, 80);
  if (Array.isArray(config.tags)) return config.tags.join(', ');
  if (config.stageKey) return `→ ${config.stageKey}`;
  if (config.url) return String(config.url);
  if (Array.isArray(config.checks)) return `${config.checks.length} condiciones`;
  return '';
}

function runColor(status: string): string {
  if (status === 'completed') return 'var(--good)';
  if (status === 'failed') return 'var(--critical)';
  if (status === 'waiting') return 'var(--ramp-3)';
  return 'var(--warning)';
}

function runLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: 'Completada',
    failed: 'Falló',
    waiting: 'Esperando respuesta',
    skipped: 'Omitida',
    running: 'En curso',
    pending: 'Pendiente',
  };
  return labels[status] ?? status;
}
