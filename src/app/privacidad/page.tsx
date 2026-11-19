import type { Metadata } from 'next';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Política de privacidad · Hook CRM',
  description: 'Qué datos guarda Hook CRM, para qué, y cómo pedir que se borren.',
};

/**
 * Meta exige una URL de política de privacidad para habilitar el login.
 * Mientras ese campo este vacio, el inicio de sesion de la app queda
 * desactivado con el cartel "Feature Unavailable".
 *
 * Esta pagina describe lo que la app hace de verdad. No es un texto de
 * relleno: si dice algo que el codigo no hace, hay que corregir uno de los dos.
 */
export default function PrivacidadPage() {
  const base = env.appUrl;

  return (
    <article className="mx-auto max-w-2xl space-y-6 py-4 text-sm leading-relaxed text-ink-2">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Política de privacidad</h1>
        <p className="mt-1 text-xs text-muted">Última actualización: noviembre de 2026</p>
      </header>

      <Section titulo="Qué es esto">
        <p>
          Hook CRM es una herramienta de gestión de clientes para quienes venden infoproductos a
          través de Instagram. La usa una sola empresa para administrar sus propias conversaciones:
          no es un servicio público ni se revenden datos.
        </p>
      </Section>

      <Section titulo="Qué datos guardamos">
        <p className="mb-2">De la cuenta de Instagram que se conecta:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Nombre de usuario, identificador de la cuenta, foto de perfil y cantidad de seguidores.</li>
          <li>Token de acceso que entrega Meta, para poder leer y responder mensajes.</li>
          <li>Publicaciones y sus métricas públicas (vistas, alcance, me gusta, comentarios).</li>
        </ul>
        <p className="mt-3 mb-2">De las personas que escriben a esa cuenta:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Nombre de usuario e identificador de Instagram.</li>
          <li>El contenido de los mensajes directos y comentarios que intercambian con la cuenta.</li>
          <li>De qué publicación llegaron, para saber qué contenido genera clientes.</li>
          <li>Datos que la propia persona entrega en la conversación: correo, teléfono, nombre.</li>
        </ul>
      </Section>

      <Section titulo="Para qué los usamos">
        <p>
          Únicamente para operar el CRM: mostrar las conversaciones en una bandeja, responderlas,
          organizar los contactos en un embudo de ventas y calcular de qué publicación viene cada
          venta. No se usan para publicidad de terceros, no se venden y no se comparten con nadie
          fuera de los servicios que hacen funcionar la aplicación.
        </p>
      </Section>

      <Section titulo="Con quién se comparten">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Meta (Instagram)</strong>: para enviar y recibir los mensajes. Son sus propios
            datos volviendo a su plataforma.
          </li>
          <li>
            <strong>Vercel</strong>, donde corre la aplicación, y <strong>Neon</strong>, donde vive
            la base de datos. Ambos actúan como proveedores de infraestructura.
          </li>
          <li>
            Si el titular de la cuenta configura webhooks salientes hacia otras herramientas suyas,
            los eventos van a donde él indique. Esa decisión es suya.
          </li>
        </ul>
      </Section>

      <Section titulo="Cuánto tiempo">
        <p>
          Los datos se conservan mientras la cuenta esté conectada y el titular los necesite para su
          operación. Al desconectar la cuenta, el token de acceso se borra de inmediato.
        </p>
      </Section>

      <Section titulo="Cómo pedir el borrado">
        <p className="mb-2">Hay dos formas:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Desde Instagram o Facebook, quitando el acceso a la aplicación. Meta nos avisa
            automáticamente y la conexión se cierra.
          </li>
          <li>
            Escribiendo a quien administra la cuenta de Instagram con la que te comunicaste. Es
            quien controla esos datos.
          </li>
        </ul>
        <p className="mt-3">
          La dirección que Meta usa para notificar pedidos de borrado es{' '}
          <code className="rounded bg-surface-2 px-1 text-xs">{base}/api/instagram/data-deletion</code>.
        </p>
      </Section>

      <Section titulo="Seguridad">
        <p>
          Las conexiones viajan cifradas. Los webhooks que entran se validan con firma
          criptográfica, así que no se aceptan eventos de origen desconocido. El token de acceso de
          Instagram se guarda en la base de datos de la aplicación y no se expone en la interfaz.
        </p>
      </Section>
    </article>
  );
}

function Section({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-base font-medium text-ink">{titulo}</h2>
      {children}
    </section>
  );
}
