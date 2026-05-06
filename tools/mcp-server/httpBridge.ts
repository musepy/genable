/**
 * @file httpBridge.ts
 * @description Standalone HTTP bridge to Figma plugin — no MCP protocol needed.
 * Any AI CLI (Claude Code, OpenCode, Cursor, etc.) can call Figma tools via curl.
 *
 * Architecture:
 *   AI Client (curl / fetch)
 *     → This HTTP server (localhost:3460)
 *       → WebSocket relay (port 3461, same process) → Figma Plugin
 *
 * Usage:
 *   npx tsx tools/mcp-server/httpBridge.ts
 *   # or with custom ports:
 *   HTTP_PORT=3462 MCP_WS_PORT=3463 npx tsx tools/mcp-server/httpBridge.ts
 *
 * Endpoints:
 *   GET  /health              — connection status + connected files
 *   GET  /clients             — list connected Figma files (fileKey, fileName)
 *   GET  /tools               — list available tools
 *   POST /tool/:name          — call a tool (JSON body = parameters)
 *   POST /tool/:name?file=KEY — call a tool targeting a specific Figma file
 */

import http from 'http';

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3460', 10);
const WS_PORT = parseInt(process.env.MCP_WS_PORT || '3461', 10);

// ── Helpers ──
function jsonResponse(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── Main ──
async function main() {
  // Set WS port BEFORE importing wsRelay — it reads env at module top-level
  process.env.MCP_WS_PORT = String(WS_PORT);
  const { createWsRelay } = await import('./wsRelay.js');
  const { unifiedTools } = await import('../../src/engine/agent/tools/unified/index.js');

  const relay = createWsRelay();

  // Tool catalog for /tools endpoint
  const toolCatalog = unifiedTools.map((def: any) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  }));
  const toolSet = new Set(unifiedTools.map((d: any) => d.name));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      const clients = relay.listClients();
      jsonResponse(res, 200, {
        ok: true,
        pluginConnected: relay.isPluginConnected(),
        clients,
      });
      return;
    }

    // GET /clients
    if (req.method === 'GET' && url.pathname === '/clients') {
      jsonResponse(res, 200, { clients: relay.listClients() });
      return;
    }

    // GET /tools
    if (req.method === 'GET' && url.pathname === '/tools') {
      jsonResponse(res, 200, { tools: toolCatalog });
      return;
    }

    // POST /tool/:name[?file=fileKey]
    const toolMatch = url.pathname.match(/^\/tool\/([a-z_]+)$/);
    if (req.method === 'POST' && toolMatch) {
      const toolName = toolMatch[1];
      const fileKey = url.searchParams.get('file') || undefined;

      if (!toolSet.has(toolName)) {
        jsonResponse(res, 404, { error: `Unknown tool: ${toolName}` });
        return;
      }

      // Require ?file= when multiple clients are connected
      const clients = relay.listClients();
      if (!fileKey && clients.length > 1) {
        const fileList = clients.map(c => `  "${c.fileName}" (?file=${encodeURIComponent(c.fileName.replace('[Draft] ', ''))})`).join('\n');
        jsonResponse(res, 400, {
          error: `Multiple Figma files connected. Add ?file=<name> to target one:\n${fileList}`,
        });
        return;
      }

      if (!relay.isPluginConnected()) {
        jsonResponse(res, 503, {
          error: 'Figma plugin is not connected. Open Figma and run the plugin first.',
        });
        return;
      }

      try {
        const body = await readBody(req);
        const params = body ? JSON.parse(body) : {};

        // Pit-of-success: screenshot=true implies mode:detail (screenshot only works in detail mode)
        if (toolName === 'inspect' && params.screenshot && !params.mode) {
          params.mode = 'detail';
        }

        // Route to specific file or any available
        const response = fileKey
          ? await relay.callToolForFile(fileKey, toolName, params)
          : await relay.callTool(toolName, params);

        if (response.error) {
          jsonResponse(res, 422, { error: response.error });
        } else {
          const data = response.data ?? response;
          // Normalize __image → screenshot for cleaner API surface
          if (data?.__image) {
            data.screenshot = data.__image;
            delete data.__image;
          }
          // Forward tool warnings (sizing demotes, dependency violations, ambiguous
          // variable autopicks, etc.) — these mirror what the LLM sees and are
          // load-bearing for debugging "why didn't my intent take" cases.
          const out: any = { ok: true, data };
          if (response.warnings && response.warnings.length > 0) {
            out.warnings = response.warnings;
          }
          jsonResponse(res, 200, out);
        }
      } catch (err: any) {
        const isTimeout = err.message?.includes('timed out');
        const isNotConnected = err.message?.includes('not connected') || err.message?.includes('No Figma file');
        jsonResponse(res, isTimeout ? 504 : isNotConnected ? 404 : 500, { error: err.message });
      }
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  });

  server.listen(HTTP_PORT, () => {
    console.error(`[HTTP Bridge] Listening on http://localhost:${HTTP_PORT}`);
    console.error(`[HTTP Bridge] WebSocket relay on port ${WS_PORT}`);
    console.error(`[HTTP Bridge] Endpoints:`);
    console.error(`[HTTP Bridge]   GET  /health, /clients, /tools`);
    console.error(`[HTTP Bridge]   POST /tool/:name[?file=fileKey]`);
  });

  process.on('SIGINT', () => {
    relay.close();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[HTTP Bridge] Fatal error:', err);
  process.exit(1);
});
