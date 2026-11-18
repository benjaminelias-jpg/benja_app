import type { Metadata, Viewport } from 'next';
import { eq } from 'drizzle-orm';
import './globals.css';
import { Sidebar } from '@/components/nav';
import { getCurrentOrg } from '@/server/context';
import { getDb } from '@/db/client';
import { instagramAccounts } from '@/db/schema';

export const metadata: Metadata = {
  title: 'Hook CRM',
  description: 'CRM de Instagram para infoproductores: cada venta rastreada hasta el contenido que la genero.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Aplica el tema guardado antes del primer pintado para evitar el parpadeo. */
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('hookcrm-theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
} catch (e) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let orgName = 'Hook CRM';
  let igUsername: string | null = null;
  let ready = true;

  try {
    const org = await getCurrentOrg();
    orgName = org.name;
    const db = await getDb();
    const [account] = await db
      .select()
      .from(instagramAccounts)
      .where(eq(instagramAccounts.orgId, org.id))
      .limit(1);
    igUsername = account?.username ?? null;
  } catch {
    // Base vacia: la app igual renderiza y explica como sembrarla.
    ready = false;
  }

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-plane text-ink antialiased">
        {ready ? (
          <div className="flex min-h-screen">
            <aside className="sticky top-0 hidden h-screen w-60 shrink-0 md:block">
              <Sidebar orgName={orgName} igUsername={igUsername} />
            </aside>
            <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto w-full max-w-[1180px]">{children}</div>
            </main>
          </div>
        ) : (
          <SetupNeeded />
        )}
      </body>
    </html>
  );
}

function SetupNeeded() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-xl font-semibold text-ink">Falta preparar la base de datos</h1>
      <p className="mt-3 text-sm text-ink-2">
        Todavia no hay ninguna organizacion cargada. Ejecuta esto en la raiz del proyecto:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-surface p-4 text-xs text-ink-2 hairline">
        npm run setup
      </pre>
      <p className="mt-3 text-xs text-muted">
        Crea el esquema en Postgres embebido y carga un negocio de ejemplo con 60 dias de actividad.
      </p>
    </main>
  );
}
