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
import { mkdir, readFile, writeFile, appendFile, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// --- ask_user answer store ---

const pendingAnswers = new Map<string, string>();
const answerWaiters = new Map<string, Array<(answer: string) => void>>();

function notifyAnswerWaiters(triggerId: string, answer: string) {
  const waiters = answerWaiters.get(triggerId);
  if (waiters) {
    for (const resolve of waiters) resolve(answer);
    answerWaiters.delete(triggerId);
  }
}

// --- active trigger tracking (disconnect detection) ---

let activeTrigger: { id: string; claimedAt: number } | null = null;

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

async function handlePluginDisconnect(triggerId: string, claimedAt: number) {
  console.log(`[disconnect] plugin reloaded during ${triggerId}, saving partial result`);

  const partialDir = join(RESULT_DIR, triggerId);
  await mkdir(partialDir, { recursive: true });

  // Read accumulated events from disk
  let events: any[] = [];
  try {
    const lines = (await readFile(join(partialDir, 'events.jsonl'), 'utf-8')).trim();
    if (lines) events = lines.split('\n').map(l => JSON.parse(l));
  } catch { /* no events */ }

  const toolEvents = events.filter(e => e.type === 'tool');
  const partialMeta = {
    triggerId,
    status: 'interrupted',
    reason: 'plugin_reloaded',
    durationMs: Date.now() - claimedAt,
    toolCallSummary: {
      total: toolEvents.length,
      errors: toolEvents.filter((e: any) => e.status === 'error').length,
      partial: true,
    },
    toolCallDetails: toolEvents,
  };

  await writeFile(join(partialDir, 'meta.json'), JSON.stringify(partialMeta, null, 2));

  // Notify SSE clients
  sendSSE(triggerId, 'disconnected', { triggerId, reason: 'plugin_reloaded', toolEvents: toolEvents.length });
  const clients = streamClients.get(triggerId);
  if (clients) {
    for (const c of clients) try { c.end(); } catch {}
    streamClients.delete(triggerId);
  }
}

async function handleTriggerGet(waitSec: number, res: ServerResponse) {
  // Disconnect detection: plugin is polling while a trigger should be executing
  if (activeTrigger) {
    const { id, claimedAt } = activeTrigger;
    activeTrigger = null;
    // Check if result was already posted (race with normal completion)
    try {
      await stat(join(RESULT_DIR, id, 'meta.json'));
      // Result exists — normal completion, not a disconnect
    } catch {
      // No result — plugin reloaded mid-run
      await handlePluginDisconnect(id, claimedAt);
    }
  }

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
  // Read trigger ID before deleting so we can track it as active
  try {
    const data = await readFile(TRIGGER_FILE, 'utf-8');
    const trigger = JSON.parse(data);
    if (trigger.id) {
      activeTrigger = { id: trigger.id, claimedAt: Date.now() };
    }
  } catch { /* already gone or unreadable */ }

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

  // Clear active trigger — run completed normally
  activeTrigger = null;

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
        // Not found — might still be pending.
        // 202 (not 200) signals "not ready" — a 200 response is a contract that meta is here.
        // No business fields (no toolCallSummary, no durationMs, no logs) to prevent
        // callers from misreading "0" as "run completed with 0 tool calls".
        json(res, 202, {
          id: filterTriggerId,
          status: 'pending',
          triggerId: filterTriggerId,
          hint: `Run not complete. Ground truth: existence of /tmp/figma-bridge/results/${filterTriggerId}/meta.json`,
        });
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
      // Long-poll expired. Run MAY still be in progress — callers MUST NOT infer
      // "run failed" or "0 tool calls" from this response. Never include business
      // fields here (toolCallSummary, durationMs, logs) — missing fields prevent
      // the "0 must mean done" misread that bit us in the Apr 13 prompt-eng session.
      json(res, 202, {
        id,
        status: 'pending',
        waitExpired: true,
        message: `Long-poll timed out after ${waitSec}s — run may still be in progress`,
        hint: `Ground truth: /tmp/figma-bridge/results/${id}/meta.json exists iff run completed`,
      });
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
    json(res, 202, {
      id,
      status: 'pending',
      hint: `Use ?wait=N to long-poll, or check /tmp/figma-bridge/results/${id}/meta.json for ground truth`,
    });
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
      } catch {
        try {
          await stat(join(dirPath, 'events.jsonl'));
          hasEvents = true;
        } catch { /* no events file */ }
      }

      recordings.push({ id: entry, mtime: s.mtimeMs, hasEvents });
    }

    recordings.sort((a, b) => b.mtime - a.mtime);
    json(res, 200, recordings);
  } catch {
    json(res, 200, []);
  }
}

/** Assemble recording metadata from available files (meta.json, tool-calls.json, logs.txt). */
async function handleRecordingMeta(id: string, res: ServerResponse) {
  const dir = join(RESULT_DIR, id);
  const result: Record<string, any> = { id };

  // Try meta.json first (full payload)
  try {
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8'));
    // Patch toolCallSummary from events.jsonl when meta has stale counts (e.g. timeout)
    if (meta.toolCallSummary?.total === 0) {
      try {
        const lines = (await readFile(join(dir, 'events.jsonl'), 'utf-8')).trim().split('\n').filter(Boolean);
        const toolEvents = lines.map(l => JSON.parse(l)).filter((e: any) => e.type === 'tool');
        if (toolEvents.length > 0) {
          meta.toolCallSummary = {
            total: toolEvents.length,
            errors: toolEvents.filter((e: any) => e.status === 'error').length,
            capRejects: meta.toolCallSummary.capRejects || 0,
          };
        }
      } catch { /* no events.jsonl */ }
    }
    json(res, 200, { ...meta, id });
    return;
  } catch { /* no meta.json — assemble from parts */ }

  // Assemble from individual files
  try {
    const tc = await readFile(join(dir, 'tool-calls.json'), 'utf-8');
    result.toolCallDetails = JSON.parse(tc);
    const details = result.toolCallDetails as any[];
    result.toolCallSummary = {
      total: details.length,
      errors: details.filter((d: any) => d.status === 'error').length,
    };
  } catch { /* no tool-calls */ }

  try {
    const logs = await readFile(join(dir, 'logs.txt'), 'utf-8');
    result.logs = logs;
    // Try to extract prompt from logs
    const promptMatch = logs.match(/Prompt: "(.+?)"/);
    if (promptMatch) result.prompt = promptMatch[1];
  } catch { /* no logs */ }

  if (Object.keys(result).length <= 1) {
    json(res, 404, { error: `No data files found for recording "${id}"` });
    return;
  }

  json(res, 200, result);
}

async function handleRecordingEvents(id: string, res: ServerResponse) {
  // Prefer full runtime-events.json; fall back to events.jsonl (tool-only log)
  const runtimePath = join(RESULT_DIR, id, 'runtime-events.json');
  try {
    const data = await readFile(runtimePath, 'utf-8');
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
    return;
  } catch { /* try fallback */ }

  const jsonlPath = join(RESULT_DIR, id, 'events.jsonl');
  try {
    const raw = await readFile(jsonlPath, 'utf-8');
    // Convert JSONL tool events → dashboard-compatible format
    const events: any[] = [];
    for (const line of raw.trim().split('\n')) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.type !== 'tool') continue;
      const syntheticId = `evt-${entry.index}`;
      events.push({
        type: 'tool_call',
        iteration: entry.index,
        timestamp: entry.timestamp,
        toolCall: { id: syntheticId, name: entry.name },
      });
      events.push({
        type: 'tool_result',
        iteration: entry.index,
        timestamp: entry.timestamp,
        toolResult: {
          id: syntheticId,
          name: entry.name,
          status: entry.status,
          error: entry.error || undefined,
        },
      });
    }
    json(res, 200, events);
  } catch {
    json(res, 404, { error: `No events for recording "${id}"` });
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
      // Persist to disk so partial runs survive plugin reloads
      const eventDir = join(RESULT_DIR, id);
      await mkdir(eventDir, { recursive: true });
      await appendFile(join(eventDir, 'events.jsonl'), JSON.stringify({ ...event, timestamp: Date.now() }) + '\n');
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
    } else if (path.match(/^\/recordings\/[^/]+\/meta$/) && method === 'GET') {
      const id = path.split('/')[2];
      await handleRecordingMeta(id, res);
    } else if (path.match(/^\/recordings\/[^/]+\/screenshot$/) && method === 'GET') {
      const id = path.split('/')[2];
      const screenshotPath = join(RESULT_DIR, id, 'screenshot.png');
      try {
        const buf = await readFile(screenshotPath);
        cors(res);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buf);
      } catch {
        json(res, 404, { error: 'Screenshot not found' });
      }
    } else if (path === '/dashboard' && method === 'GET') {
      const htmlPath = join(__dirname, 'dashboard.html');
      try {
        const html = await readFile(htmlPath, 'utf-8');
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        json(res, 500, { error: 'Dashboard file not found' });
      }
    } else if (path.startsWith('/answer/') && method === 'POST') {
      // Claude Code posts answer to an ask_user question
      const triggerId = path.slice('/answer/'.length);
      const body = await readBody(req);
      const payload = JSON.parse(body.toString('utf-8'));
      const answer = payload.answer;
      if (!answer || typeof answer !== 'string') {
        json(res, 400, { error: 'Missing "answer" string field' });
        return;
      }
      pendingAnswers.set(triggerId, answer);
      notifyAnswerWaiters(triggerId, answer);
      sendSSE(triggerId, 'answer', { answer });
      json(res, 200, { ok: true, triggerId, answer });
      console.log(`[answer] ${triggerId}: "${answer}"`);
    } else if (path.startsWith('/answer/') && method === 'GET') {
      // Plugin polls for answer (supports ?wait=N long-poll)
      const triggerId = path.slice('/answer/'.length);
      const stored = pendingAnswers.get(triggerId);
      if (stored) {
        pendingAnswers.delete(triggerId);
        json(res, 200, { answer: stored });
        return;
      }
      const waitSec = Number(url.searchParams.get('wait')) || 0;
      if (waitSec > 0) {
        const timeoutMs = Math.min(waitSec, 120) * 1000;
        let resolved = false;
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          const waiters = answerWaiters.get(triggerId);
          if (waiters) {
            const idx = waiters.indexOf(resolve);
            if (idx >= 0) waiters.splice(idx, 1);
            if (waiters.length === 0) answerWaiters.delete(triggerId);
          }
          cors(res);
          res.writeHead(204);
          res.end();
        }, timeoutMs);
        function resolve(answer: string) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          pendingAnswers.delete(triggerId);
          json(res, 200, { answer });
        }
        if (!answerWaiters.has(triggerId)) answerWaiters.set(triggerId, []);
        answerWaiters.get(triggerId)!.push(resolve);
      } else {
        cors(res);
        res.writeHead(204);
        res.end();
      }
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
    console.log(`  GET  /recordings/:id/events - get runtime events for replay`);
    console.log(`  GET  /recordings/:id/screenshot - get screenshot PNG`);
    console.log(`  GET  /dashboard       - agent timeline dashboard\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
