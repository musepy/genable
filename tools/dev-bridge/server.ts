/**
 * Dev Bridge Server — bridges Claude Code ↔ Figma Plugin
 *
 * Endpoints:
 *   GET  /trigger  → returns current prompt (or 204 if none)
 *   POST /trigger  → set a new prompt (Claude writes here)
 *   POST /result   → plugin posts execution results
 *   GET  /result   → returns latest result (Claude reads here)
 *   GET  /health   → liveness check
 *
 * Storage: /tmp/figma-bridge/ (ephemeral, no cleanup needed)
 *
 * Usage:
 *   npx tsx tools/dev-bridge/server.ts
 *   # or: node --import tsx tools/dev-bridge/server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 3456;
const BRIDGE_DIR = process.env.BRIDGE_DIR || '/tmp/figma-bridge';
const TRIGGER_FILE = join(BRIDGE_DIR, 'prompt.json');
const RESULT_DIR = join(BRIDGE_DIR, 'results');

// --- helpers ---

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

// --- routes ---

async function handleTriggerGet(res: ServerResponse) {
  try {
    const data = await readFile(TRIGGER_FILE, 'utf-8');
    json(res, 200, JSON.parse(data));
  } catch {
    // no pending trigger
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

  const id = payload.triggerId || `result-${Date.now()}`;
  const resultDir = join(RESULT_DIR, id);
  await mkdir(resultDir, { recursive: true });

  // write node tree
  if (payload.nodeTree) {
    await writeFile(join(resultDir, 'tree.json'), JSON.stringify(payload.nodeTree, null, 2));
  }

  // write screenshot (base64 PNG)
  if (payload.screenshot) {
    const buf = Buffer.from(payload.screenshot, 'base64');
    await writeFile(join(resultDir, 'screenshot.png'), buf);
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

  // write full payload as meta
  await writeFile(join(resultDir, 'meta.json'), JSON.stringify(payload, null, 2));

  // clear the trigger after result is received
  try { await rm(TRIGGER_FILE); } catch { /* noop */ }

  json(res, 201, { ok: true, id, path: resultDir });
  console.log(`[result] saved to ${resultDir}`);
}

async function handleResultGet(res: ServerResponse) {
  try {
    const { readdir, stat } = await import('node:fs/promises');
    const entries = await readdir(RESULT_DIR);
    if (entries.length === 0) {
      json(res, 204, null);
      return;
    }

    // find most recent result dir
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
      await handleTriggerGet(res);
    } else if (path === '/trigger' && method === 'POST') {
      await handleTriggerPost(req, res);
    } else if (path === '/trigger' && method === 'DELETE') {
      await handleTriggerDelete(res);
    } else if (path === '/result' && method === 'POST') {
      await handleResultPost(req, res);
    } else if (path === '/result' && method === 'GET') {
      await handleResultGet(res);
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

  server.listen(PORT, () => {
    console.log(`\nDev Bridge Server running on http://localhost:${PORT}`);
    console.log(`Bridge dir: ${BRIDGE_DIR}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health   - liveness check`);
    console.log(`  GET  /trigger  - read pending prompt (204 if none)`);
    console.log(`  POST /trigger  - set prompt { "prompt": "..." }`);
    console.log(`  DEL  /trigger  - clear pending prompt`);
    console.log(`  POST /result   - save execution result`);
    console.log(`  GET  /result   - read latest result (204 if none)\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
