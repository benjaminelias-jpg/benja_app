import { getCurrentOrg } from '@/server/context';
import { listApiKeys } from '@/server/auth/apiKey';
import { env } from '@/lib/env';
import { Card, SectionTitle, Badge } from '@/components/ui';
import { ClaudeSetup } from '@/components/claude-setup';
import { ApiKeyCreator } from '@/components/integration-forms';
import { revokeApiKeyAction } from '@/app/integraciones/actions';

export const dynamic = 'force-dynamic';

/** Las herramientas que el MCP expone, agrupadas para que se entienda el alcance. */
const TOOLS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: 'Analítica',
    items: [
      ['reporte_de_atribucion', 'qué contenido generó cada lead, reunión y venta'],
      ['resumen_del_negocio', 'KPIs y embudo del período'],
      ['rendimiento_por_palabra_clave', 'qué automatización trae más dinero'],
      ['rendimiento_del_equipo', 'reuniones, ventas y cierre por closer'],
      ['detectar_problemas', 'leads estancados y contenido con views y cero leads'],
    ],
  },
  {
    group: 'Leads',
    items: [
      ['buscar_leads', 'buscar por nombre, usuario o email'],
      ['ver_lead', 'ficha completa con historial'],
      ['mover_lead_de_etapa', 'cambiar de etapa'],
      ['etiquetar_lead', 'agregar etiquetas'],
      ['listar_etapas', 'etapas del pipeline con sus ids'],
    ],
  },
  {
    group: 'Comercial',
    items: [
      ['registrar_venta', 'cerrar una venta (se acredita sola al contenido)'],
      ['agendar_reunion', 'crear una reunión'],
      ['proximas_reuniones', 'agenda por delante'],
    ],
  },
  {
    group: 'Instagram',
    items: [
      ['listar_conversaciones', 'bandeja, con la ventana de 24 h de cada chat'],
      ['leer_conversacion', 'los mensajes de un hilo'],
      ['responder_dm', 'mandar un mensaje directo'],
    ],
  },
  {
    group: 'Contenido y flujos',
    items: [
      ['listar_contenido', 'catálogo con ids'],
      ['crear_contenido', 'dar de alta una pieza'],
      ['listar_flujos', 'automatizaciones y sus pasos'],
      ['probar_flujo', 'recorrerlo en seco, sin mandar nada'],
      ['listar_palabras_clave', 'palabras y su contenido'],
      ['crear_palabra_clave', 'atar una palabra a un contenido y un flujo'],
      ['listar_equipo_y_productos', 'ids del equipo y del catálogo'],
    ],
  },
];

export default async function ClaudePage() {
  const org = await getCurrentOrg();
  const keys = await listApiKeys(org.id);
  const activas = keys.filter((key) => !key.revokedAt);

  const base = env.appUrl.replace(/\/$/, '');
  const mcpUrl = `${base}/api/mcp`;
  const isLocal = /localhost|127\.0\.0\.1|^http:/.test(base);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Conectá tu Claude</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          El CRM expone un servidor MCP propio. Conectándolo, tu Claude puede leer y operar el CRM
          con tu sesión: preguntarle qué reel vende más, pedirle los leads estancados, que te
          redacte y mande una respuesta por DM, o que registre una venta.
        </p>
      </header>

      <Card>
        <SectionTitle
          title="1. Creá una clave"
          hint="Es lo que autoriza a tu Claude. Podés revocarla cuando quieras sin tocar nada más."
        />
        {activas.length > 0 ? (
          <ul className="mb-2 space-y-1 text-xs">
            {activas.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3">
                <span className="text-ink-2">{key.name}</span>
                <span className="flex items-center gap-2">
                  <code className="text-muted">{key.prefix}••••••••</code>
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="apiKeyId" value={key.id} />
                    <button type="submit" className="text-[10px] text-muted hover:text-ink">
                      Revocar
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">
            Todavía no hay claves. Creá una: la vas a ver una sola vez.
          </p>
        )}
        <ApiKeyCreator />
      </Card>

      <Card>
        <SectionTitle title="2. Conectá tu Claude" hint="Elegí dónde lo usás" />
        <ClaudeSetup mcpUrl={mcpUrl} projectPath={process.cwd()} isLocal={isLocal} />
      </Card>

      <Card>
        <SectionTitle
          title={`3. Qué puede hacer (${TOOLS.reduce((sum, group) => sum + group.items.length, 0)} herramientas)`}
          hint="Todo queda acotado a esta organización: una clave no ve datos de otra cuenta"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">{group.group}</p>
              <ul className="space-y-1">
                {group.items.map(([name, description]) => (
                  <li key={name} className="text-xs">
                    <code className="text-ink">{name}</code>
                    <span className="block text-[11px] text-muted">{description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Probalo" hint="Una vez conectado, pedile esto a tu Claude" />
        <ul className="space-y-1.5 text-sm text-ink-2">
          <li>“¿Qué contenido me generó más facturación en los últimos 60 días?”</li>
          <li>“Pasame los leads estancados y decime a quién conviene escribirle primero.”</li>
          <li>“Leé el chat con @camila.rossi y redactá una respuesta; mandala si te parece bien.”</li>
          <li>“Registrá la venta de 1497 del lead que cerré recién por teléfono.”</li>
          <li>“Revisá mi flujo de calificación y decime si tiene algún agujero.”</li>
        </ul>
        <p className="mt-4 border-t border-[var(--grid)] pt-3 text-xs text-muted">
          <Badge>Permisos</Badge> La clave da acceso completo de lectura y escritura a esta
          organización, incluido el envío de DMs. Tratala como una contraseña: si la compartís,
          quien la tenga puede operar el CRM.
        </p>
      </Card>
    </div>
  );
}
