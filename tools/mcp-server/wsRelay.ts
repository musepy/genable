/**
 * @file wsRelay.ts
 * @description WebSocket relay between MCP server and Figma plugin.
 * Creates a WS server on port 3458. The plugin connects as a client.
 * MCP server calls `callTool()` which sends a request and awaits the response.
 *
 * If the port is already in use (e.g. stale process from a previous session),
 * the relay will kill the occupant and retry once before falling back to
 * degraded mode (local-only tools still work, WS-dependent tools return a
 * clear error message).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'child_process';

const WS_PORT = 3458;
const CALL_TIMEOUT_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

interface PendingRequest {
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WsRelay {
  callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
  isPluginConnected(): boolean;
  close(): void;
}

/** Try to kill whatever process is listening on WS_PORT. */
function killPortOccupant(): boolean {
  try {
    const out = execSync(`lsof -ti :${WS_PORT}`, { encoding: 'utf8' }).trim();
    if (out) {
      for (const pid of out.split('\n')) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch {}
      }
      console.error(`[MCP] Killed stale process(es) on port ${WS_PORT}: ${out.replace(/\n/g, ', ')}`);
      return true;
    }
  } catch {
    // lsof returns non-zero when no matches — that's fine
  }
  return false;
}

function setupClient(
  wss: WebSocketServer,
  state: { client: WebSocket | null; pingTimer: ReturnType<typeof setInterval> | null },
  pending: Map<string, PendingRequest>,
) {
  wss.on('connection', (ws) => {
    if (state.client && state.client.readyState === WebSocket.OPEN) {
      state.client.close();
    }
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
    }
    state.client = ws;
    console.error('[MCP] Plugin connected via WebSocket');

    // Keepalive ping — prevents idle connection drops by OS/firewall/proxy
    state.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, KEEPALIVE_INTERVAL_MS);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { requestId, response } = msg;
        const req = pending.get(requestId);
        if (req) {
          clearTimeout(req.timer);
          pending.delete(requestId);
          req.resolve(response);
        }
      } catch (e) {
        console.error('[MCP] Failed to parse WS message:', e);
      }
    });

    ws.on('close', () => {
      if (state.client === ws) {
        state.client = null;
        if (state.pingTimer) {
          clearInterval(state.pingTimer);
          state.pingTimer = null;
        }
        console.error('[MCP] Plugin disconnected');
      }
    });

    ws.on('error', (err) => {
      console.error('[MCP] WebSocket error:', err.message);
    });
  });
}

export function createWsRelay(): WsRelay {
  const pending = new Map<string, PendingRequest>();
  const state: { client: WebSocket | null; pingTimer: ReturnType<typeof setInterval> | null } = { client: null, pingTimer: null };
  let reqCounter = 0;
  let wss: WebSocketServer | null = null;

  // --- Async boot: try listen → on EADDRINUSE kill occupant & retry → or degrade ---
  (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        wss = await listenOnPort(WS_PORT);
        setupClient(wss, state, pending);
        console.error(`[MCP] WebSocket relay listening on port ${WS_PORT}`);
        return; // success
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' && attempt === 0) {
          console.error(`[MCP] Port ${WS_PORT} in use, killing stale occupant…`);
          killPortOccupant();
          await sleep(1000); // give OS time to release
          continue;
        }
        console.error(`[MCP] WebSocket relay failed to start: ${err.message}`);
        console.error('[MCP] Running in degraded mode — local-only tools work, Figma-dependent tools will error.');
        return;
      }
    }
  })();

  return {
    callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
      return new Promise((resolve, reject) => {
        if (!state.client || state.client.readyState !== WebSocket.OPEN) {
          reject(new Error('Figma plugin is not connected. Open Figma and run the plugin first.'));
          return;
        }

        const requestId = `mcp_${Date.now()}_${++reqCounter}`;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Tool call "${toolName}" timed out after ${CALL_TIMEOUT_MS / 1000}s`));
        }, CALL_TIMEOUT_MS);

        pending.set(requestId, { resolve, reject, timer });

        state.client.send(JSON.stringify({ requestId, toolName, parameters }));
      });
    },

    isPluginConnected(): boolean {
      return state.client !== null && state.client.readyState === WebSocket.OPEN;
    },

    close() {
      if (state.pingTimer) {
        clearInterval(state.pingTimer);
        state.pingTimer = null;
      }
      for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new Error('Relay shutting down'));
        pending.delete(id);
      }
      wss?.close();
    },
  };
}

// --- helpers ---

function listenOnPort(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port });
    server.once('listening', () => resolve(server));
    server.once('error', (err) => {
      server.close();
      reject(err);
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
