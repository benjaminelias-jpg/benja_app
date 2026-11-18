'use client';

import { useState } from 'react';
import { CopyField } from '@/components/copy-field';

type Client = 'code' | 'web' | 'desktop';

const TABS: Array<{ id: Client; label: string; hint: string }> = [
  { id: 'code', label: 'Claude Code', hint: 'terminal / IDE' },
  { id: 'web', label: 'claude.ai', hint: 'conector personalizado' },
  { id: 'desktop', label: 'Claude Desktop', hint: 'servidor local' },
];

/**
 * Instrucciones de conexión por cliente.
 *
 * Cada Claude se conecta distinto y equivocarse da errores poco claros, así que
 * cada camino va con el comando exacto, ya armado con la URL de esta instancia.
 */
export function ClaudeSetup({
  mcpUrl,
  projectPath,
  isLocal,
}: {
  mcpUrl: string;
  projectPath: string;
  isLocal: boolean;
}) {
  const [tab, setTab] = useState<Client>('code');
  const [key, setKey] = useState('');
  const token = key.trim() || 'TU_CLAVE_DE_API';

  return (
    <div>
      <label className="mb-4 block">
        <span className="mb-1 block text-[11px] text-muted">
          Pegá acá tu clave para que los comandos salgan listos para copiar
        </span>
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="hk_live_…"
          spellCheck={false}
          className="h-9 w-full max-w-md rounded-lg bg-surface-2 px-2.5 font-mono text-sm text-ink hairline placeholder:text-muted"
        />
        <span className="mt-1 block text-[10px] text-muted">
          No se guarda ni se envía a ningún lado: solo se usa para armar el texto de abajo.
        </span>
      </label>

      <div className="mb-4 flex gap-1 border-b border-[var(--grid)]" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className="-mb-px border-b-2 px-3 py-2 text-sm"
            style={{
              borderColor: tab === item.id ? 'var(--series-1)' : 'transparent',
              color: tab === item.id ? 'var(--ink)' : 'var(--ink-2)',
              fontWeight: tab === item.id ? 600 : 400,
            }}
          >
            {item.label}
            <span className="ml-1.5 text-[10px] text-muted">{item.hint}</span>
          </button>
        ))}
      </div>

      {tab === 'code' ? (
        <div>
          <p className="mb-3 text-sm text-ink-2">
            Un comando en la terminal, dentro del proyecto donde quieras usarlo:
          </p>
          <CopyField
            value={`claude mcp add --transport http hook-crm ${mcpUrl} --header "Authorization: Bearer ${token}"`}
          />
          <p className="mb-2 mt-4 text-xs text-ink-2">
            Por defecto queda disponible solo en ese proyecto. Para tenerlo en todos:
          </p>
          <CopyField
            value={`claude mcp add --transport http --scope user hook-crm ${mcpUrl} --header "Authorization: Bearer ${token}"`}
          />
          <p className="mt-4 text-xs text-muted">
            Verificá con <code className="rounded bg-surface-2 px-1">claude mcp list</code>, o escribí{' '}
            <code className="rounded bg-surface-2 px-1">/mcp</code> dentro de Claude Code. Para
            sacarlo: <code className="rounded bg-surface-2 px-1">claude mcp remove hook-crm</code>.
          </p>
        </div>
      ) : null}

      {tab === 'web' ? (
        <div>
          {isLocal ? (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--surface-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" className="mt-px shrink-0" aria-hidden>
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              <span className="text-ink-2">
                Esta instancia corre en <code>localhost</code>. claude.ai se conecta desde la nube de
                Anthropic, así que necesita una URL pública por HTTPS en el puerto 443. Desplegá el
                CRM (Vercel, Fly, Railway) y volvé a esta pantalla.
              </span>
            </div>
          ) : null}

          <p className="mb-3 text-sm text-ink-2">
            En claude.ai: <strong>Personalizar → Conectores → Agregar → Agregar conector
            personalizado</strong>. Pegá esta URL:
          </p>
          <CopyField label="URL del servidor MCP" value={mcpUrl} />

          <p className="mb-2 mt-4 text-sm text-ink-2">
            En <strong>Autenticación</strong> elegí la opción sin inicio de sesión, y en{' '}
            <strong>Cabeceras de la petición</strong> agregá:
          </p>
          <CopyField label="Nombre de la cabecera" value="Authorization" />
          <CopyField label="Valor" value={`Bearer ${token}`} />

          <p className="mt-4 text-xs text-muted">
            En cuentas Team o Enterprise el conector lo agrega un propietario desde la configuración
            de la organización y después cada persona lo conecta. En el plan gratuito se permite un
            solo conector personalizado.
          </p>
        </div>
      ) : null}

      {tab === 'desktop' ? (
        <div>
          <p className="mb-3 text-sm text-ink-2">
            Claude Desktop lanza un proceso local. Este proyecto trae un puente que reenvía al CRM.
            Editá el archivo de configuración y reiniciá la app:
          </p>

          <div className="mb-3 space-y-1 text-[11px] text-muted">
            <p>
              macOS: <code className="text-ink-2">~/Library/Application Support/Claude/claude_desktop_config.json</code>
            </p>
            <p>
              Windows: <code className="text-ink-2">%AppData%\Claude\claude_desktop_config.json</code>
            </p>
            <p>
              Linux: <code className="text-ink-2">~/.config/Claude/claude_desktop_config.json</code>
            </p>
          </div>

          <CopyField
            multiline
            value={JSON.stringify(
              {
                mcpServers: {
                  'hook-crm': {
                    command: 'npx',
                    args: ['-y', 'tsx', `${projectPath}/src/mcp/stdio.ts`],
                    env: { HOOKCRM_URL: mcpUrl.replace(/\/api\/mcp$/, ''), HOOKCRM_API_KEY: token },
                  },
                },
              },
              null,
              2,
            )}
          />

          <p className="mt-3 text-xs text-muted">
            En Windows, escribí la ruta con barras normales o con doble barra invertida. Si el CRM ya
            está desplegado, conviene el conector de claude.ai o Claude Code por HTTP: no hace falta
            ningún proceso local.
          </p>
        </div>
      ) : null}
    </div>
  );
}
