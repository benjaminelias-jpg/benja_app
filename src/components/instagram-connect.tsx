'use client';

import { useActionState, useState } from 'react';
import { CopyField } from '@/components/copy-field';
import { syncMediaAction, syncInboxAction } from '@/app/inbox/actions';
import {
  saveMetaAppAction,
  forgetMetaAppAction,
  disconnectInstagramAction,
  type CredentialsState,
} from '@/app/integraciones/actions';

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
  manual: 'Manual',
};

const input =
  'h-9 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-ink hairline placeholder:text-muted';

/**
 * Conexión de Instagram en tres pasos.
 *
 * Lo único que Meta no permite saltear es tener una app propia: sin eso no hay
 * forma de pedirle permisos a una cuenta. Lo que sí se puede evitar —y es lo
 * que hace esta pantalla— es tener que tocar variables de entorno y volver a
 * desplegar cada vez. Se cargan una vez acá y después es un botón.
 */
export function InstagramConnect({
  account,
  defaultMethod,
  configIssue,
  credentialsSource,
  appId,
  redirectUri,
}: {
  account: AccountSummary | null;
  defaultMethod: string;
  configIssue: string | null;
  credentialsSource: 'base' | 'entorno' | 'ninguna';
  appId: string;
  redirectUri: string;
}) {
  const [state, save, saving] = useActionState<CredentialsState, FormData>(saveMetaAppAction, {});
  const [method, setMethod] = useState(defaultMethod);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const hasCredentials = credentialsSource !== 'ninguna' && !configIssue;
  const showForm = editing || !hasCredentials;

  const daysLeft = account?.tokenExpiresAt
    ? Math.round((new Date(account.tokenExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  async function run(label: string, fn: () => Promise<{ dryRun?: boolean; ok: boolean; imported: number; updated: number; errors: string[] }>) {
    setPending(label);
    setResult(null);
    try {
      const outcome = await fn();
      setResult(
        outcome.dryRun
          ? 'Modo simulado: falta el token de Instagram.'
          : !outcome.ok
            ? (outcome.errors[0] ?? 'Falló')
            : `${outcome.imported} nuevos, ${outcome.updated} actualizados.`,
      );
    } finally {
      setPending(null);
    }
  }

  /* ---------------- Cuenta ya conectada ---------------- */
  if (account?.connected) {
    return (
      <div className="space-y-3">
        <dl className="space-y-1.5 text-xs">
          <Row label="Cuenta" value={`@${account.username}`} />
          <Row label="Vía" value={METHOD_LABEL[account.method] ?? account.method} />
          <Row
            label="Token"
            value={
              daysLeft === null
                ? 'sin vencimiento conocido'
                : daysLeft > 0
                  ? `se renueva solo · vence en ${daysLeft} días`
                  : 'vencido — reconectá'
            }
          />
          {account.scopes.length > 0 ? <Row label="Permisos" value={account.scopes.join(', ')} /> : null}
          <Row
            label="Última importación"
            value={account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('es-AR') : 'nunca'}
          />
        </dl>

        {account.lastError ? (
          <p className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--serious)' }}>
            {account.lastError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => run('media', syncMediaAction)}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
          >
            {pending === 'media' ? 'Importando…' : 'Importar publicaciones'}
          </button>
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => run('inbox', syncInboxAction)}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
          >
            {pending === 'inbox' ? 'Bajando…' : 'Bajar conversaciones'}
          </button>
          <a href="/api/instagram/connect" className="rounded-lg px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
            Reconectar
          </a>
          <form action={disconnectInstagramAction}>
            <button type="submit" className="rounded-lg px-3 py-1.5 text-xs" style={{ color: 'var(--critical)' }}>
              Desconectar
            </button>
          </form>
        </div>

        {result ? <p className="text-xs text-ink-2">{result}</p> : null}
      </div>
    );
  }

  /* ---------------- Todavía sin conectar ---------------- */
  return (
    <div className="space-y-4">
      {/* Paso 1 */}
      <Step n={1} title="Creá tu app en Meta (una sola vez)">
        <p className="text-xs text-ink-2">
          Meta exige que la conexión salga de una app tuya: no hay forma de pedirle permisos a una
          cuenta sin eso. Se hace una vez y queda.
        </p>
        <a
          href="https://developers.facebook.com/apps/create/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink"
        >
          Abrir el panel de Meta ↗
        </a>
        <p className="mt-2 text-[11px] text-muted">
          Elegí tipo <strong>Business</strong>, agregá el producto <strong>Instagram</strong> y pegá
          esta dirección en <em>OAuth redirect URIs</em>:
        </p>
        <div className="mt-1.5">
          <CopyField value={redirectUri} />
        </div>
      </Step>

      {/* Paso 2 */}
      <Step n={2} title="Pegá las credenciales">
        {hasCredentials && !showForm ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-2">
              Cargadas{credentialsSource === 'entorno' ? ' por variables de entorno' : ''} · app{' '}
              <code className="rounded bg-surface-2 px-1">{appId}</code>
            </span>
            <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-muted hover:text-ink">
              Cambiar
            </button>
            {credentialsSource === 'base' ? (
              <form action={forgetMetaAppAction}>
                <button type="submit" className="text-[11px] text-muted hover:text-ink">
                  Borrar
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <form action={save} className="space-y-2">
            <fieldset className="mb-1">
              <legend className="mb-1 text-[11px] text-muted">Tipo de app</legend>
              {(['instagram_login', 'unified_login'] as const).map((value) => (
                <label key={value} className="mr-3 inline-flex items-center gap-1.5 text-xs text-ink-2">
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => setMethod(value)}
                  />
                  {METHOD_LABEL[value]}
                </label>
              ))}
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                {method === 'unified_login' ? 'Meta App ID' : 'Instagram App ID'}
              </span>
              <input name="appId" required placeholder="1234567890123456" className={input} />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                {method === 'unified_login' ? 'Meta App Secret' : 'Instagram App Secret'}
              </span>
              <input name="appSecret" required type="password" placeholder="••••••••" className={input} />
            </label>

            {method === 'unified_login' ? (
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Config ID</span>
                <input name="configId" placeholder="De la configuración de Facebook Login" className={input} />
              </label>
            ) : null}

            {state.error ? (
              <p className="text-xs" style={{ color: 'var(--critical)' }}>
                {state.error}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="h-9 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--series-1)' }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
              {editing ? (
                <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-2 hover:text-ink">
                  Cancelar
                </button>
              ) : null}
            </div>
            <p className="text-[10px] text-muted">
              Se guardan en tu base de datos. No hace falta redesplegar ni tocar variables.
            </p>
          </form>
        )}
      </Step>

      {/* Paso 3 */}
      <Step n={3} title="Iniciá sesión y aceptá los permisos">
        {hasCredentials ? (
          <>
            <a
              href="/api/instagram/connect"
              className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: 'var(--series-1)' }}
            >
              Conectar Instagram
            </a>
            <p className="mt-2 text-[11px] text-muted">
              Te lleva a Instagram, iniciás sesión y aceptás. Volvés acá con la cuenta conectada.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">Primero cargá las credenciales del paso 2.</p>
        )}
      </Step>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ background: 'var(--ramp-4)' }}
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-sm font-medium text-ink">{title}</p>
        {children}
      </div>
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
