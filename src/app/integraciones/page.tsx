import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { instagramAccounts } from '@/db/schema';
import { getCurrentOrg } from '@/server/context';
import { listEndpoints, listRecentDeliveries } from '@/server/services/webhooks';
import { listApiKeys } from '@/server/auth/apiKey';
import { env } from '@/lib/env';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function IntegracionesPage() {
  const org = await getCurrentOrg();
  const db = await getDb();

  const [endpoints, deliveries, keys, accounts] = await Promise.all([
    listEndpoints(org.id),
    listRecentDeliveries(20),
    listApiKeys(org.id),
    db.select().from(instagramAccounts).where(eq(instagramAccounts.orgId, org.id)),
  ]);

  const base = env.appUrl;
  const account = accounts[0];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Integraciones</h1>
        <p className="mt-1 text-sm text-ink-2">
          Webhooks, Instagram y la API publica. Todo lo que entra pasa por el mismo pipeline de
          atribucion.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Instagram" hint="Webhook de Meta para comentarios, DMs y stories" />
          {account ? (
            <div className="mb-4 flex items-center gap-2">
              <Badge color={account.connected ? 'var(--good)' : 'var(--warning)'}>
                {account.connected ? 'Conectada' : 'Pendiente'}
              </Badge>
              <span className="text-sm text-ink">@{account.username}</span>
              <span className="text-xs text-muted">
                {formatNumber(account.followersCount, true)} seguidores
              </span>
            </div>
          ) : (
            <EmptyState title="Sin cuenta conectada" />
          )}

          <Field label="URL de callback" value={`${base}/api/webhooks/instagram`} />
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
              por defecto.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3">
                  <span className="text-ink-2">{key.name}</span>
                  <code className="text-muted">{key.prefix}••••••••</code>
                </li>
              ))}
            </ul>
          )}
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
