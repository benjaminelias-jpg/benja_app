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

  /* ---------------- Ya hay app de Meta: un solo boton ---------------- */
  if (hasCredentials && !showForm) {
    return (
      <div className="space-y-3">
        <a
          href="/api/instagram/connect"
          className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white"
          style={{ background: 'var(--series-1)' }}
        >
          Iniciar sesión con Instagram
        </a>
        <p className="text-xs text-ink-2">
          Te lleva a Instagram, aceptás los permisos y volvés acá con la cuenta conectada.
        </p>

        <details className="group">
          <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink">
            Configuración avanzada
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>
              App de Meta <code className="rounded bg-surface-2 px-1">{appId}</code>
              {credentialsSource === 'entorno' ? ' (por variables de entorno)' : ''}
            </span>
            <button type="button" onClick={() => setEditing(true)} className="hover:text-ink">
              Cambiar
            </button>
            {credentialsSource === 'base' ? (
              <form action={forgetMetaAppAction}>
                <button type="submit" className="hover:text-ink">
                  Borrar
                </button>
              </form>
            ) : null}
          </div>
        </details>
      </div>
    );
  }

  /* ---------------- Configuracion inicial: una sola vez ---------------- */
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">Configuración inicial</p>
        <p className="mt-0.5 text-xs text-ink-2">
          Se hace una sola vez. Después, conectar una cuenta es un botón.
        </p>
      </div>

      <p className="text-xs text-ink-2">
        Instagram no deja que una app ajena le pida permisos a tu cuenta: la conexión tiene que
        salir de una app tuya. Creala y pegá sus dos claves acá abajo.
      </p>

      <ol className="space-y-2 text-xs text-ink-2">
        <li className="flex gap-2">
          <span className="text-muted">1.</span>
          <span>
            <a
              href="https://developers.facebook.com/apps/create/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Creá la app en Meta ↗
            </a>{' '}
            — tipo <strong>Business</strong>, y agregale el producto <strong>Instagram</strong>.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted">2.</span>
          <span className="min-w-0 flex-1">
            Pegá esta dirección en <em>OAuth redirect URIs</em>:
            <span className="mt-1 block">
              <CopyField value={redirectUri} />
            </span>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted">3.</span>
          <span>Copiá de ahí el App ID y el App Secret:</span>
        </li>
      </ol>

      <form action={save} className="space-y-2">
        <input type="hidden" name="method" value={method} />

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

        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--series-1)' }}
          >
            {saving ? 'Guardando…' : 'Guardar y conectar'}
          </button>
          {editing ? (
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-2 hover:text-ink">
              Cancelar
            </button>
          ) : null}
        </div>

        <p className="text-[10px] text-muted">
          Quedan guardadas en tu base. Al guardar te mandamos derecho al login de Instagram.
        </p>

        <details>
          <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink">
            Mi app usa Facebook Login for Business
          </summary>
          <div className="mt-1.5 text-[11px] text-ink-2">
            {(['instagram_login', 'unified_login'] as const).map((value) => (
              <label key={value} className="mr-3 inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="methodPicker"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                />
                {METHOD_LABEL[value]}
              </label>
            ))}
          </div>
        </details>
      </form>
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
