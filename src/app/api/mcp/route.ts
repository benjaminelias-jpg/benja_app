import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@/mcp/tools';
import { isResponse, requireAuth } from '@/server/api/respond';
import type { Organization } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Servidor MCP del CRM sobre Streamable HTTP.
 *
 *   POST /api/mcp     con  Authorization: Bearer hk_live_...
 *
 * Es el endpoint que se pega en Claude:
 *   - Claude Code:  claude mcp add --transport http hook-crm <url> --header "..."
 *   - claude.ai:    Conectores → Agregar conector personalizado
 *
 * Modo sin sesión (stateless), que es lo que pide la revisión actual del
 * protocolo: cada POST se atiende por su cuenta y no se emiten session ids.
 */

/**
 * Un servidor y un transporte NUEVOS por petición.
 *
 * En modo sin sesión el transporte no se puede reutilizar: el propio SDK lo
 * rechaza con "Stateless transport cannot be reused across requests". Cada POST
 * se atiende con su propia instancia y se cierra cuando la respuesta termina.
 */
async function createInstance(org: Organization) {
  const server: McpServer = buildMcpServer(org);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return { server, transport };
}

/**
 * Cierra la instancia cuando el cuerpo de la respuesta termina de enviarse.
 * Cerrar antes cortaría una respuesta en streaming por la mitad; no cerrar
 * nunca filtraría una instancia por petición.
 */
function closeWhenDone(
  response: Response,
  cleanup: () => Promise<void>,
): Response {
  if (!response.body) {
    void cleanup();
    return response;
  }

  const monitored = response.body.pipeThrough(
    new TransformStream({
      flush() {
        void cleanup();
      },
    }),
  );

  return new Response(monitored, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isResponse(auth)) {
    // El cliente MCP necesita entender el rechazo, no recibir HTML.
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message:
            'No autorizado. Agregá la cabecera Authorization: Bearer <tu clave> al conectar el servidor MCP.',
        },
        id: null,
      },
      { status: 401 },
    );
  }

  const { server, transport } = await createInstance(auth.org);

  try {
    const response = await transport.handleRequest(request as unknown as Request);
    return closeWhenDone(response, async () => {
      await Promise.allSettled([transport.close(), server.close()]);
    });
  } catch (error) {
    await Promise.allSettled([transport.close(), server.close()]);
    console.error('[mcp]', error);
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: (error as Error).message }, id: null },
      { status: 500 },
    );
  }
}

/**
 * La revisión actual del protocolo quitó el stream por GET. Igual respondemos
 * algo legible: alguien que abre esta URL en el navegador merece una pista, no
 * una pantalla en blanco.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      transport: 'streamable-http',
      mensaje:
        'Este es el servidor MCP del CRM. No se usa desde el navegador: pegá esta URL en Claude ' +
        'como conector personalizado, o usá `claude mcp add --transport http`.',
    },
    { status: 405, headers: { allow: 'POST' } },
  );
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}
