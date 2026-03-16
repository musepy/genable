/**
 * @file MCP Server — Expose Figma plugin tools to external clients (Claude Code, etc.)
 *
 * Architecture:
 *   Claude Code (MCP client, stdio)
 *     → This MCP Server (Node.js, stdio transport)
 *       ├─ query(guidelines|style-tags|style|help) → local execution (catalogs + matcher + helpIndex)
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

// ── CLI command parsing (run → individual commands) ──
import {
  parseCommandString,
  mapToToolArgs,
} from '../../src/engine/agent/tools/unified/commandParser.js';
import { isValidCommand, getCommandHelp, findClosestCommand } from '../../src/engine/agent/tools/unified/commandRegistry.js';

// ── Exit code & presentation layer ──
import {
  computeExitCode,
  formatMeta,
  extractStderr,
  truncateOverflow,
  guardBinary,
  EXIT_NOT_FOUND,
  EXIT_ERROR,
} from '../../src/engine/agent/tools/unified/exitCode.js';

// ── Local execution imports (query: guidelines, style-tags, style, help) ──
import guidelinesCatalog from '../../src/generated/guidelines-catalog.json';
import styleCatalog from '../../src/generated/style-catalog.json';
import {
  matchStyleGuide,
  normalizeStyleTags,
  type StyleGuideEntry,
} from '../../src/features/chat/styleGuideMatcher.js';
import { helpIndex } from '../../src/engine/agent/tools/helpIndex.js';

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

  if (source === 'help') {
    const query = (params.query || '').trim();
    if (!query) {
      return { handled: true, result: { success: true, data: { topics: helpIndex.listTopics() } } };
    }
    const exact = helpIndex.getById(query);
    if (exact) {
      return { handled: true, result: { success: true, data: { topic: exact.id, title: exact.title, content: exact.content } } };
    }
    const results = helpIndex.search(query, 2);
    if (results.length === 0) {
      return {
        handled: true,
        result: {
          success: true,
          data: {
            message: `No help article matched "${query}".`,
            availableTopics: helpIndex.listTopics(),
          },
        },
      };
    }
    return {
      handled: true,
      result: {
        success: true,
        data: { results: results.map(r => ({ topic: r.id, title: r.title, content: r.content })) },
      },
    };
  }

  // source === 'nodes' or unknown — fall through to WebSocket relay
  return { handled: false };
}

// ── Build MCP content from ToolResponse ──
function buildMcpContent(
  response: any,
  meta?: { exitCode: number; durationMs: number },
): { content: any[]; isError?: boolean } {
  // Error response
  if (response.error) {
    const stderr = extractStderr(response);
    const metaStr = meta ? `\n${formatMeta(meta.exitCode, meta.durationMs)}` : '';
    const stderrStr = stderr ? `\n${stderr}` : '';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: response.error }) + stderrStr + metaStr,
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
    // Apply overflow guard on text fields
    if (rest.listing && typeof rest.listing === 'string') {
      rest.listing = guardBinary(truncateOverflow(rest.listing, 'Use cat /path/ for details.'));
    }
    if (rest.tree && typeof rest.tree === 'string') {
      rest.tree = guardBinary(truncateOverflow(rest.tree, 'Use cat /path/ for details.'));
    }
    const metaStr = meta ? formatMeta(meta.exitCode, meta.durationMs) : '';
    content.push({ type: 'text', text: JSON.stringify(rest) + (metaStr ? `\n${metaStr}` : '') });
    content.push({
      type: 'image',
      data: __image.data, // raw base64
      mimeType: __image.mimeType, // 'image/png'
    });
  } else {
    // Apply overflow guard on text fields
    if (data?.listing && typeof data.listing === 'string') {
      data.listing = guardBinary(truncateOverflow(data.listing, 'Use cat /path/ for details.'));
    }
    if (data?.tree && typeof data.tree === 'string') {
      data.tree = guardBinary(truncateOverflow(data.tree, 'Use cat /path/ for details.'));
    }

    // Append stderr + meta as footer
    const stderr = extractStderr(response);
    const metaStr = meta ? formatMeta(meta.exitCode, meta.durationMs) : '';
    const stderrStr = stderr ? `\n${stderr}` : '';
    const footer = stderrStr + (metaStr ? `\n${metaStr}` : '');
    content.push({ type: 'text', text: JSON.stringify(data) + footer });
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

  // ── Execute a single parsed command (local or relay) ──
  async function executeCommand(
    commandName: string,
    args: Record<string, any>,
  ): Promise<{ content: any[]; isError?: boolean }> {
    const startMs = Date.now();

    // Try local execution for query tool
    if (commandName === 'query') {
      const local = executeQueryLocally(args);
      if (local.handled) {
        const durationMs = Date.now() - startMs;
        const exitCode = computeExitCode(local.result);
        return buildMcpContent(local.result, { exitCode, durationMs });
      }
    }

    // man command → local execution (same sources as query: guidelines, style-tags, style, help)
    if (commandName === 'man') {
      const manSource = args.source || 'help';
      const local = executeQueryLocally({ source: manSource, query: args.query });
      if (local.handled) {
        const durationMs = Date.now() - startMs;
        const exitCode = computeExitCode(local.result);
        return buildMcpContent(local.result, { exitCode, durationMs });
      }
    }

    // All other commands → WebSocket relay to Figma plugin
    if (!relay.isPluginConnected()) {
      const durationMs = Date.now() - startMs;
      return {
        content: [
          {
            type: 'text',
            text: `Figma plugin is not connected. Open Figma and run the plugin first, then retry.\n${formatMeta(EXIT_ERROR, durationMs)}`,
          },
        ],
        isError: true,
      };
    }

    const response = await relay.callTool(commandName, args);
    const durationMs = Date.now() - startMs;
    const exitCode = computeExitCode(response);
    return buildMcpContent(response, { exitCode, durationMs });
  }

  // Call tool — parse CLI command string, route to local executor or WebSocket relay
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: params = {} } = request.params;
    const { command, input } = params as { command?: string; input?: string };

    // `run` tool — parse CLI command string and dispatch
    if (toolName === 'run') {
      if (!command) {
        return {
          content: [{ type: 'text', text: `Missing required parameter: command. Usage: run({command: "ls /"})\n${formatMeta(EXIT_ERROR, 0)}` }],
          isError: true,
        };
      }

      const chain = parseCommandString(command);

      // Validate all commands in chain before executing
      for (const cmd of chain.commands) {
        if (!cmd.name) {
          return {
            content: [{ type: 'text', text: `Empty command. Available: ls, tree, cat, mk, rm, cp, grep, sed, man\n${formatMeta(EXIT_ERROR, 0)}` }],
            isError: true,
          };
        }
        if (!isValidCommand(cmd.name)) {
          return {
            content: [{ type: 'text', text: `Unknown command "${cmd.name}".${(() => { const s = findClosestCommand(cmd.name); return s ? ` Did you mean "${s}"?` : ''; })()} Available: ls, tree, cat, mk, rm, cp, grep, sed, man\n${formatMeta(EXIT_NOT_FOUND, 0)}` }],
            isError: true,
          };
        }
      }

      // Execute chain with operator semantics: &&, ||, ;, |
      const results: any[] = [];
      let lastIsError = false;

      for (let ci = 0; ci < chain.commands.length; ci++) {
        const cmd = chain.commands[ci];
        const prevOp = ci > 0 ? chain.operators[ci - 1] : undefined;

        // ── Operator semantics ──
        if (prevOp === '&&' && lastIsError) {
          // && : skip on previous failure
          results.push({ type: 'text', text: `[skipped] ${cmd.raw} — previous command failed (&&)` });
          continue;
        }
        if (prevOp === '||' && !lastIsError) {
          // || : skip on previous success
          continue; // silently skip — || is fallback
        }
        // ; : always run
        // | : always run (pipe data is contextual, passed via input)

        // Map CLI args to tool parameters
        const cmdInput = chain.commands.length === 1 ? input : undefined;
        const args = mapToToolArgs(cmd, cmdInput);

        // null args = help mode
        if (args === null) {
          results.push({ type: 'text', text: getCommandHelp(cmd.name) });
          lastIsError = false;
          continue;
        }

        try {
          const result = await executeCommand(cmd.name, args);
          results.push(...result.content);
          lastIsError = !!result.isError;

          // && : stop chain on error
          if (prevOp === '&&' && result.isError) {
            return { content: results, isError: true };
          }
        } catch (err: any) {
          results.push({ type: 'text', text: `${err.message || String(err)}\n${formatMeta(EXIT_ERROR, 0)}` });
          lastIsError = true;
          // && : stop chain on error
          if (prevOp === '&&') {
            return { content: results, isError: true };
          }
        }
      }

      return { content: results, isError: lastIsError ? true : undefined };
    }

    // Direct tool call (non-`run`) — backward compatibility
    try {
      return await executeCommand(toolName, params as Record<string, any>);
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `${err.message || String(err)}\n${formatMeta(EXIT_ERROR, 0)}` }],
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
