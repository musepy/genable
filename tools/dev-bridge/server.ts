/**
 * Dev Bridge Server — bridges Claude Code ↔ Figma Plugin
 *
 * Endpoints:
 *   GET  /trigger      → returns current prompt (or 204 if none)
 *   POST /trigger      → set a new prompt (Claude writes here)
 *   DEL  /trigger      → clear pending prompt
 *   POST /result       → plugin posts execution results
 *   GET  /result       → returns latest result
 *   GET  /result/:id   → returns specific result (supports ?wait=N long-poll)
 *   GET  /health       → liveness check
 *
 * Storage: /tmp/figma-bridge/ (ephemeral)
 * Auto-cleanup: keeps most recent MAX_RESULTS results.
 *
 * Usage:
 *   npx tsx tools/dev-bridge/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 3456;
const BRIDGE_DIR = process.env.BRIDGE_DIR || '/tmp/figma-bridge';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const TRIGGER_FILE = join(BRIDGE_DIR, 'prompt.json');
const RESULT_DIR = join(BRIDGE_DIR, 'results');
const MAX_RESULTS = 5;

// --- helpers ---

function cors(res: ServerResponse) {
  // Figma plugin iframes have origin 'null' — must use wildcard for dev bridge
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** Check Bearer token on mutating endpoints. No-op if BRIDGE_TOKEN is unset. */
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!BRIDGE_TOKEN) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${BRIDGE_TOKEN}`) return true;
  json(res, 401, { error: 'Invalid or missing BRIDGE_TOKEN' });
  return false;
}

function json(res: ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// --- SSE stream clients ---

const streamClients = new Map<string, Set<ServerResponse>>();

function sendSSE(triggerId: string, event: string, data: any) {
  const clients = streamClients.get(triggerId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// --- long-poll waiters ---

const resultWaiters = new Map<string, Array<(data: any) => void>>();
const triggerWaiters: Array<(data: any) => void> = [];

function notifyWaiters(id: string, data: any) {
  const waiters = resultWaiters.get(id);
  if (waiters) {
    for (const resolve of waiters) resolve(data);
    resultWaiters.delete(id);
  }
}

function notifyTriggerWaiters(data: any) {
  const waiters = triggerWaiters.splice(0);
  for (const resolve of waiters) resolve(data);
}

// --- auto-cleanup ---

async function cleanupOldResults() {
  try {
    const entries = await readdir(RESULT_DIR);
    if (entries.length <= MAX_RESULTS) return;

    const withTime = await Promise.all(
      entries.map(async (e) => {
        const s = await stat(join(RESULT_DIR, e));
        return { name: e, mtime: s.mtimeMs };
      })
    );
    withTime.sort((a, b) => b.mtime - a.mtime);

    const toDelete = withTime.slice(MAX_RESULTS);
    for (const entry of toDelete) {
      await rm(join(RESULT_DIR, entry.name), { recursive: true });
    }
    if (toDelete.length > 0) {
      console.log(`[cleanup] removed ${toDelete.length} old result(s), keeping ${MAX_RESULTS}`);
    }
  } catch { /* ignore */ }
}

// --- routes ---

async function handleTriggerGet(waitSec: number, res: ServerResponse) {
  // Try immediate read first
  try {
    const data = await readFile(TRIGGER_FILE, 'utf-8');
    json(res, 200, JSON.parse(data));
    return;
  } catch { /* no pending trigger */ }

  // No trigger — if wait requested, long-poll until one arrives
  if (waitSec > 0) {
    const timeoutMs = Math.min(waitSec, 60) * 1000; // cap at 60s
    let resolved = false;

    const timeout = setTimeout(async () => {
      if (resolved) return;
      // Re-check file before giving up (race window)
      try {
        const data = await readFile(TRIGGER_FILE, 'utf-8');
        resolved = true;
        const idx = triggerWaiters.indexOf(resolve);
        if (idx >= 0) triggerWaiters.splice(idx, 1);
        json(res, 200, JSON.parse(data));
        return;
      } catch { /* still nothing */ }

      resolved = true;
      const idx = triggerWaiters.indexOf(resolve);
      if (idx >= 0) triggerWaiters.splice(idx, 1);
      cors(res);
      res.writeHead(204);
      res.end();
    }, timeoutMs);

    function resolve(data: any) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      json(res, 200, data);
    }

    triggerWaiters.push(resolve);
  } else {
    cors(res);
    res.writeHead(204);
    res.end();
  }
}

async function handleTriggerPost(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const payload = JSON.parse(body.toString('utf-8'));

  // validate minimal shape
  if (!payload.prompt || typeof payload.prompt !== 'string') {
    json(res, 400, { error: 'Missing "prompt" string field' });
    return;
  }

  // stamp metadata
  payload.timestamp = Date.now();
  payload.id = payload.id || `trigger-${Date.now()}`;

  await writeFile(TRIGGER_FILE, JSON.stringify(payload, null, 2));
  json(res, 201, { ok: true, id: payload.id });
  console.log(`[trigger] new prompt: "${payload.prompt.slice(0, 80)}..."`);

  // Wake up any long-polling plugin connections immediately
  notifyTriggerWaiters(payload);
}

async function handleTriggerDelete(res: ServerResponse) {
  try {
    await rm(TRIGGER_FILE);
  } catch {
    // already gone
  }
  json(res, 200, { ok: true });
}

async function handleResultPost(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const payload = JSON.parse(body.toString('utf-8'));

  const rawId = payload.triggerId || `result-${Date.now()}`;
  const id = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_'); // sanitize: alphanumeric, dash, underscore only
  const resultDir = join(RESULT_DIR, id);
  await mkdir(resultDir, { recursive: true });

  // write node tree
  if (payload.nodeTree) {
    await writeFile(join(resultDir, 'tree.json'), JSON.stringify(payload.nodeTree, null, 2));
  }

  // write per-node screenshots
  if (payload.screenshots && Array.isArray(payload.screenshots)) {
    for (let i = 0; i < payload.screenshots.length; i++) {
      const s = payload.screenshots[i];
      const buf = Buffer.from(s.base64, 'base64');
      const suffix = payload.screenshots.length === 1 ? '' : `-${i + 1}`;
      await writeFile(join(resultDir, `screenshot${suffix}.png`), buf);
    }
  }

  // write logs
  if (payload.logs) {
    const logText = Array.isArray(payload.logs) ? payload.logs.join('\n') : String(payload.logs);
    await writeFile(join(resultDir, 'logs.txt'), logText);
  }

  // write tool call details (per-call params + results + warnings)
  if (payload.toolCallDetails) {
    await writeFile(join(resultDir, 'tool-calls.json'), JSON.stringify(payload.toolCallDetails, null, 2));
  }

  // write runtime events for UI replay
  if (payload.runtimeEvents && Array.isArray(payload.runtimeEvents)) {
    await writeFile(join(resultDir, 'runtime-events.json'), JSON.stringify(payload.runtimeEvents));
  }

  // write full payload as meta
  await writeFile(join(resultDir, 'meta.json'), JSON.stringify(payload, null, 2));

  // clear the trigger after result is received
  try { await rm(TRIGGER_FILE); } catch { /* noop */ }

  json(res, 201, { ok: true, id, path: resultDir });
  console.log(`[result] saved to ${resultDir}`);

  // Notify SSE stream clients that the run is done
  sendSSE(rawId, 'done', { triggerId: rawId, durationMs: payload.durationMs, toolCalls: payload.toolCallSummary });
  // Close all SSE connections for this trigger
  const clients = streamClients.get(rawId);
  if (clients) {
    for (const c of clients) try { c.end(); } catch {}
    streamClients.delete(rawId);
  }

  // Notify any long-poll waiters
  notifyWaiters(id, payload);

  // Auto-cleanup disabled — keep all results for post-test analysis
  // await cleanupOldResults();
}

async function handleResultGet(filterTriggerId: string | null, res: ServerResponse) {
  try {
    const entries = await readdir(RESULT_DIR);
    if (entries.length === 0) {
      json(res, 200, { status: 'no_results' });
      return;
    }

    // If filtering by trigger ID, try direct lookup first
    if (filterTriggerId) {
      const directPath = join(RESULT_DIR, filterTriggerId, 'meta.json');
      try {
        const meta = await readFile(directPath, 'utf-8');
        json(res, 200, { id: filterTriggerId, ...JSON.parse(meta) });
        return;
      } catch {
        // Not found — might still be pending
        json(res, 200, { id: filterTriggerId, status: 'pending', triggerId: filterTriggerId });
        return;
      }
    }

    // No filter — find most recent result dir
    let latest = '';
    let latestTime = 0;
    for (const entry of entries) {
      const s = await stat(join(RESULT_DIR, entry));
      if (s.mtimeMs > latestTime) {
        latestTime = s.mtimeMs;
        latest = entry;
      }
    }

    const metaPath = join(RESULT_DIR, latest, 'meta.json');
    const meta = await readFile(metaPath, 'utf-8');
    json(res, 200, { id: latest, ...JSON.parse(meta) });
  } catch {
    cors(res);
    res.writeHead(204);
    res.end();
  }
}

async function handleResultById(id: string, waitSec: number, res: ServerResponse) {
  // Try to read existing result first
  const resultDir = join(RESULT_DIR, id);
  try {
    const meta = await readFile(join(resultDir, 'meta.json'), 'utf-8');
    json(res, 200, { id, ...JSON.parse(meta) });
    return;
  } catch { /* not ready yet */ }

  // No result yet — if wait requested, long-poll
  if (waitSec > 0) {
    const timeoutMs = Math.min(waitSec, 300) * 1000; // cap at 5 min
    let resolved = false;

    const timeout = setTimeout(async () => {
      if (resolved) return;
      // Before giving up, re-check filesystem — result may have arrived
      // between the initial check and waiter registration (race window)
      try {
        const meta = await readFile(join(resultDir, 'meta.json'), 'utf-8');
        resolved = true;
        const waiters = resultWaiters.get(id);
        if (waiters) {
          const idx = waiters.indexOf(resolve);
          if (idx >= 0) waiters.splice(idx, 1);
          if (waiters.length === 0) resultWaiters.delete(id);
        }
        json(res, 200, { id, ...JSON.parse(meta) });
        return;
      } catch { /* still not ready */ }

      resolved = true;
      const waiters = resultWaiters.get(id);
      if (waiters) {
        const idx = waiters.indexOf(resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        if (waiters.length === 0) resultWaiters.delete(id);
      }
      json(res, 202, { id, status: 'pending', message: `No result after ${waitSec}s` });
    }, timeoutMs);

    function resolve(data: any) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      json(res, 200, { id, ...data });
    }

    if (!resultWaiters.has(id)) resultWaiters.set(id, []);
    resultWaiters.get(id)!.push(resolve);
  } else {
    json(res, 202, { id, status: 'pending' });
  }
}

// --- recordings (for UI replay) ---

async function handleRecordingsList(res: ServerResponse) {
  try {
    const entries = await readdir(RESULT_DIR);
    const recordings: { id: string; mtime: number; hasEvents: boolean }[] = [];

    for (const entry of entries) {
      const dirPath = join(RESULT_DIR, entry);
      const s = await stat(dirPath);
      if (!s.isDirectory()) continue;

      let hasEvents = false;
      try {
        await stat(join(dirPath, 'runtime-events.json'));
        hasEvents = true;
      } catch { /* no events file */ }

      recordings.push({ id: entry, mtime: s.mtimeMs, hasEvents });
    }

    recordings.sort((a, b) => b.mtime - a.mtime);
    json(res, 200, recordings);
  } catch {
    json(res, 200, []);
  }
}

async function handleRecordingEvents(id: string, res: ServerResponse) {
  const eventsPath = join(RESULT_DIR, id, 'runtime-events.json');
  try {
    const data = await readFile(eventsPath, 'utf-8');
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  } catch {
    json(res, 404, { error: `No runtime-events.json for recording "${id}"` });
  }
}

// --- server ---

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (path === '/health') {
      json(res, 200, { status: 'ok', uptime: process.uptime() });
    } else if (path === '/trigger' && method === 'GET') {
      const waitSec = Number(url.searchParams.get('wait')) || 0;
      await handleTriggerGet(waitSec, res);
    } else if (path === '/trigger' && method === 'POST') {
      if (!checkAuth(req, res)) return;
      await handleTriggerPost(req, res);
    } else if (path === '/trigger' && method === 'DELETE') {
      if (!checkAuth(req, res)) return;
      await handleTriggerDelete(res);
    } else if (path === '/result' && method === 'POST') {
      if (!checkAuth(req, res)) return;
      await handleResultPost(req, res);
    } else if (path === '/result' && method === 'GET') {
      const filterTriggerId = url.searchParams.get('trigger') || null;
      await handleResultGet(filterTriggerId, res);
    } else if (path.startsWith('/result/') && method === 'GET') {
      const id = path.slice('/result/'.length);
      const waitSec = Number(url.searchParams.get('wait')) || 0;
      await handleResultById(id, waitSec, res);
    } else if (path.startsWith('/event/') && method === 'POST') {
      // Plugin posts tool call events as they happen
      const id = path.slice('/event/'.length);
      const body = await readBody(req);
      const event = JSON.parse(body.toString('utf-8'));
      sendSSE(id, event.type || 'tool', event);
      json(res, 200, { ok: true });
    } else if (path.startsWith('/stream/') && method === 'GET') {
      // SSE stream for a trigger — client subscribes to live events
      const id = path.slice('/stream/'.length);
      cors(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`event: connected\ndata: {"triggerId":"${id}"}\n\n`);
      if (!streamClients.has(id)) streamClients.set(id, new Set());
      streamClients.get(id)!.add(res);
      req.on('close', () => {
        streamClients.get(id)?.delete(res);
        if (streamClients.get(id)?.size === 0) streamClients.delete(id);
      });
    } else if (path === '/recordings' && method === 'GET') {
      await handleRecordingsList(res);
    } else if (path.match(/^\/recordings\/[^/]+\/events$/) && method === 'GET') {
      const id = path.split('/')[2];
      await handleRecordingEvents(id, res);
    } else {
      json(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    console.error(`[error] ${method} ${path}:`, err);
    json(res, 500, { error: String(err) });
  }
});

async function main() {
  await mkdir(BRIDGE_DIR, { recursive: true });
  await mkdir(RESULT_DIR, { recursive: true });

  // Clean up on startup — disabled, keep all results
  // await cleanupOldResults();

  server.listen(PORT, () => {
    console.log(`\nDev Bridge Server running on http://localhost:${PORT}`);
    console.log(`Bridge dir: ${BRIDGE_DIR}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health          - liveness check`);
    console.log(`  GET  /trigger         - read pending prompt (204 if none)`);
    console.log(`  POST /trigger         - set prompt { "prompt": "..." }`);
    console.log(`  DEL  /trigger         - clear pending prompt`);
    console.log(`  POST /result          - save execution result`);
    console.log(`  GET  /result          - read latest result`);
    console.log(`  GET  /result/:id      - read specific result`);
    console.log(`  GET  /result/:id?wait=120 - long-poll until result ready`);
    console.log(`  GET  /recordings      - list recordings with runtime events`);
    console.log(`  GET  /recordings/:id/events - get runtime events for replay\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
