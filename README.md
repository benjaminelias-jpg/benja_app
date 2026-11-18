# Hook CRM

CRM de Instagram para infoproductores. La diferencia con un CRM normal es una
sola pregunta, que acá se responde siempre:

> **¿De qué contenido salió esta venta?**

Un lead comenta `GUION` en un reel → el CRM lo crea, le manda el recurso por DM
y le ata ese reel. Tres semanas después agenda una call y compra 2.997 USD. El
reporte acredita esos 2.997 USD **a ese reel**, no a "Instagram" ni a "orgánico".

---

## Arrancar en dos comandos

```bash
npm install
```

```bash
npm run setup && npm run dev
```

Abrí <http://localhost:3000>.

No hace falta Docker, ni instalar Postgres, ni configurar nada: sin
`DATABASE_URL`, la app levanta **PGlite** (un Postgres real compilado a WASM) en
`./.data/pgdata`. `npm run setup` crea el esquema y carga un negocio de ejemplo
—12 contenidos, 186 leads, reuniones y ventas simuladas a lo largo de 60 días—
generado a través del mismo pipeline de ingesta que usan los webhooks, así que
los números del panel son coherentes entre sí.

---

## Cómo funciona la atribución

Todo lo que le pasa a un lead se escribe en una tabla `events` inmutable, y
**cada evento arrastra el `contentId` que lo originó**. Por eso una venta
registrada 40 días después sigue sabiendo de qué reel vino el lead.

```
Comentario "GUION" en un reel
        │
        ├─ ¿de qué contenido viene?   ig_media_id → ref_code → permalink → keyword
        ├─ ¿qué keyword disparó?      exacta > empieza con > contiene > regex
        │
        ├─ Lead creado (o enriquecido si ya existía)
        │     first_touch_content_id ← el reel      ← nunca se reescribe
        │     last_touch_content_id  ← el reel      ← se actualiza siempre
        │
        ├─ Automatización: responde el comentario, manda el recurso por DM,
        │   etiqueta, mueve de etapa, asigna closer
        │
        └─ events: lead_created · comment_received · keyword_triggered · resource_sent
                   ↑ todos con content_id = el reel

   ... 3 semanas después ...

   Calendly → /api/webhooks/calendly → reunión agendada  (content_id = el reel)
   Hotmart  → /api/webhooks/hotmart  → venta 2.997 USD   (content_id = el reel)
```

**Modelo:** first-touch con ventana. El contenido que trajo al lead se lleva el
crédito mientras la conversión ocurra dentro de la ventana de atribución de la
organización (90 días por defecto); pasado ese plazo se usa el último contenido
que lo tocó. La tabla `attribution_touches` guarda además *todos* los contactos,
para análisis multi-touch.

**Las tasas de conversión se calculan sobre la cohorte** de leads que entraron
en el período, no sobre conteos de ventana mezclados. Sin eso, una venta de un
lead viejo produce un "lead→venta 200%".

---

## Lo que trae

| | |
|---|---|
| **Panel** | KPIs con variación vs. período anterior, leads/día, ingresos/día, embudo, contenido que más factura, reuniones próximas, leads estancados y *contenido mudo* (mucha view, cero leads). |
| **Bandeja** | Los chats de Instagram dentro del CRM: lista de hilos, conversación completa, responder por DM. Cada hilo muestra de qué contenido vino el lead, su etapa, y **cuánto queda de la ventana de 24 h** que Meta da para responder. |
| **Contenido** | La tabla central: views, leads, leads por 1.000 views, reuniones, ventas, lead→venta e ingresos por cada pieza. Ordenable. Incluye una fila **Sin atribuir** que expone los huecos de trazabilidad. |
| **Pipeline** | Kanban con etapas configurables. Cada tarjeta muestra de qué contenido vino el lead. Se mueve con un selector (funciona con teclado, no hace falta arrastrar). |
| **Leads** | Listado con búsqueda y filtros, ficha completa con historial, conversación de Instagram, recorrido de contenidos, reuniones y ventas. |
| **Automatizaciones** | El ManyChat propio: **constructor visual de flujos** con ramificación, pasos que esperan la respuesta del lead, botón de prueba en seco y el log de cada ejecución. |
| **Integraciones** | URLs y secretos de cada webhook, estado de la cuenta de Instagram, claves de API y las últimas entregas recibidas con su payload crudo. |

---

## La bandeja de Instagram

Los DMs se leen y se responden **dentro del CRM**. Entran por el webhook en
tiempo real, y la primera carga se puede importar con el botón *Sincronizar*.

Lo que la hace distinta de un inbox cualquiera:

- **Ventana de 24 h visible.** Meta solo deja escribirle a alguien dentro de las
  24 h posteriores a *su* último mensaje. El composer lo avisa antes de que
  escribas y bloquea el envío en vez de dejar que la API lo rechace después.
- **Límite real de Instagram.** Un DM no puede pasar de 1000 **bytes**; el
  contador los cuenta en bytes, no en caracteres, porque un emoji ocupa cuatro.
- **Cada hilo sabe de qué reel vino.** El encabezado linkea al contenido que
  trajo al lead y a su etapa del pipeline.
- **Los DMs que mandás desde el celular aparecen igual.** Meta los manda como
  *echo* y el CRM los refleja, así el equipo no responde dos veces.

Sobre abrir el chat en Instagram: **Meta no documenta ninguna URL para abrir un
hilo existente**. La bandeja ofrece el enlace al perfil del lead (que sí es
estable) y, cuando conoce el id del hilo, un atajo a `instagram.com/direct/t/…`
marcado como no oficial, porque puede dejar de funcionar sin aviso.

---

## Tu propio ManyChat

Los flujos se arman en un lienzo: cada paso es un nodo y las flechas definen por
dónde sigue.

```
 [Disparador: comentario "GUION"]
            │
    [Responder comentario]
            │
     [Entregar recurso]  ──→ DM con el link
            │
        [Etiquetar]
            │
   [Asignar responsable]  ──→ reparto equitativo
            │
  [Preguntar y esperar]   ──→ "¿ya vendés o recién empezás?"
            │                 el flujo PAUSA acá
      [¿Qué respondió?]
        sí ╱        ╲ no
   [Mandar link]   [Etiquetar "está empezando"]
   [→ Calificado]  [→ Conversando]
```

Tres cosas que un flujo lineal no puede hacer:

1. **Ramificar.** Un nodo de condición evalúa la respuesta del lead, sus
   etiquetas, su origen o cualquier campo propio, y manda cada caso por su lado.
2. **Esperar una respuesta de verdad.** `Preguntar y esperar` manda el mensaje y
   corta la ejecución. Cuando el lead contesta, el webhook reanuda el flujo
   desde ese punto y guarda su respuesta en un campo del lead. La espera gana
   siempre sobre las palabras clave: si alguien está contestando una pregunta,
   su mensaje no arranca otro flujo porque contenga una keyword.
3. **Probarse sin molestar a nadie.** El botón *Probar* recorre el flujo en seco
   contra un lead real: muestra cada paso y qué rama tomó, sin mandar un solo
   DM ni mover una etapa.

La palabra clave es lo que ata un contenido con un flujo. Sin keyword, los leads
de ese reel entran sin atribución; la tabla de contenido lo muestra como
*Sin atribuir*.

---

## Integraciones

### Conectar Instagram

Desde *Integraciones* → **Conectar Instagram**. Meta tiene hoy dos caminos y cuál
te toca depende de cómo esté dada de alta tu app:

| | Instagram Login | Unified Login |
|---|---|---|
| OAuth | `www.instagram.com/oauth/authorize` | `www.facebook.com/dialog/oauth` (Facebook Login for Business) |
| Host de la API | `graph.instagram.com` | `graph.facebook.com` |
| Token | de usuario de Instagram, 60 días, **renovable** | de sistema del portafolio de negocio (BISU) |
| Permisos | `instagram_business_basic`, `…manage_messages`, `…manage_comments` | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_manage_insights` |
| Hace falta | `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` | `META_APP_ID` + `META_APP_SECRET` + `META_CONFIG_ID` |

La app implementa los dos. El redirect a registrar en Meta es siempre:

```
<APP_URL>/api/instagram/callback
```

Con el camino *Instagram Login* el token de 60 días se **renueva solo** cuando
quedan menos de 10 días. Un token que pasa 60 días sin refrescarse muere y hay
que volver a conectar a mano, así que el margen es a propósito.

Dos advertencias honestas:

- Una página de la guía de migración de Meta dice que las apps nuevas ya no
  pueden usar *Instagram Login*. No pude confirmarlo en las páginas de *Unified
  Login*, así que conviene mirar el App Dashboard antes de decidir.
- Los endpoints de mensajería de *Unified Login* **no están documentados** en las
  páginas de ese producto. El cliente usa las mismas rutas sobre
  `graph.facebook.com` con el id de la cuenta de Instagram, que es lo que la
  documentación implica, pero no está confirmado por Meta.

### Instagram (webhook de Meta)

En la app de Meta, apuntá el webhook a:

```
https://tu-dominio.com/api/webhooks/instagram
```

Campos a suscribir: `comments`, `messages`, `mentions`.

El handshake `GET` responde solo si `hub.verify_token` coincide con
`META_VERIFY_TOKEN`. Cada `POST` se valida con la firma `X-Hub-Signature-256`
cuando hay `META_APP_SECRET`. El endpoint procesa comentarios, DMs, respuestas a
stories y menciones, e ignora los ecos de los mensajes propios.

**Sin `INSTAGRAM_ACCESS_TOKEN` la app entra en modo simulado:** los DMs se
registran en el CRM y aparecen en el historial del lead, pero no salen a
Instagram. Sirve para probar el embudo completo sin conectar una cuenta real.

### ManyChat

Bloque *External Request* apuntando a:

```
POST https://tu-dominio.com/api/webhooks/manychat
Header: x-hook-secret: <MANYCHAT_WEBHOOK_SECRET>
```

Un solo endpoint para las cuatro cosas, distinguidas por `event`:

```jsonc
// Lead nuevo con atribución
{ "event": "keyword", "subscriber_id": "{{user_id}}",
  "ig_username": "{{ig_username}}", "keyword": "GUIA",
  "ig_media_id": "{{media_id}}" }

{ "event": "reu",   "scheduled_at": "2026-03-01T15:00:00Z" }
{ "event": "venta", "amount": "1497", "currency": "USD" }
{ "event": "no_show" }
```

Acepta sinónimos en español (`venta`, `compra`, `reunion`, `reu`, `no_show`…)
porque la gente nombra sus flujos como quiere. El importe se parsea desde
`197`, `"197.50"`, `"$1.497,00"` o `"USD 2 997"`.

### Cualquier otra herramienta

Los endpoints configurables traducen el payload de cualquier servicio sin tocar
código. Cada uno guarda su propio `mapping`:

```jsonc
// Calendly → /api/webhooks/calendly
{
  "kind":        "=meeting",              // un valor con "=" es literal
  "email":       "payload.invitee.email", // el resto son rutas del payload
  "fullName":    "payload.invitee.name",
  "scheduledAt": "payload.event.start_time",
  "externalId":  "payload.event.uri"      // idempotencia
}
```

Autenticación: header `x-hook-secret`, firma HMAC en `x-hook-signature`, o
`?secret=` en la query — lo que soporte la herramienta de origen.

El seed deja configurados **Calendly**, **Hotmart** y **Cal.com**. Los secretos
están en la página *Integraciones*.

### API pública

```
GET    /api/v1/leads                  Listado con filtros
POST   /api/v1/leads                  Crear/actualizar lead (resuelve atribución)
GET    /api/v1/leads/:id              Ficha con timeline, reuniones y ventas
PATCH  /api/v1/leads/:id              Mover de etapa, asignar, etiquetar
POST   /api/v1/conversions            Reunión, no-show, venta o reembolso
GET    /api/v1/contents               Catálogo de contenidos
POST   /api/v1/contents               Registrar un contenido
GET    /api/v1/analytics/content      Reporte de atribución
POST   /api/instagram/sync?what=      Importa publicaciones y/o bandeja (media|inbox|all)
GET    /api/instagram/sync            Estado de la conexión (para monitoreo)
```

Creá una clave (el servidor de desarrollo debe estar detenido si usás PGlite):

```bash
npm run key:create -- "Make.com"
```

```bash
curl -H "Authorization: Bearer hk_live_..." http://localhost:3000/api/v1/analytics/content
```

En desarrollo, si no mandás clave, la API usa la organización por defecto. En
producción la clave es obligatoria.

---

## Probarlo de punta a punta

```bash
curl -X POST http://localhost:3000/api/webhooks/instagram -H 'content-type: application/json' -d '{"object":"instagram","entry":[{"id":"17841400000000001","changes":[{"field":"comments","value":{"id":"CMT_1","text":"GUION!! lo necesito","from":{"id":"IG_1","username":"prueba"},"media":{"id":"178410000000007919"}}}]}]}'
```

```bash
curl -X POST http://localhost:3000/api/webhooks/manychat -H 'content-type: application/json' -d '{"event":"venta","ig_username":"prueba","amount":"2997","currency":"USD"}'
```

Abrí `/contenido`: los 2.997 USD aparecen en la fila del reel *"Mi guion de DM
que agenda 4 reus por día"*.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run setup` | Migra la base y carga datos de ejemplo |
| `npm run db:reset` | Borra todo y vuelve a sembrar |
| `npm run db:generate` | Genera una migración SQL tras cambiar el esquema |
| `npm run db:migrate` | Aplica las migraciones pendientes |
| `npm run key:create -- "nombre"` | Crea una clave de API |
| `npm test` | Tests (42 casos: keywords, importes, mapeo de webhooks, embudo completo, flujos con ramificación, esperas de respuesta y bandeja) |
| `npm run typecheck` | TypeScript en modo estricto |

---

## Arquitectura

```
src/
├── db/
│   ├── schema.ts          21 tablas: organizaciones, contenidos, leads, eventos,
│   │                      automatizaciones, webhooks, deals, citas…
│   ├── client.ts          Un cliente: PGlite en local, node-postgres en producción
│   ├── migrate.ts         Runner de migraciones (sirve para ambos)
│   └── seed.ts            Negocio de ejemplo, generado vía el pipeline real
├── server/
│   ├── services/
│   │   ├── ingest.ts          Puerta de entrada única de toda interacción
│   │   ├── attribution.ts     Resolución de contenido y matching de keywords
│   │   ├── events.ts          Log inmutable + puntos de contacto
│   │   ├── leads.ts           Upsert, etapas, etiquetas, listados
│   │   ├── commerce.ts        Reuniones y ventas (congelan su atribución)
│   │   ├── automations.ts     Motor de flujos: grafo, ramas y esperas
│   │   ├── inbox.ts           Hilos, ventana de 24 h y envío de DMs
│   │   ├── instagram-sync.ts  Conexión, import de publicaciones y bandeja
│   │   ├── analytics.ts       Las consultas que responden la pregunta del negocio
│   │   └── webhooks.ts        Registro de entregas y mapeo configurable
│   ├── integrations/      Instagram Graph API (dos caminos) · OAuth · ManyChat
│   └── auth/apiKey.ts     Claves hasheadas con SHA-256
├── app/
│   ├── api/webhooks/      instagram · manychat · [slug] configurable
│   ├── api/instagram/     connect · callback · sync
│   ├── api/v1/            API pública
│   ├── inbox/             Bandeja de Instagram
│   ├── automatizaciones/  Lista y constructor visual de flujos
│   └── …                  Resto del CRM
└── components/
    ├── flow/              Constructor de flujos (React Flow)
    ├── inbox/             Hilo, lista y composer
    └── …                  UI y gráficos (SVG inline, sin librería de charts)
```

**Por qué `ingest.ts` es una sola puerta:** si cada webhook resolviera la
atribución por su cuenta, tarde o temprano una vía quedaría sin ella y el
reporte mentiría sin que nadie se entere.

**El dinero se guarda siempre en centavos** (`integer`), nunca en coma flotante.

**Un flujo con aristas se recorre como grafo.** Un paso sin salida termina su
rama. (Al principio el motor caía al paso siguiente por posición cuando no había
`nextNodeId`: el final de la rama "sí" seguía ejecutando la rama "no" y las dos
hacían lo mismo. Hay un test que cubre exactamente ese caso.)

---

## Llevarlo a producción

1. Creá un Postgres (Neon, Supabase, RDS) y poné `DATABASE_URL`.
2. `npm run db:migrate` contra esa base. Las migraciones de `./drizzle` son SQL
   estándar de Postgres: las mismas que corren en local sobre PGlite.
3. Desplegá en Vercel, Fly, Railway o un contenedor. No hay estado en disco
   cuando usás `DATABASE_URL`.
4. Configurá `META_APP_SECRET` y `MANYCHAT_WEBHOOK_SECRET`: sin ellos los
   webhooks aceptan cualquier payload.
5. `npm run key:create` para cada integración externa.

---

## Limitaciones conocidas

- **PGlite es de un solo proceso.** El servidor de desarrollo bloquea
  `./.data/pgdata`: para correr `db:seed` o `key:create` hay que detenerlo.
  Con `DATABASE_URL` el problema desaparece.
- **El paso `wait` (esperar N minutos) no espera.** Queda registrado como omitido
  en el log. Una espera por *tiempo* necesita un worker de cola; el webhook tiene
  que responder en milisegundos. `Preguntar y esperar` sí pausa de verdad, porque
  lo que la reanuda es un mensaje entrante y no un temporizador.
- **La bandeja no actualiza sola.** Los mensajes nuevos entran por webhook, pero
  la pantalla se refresca al navegar o al recargar: no hay websocket.
- **Importar la bandeja trae como mucho 20 mensajes por hilo.** Es un límite de
  la API de Meta, no del CRM.
- **No hay URL oficial para abrir un hilo concreto en Instagram.** El atajo que
  ofrece la bandeja no está documentado por Meta y puede romperse.
- **Los endpoints de mensajería de Unified Login no están documentados.** Lo que
  implementa el cliente para ese camino es una inferencia razonable, no una
  especificación confirmada.
- **No hay autenticación de usuarios en la UI.** La app corre en modo
  mono-organización (la primera de la base). El esquema y todos los servicios ya
  llevan `orgId`, así que pasar a multi-tenant es cambiar `getCurrentOrg()` por
  una lectura de sesión.
- **Las métricas de Instagram no se sincronizan solas.** Se importan con el botón
  de *Integraciones* o llamando a `POST /api/instagram/sync`; no hay un cron que
  lo dispare. Apuntá un cron externo a esa ruta con una clave de API.
- **Los tokens se guardan en texto plano en la base.** Para producción conviene
  cifrarlos o moverlos a un gestor de secretos.
