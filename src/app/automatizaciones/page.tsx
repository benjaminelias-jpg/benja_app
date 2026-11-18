import { getCurrentOrg } from '@/server/context';
import { listAutomations, listRecentRuns } from '@/server/services/automations';
import { getKeywordPerformance, defaultRange } from '@/server/services/analytics';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge } from '@/components/ui';
import { toggleAutomationAction } from '@/app/actions';
import { formatNumber, formatDateTime } from '@/lib/format';
import type { AutomationStep } from '@/db/schema';

export const dynamic = 'force-dynamic';

const STEP_LABELS: Record<AutomationStep['type'], string> = {
  send_dm: 'Enviar DM',
  reply_comment: 'Responder comentario',
  send_resource: 'Entregar recurso',
  add_tag: 'Etiquetar',
  remove_tag: 'Quitar etiqueta',
  set_stage: 'Mover de etapa',
  set_field: 'Escribir campo',
  assign_owner: 'Asignar responsable',
  create_appointment: 'Agendar reunion',
  create_deal: 'Registrar venta',
  http_request: 'Llamar webhook externo',
  wait: 'Esperar',
  notify: 'Notificar al equipo',
};

const TRIGGER_LABELS: Record<string, string> = {
  ig_comment_keyword: 'Comentario con palabra clave',
  ig_dm_keyword: 'DM con palabra clave',
  ig_story_reply: 'Respuesta a story',
  ig_mention: 'Mencion',
  manychat_event: 'Evento de ManyChat',
  webhook: 'Webhook',
  stage_change: 'Cambio de etapa',
  manual: 'Manual',
};

export default async function AutomatizacionesPage() {
  const org = await getCurrentOrg();
  const [automations, runs, keywords] = await Promise.all([
    listAutomations(org.id),
    listRecentRuns(org.id, 15),
    getKeywordPerformance(org.id, defaultRange(90)),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Automatizaciones</h1>
        <p className="mt-1 text-sm text-ink-2">
          El flujo de “responde X y te paso Y”, con la atribucion del contenido pegada a cada paso.
        </p>
      </header>

      {automations.length === 0 ? (
        <EmptyState title="Sin automatizaciones" hint="Ejecuta `npm run setup` para cargar las de ejemplo." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {automations.map(({ automation, steps }) => (
            <Card key={automation.id}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">{automation.name}</h2>
                  <p className="mt-0.5 text-xs text-muted">{automation.description}</p>
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
                <span className="text-[11px] text-muted">
                  {formatNumber(automation.runsCount)} ejecuciones
                </span>
              </div>

              <ol className="space-y-1.5">
                {steps.map((step, index) => (
                  <li key={step.id} className="flex items-start gap-2.5 text-xs">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                      style={{ background: 'var(--ramp-3)' }}
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{STEP_LABELS[step.type]}</span>
                      <span className="block truncate text-muted">{describeStep(step)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <SectionTitle
          title="Palabras clave"
          hint="Cada palabra ata un contenido con el recurso que entrega"
        />
        {keywords.length === 0 ? (
          <EmptyState title="Sin palabras clave" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Palabra</Th>
                <Th>Canal</Th>
                <Th>Contenido</Th>
                <Th>Recurso</Th>
                <Th align="right">Disparos</Th>
                <Th align="right">Leads</Th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((keyword) => (
                <tr key={keyword.keywordId}>
                  <Td>
                    <span className="font-mono text-xs font-medium text-ink">{keyword.word}</span>
                  </Td>
                  <Td>
                    <span className="text-xs">{keyword.channel === 'ig_comment' ? 'Comentario' : 'DM'}</span>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 text-xs">{keyword.contentTitle ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 text-xs text-muted">{keyword.resourceName ?? '—'}</span>
                  </Td>
                  <Td align="right">{formatNumber(keyword.triggers)}</Td>
                  <Td align="right">{formatNumber(keyword.leads)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle title="Ultimas ejecuciones" hint="Cada paso queda registrado, incluidos los que fallan" />
        {runs.length === 0 ? (
          <EmptyState title="Sin ejecuciones todavia" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Automatizacion</Th>
                <Th>Estado</Th>
                <Th>Pasos</Th>
                <Th align="right">Cuando</Th>
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
                      <Badge
                        color={
                          run.status === 'completed'
                            ? 'var(--good)'
                            : run.status === 'failed'
                              ? 'var(--critical)'
                              : 'var(--warning)'
                        }
                      >
                        {run.status === 'completed' ? 'Completada' : run.status === 'failed' ? 'Fallo' : run.status}
                      </Badge>
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

function describeStep(step: AutomationStep): string {
  const config = step.config as Record<string, unknown>;
  switch (step.type) {
    case 'send_dm':
    case 'send_resource':
    case 'reply_comment':
      return String(config.text ?? '').slice(0, 90);
    case 'add_tag':
    case 'remove_tag':
      return Array.isArray(config.tags) ? config.tags.join(', ') : String(config.tags ?? '');
    case 'set_stage':
      return `→ ${config.stageKey ?? config.stageId ?? ''}`;
    case 'assign_owner':
      return config.strategy === 'round_robin' ? 'reparto equitativo' : String(config.ownerId ?? '');
    case 'wait':
      return `${config.minutes ?? 0} minutos`;
    case 'http_request':
      return String(config.url ?? '');
    default:
      return '';
  }
}
