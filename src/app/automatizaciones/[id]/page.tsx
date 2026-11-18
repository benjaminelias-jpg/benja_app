import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users, products } from '@/db/schema';
import { getCurrentOrg, getDefaultPipeline } from '@/server/context';
import { getAutomation } from '@/server/services/automations';
import { FlowBuilder, type InitialStep } from '@/components/flow/builder';
import { Badge } from '@/components/ui';
import { toggleAutomationAction, deleteAutomationAction } from '../actions';

export const dynamic = 'force-dynamic';

const TRIGGER_LABEL: Record<string, string> = {
  ig_comment_keyword: 'Comentario con palabra clave',
  ig_dm_keyword: 'DM con palabra clave',
  ig_story_reply: 'Respuesta a story',
  ig_mention: 'Mención',
  manychat_event: 'Evento de ManyChat',
  webhook: 'Webhook',
  stage_change: 'Cambio de etapa',
  manual: 'Manual',
};

export default async function FlowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const data = await getAutomation(org.id, id);
  if (!data) notFound();

  const db = await getDb();
  const [pipelineData, team, catalog] = await Promise.all([
    getDefaultPipeline(org.id),
    db.select().from(users).where(and(eq(users.orgId, org.id), eq(users.active, true))),
    db.select().from(products).where(eq(products.orgId, org.id)),
  ]);

  const initialSteps: InitialStep[] = data.steps.map((step) => ({
    nodeId: step.nodeId ?? step.id,
    type: step.type,
    config: step.config ?? {},
    x: step.canvasX,
    y: step.canvasY,
    next: step.nextNodeId,
    branches: (step.branches as Array<{ when: string; goTo: string }>) ?? [],
  }));

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-0px)] flex-col sm:-mx-6 lg:-mx-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-surface px-5 py-3">
        <div className="min-w-0 flex-1">
          <nav className="text-[11px] text-muted">
            <Link href="/automatizaciones" className="hover:underline">
              Automatizaciones
            </Link>
            <span className="mx-1.5">/</span>
          </nav>
          <h1 className="truncate text-sm font-semibold text-ink">{data.automation.name}</h1>
        </div>

        <Badge color={data.automation.active ? 'var(--good)' : 'var(--muted)'}>
          {data.automation.active ? 'Activa' : 'Pausada'}
        </Badge>

        <form action={toggleAutomationAction}>
          <input type="hidden" name="automationId" value={id} />
          <input type="hidden" name="active" value={String(!data.automation.active)} />
          <button
            type="submit"
            className="rounded-md px-2.5 py-1.5 text-[11px] font-medium hairline"
            style={{
              background: data.automation.active ? 'var(--surface-2)' : 'var(--good)',
              color: data.automation.active ? 'var(--ink-2)' : '#fff',
            }}
          >
            {data.automation.active ? 'Pausar' : 'Activar'}
          </button>
        </form>

        <form action={deleteAutomationAction}>
          <input type="hidden" name="automationId" value={id} />
          <button
            type="submit"
            className="rounded-md px-2.5 py-1.5 text-[11px] hairline"
            style={{ color: 'var(--critical)' }}
          >
            Eliminar
          </button>
        </form>
      </header>

      <div className="min-h-0 flex-1">
        <FlowBuilder
          automationId={id}
          name={data.automation.name}
          triggerLabel={TRIGGER_LABEL[data.automation.trigger] ?? data.automation.trigger}
          triggerHint={
            data.automation.trigger === 'ig_comment_keyword'
              ? 'Se dispara cuando alguien comenta una palabra clave asociada a este flujo.'
              : 'Se dispara según la configuración del disparador.'
          }
          initialSteps={initialSteps}
          options={{
            stages: (pipelineData?.stages ?? []).map((stage) => ({
              value: stage.key,
              label: stage.name,
            })),
            users: team.map((member) => ({ value: member.id, label: member.name })),
            products: catalog.map((product) => ({ value: product.id, label: product.name })),
          }}
        />
      </div>
    </div>
  );
}
