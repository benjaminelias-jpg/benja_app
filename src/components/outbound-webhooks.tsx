'use client';

import { useActionState, useState } from 'react';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge } from '@/components/ui';
import { CopyField } from '@/components/copy-field';
import {
  createSubscriptionAction,
  toggleSubscriptionAction,
  deleteSubscriptionAction,
  testSubscriptionAction,
  retryDeliveryAction,
} from '@/app/integraciones/actions';

export interface SubscriptionRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  deliveredCount: number;
  failedCount: number;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
}

export interface DeliveryRow {
  id: string;
  subscriptionName: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

/**
 * Webhooks salientes: el CRM avisando a otras herramientas.
 *
 * Es la otra mitad de las integraciones. Sin esto, conectar el CRM con Make,
 * Zapier o un backend propio obliga a consultar la API cada tantos minutos.
 */
export function OutboundWebhooks({
  subscriptions,
  deliveries,
  events,
  signatureSnippet,
}: {
  subscriptions: SubscriptionRow[];
  deliveries: DeliveryRow[];
  events: Array<{ value: string; label: string; group: string }>;
  signatureSnippet: string;
}) {
  const [open, setOpen] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  const groups = Array.from(new Set(events.map((event) => event.group)));

  return (
    <>
      <Card>
        <SectionTitle
          title="Webhooks salientes"
          hint="El CRM avisa a otras apps cuando entra un lead, se agenda una reu o se cierra una venta"
          action={
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDocs((value) => !value)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink"
              >
                {showDocs ? 'Ocultar docs' : 'Cómo verificar la firma'}
              </button>
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink"
              >
                {open ? 'Cancelar' : 'Nuevo webhook saliente'}
              </button>
            </span>
          }
        />

        {showDocs ? (
          <div className="mb-4 rounded-xl bg-surface-2 p-3">
            <p className="mb-2 text-xs text-ink-2">
              Cada entrega llega por <code>POST</code> con el evento en el cuerpo y estas cabeceras:
            </p>
            <ul className="mb-3 space-y-0.5 text-[11px] text-muted">
              <li>
                <code className="text-ink-2">x-hook-event</code> — tipo de evento
              </li>
              <li>
                <code className="text-ink-2">x-hook-delivery</code> — id único; sirve para
                descartar duplicados
              </li>
              <li>
                <code className="text-ink-2">x-hook-timestamp</code> — segundos UNIX
              </li>
              <li>
                <code className="text-ink-2">x-hook-signature-256</code> —{' '}
                <code>sha256=HMAC(timestamp + &quot;.&quot; + cuerpo, secreto)</code>
              </li>
            </ul>
            <CopyField value={signatureSnippet} multiline />
            <p className="mt-1 text-[10px] text-muted">
              Si falla, el CRM reintenta 5 veces con espera creciente (1 min, 5, 30, 2 h, 6 h).
            </p>
          </div>
        ) : null}

        {open ? (
          <form action={createSubscriptionAction} className="mb-4 space-y-3 rounded-xl bg-surface-2 p-3 hairline">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Nombre</span>
                <input
                  name="name"
                  required
                  placeholder="Make — alta de clientes"
                  className="h-9 rounded-lg bg-surface px-2.5 text-sm text-ink hairline"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">URL de destino</span>
                <input
                  name="url"
                  required
                  type="url"
                  placeholder="https://hook.make.com/…"
                  className="h-9 rounded-lg bg-surface px-2.5 text-sm text-ink hairline"
                />
              </label>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-[11px] text-muted">
                Eventos (si no elegís ninguno, se mandan todos)
              </legend>
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">{group}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {events
                        .filter((event) => event.group === group)
                        .map((event) => (
                          <label key={event.value} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                            <input type="checkbox" name="events" value={event.value} />
                            {event.label}
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              className="h-9 rounded-lg px-3 text-sm font-medium text-white"
              style={{ background: 'var(--series-1)' }}
            >
              Crear webhook
            </button>
          </form>
        ) : null}

        {subscriptions.length === 0 ? (
          <EmptyState
            title="Sin webhooks salientes"
            hint="Creá uno para que el CRM avise a Make, Zapier, n8n, Slack o tu propio backend."
          />
        ) : (
          <ul className="space-y-3">
            {subscriptions.map((subscription) => (
              <li key={subscription.id} className="rounded-xl bg-surface-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {subscription.name}
                      <Badge color={subscription.active ? 'var(--good)' : 'var(--muted)'}>
                        {subscription.active ? 'Activo' : 'Pausado'}
                      </Badge>
                    </p>
                    <code className="mt-0.5 block truncate text-[11px] text-muted">{subscription.url}</code>
                    <p className="mt-1 text-[11px] text-muted">
                      {subscription.events.includes('*')
                        ? 'todos los eventos'
                        : `${subscription.events.length} eventos: ${subscription.events.slice(0, 4).join(', ')}${subscription.events.length > 4 ? '…' : ''}`}
                      {' · '}
                      {subscription.deliveredCount} entregados
                      {subscription.failedCount > 0 ? ` · ${subscription.failedCount} fallidos` : ''}
                    </p>
                    {subscription.lastError ? (
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--critical)' }}>
                        último error: {subscription.lastError}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <TestButton subscriptionId={subscription.id} />
                    <form action={toggleSubscriptionAction}>
                      <input type="hidden" name="subscriptionId" value={subscription.id} />
                      <input type="hidden" name="active" value={String(!subscription.active)} />
                      <button type="submit" className="rounded-md px-2 py-1 text-[11px] text-ink-2 hairline hover:text-ink">
                        {subscription.active ? 'Pausar' : 'Activar'}
                      </button>
                    </form>
                    <form action={deleteSubscriptionAction}>
                      <input type="hidden" name="subscriptionId" value={subscription.id} />
                      <button type="submit" className="rounded-md px-2 py-1 text-[11px] hairline" style={{ color: 'var(--critical)' }}>
                        Borrar
                      </button>
                    </form>
                  </div>
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-muted">Ver secreto de firma</summary>
                  <div className="mt-1.5">
                    <CopyField value={subscription.secret} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Entregas salientes" hint="Qué mandó el CRM y qué contestó cada destino" />
        {deliveries.length === 0 ? (
          <EmptyState title="Sin entregas todavía" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Destino</Th>
                <Th>Evento</Th>
                <Th>Estado</Th>
                <Th align="right">Intentos</Th>
                <Th align="right">Respuesta</Th>
                <Th align="right">Cuándo</Th>
                <Th align="right">—</Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <Td>
                    <span className="text-xs">{delivery.subscriptionName}</span>
                  </Td>
                  <Td>
                    <code className="text-[11px] text-ink-2">{delivery.eventType}</code>
                  </Td>
                  <Td>
                    <Badge color={statusColor(delivery.status)}>{statusLabel(delivery.status)}</Badge>
                  </Td>
                  <Td align="right">{delivery.attempts}</Td>
                  <Td align="right">
                    <span className="text-xs text-muted">
                      {delivery.responseStatus ?? delivery.error?.slice(0, 24) ?? '—'}
                      {delivery.durationMs ? ` · ${delivery.durationMs} ms` : ''}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-xs text-muted">
                      {new Date(delivery.createdAt).toLocaleString('es-AR')}
                    </span>
                  </Td>
                  <Td align="right">
                    {delivery.status !== 'delivered' ? (
                      <form action={retryDeliveryAction}>
                        <input type="hidden" name="deliveryId" value={delivery.id} />
                        <button type="submit" className="text-[10px] text-muted hover:text-ink">
                          Reintentar
                        </button>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function TestButton({ subscriptionId }: { subscriptionId: string }) {
  const [state, action, pending] = useActionState(testSubscriptionAction, {});

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {state.message ? (
        <span
          className="text-[10px]"
          style={{ color: state.ok ? 'var(--good-text)' : 'var(--critical)' }}
        >
          {state.message}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-2 py-1 text-[11px] text-ink-2 hairline hover:text-ink disabled:opacity-50"
      >
        {pending ? 'Probando…' : 'Probar'}
      </button>
    </form>
  );
}

function statusColor(status: string): string {
  if (status === 'delivered') return 'var(--good)';
  if (status === 'exhausted') return 'var(--critical)';
  if (status === 'retrying') return 'var(--warning)';
  return 'var(--muted)';
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    delivered: 'Entregado',
    pending: 'Pendiente',
    retrying: 'Reintentando',
    exhausted: 'Agotado',
  };
  return labels[status] ?? status;
}
