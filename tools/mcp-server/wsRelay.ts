/**
 * @file wsRelay.ts
 * @description WebSocket relay between MCP/HTTP server and Figma plugin.
 * Creates a WS server on a configurable port. The plugin connects as a client.
 * MCP server calls `callTool()` which sends a request and awaits the response.
 *
 * Supports multiple concurrent Figma files. Each plugin instance sends
 * { type: 'identify', name, fileKey, fileName } on connect. Tool calls
 * can target a specific file via `callToolForFile(fileKey, ...)`.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'child_process';

const WS_PORT = process.env.MCP_WS_PORT ? parseInt(process.env.MCP_WS_PORT, 10) : 3458;
const KEEPALIVE_INTERVAL_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const RELAY_SECRET = process.env.RELAY_SECRET || '';

// Per-tool timeout: heavy tools (design, replace) need more headroom than reads.
const TOOL_TIMEOUTS: Record<string, number> = {
  jsx: 120_000,     // creates many nodes + font loading + icon fetch
  replace: 90_000,  // recursive tree traversal + font loading per text node
  get_screenshot: 60_000, // exportAsync can be slow on complex nodes
};
const DEFAULT_TIMEOUT_MS = 30_000;

// Generate unique client ID
let clientIdCounter = 0;
function generateClientId(): string {
  return `client_${Date.now()}_${++clientIdCounter}`;
}

interface PendingRequest {
  clientId: string;
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ClientFileInfo {
  clientId: string;
  fileKey: string;
  fileName: string;
}

interface ClientInfo {
  ws: WebSocket;
  name: string;
  fileKey: string;
  fileName: string;
  pingTimer: ReturnType<typeof setInterval>;
}

export interface WsRelay {
  /** Call tool on any connected client (first available). */
  callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
  /** Call tool targeting a specific Figma file by fileKey. */
  callToolForFile(fileKey: string, toolName: string, parameters: Record<string, any>): Promise<any>;
  isPluginConnected(): boolean;
  /** List all connected Figma files. */
  listClients(): ClientFileInfo[];
  close(): void;
}

/** Try to kill whatever process is listening on WS_PORT. */
function killPortOccupant(port: number): boolean {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (out) {
      for (const pid of out.split('\n')) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch {}
      }
      console.error(`[WS] Killed stale process(es) on port ${port}: ${out.replace(/\n/g, ', ')}`);
      return true;
    }
  } catch {
    // lsof returns non-zero when no matches — that's fine
  }
  return false;
}

function setupClient(
  wss: WebSocketServer,
  state: { clients: Map<string, ClientInfo> },
  pending: Map<string, PendingRequest>,
) {
  wss.on('connection', (ws) => {
    let identified = false;
    let clientId: string | null = null;

    const handshakeTimer = setTimeout(() => {
      if (!identified) {
        console.error(`[WS] Client failed to identify within ${HANDSHAKE_TIMEOUT_MS / 1000}s — closing`);
        ws.close();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Handle identify / re-identify (file info may arrive later)
        if (msg.type === 'identify') {
          if (RELAY_SECRET && msg.secret !== RELAY_SECRET) {
            console.error(`[WS] Rejecting "${msg.name || '(unnamed)'}" — invalid secret`);
            ws.close(4003, 'auth-failed');
            clearTimeout(handshakeTimer);
            return;
          }
          clearTimeout(handshakeTimer);

          if (!identified) {
            // First identify — register client
            identified = true;
            clientId = generateClientId();
            const pingTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, KEEPALIVE_INTERVAL_MS);

            state.clients.set(clientId, {
              ws,
              name: msg.name || '(unnamed)',
              fileKey: msg.fileKey || '',
              fileName: msg.fileName || '',
              pingTimer,
            });
            console.error(`[WS] Client connected: "${msg.name}" (${clientId}) file=${msg.fileName || '?'} [${msg.fileKey || '?'}]`);
          } else if (clientId) {
            // Re-identify — update file info (plugin sends this when file info becomes available)
            const client = state.clients.get(clientId);
            if (client) {
              client.fileKey = msg.fileKey || client.fileKey;
              client.fileName = msg.fileName || client.fileName;
              console.error(`[WS] Client updated: "${msg.name}" (${clientId}) file=${client.fileName} [${client.fileKey}]`);
            }
          }
          return;
        }

        // Ignore messages from unidentified clients
        if (!identified || !clientId) return;

        // Handle tool result response
        const { requestId, response } = msg;
        const req = pending.get(requestId);
        if (req) {
          if (req.clientId !== clientId) {
            console.error(`[WS] Security: Client ${clientId} tried to respond to request from ${req.clientId}`);
            return;
          }
          clearTimeout(req.timer);
          pending.delete(requestId);
          req.resolve(response);
        }
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    });

    ws.on('close', () => {
      clearTimeout(handshakeTimer);
      if (clientId && state.clients.has(clientId)) {
        const client = state.clients.get(clientId)!;
        clearInterval(client.pingTimer);
        state.clients.delete(clientId);
        console.error(`[WS] Client disconnected: "${client.name}" (${clientId}) file=${client.fileName}`);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] WebSocket error:', err.message);
    });
  });
}

export function createWsRelay(): WsRelay {
  const pending = new Map<string, PendingRequest>();
  const state: { clients: Map<string, ClientInfo> } = { clients: new Map() };
  let reqCounter = 0;
  let wss: WebSocketServer | null = null;

  // --- Async boot ---
  (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        wss = await listenOnPort(WS_PORT);
        setupClient(wss, state, pending);
        console.error(`[WS] WebSocket relay listening on port ${WS_PORT}`);
        return;
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' && attempt === 0) {
          console.error(`[WS] Port ${WS_PORT} in use, killing stale occupant…`);
          killPortOccupant(WS_PORT);
          await sleep(1000);
          continue;
        }
        console.error(`[WS] WebSocket relay failed to start: ${err.message}`);
        console.error('[WS] Running in degraded mode — Figma-dependent tools will error.');
        return;
      }
    }
  })();

  function findClient(fileIdentifier?: string): ClientInfo | null {
    if (state.clients.size === 0) return null;

    // If identifier specified, match against fileKey OR fileName (case-insensitive)
    if (fileIdentifier) {
      const needle = fileIdentifier.toLowerCase();
      for (const client of state.clients.values()) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (client.fileKey === fileIdentifier) return client;
        if (client.fileName.toLowerCase() === needle) return client;
        // Partial match on fileName (e.g. "test" matches "opencode genable test")
        if (client.fileName.toLowerCase().includes(needle)) return client;
      }
      return null;
    }

    // No identifier — use first available (backward compatible)
    for (const client of state.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) return client;
    }
    return null;
  }

  function doCallTool(client: ClientInfo, clientId: string, toolName: string, parameters: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutMs = TOOL_TIMEOUTS[toolName] ?? DEFAULT_TIMEOUT_MS;
      const requestId = `mcp_${Date.now()}_${++reqCounter}`;
      const startTime = Date.now();

      console.error(`[WS] → ${toolName} (${requestId}, file=${client.fileName}, timeout ${timeoutMs / 1000}s)`);

      const timer = setTimeout(() => {
        pending.delete(requestId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        reject(new Error(`Tool call "${toolName}" timed out after ${elapsed}s (limit: ${timeoutMs / 1000}s)`));
      }, timeoutMs);

      pending.set(requestId, {
        clientId,
        resolve: (response: any) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.error(`[WS] ← ${toolName} (${requestId}, ${elapsed}s)`);
          resolve(response);
        },
        reject,
        timer,
      });

      client.ws.send(JSON.stringify({ requestId, toolName, parameters }));
    });
  }

  return {
    callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
      const client = findClient();
      if (!client) {
        return Promise.reject(new Error('Figma plugin is not connected. Open Figma and run the plugin first.'));
      }
      // Find clientId for this client
      const clientId = [...state.clients.entries()].find(([_, c]) => c === client)?.[0];
      if (!clientId) return Promise.reject(new Error('Client not found'));
      return doCallTool(client, clientId, toolName, parameters);
    },

    callToolForFile(fileKey: string, toolName: string, parameters: Record<string, any>): Promise<any> {
      const client = findClient(fileKey);
      if (!client) {
        const available = [...state.clients.values()].map(c => `${c.fileName} [${c.fileKey}]`).join(', ');
        return Promise.reject(new Error(
          `No Figma file with key "${fileKey}" is connected. Connected files: ${available || 'none'}`
        ));
      }
      const clientId = [...state.clients.entries()].find(([_, c]) => c === client)?.[0];
      if (!clientId) return Promise.reject(new Error('Client not found'));
      return doCallTool(client, clientId, toolName, parameters);
    },

    isPluginConnected(): boolean {
      return findClient() !== null;
    },

    listClients(): ClientFileInfo[] {
      return [...state.clients.entries()]
        .filter(([_, c]) => c.ws.readyState === WebSocket.OPEN)
        .map(([id, c]) => ({ clientId: id, fileKey: c.fileKey, fileName: c.fileName }));
    },

    close() {
      state.clients.forEach((client) => {
        clearInterval(client.pingTimer);
        client.ws.close();
      });
      state.clients.clear();
      pending.forEach((req) => {
        clearTimeout(req.timer);
        req.reject(new Error('Relay shutting down'));
      });
      pending.clear();
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
