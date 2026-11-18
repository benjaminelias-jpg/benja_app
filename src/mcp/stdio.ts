#!/usr/bin/env node
/**
 * Puente stdio para el servidor MCP del CRM.
 *
 * Claude Desktop y algunos clientes solo saben lanzar un proceso local y
 * hablarle por entrada/salida estándar. Este puente recibe por stdio y reenvía
 * al endpoint HTTP del CRM, que es donde viven de verdad las herramientas.
 *
 * Uso:
 *   HOOKCRM_URL=https://tu-crm.com HOOKCRM_API_KEY=hk_live_... npm run mcp
 *
 * Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "hook-crm": {
 *         "command": "npx",
 *         "args": ["-y", "tsx", "/ruta/absoluta/al/proyecto/src/mcp/stdio.ts"],
 *         "env": { "HOOKCRM_URL": "...", "HOOKCRM_API_KEY": "..." }
 *       }
 *     }
 *   }
 *
 * REGLA DURA: nada puede escribirse en stdout salvo el protocolo JSON-RPC.
 * Un `console.log` suelto corrompe los mensajes y rompe la conexión; por eso
 * todos los avisos de este archivo van a stderr.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './tools';

const log = (...args: unknown[]) => console.error('[hook-crm-mcp]', ...args);

async function main() {
  const baseUrl = (process.env.HOOKCRM_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const apiKey = process.env.HOOKCRM_API_KEY;

  if (!apiKey) {
    log('Falta HOOKCRM_API_KEY. Creá una clave en el CRM: Integraciones → API.');
  }

  const endpoint = new URL(`${baseUrl}/api/mcp`);
  log(`conectando a ${endpoint.toString()}`);

  const upstream = new Client(
    { name: `${MCP_SERVER_NAME}-stdio-bridge`, version: MCP_SERVER_VERSION },
    { capabilities: {} },
  );

  await upstream.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      },
    }),
  );

  const bridge = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  bridge.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await upstream.listTools();
    return { tools: result.tools };
  });

  bridge.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return (await upstream.callTool({
        name: request.params.name,
        arguments: request.params.arguments ?? {},
      })) as CallToolResult;
    } catch (error) {
      // Un fallo de red no debe tumbar el puente: se devuelve como error de
      // herramienta para que el cliente pueda reintentar o avisar.
      return {
        content: [{ type: 'text' as const, text: `Error llamando al CRM: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  await bridge.connect(new StdioServerTransport());
  log('puente listo');

  const cerrar = async () => {
    await Promise.allSettled([bridge.close(), upstream.close()]);
    process.exit(0);
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

main().catch((error) => {
  log('no se pudo iniciar:', error?.message ?? error);
  process.exit(1);
});
