import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Condiciones del servicio · Hook CRM',
  description: 'Condiciones de uso de Hook CRM.',
};

export default function TerminosPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 py-4 text-sm leading-relaxed text-ink-2">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Condiciones del servicio</h1>
        <p className="mt-1 text-xs text-muted">Última actualización: noviembre de 2026</p>
      </header>

      <Section titulo="Qué ofrece">
        <p>
          Hook CRM organiza las conversaciones de Instagram de una empresa y las relaciona con el
          contenido que las origina. Se ofrece tal cual está, sin garantía de disponibilidad
          ininterrumpida.
        </p>
      </Section>

      <Section titulo="Uso aceptable">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Solo puede conectarse una cuenta de Instagram sobre la que se tenga autoridad para
            hacerlo.
          </li>
          <li>
            No puede usarse para enviar mensajes masivos no solicitados ni para nada que incumpla
            las políticas de la plataforma de Meta.
          </li>
          <li>
            Quien conecta la cuenta es responsable del contenido que envía y de cumplir la
            normativa de protección de datos que le aplique.
          </li>
        </ul>
      </Section>

      <Section titulo="Relación con Meta">
        <p>
          Esta aplicación usa la API de Instagram de Meta. No está afiliada a Meta ni respaldada por
          ella. El acceso depende de que Meta lo mantenga disponible y puede interrumpirse si esa
          plataforma cambia sus condiciones.
        </p>
      </Section>

      <Section titulo="Datos">
        <p>
          El tratamiento de datos se describe en la política de privacidad, que forma parte de estas
          condiciones.
        </p>
      </Section>

      <Section titulo="Cambios">
        <p>
          Estas condiciones pueden actualizarse. La fecha de arriba indica la última revisión.
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
