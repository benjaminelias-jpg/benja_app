import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { instagramAccounts } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { InstagramConnect } from '@/components/instagram-connect';
import { missingConfig, redirectUri, getMetaCredentials } from '@/server/integrations/instagram-oauth';
import { listEndpoints, listRecentDeliveries } from '@/server/services/webhooks';
import {
  listSubscriptions,
  listOutboundDeliveries,
  SUBSCRIBABLE_EVENTS,
  signatureSnippet,
} from '@/server/services/outbound';
import { OutboundWebhooks } from '@/components/outbound-webhooks';
import Link from 'next/link';
import { listApiKeys } from '@/server/auth/apiKey';
import { env } from '@/lib/env';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ApiKeyCreator, EndpointCreator } from '@/components/integration-forms';
import { revokeApiKeyAction, deleteEndpointAction, rotateSecretAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function IntegracionesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const feedback = await searchParams;
  const org = await getCurrentOrg();
  const db = await getDb();

  const credentials = await getMetaCredentials(org.id);
  const [endpoints, deliveries, keys, accounts, subscriptions, outbound] = await Promise.all([
    listEndpoints(org.id),
    listRecentDeliveries(20),
    listApiKeys(org.id),
    db.select().from(instagramAccounts).where(eq(instagramAccounts.orgId, org.id)),
    listSubscriptions(org.id),
    listOutboundDeliveries(org.id, 20),
  ]);

  const base = env.appUrl;
  const account = accounts[0];

  return (
    <div className="space-y-5">
      {feedback.ok || feedback.error ? (
        <div
          className="rounded-xl px-4 py-3 text-sm hairline"
          style={{
            background: 'var(--surface-1)',
            color: feedback.ok ? 'var(--good-text)' : 'var(--critical)',
          }}
          role="status"
        >
          {feedback.ok ?? feedback.error}
        </div>
      ) : null}

      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Integraciones</h1>
        <p className="mt-1 text-sm text-ink-2">
          Webhooks, Instagram y la API publica. Todo lo que entra pasa por el mismo pipeline de
          atribucion.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Instagram" hint="Conexión de la cuenta y webhook de Meta" />

          {account ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge color={account.connected ? 'var(--good)' : 'var(--warning)'}>
                {account.connected ? 'Conectada' : 'Pendiente'}
              </Badge>
              <span className="text-sm text-ink">@{account.username}</span>
              <span className="text-xs text-muted">
                {formatNumber(account.followersCount, true)} seguidores
              </span>
            </div>
          ) : null}

          <InstagramConnect
            account={
              account
                ? {
                    connected: account.connected,
                    username: account.username,
                    method: account.connectionMethod,
                    scopes: account.scopes,
                    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
                    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
                    lastInboxSyncAt: account.lastInboxSyncAt?.toISOString() ?? null,
                    lastError: account.lastError,
                  }
                : null
            }
            defaultMethod={credentials.method}
            configIssue={missingConfig(credentials)}
            credentialsSource={credentials.source}
            appId={credentials.appId}
            redirectUri={redirectUri()}
          />

          <div className="mt-4 border-t border-[var(--grid)] pt-3">
          <Field label="Redirect URI a registrar en Meta" value={redirectUri()} />
          <Field label="URL de callback del webhook" value={`${base}/api/webhooks/instagram`} />
          <Field label="Verify token" value={env.metaVerifyToken} />
          <Field
            label="Campos a suscribir"
            value="comments, messages, mentions, message_reactions"
          />
          <p className="mt-3 text-xs text-muted">
            En la app de Meta, apunta el webhook a esa URL. El handshake GET responde solo si el
            token coincide; cada POST se valida con la firma{' '}
            <code className="rounded bg-surface-2 px-1">X-Hub-Signature-256</code> cuando hay{' '}
            <code className="rounded bg-surface-2 px-1">META_APP_SECRET</code>.
          </p>
          {env.dryRunOutbound ? (
            <p
              className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--surface-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" className="mt-px shrink-0" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <span className="text-ink-2">
                <strong>Modo simulado:</strong> sin{' '}
                <code className="rounded bg-surface px-1">INSTAGRAM_ACCESS_TOKEN</code> los DMs se
                registran en el CRM pero no salen a Instagram. Todo el embudo se puede probar igual.
              </span>
            </p>
          ) : null}
          </div>
        </Card>

        <Card>
          <SectionTitle title="ManyChat" hint="Bloque External Request hacia el CRM" />
          <Field label="URL" value={`${base}/api/webhooks/manychat`} />
          <Field label="Header" value="x-hook-secret: <MANYCHAT_WEBHOOK_SECRET>" />
          <p className="mt-3 mb-2 text-xs text-ink-2">
            El mismo endpoint sirve para las cuatro cosas, distinguidas por <code className="rounded bg-surface-2 px-1">event</code>:
          </p>
          <pre className="scroll-thin overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">
{`{
  "event": "keyword",            // lead + atribucion
  "subscriber_id": "{{user_id}}",
  "ig_username": "{{ig_username}}",
  "keyword": "GUIA",
  "ig_media_id": "{{media_id}}"
}

{ "event": "reu",   "scheduled_at": "2026-03-01T15:00:00Z" }
{ "event": "venta", "amount": "1497", "currency": "USD" }
{ "event": "no_show" }`}
          </pre>
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Webhooks configurables"
          hint="Calendly, Cal.com, Hotmart, Stripe, Make... sin tocar codigo"
          action={<EndpointCreator />}
        />
        {endpoints.length === 0 ? (
          <EmptyState title="Sin endpoints" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>URL</Th>
                <Th>Mapeo</Th>
                <Th align="right">Entregas</Th>
                <Th align="right">Ultima</Th>
                <Th align="right">—</Th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.id}>
                  <Td>
                    <span className="text-xs font-medium text-ink">{endpoint.name}</span>
                    <Badge>{endpoint.provider}</Badge>
                  </Td>
                  <Td>
                    <code className="text-[11px] text-ink-2">/api/webhooks/{endpoint.slug}</code>
                  </Td>
                  <Td>
                    <code className="line-clamp-2 text-[10px] text-muted">
                      {JSON.stringify(endpoint.mapping)}
                    </code>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted">Ver secreto</summary>
                      <code className="mt-1 block text-[10px] text-ink-2" data-secret={endpoint.slug}>
                        {endpoint.secret}
                      </code>
                    </details>
                  </Td>
                  <Td align="right">{formatNumber(endpoint.deliveriesCount)}</Td>
                  <Td align="right">
                    <span className="text-xs text-muted">
                      {endpoint.lastDeliveryAt ? formatDateTime(endpoint.lastDeliveryAt) : '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1.5">
                      <form action={rotateSecretAction}>
                        <input type="hidden" name="endpointId" value={endpoint.id} />
                        <button type="submit" className="text-[10px] text-muted hover:text-ink" title="Genera un secreto nuevo: hay que actualizarlo en la herramienta">
                          Rotar
                        </button>
                      </form>
                      <form action={deleteEndpointAction}>
                        <input type="hidden" name="endpointId" value={endpoint.id} />
                        <button type="submit" className="text-[10px] text-muted hover:text-ink">
                          Borrar
                        </button>
                      </form>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted">
          El mapeo traduce el payload de cualquier herramienta al vocabulario del CRM:{' '}
          <code className="rounded bg-surface-2 px-1">{'{ "email": "payload.invitee.email" }'}</code>.
          Un valor que empieza con <code className="rounded bg-surface-2 px-1">=</code> es literal.
        </p>
      </Card>

      <Card>
        <SectionTitle title="API publica" hint="Para conectar lo que no tiene integracion propia" />
        <div className="space-y-2 text-xs">
          <Endpoint method="GET" path="/api/v1/leads" description="Listado con filtros" />
          <Endpoint method="POST" path="/api/v1/leads" description="Crear o actualizar un lead (resuelve atribucion)" />
          <Endpoint method="GET" path="/api/v1/leads/:id" description="Ficha con timeline, reuniones y ventas" />
          <Endpoint method="PATCH" path="/api/v1/leads/:id" description="Mover de etapa, asignar, etiquetar" />
          <Endpoint method="POST" path="/api/v1/conversions" description="Marcar reunion, no-show, venta o reembolso" />
          <Endpoint method="GET" path="/api/v1/contents" description="Catalogo de contenidos" />
          <Endpoint method="GET" path="/api/v1/analytics/content" description="Reporte de atribucion por contenido" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-ink">Claves activas</p>
          {keys.length === 0 ? (
            <p className="text-xs text-muted">
              Ninguna clave creada. En desarrollo la API responde sin clave usando la organizacion
              por defecto; en produccion la clave es obligatoria.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3">
                  <span className={key.revokedAt ? 'text-muted line-through' : 'text-ink-2'}>
                    {key.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <code className="text-muted">{key.prefix}••••••••</code>
                    {key.revokedAt ? (
                      <span className="text-[10px] text-muted">revocada</span>
                    ) : (
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="apiKeyId" value={key.id} />
                        <button type="submit" className="text-[10px] text-muted hover:text-ink">
                          Revocar
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <ApiKeyCreator />
        </div>
      </Card>

      <OutboundWebhooks
        subscriptions={subscriptions.map((subscription) => ({
          id: subscription.id,
          name: subscription.name,
          url: subscription.url,
          events: subscription.events,
          secret: subscription.secret,
          active: subscription.active,
          deliveredCount: subscription.deliveredCount,
          failedCount: subscription.failedCount,
          lastStatus: subscription.lastStatus,
          lastError: subscription.lastError,
          lastDeliveryAt: subscription.lastDeliveryAt?.toISOString() ?? null,
        }))}
        deliveries={outbound.map((row) => ({
          id: row.delivery.id,
          subscriptionName: row.subscription.name,
          eventType: row.delivery.eventType,
          status: row.delivery.status,
          attempts: row.delivery.attempts,
          responseStatus: row.delivery.responseStatus,
          error: row.delivery.error,
          durationMs: row.delivery.durationMs,
          createdAt: row.delivery.createdAt.toISOString(),
        }))}
        events={SUBSCRIBABLE_EVENTS}
        signatureSnippet={signatureSnippet()}
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Conectá tu Claude</h2>
            <p className="mt-1 max-w-xl text-xs text-ink-2">
              El CRM expone un servidor MCP propio. Conectalo a Claude Code, a claude.ai o a Claude
              Desktop y tu Claude puede leer la atribución, revisar la bandeja y operar el pipeline
              con tu sesión.
            </p>
          </div>
          <Link
            href="/claude"
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--series-1)' }}
          >
            Ver cómo conectarlo
          </Link>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Ultimas entregas recibidas"
          hint="Payload crudo guardado antes de procesar, para depurar cuando algo falla"
        />
        {deliveries.length === 0 ? (
          <EmptyState
            title="Sin entregas"
            hint={`curl -X POST ${base}/api/webhooks/manychat -H 'content-type: application/json' -d '{"event":"keyword","keyword":"GUION","ig_username":"test.user"}'`}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Proveedor</Th>
                <Th>Estado</Th>
                <Th>Error</Th>
                <Th align="right">Duracion</Th>
                <Th align="right">Recibida</Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <Td>
                    <span className="text-xs">{delivery.provider}</span>
                  </Td>
                  <Td>
                    <Badge color={statusColor(delivery.status)}>{delivery.status}</Badge>
                  </Td>
                  <Td>
                    <span className="line-clamp-1 text-[11px] text-muted">{delivery.error ?? '—'}</span>
                  </Td>
                  <Td align="right">
                    <span className="text-xs text-muted">
                      {delivery.durationMs ? `${delivery.durationMs} ms` : '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-xs text-muted">{formatDateTime(delivery.receivedAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2">
      <p className="text-[11px] text-muted">{label}</p>
      <code className="mt-0.5 block overflow-x-auto rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
        {value}
      </code>
    </div>
  );
}

function Endpoint({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description: string;
}) {
  const colors: Record<string, string> = {
    GET: 'var(--series-1)',
    POST: 'var(--series-3)',
    PATCH: 'var(--series-2)',
  };
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className="w-[52px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold text-white"
        style={{ background: colors[method] ?? 'var(--muted)' }}
      >
        {method}
      </span>
      <code className="text-[11px] text-ink">{path}</code>
      <span className="text-[11px] text-muted">{description}</span>
    </div>
  );
}

function statusColor(status: string): string {
  if (status === 'processed') return 'var(--good)';
  if (status === 'failed') return 'var(--critical)';
  if (status === 'ignored') return 'var(--warning)';
  return 'var(--muted)';
}
