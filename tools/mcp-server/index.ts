/**
 * @file MCP Server — Expose Figma plugin tools to external clients (Claude Code, etc.)
 *
 * Architecture:
 *   Claude Code (MCP client, stdio)
 *     → This MCP Server (Node.js, stdio transport)
 *       ├─ query(guidelines|style-tags|style) → local execution (catalogs + matcher)
 *       └─ all other calls → WebSocket relay (localhost:3458) → Figma Plugin
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

// ── Tool definitions (for schema registration) ──
import { unifiedTools } from '../../src/engine/agent/tools/unified/index.js';

// ── Local execution imports (query: guidelines, style-tags, style) ──
import guidelinesCatalog from '../../src/generated/guidelines-catalog.json';
import styleCatalog from '../../src/generated/style-catalog.json';
import {
  matchStyleGuide,
  normalizeStyleTags,
  type StyleGuideEntry,
} from '../../src/features/chat/styleGuideMatcher.js';

// ── Convert ToolDefinition.parameters → MCP inputSchema ──
function toMcpInputSchema(def: (typeof unifiedTools)[number]) {
  return {
    type: 'object' as const,
    properties: def.parameters.properties,
    required: def.parameters.required ?? [],
  };
}

// ── Local executors for query tool (no Figma IPC needed) ──
function executeQueryLocally(
  params: Record<string, any>
): { handled: true; result: any } | { handled: false } {
  const source = params.source;

  if (source === 'guidelines') {
    const topic = (params.query || '').toLowerCase().trim();
    const content = (guidelinesCatalog as Record<string, string>)[topic];
    if (!content) {
      return {
        handled: true,
        result: {
          success: false,
          error: {
            code: 'UNKNOWN_TOPIC',
            message: `Unknown topic "${topic}". Available: ${Object.keys(guidelinesCatalog).join(', ')}`,
          },
        },
      };
    }
    return { handled: true, result: { success: true, data: { topic, content } } };
  }

  if (source === 'style-tags') {
    return {
      handled: true,
      result: { success: true, data: { tags: (styleCatalog as any).tags } },
    };
  }

  if (source === 'style') {
    const queryTags = normalizeStyleTags(params.query || '');
    const guides = (styleCatalog as any).guides as Record<string, StyleGuideEntry>;
    const match = matchStyleGuide(queryTags, guides);
    if (!match) {
      return {
        handled: true,
        result: {
          success: false,
          error: {
            code: 'NO_STYLE_MATCH',
            message: `No style guide matched tags "${queryTags.join(', ')}". Use query(source="style-tags") to see available tags.`,
          },
        },
      };
    }
    return {
      handled: true,
      result: {
        success: true,
        data: { name: match.name, tags: match.guide.tags, content: match.guide.content },
      },
    };
  }

  // source === 'nodes' or unknown — fall through to WebSocket relay
  return { handled: false };
}

// ── Build MCP content from ToolResponse ──
function buildMcpContent(response: any): { content: any[]; isError?: boolean } {
  // Error response
  if (response.error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: response.error }),
        },
      ],
      isError: true,
    };
  }

  const data = response.data ?? response;
  const content: any[] = [];

  // Extract image if present (inspect tool with screenshot=true)
  if (data?.__image) {
    // Add text content without the image blob
    const { __image, ...rest } = data;
    content.push({ type: 'text', text: JSON.stringify(rest) });
    content.push({
      type: 'image',
      data: __image.data, // raw base64
      mimeType: __image.mimeType, // 'image/png'
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

  // Call tool — route to local executor or WebSocket relay
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: params = {} } = request.params;

    // Try local execution for query tool
    if (toolName === 'query') {
      const local = executeQueryLocally(params as Record<string, any>);
      if (local.handled) {
        return buildMcpContent(local.result);
      }
    }

    // All other tools → WebSocket relay to Figma plugin
    if (!relay.isPluginConnected()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Figma plugin is not connected. Open Figma and run the plugin first, then retry.',
          },
        ],
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
