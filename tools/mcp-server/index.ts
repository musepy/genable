/**
 * @file MCP Server — Expose Figma plugin tools to external clients (Claude Code, etc.)
 *
 * Architecture:
 *   Claude Code (MCP client, stdio)
 *     → This MCP Server (Node.js, stdio transport)
 *       → WebSocket relay (localhost:3458) → Figma Plugin
 *
 * All 28 unified tools are registered as MCP tools.
 * All calls are relayed to the Figma plugin via WebSocket.
 *
 * IMPORTANT: Use console.error() for logging — stdout is reserved for MCP JSON-RPC.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createWsRelay } from './wsRelay.js';
import { unifiedTools } from '../../src/engine/agent/tools/unified/index.js';

// ── Convert ToolDefinition.parameters → MCP inputSchema ──
function toMcpInputSchema(def: (typeof unifiedTools)[number]) {
  return {
    type: 'object' as const,
    properties: def.parameters.properties,
    required: def.parameters.required ?? [],
  };
}

// ── Build MCP content from tool response ──
function buildMcpContent(
  response: any,
): { content: any[]; isError?: boolean } {
  // Error response
  if (response.error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: response.error }) }],
      isError: true,
    };
  }

  const data = response.data ?? response;
  const content: any[] = [];

  // Extract image if present (get_screenshot tool — data.__image)
  if (data?.__image) {
    const { __image, ...rest } = data;
    content.push({ type: 'text', text: JSON.stringify(rest) });
    content.push({
      type: 'image',
      data: __image.data,
      mimeType: __image.mimeType,
    });
  } else {
    content.push({ type: 'text', text: JSON.stringify(data) });
  }

  return { content };
}

// ── Main ──
async function main() {
  const relay = createWsRelay();

  const server = new Server(
    { name: 'figma-ai-generator', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // List tools — auto-convert from ToolDefinition
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: unifiedTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: toMcpInputSchema(def),
    })),
  }));

  // Call tool — relay to Figma plugin via WebSocket
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: params = {} } = request.params;

    if (!relay.isPluginConnected()) {
      return {
        content: [{
          type: 'text',
          text: 'Figma plugin is not connected. Open Figma and run the plugin first, then retry.',
        }],
        isError: true,
      };
    }

    try {
      const response = await relay.callTool(toolName, params as Record<string, any>);
      return buildMcpContent(response);
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: err.message || String(err) }],
        isError: true,
      };
    }
  });

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Figma AI Generator MCP server running (stdio)');

  // Graceful shutdown
  process.on('SIGINT', () => {
    relay.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
