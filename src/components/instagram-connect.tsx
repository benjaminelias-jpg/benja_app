'use client';

import { useState, useTransition } from 'react';
import { syncMediaAction } from '@/app/inbox/actions';
import { syncInboxAction } from '@/app/inbox/actions';

export interface AccountSummary {
  connected: boolean;
  username: string | null;
  method: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastInboxSyncAt: string | null;
  lastError: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  instagram_login: 'Instagram Login',
  unified_login: 'Unified Login (Facebook Login for Business)',
  manual: 'Manual / datos de ejemplo',
};

/**
 * Conexión de la cuenta y sincronización.
 *
 * Ofrece los dos caminos de Meta porque cuál sirve depende de cómo esté dada de
 * alta la app del usuario, y equivocarse da un error opaco en el panel de Meta.
 */
export function InstagramConnect({
  account,
  defaultMethod,
  configIssue,
}: {
  account: AccountSummary | null;
  defaultMethod: string;
  configIssue: string | null;
}) {
  const [method, setMethod] = useState(defaultMethod);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const daysLeft = account?.tokenExpiresAt
    ? Math.round((new Date(account.tokenExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="space-y-3">
      {account?.connected ? (
        <>
          <dl className="space-y-1.5 text-xs">
            <Row label="Cuenta" value={`@${account.username}`} />
            <Row label="Vía" value={METHOD_LABEL[account.method] ?? account.method} />
            <Row
              label="Token"
              value={
                daysLeft === null
                  ? 'sin vencimiento conocido'
                  : daysLeft > 0
                    ? `vence en ${daysLeft} días`
                    : 'vencido — reconectá'
              }
            />
            {account.scopes.length > 0 ? (
              <Row label="Permisos" value={account.scopes.join(', ')} />
            ) : null}
            <Row
              label="Última importación"
              value={account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('es-AR') : 'nunca'}
            />
          </dl>

          {account.lastError ? (
            <p
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--serious)' }}
            >
              {account.lastError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(null);
                  const outcome = await syncMediaAction();
                  setResult(
                    outcome.dryRun
                      ? 'Modo simulado: configurá el token para importar de verdad.'
                      : `Publicaciones: ${outcome.imported} nuevas, ${outcome.updated} actualizadas.`,
                  );
                })
              }
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
            >
              Importar publicaciones
            </button>

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(null);
                  const outcome = await syncInboxAction();
                  setResult(
                    outcome.dryRun
                      ? 'Modo simulado: configurá el token para bajar la bandeja real.'
                      : `Bandeja: ${outcome.imported} hilos, ${outcome.updated} mensajes.`,
                  );
                })
              }
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
            >
              Bajar conversaciones
            </button>

            <a
              href={`/api/instagram/connect?method=${account.method}`}
              className="rounded-lg px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
            >
              Reconectar
            </a>
          </div>

          {pending ? <p className="text-xs text-muted">Sincronizando…</p> : null}
          {result ? <p className="text-xs text-ink-2">{result}</p> : null}
        </>
      ) : (
        <>
          <p className="text-xs text-ink-2">
            Conectá tu cuenta profesional para recibir comentarios y DMs, responder desde la bandeja
            e importar tus publicaciones con sus métricas.
          </p>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-medium text-muted">Camino de conexión</legend>
            {(['instagram_login', 'unified_login'] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  name="method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-ink">{METHOD_LABEL[value]}</span>
                  <span className="block text-[11px] text-muted">
                    {value === 'instagram_login'
                      ? 'Token de Instagram, sin página de Facebook. Necesita INSTAGRAM_APP_ID y SECRET.'
                      : 'Token de sistema del portafolio de negocio. Necesita META_APP_ID, SECRET y CONFIG_ID.'}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {configIssue ? (
            <p
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--serious)' }}
            >
              {configIssue}
            </p>
          ) : null}

          <a
            href={`/api/instagram/connect?method=${method}`}
            className="inline-block rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--series-1)' }}
          >
            Conectar Instagram
          </a>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink-2">{value}</dd>
    </div>
  );
}
