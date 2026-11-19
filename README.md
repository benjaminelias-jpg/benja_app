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
| **Integraciones** | Webhooks de entrada y de salida, estado de la cuenta de Instagram, claves de API y el registro de entregas en ambas direcciones con su payload crudo. |
| **Conectá tu Claude** | El CRM expone un servidor MCP propio. Se conecta a Claude Code, a claude.ai o a Claude Desktop y tu Claude opera el CRM con tu sesión. |

---

## La bandeja de Instagram

Los DMs se leen y se responden **dentro del CRM**. Entran por el webhook en
tiempo real, y la primera carga se puede importar con el botón *Sincronizar*.

**Se mandan notas de voz y archivos**, como en ManyChat: elegís el tipo, subís
el archivo y se envía. El audio se reproduce dentro del hilo, no aparece como
"(adjunto)". Instagram acepta audio en aac, m4a, wav y mp4 hasta 25 MB; imagen
en png y jpeg hasta 8 MB; video hasta 25 MB; y como archivo **solo PDF**. El
formato y el tamaño se validan antes de subir y antes de enviar.

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

Los pasos disponibles: enviar DM, **audio**, imagen, video o PDF, entregar el
recurso de la palabra clave, responder el comentario, mostrar "escribiendo…",
preguntar y esperar (con **botones de respuesta rápida**), condición,
etiquetar, mover de etapa, escribir campos, asignar responsable, agendar
reunión, registrar venta, llamar un webhook y avisar al equipo.

Tres cosas que un flujo lineal no puede hacer:

1. **Ramificar.** Un nodo de condición evalúa la respuesta del lead, sus
   etiquetas, su origen o cualquier campo propio, y manda cada caso por su lado.
2. **Esperar una respuesta de verdad.** `Preguntar y esperar` manda el mensaje y
   corta la ejecución. Cuando el lead contesta, el webhook reanuda el flujo
   desde ese punto y guarda su respuesta en un campo del lead. La espera gana
   siempre sobre las palabras clave: si alguien está contestando una pregunta,
   su mensaje no arranca otro flujo porque contenga una keyword.
3. **Preguntar con botones.** Hasta 13, y la respuesta vuelve como un valor
   exacto en vez de texto libre que haya que interpretar. Las condiciones miran
   ese valor, así que cambiar el texto de un botón no rompe la lógica.
4. **Probarse sin molestar a nadie.** El botón *Probar* recorre el flujo en seco
   contra un lead real: muestra cada paso y qué rama tomó, sin mandar un solo
   DM ni mover una etapa.

La palabra clave es lo que ata un contenido con un flujo. Sin keyword, los leads
de ese reel entran sin atribución; la tabla de contenido lo muestra como
*Sin atribuir*.

---

## Integraciones

### Conectar Instagram

Tres pasos en la pantalla de *Integraciones*:

1. Creá una app en Meta (una sola vez) y pegá ahí la URL de redirección que la
   pantalla te muestra.
2. Pegá el App ID y el App Secret **en la interfaz**. Se guardan en tu base de
   datos: no hace falta tocar variables de entorno ni volver a desplegar.
3. **Conectar Instagram** → iniciás sesión, aceptás los permisos y volvés con la
   cuenta conectada.

Lo único que Meta no deja saltear es el paso 1: sin una app propia no hay forma
de pedirle permisos a una cuenta. Es lo mismo que hace ManyChat, con la
diferencia de que la app es suya y acá es tuya.

Los dos caminos que ofrece Meta:

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
usando el App Secret: el de `META_APP_SECRET` si existe y, si no, el que se
guardó desde `/integraciones`. El endpoint procesa comentarios, DMs, respuestas
a stories y menciones, e ignora los ecos de los mensajes propios.

**Mientras no haya una cuenta conectada la app está en modo simulado:** los DMs
se registran en el CRM y aparecen en el historial del lead, pero no salen a
Instagram. Sirve para probar el embudo completo sin conectar una cuenta real.
En cuanto conectás la cuenta desde `/integraciones`, su token queda en la base
y los envíos salen de verdad — no hace falta ninguna variable de entorno ni un
redespliegue.

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

### Webhooks salientes — conectar el CRM con otras apps

La otra mitad: el CRM avisando cuando pasa algo. Se suscribe una URL a los
eventos que interesen (`lead_created`, `meeting_booked`, `sale`, `stage_changed`,
o `*` para todos) y el CRM manda un `POST` con el evento **y la atribución ya
resuelta** — el dato que ninguna otra herramienta puede calcular por su cuenta.

```jsonc
{
  "id": "evt_…",
  "type": "sale",
  "occurredAt": "2026-11-18T21:24:00.000Z",
  "valueCents": 299700,
  "lead":    { "igUsername": "camila.rossi", "stage": { "name": "Venta" }, "tags": [] },
  "content": { "title": "Como cobrar 3000 USD sin audiencia enorme", "hook": "…" },
  "deal":    { "amountCents": 299700, "currency": "USD" }
}
```

Cada entrega lleva:

| Cabecera | Para qué |
|---|---|
| `x-hook-event` | tipo de evento |
| `x-hook-delivery` | id único de la entrega, para descartar duplicados |
| `x-hook-timestamp` | segundos UNIX |
| `x-hook-signature-256` | `sha256=HMAC(timestamp + "." + cuerpo, secreto)` |

El timestamp entra en la firma a propósito: firmando solo el cuerpo, una copia
interceptada se podría reenviar más tarde como si fuera nueva.

Si el destino falla, se reintenta **5 veces** con espera creciente (1 min, 5, 30,
2 h, 6 h) y después queda como *agotada*, con el botón para forzar el reintento
cuando el destino vuelva. En un servidor siempre despierto los reintentos salen
solos; en serverless conviene apuntar un cron a:

```bash
curl -X POST https://tu-crm.com/api/webhooks/outbound/retry -H "Authorization: Bearer hk_live_..."
```

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

## Conectá tu Claude (servidor MCP)

El CRM expone un servidor MCP propio en `/api/mcp` con **23 herramientas**.
Conectado a tu Claude, podés pedirle cosas como:

> *¿Qué contenido me generó más facturación en los últimos 60 días?*
> *Pasame los leads estancados y decime a quién escribirle primero.*
> *Leé el chat con @camila.rossi, redactá una respuesta y mandala.*
> *Registrá la venta de 1497 del lead que cerré recién por teléfono.*

La pantalla **Conectá tu Claude** arma los comandos ya con tu URL. En resumen:

**Claude Code**

```bash
claude mcp add --transport http hook-crm https://tu-crm.com/api/mcp --header "Authorization: Bearer hk_live_..."
```

**claude.ai** — Personalizar → Conectores → Agregar conector personalizado. Se
pega la URL `https://tu-crm.com/api/mcp` y, en *Cabeceras de la petición*,
`Authorization: Bearer hk_live_...`. Tiene que ser HTTPS en el puerto 443 y
accesible desde internet: la conexión sale de la nube de Anthropic, no de tu
máquina, así que `localhost` no sirve.

**Claude Desktop** — lanza un proceso local; el proyecto trae un puente en
`src/mcp/stdio.ts` que reenvía al CRM. La pantalla genera el JSON de
`claude_desktop_config.json` listo para pegar.

Las herramientas van de `reporte_de_atribucion` y `resumen_del_negocio` a
`responder_dm`, `registrar_venta` y `probar_flujo`. Todas quedan acotadas a la
organización de la clave: una clave no ve datos de otra cuenta.

El transporte es Streamable HTTP sin sesión, que es lo que pide la revisión
actual del protocolo. El `GET` sobre `/api/mcp` responde 405 con una pista
legible, porque esa URL no se abre en el navegador.

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
| `npm run db:bootstrap` | Crea la organización y el pipeline si la base está vacía |
| `npm run key:create -- "nombre"` | Crea una clave de API |
| `npm run mcp` | Puente MCP por stdio (para Claude Desktop) |
| `npm run webhooks:retry` | Reintenta las entregas salientes vencidas |
| `npm test` | Tests (69 casos: keywords, importes, mapeo de webhooks, embudo completo, flujos con ramificación, esperas de respuesta, bandeja, webhooks salientes y servidor MCP) |
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
│   │   ├── webhooks.ts        Entrada: registro de entregas y mapeo configurable
│   │   └── outbound.ts        Salida: suscripciones, firma HMAC y reintentos
│   ├── integrations/      Instagram Graph API (dos caminos) · OAuth · ManyChat
│   └── auth/apiKey.ts     Claves hasheadas con SHA-256
├── mcp/
│   ├── tools.ts           Las 23 herramientas del servidor MCP
│   └── stdio.ts           Puente stdio para Claude Desktop
├── app/
│   ├── api/webhooks/      instagram · manychat · [slug] configurable
│   ├── api/instagram/     connect · callback · sync
│   ├── api/mcp/           Servidor MCP (Streamable HTTP)
│   ├── api/v1/            API pública
│   ├── inbox/             Bandeja de Instagram
│   ├── claude/            Conectá tu Claude
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

**Los webhooks salientes salen solo de eventos nuevos.** `recordEvent` despacha
cuando el evento se insertó de verdad; un reenvío idempotente no vuelve a avisar
a nadie. Y si no hay suscripciones activas, el costo es cero: el chequeo está
cacheado 30 segundos porque se llama en cada comentario y cada DM.

**Un flujo con aristas se recorre como grafo.** Un paso sin salida termina su
rama. (Al principio el motor caía al paso siguiente por posición cuando no había
`nextNodeId`: el final de la rama "sí" seguía ejecutando la rama "no" y las dos
hacían lo mismo. Hay un test que cubre exactamente ese caso.)

---

## Llevarlo a producción

En Vercel alcanza con conectar el repo y agregar un Postgres: el proyecto trae
un `vercel-build` que **migra la base y la deja lista antes de compilar**.

1. Importá el repo en Vercel (framework Next.js, se detecta solo).
2. Storage → crear una base Postgres y conectarla al proyecto. Queda disponible
   como `DATABASE_URL`.
3. Volvé a desplegar. El build corre `src/db/deploy.ts`, que aplica las
   migraciones y crea la organización y el pipeline si la base está vacía.

Sin `DATABASE_URL` el build **no falla**: despliega y la app explica qué falta,
en vez de romperse entera por una variable sin configurar.

`APP_URL` se deduce sola del dominio de producción de Vercel, así que las URLs
de webhook y la del servidor MCP salen bien sin configurar nada.

En otro proveedor (Fly, Railway, un contenedor) es lo mismo a mano:
`npm run db:migrate && npm run db:bootstrap` y después `npm run build`. Las
migraciones de `./drizzle` son SQL estándar de Postgres: las mismas que corren
en local sobre PGlite.
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
- **Los webhooks salientes no tienen cola real.** Se despachan en segundo plano
  y se reintentan con espera creciente, pero en serverless el proceso puede morir
  antes: para eso está `POST /api/webhooks/outbound/retry`, pensado para un cron.
- **El servidor MCP no implementa OAuth.** Se autentica con una clave de API en
  la cabecera, que es lo que aceptan tanto Claude Code como los conectores
  personalizados de claude.ai. La clave da acceso completo de lectura y escritura
  a la organización, incluido el envío de DMs.
- **El MCP crea una instancia por petición.** Es lo que exige el modo sin sesión
  del SDK; con mucho tráfico convendría medirlo.
