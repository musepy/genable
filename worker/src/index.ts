/**
 * Figma AI Generator — Cloudflare Worker
 * API proxy: Token auth + Gemini forwarding + streaming SSE + KV usage tracking
 */

export interface Env {
  GEMINI_API_KEY: string;
  USERS: KVNamespace;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type UserPlan = 'free' | 'pro' | 'team' | 'unlimited';
type UserStatus = 'active' | 'inactive' | 'expired';

interface UserRecord {
  email: string;
  plan: UserPlan;
  status: UserStatus;
  created_at: string;
  expires_at: string;
}

interface UsageRecord {
  calls: number;
  tokens_used: number;
  last_call: string;
}

const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 10,
  pro: 200,
  team: 1000,
  unlimited: Infinity,
};

/** Safe JSON.parse — returns fallback on malformed data instead of crashing */
function safeParseJSON<T>(raw: string, fallback: T, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[Worker] Corrupted JSON in ${label}: ${raw.slice(0, 100)}`);
    return fallback;
  }
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authenticate(
  request: Request,
  env: Env
): Promise<{ user: UserRecord; token: string } | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) return errorResponse('Empty token', 401);

  const raw = await env.USERS.get(`user:${token}`);
  if (!raw) return errorResponse('Invalid token', 401);

  let user: UserRecord;
  try {
    user = JSON.parse(raw) as UserRecord;
  } catch {
    console.error(`[Auth] Corrupted user record for token ${token.slice(0, 8)}…`);
    return errorResponse('Corrupted user record', 500);
  }
  if (user.status !== 'active') return errorResponse('Token inactive or expired', 403);

  // Check expiry
  if (new Date(user.expires_at) < new Date()) {
    // Mark expired lazily
    user.status = 'expired';
    await env.USERS.put(`user:${token}`, JSON.stringify(user));
    return errorResponse('Subscription expired', 403);
  }

  return { user, token };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function currentMonthKey(token: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `usage:${token}:${ym}`;
}

async function checkAndIncrementUsage(
  env: Env,
  token: string,
  user: UserRecord,
  tokensUsed = 0
): Promise<Response | null> {
  const limit = PLAN_LIMITS[user.plan] ?? 10;
  const key = currentMonthKey(token);
  const raw = await env.USERS.get(key);
  const usage: UsageRecord = raw
    ? safeParseJSON<UsageRecord>(raw, { calls: 0, tokens_used: 0, last_call: '' }, `usage:${key}`)
    : { calls: 0, tokens_used: 0, last_call: '' };

  if (isFinite(limit) && usage.calls >= limit) {
    return errorResponse(
      `Monthly limit reached (${limit} calls). Please upgrade your plan.`,
      429
    );
  }

  // Increment — await to ensure write completes before response.
  // NOTE: KV has eventual consistency (~60s). Concurrent requests within that window
  // can read stale counts, allowing limit overrun. Acceptable for current scale;
  // for strict enforcement, migrate to Durable Objects (atomic read-modify-write).
  const updated: UsageRecord = {
    calls: usage.calls + 1,
    tokens_used: usage.tokens_used + tokensUsed,
    last_call: new Date().toISOString(),
  };
  // TTL: 35 days so old months auto-expire
  await env.USERS.put(key, JSON.stringify(updated), { expirationTtl: 35 * 24 * 3600 });

  return null;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/** POST /api/generate — streaming SSE proxy */
async function handleGenerateStream(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const { user, token } = auth;

  // Usage gate
  const usageBlock = await checkAndIncrementUsage(env, token, user);
  if (usageBlock) return usageBlock;

  // Parse plugin's Gemini-format request body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Strip any API key the client may have sent (security)
  delete body.key;

  const model = body.model || 'gemini-2.5-flash-preview-04-17';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${env.GEMINI_API_KEY}&alt=sse`;

  // Forward to Gemini as a streaming request
  const upstream = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // Stream the SSE response back directly
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(),
    },
  });
}

/** POST /api/generate-sync — non-streaming proxy */
async function handleGenerateSync(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const { user, token } = auth;

  const usageBlock = await checkAndIncrementUsage(env, token, user);
  if (usageBlock) return usageBlock;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  delete body.key;

  const model = body.model || 'gemini-2.5-flash-preview-04-17';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${env.GEMINI_API_KEY}`;

  const upstream = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/** GET /api/models */
async function handleModels(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`;
  const upstream = await fetch(geminiUrl);
  const data = await upstream.json();
  return jsonResponse(data, upstream.status);
}

/** POST /api/validate-token */
async function handleValidateToken(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const { user, token } = auth;

  const key = currentMonthKey(token);
  const raw = await env.USERS.get(key);
  const usage: UsageRecord = raw
    ? safeParseJSON<UsageRecord>(raw, { calls: 0, tokens_used: 0, last_call: '' }, `validate:${key}`)
    : { calls: 0, tokens_used: 0, last_call: '' };

  const limit = PLAN_LIMITS[user.plan] ?? 10;

  return jsonResponse({
    valid: true,
    plan: user.plan,
    email: user.email,
    usage: {
      calls: usage.calls,
      limit: isFinite(limit) ? limit : null,
      remaining: isFinite(limit) ? Math.max(0, limit - usage.calls) : null,
    },
  });
}

/** GET /api/usage */
async function handleUsage(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const { user, token } = auth;

  const key = currentMonthKey(token);
  const raw = await env.USERS.get(key);
  const usage: UsageRecord = raw
    ? safeParseJSON<UsageRecord>(raw, { calls: 0, tokens_used: 0, last_call: '' }, `usage:${key}`)
    : { calls: 0, tokens_used: 0, last_call: '' };

  const limit = PLAN_LIMITS[user.plan] ?? 10;

  return jsonResponse({
    plan: user.plan,
    calls: usage.calls,
    tokens_used: usage.tokens_used,
    limit: isFinite(limit) ? limit : null,
    remaining: isFinite(limit) ? Math.max(0, limit - usage.calls) : null,
    last_call: usage.last_call || null,
  });
}

// ─── DashScope CORS Proxy ────────────────────────────────────────────────────

const DASHSCOPE_BASE = 'https://coding.dashscope.aliyuncs.com/v1';
/** Subrequest timeout for DashScope (ms). Cross-border latency can be 10-30s+. */
const DASHSCOPE_TIMEOUT_MS = 45000;

/** Generic CORS proxy for DashScope — forwards client's own API key, adds UA */
async function handleDashScopeProxy(request: Request, stream: boolean): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const apiKey = request.headers.get('Authorization') || '';
  if (!apiKey) return errorResponse('Missing Authorization header', 401);

  if (stream) body.stream = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DASHSCOPE_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'User-Agent': 'anthropic-python/0.42.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError' || controller.signal.aborted) {
      console.error(`[DashScope] Upstream timeout after ${DASHSCOPE_TIMEOUT_MS}ms`);
      return errorResponse(`DashScope upstream timeout after ${DASHSCOPE_TIMEOUT_MS}ms`, 504);
    }
    console.error(`[DashScope] Upstream unreachable: ${e.message}`);
    return errorResponse(`DashScope upstream unreachable: ${e.message}`, 502);
  }
  clearTimeout(timeoutId);

  if (!upstream.ok) {
    let errText: string;
    try { errText = await upstream.text(); } catch { errText = '(failed to read error body)'; }
    console.error(`[DashScope] Upstream error ${upstream.status}: ${errText.slice(0, 500)}`);
    return new Response(errText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  console.log(`[DashScope] Upstream ok, streaming=${stream}`);
  const contentType = stream ? 'text/event-stream' : 'application/json';
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', ...corsHeaders() },
  });
}

// ─── OpenCode Go CORS Proxy ──────────────────────────────────────────────────

const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go/v1';
/** Subrequest timeout for OpenCode Go (ms). */
const OPENCODE_GO_TIMEOUT_MS = 60000;

/**
 * Proxy GET /models to OpenCode Go upstream — adds CORS headers
 * so the Figma plugin can fetch the model list from the browser.
 */
async function handleOpenCodeGoModels(request: Request): Promise<Response> {
  const apiKey = request.headers.get('Authorization') || '';
  if (!apiKey) return errorResponse('Missing Authorization header', 401);

  try {
    const upstream = await fetch(`${OPENCODE_GO_BASE}/models`, {
      method: 'GET',
      headers: { Authorization: apiKey },
    });
    if (!upstream.ok) {
      let errText: string;
      try { errText = await upstream.text(); } catch { errText = '(failed to read error body)'; }
      console.error(`[OpenCodeGo] Models upstream error ${upstream.status}: ${errText.slice(0, 500)}`);
      return new Response(errText, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...corsHeaders() },
    });
  } catch (e: any) {
    console.error(`[OpenCodeGo] Models upstream unreachable: ${e.message}`);
    return errorResponse(`OpenCode Go models unreachable: ${e.message}`, 502);
  }
}

/**
 * Generic CORS proxy for OpenCode Go — forwards client's own API key.
 *
 * Why this exists: OpenCode Go's endpoint at https://opencode.ai/zen/go/v1
 * doesn't serve `Access-Control-Allow-Origin`, so a Figma plugin (origin null)
 * gets blocked by the browser at the CORS preflight step. Routing through this
 * worker re-attaches CORS headers so the plugin can talk to OpenCode Go.
 *
 * Stream vs sync is derived from `body.stream` (openai-protocol convention),
 * not from the URL path — that's why a single route handles both.
 */
async function handleOpenCodeGoProxy(request: Request): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const apiKey = request.headers.get('Authorization') || '';
  if (!apiKey) return errorResponse('Missing Authorization header', 401);

  const stream = body && body.stream === true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENCODE_GO_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(`${OPENCODE_GO_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError' || controller.signal.aborted) {
      console.error(`[OpenCodeGo] Upstream timeout after ${OPENCODE_GO_TIMEOUT_MS}ms`);
      return errorResponse(`OpenCode Go upstream timeout after ${OPENCODE_GO_TIMEOUT_MS}ms`, 504);
    }
    console.error(`[OpenCodeGo] Upstream unreachable: ${e.message}`);
    return errorResponse(`OpenCode Go upstream unreachable: ${e.message}`, 502);
  }
  clearTimeout(timeoutId);

  if (!upstream.ok) {
    let errText: string;
    try { errText = await upstream.text(); } catch { errText = '(failed to read error body)'; }
    console.error(`[OpenCodeGo] Upstream error ${upstream.status}: ${errText.slice(0, 500)}`);
    return new Response(errText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  console.log(`[OpenCodeGo] Upstream ok, streaming=${stream}`);
  const contentType = stream ? 'text/event-stream' : 'application/json';
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', ...corsHeaders() },
  });
}

// ─── Generic CORS Proxy ──────────────────────────────────────────────────────

/**
 * Hosts allowed to be reached via /api/proxy/<host>/<path...>. Keep this in
 * lockstep with `provider-presets.json` entries that have `requiresProxy: true`.
 *
 * Why a whitelist: without it, this endpoint is an open relay — anyone could
 * point it at any URL on the internet. Cloudflare rejects accounts that get
 * abused like that. Adding a host here is intentional and reviewable.
 */
const PROXY_HOST_WHITELIST: ReadonlySet<string> = new Set([
  'opencode.ai',
  'coding.dashscope.aliyuncs.com',
  'dashscope.aliyuncs.com',
  // Add new third-party hosts here when adding a `requiresProxy: true` preset.
]);

/** Headers we forward upstream. Anything else (Origin, Referer, CF-* etc.) is dropped. */
const FORWARD_HEADER_ALLOWLIST: ReadonlyArray<string> = [
  'authorization',
  'content-type',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
];

/**
 * Per-host header injections applied AFTER the allowlisted forward. Used for
 * UA spoofs that a browser-origin client can't set itself (User-Agent is a
 * forbidden header in browser fetch). Keys are hostnames; values are headers
 * unconditionally added to the upstream request.
 */
const HOST_HEADER_INJECTIONS: Record<string, Record<string, string>> = {
  'coding.dashscope.aliyuncs.com': {
    // DashScope's coding endpoint expects a Claude/Codex-like UA.
    'User-Agent': 'anthropic-python/0.42.0',
  },
};

/** 60s covers cold-start latency on free-tier model queues plus streaming first byte. */
const GENERIC_PROXY_TIMEOUT_MS = 60_000;

/**
 * POST/GET https://<worker>/api/proxy/<host>/<path...>
 *   → forwards to https://<host>/<path...>
 *
 * Body and method are passed through verbatim. Streaming is detected from
 * `body.stream === true` (OpenAI convention) so the same route handles
 * /chat/completions (POST stream) and /models (GET non-stream).
 */
async function handleGenericProxy(request: Request, host: string, upstreamPath: string): Promise<Response> {
  if (!PROXY_HOST_WHITELIST.has(host)) {
    console.warn(`[Proxy] Rejected host "${host}" — not in whitelist`);
    return errorResponse(`Host "${host}" is not in the proxy whitelist. To add it, open an issue.`, 403);
  }

  const upstreamUrl = `https://${host}/${upstreamPath}`;

  // Forward only allowlisted headers. Drops Origin/Referer/CF-* — the upstream
  // shouldn't see anything pretending to be browser-origin metadata.
  const fwdHeaders = new Headers();
  for (const key of FORWARD_HEADER_ALLOWLIST) {
    const v = request.headers.get(key);
    if (v) fwdHeaders.set(key, v);
  }
  // Per-host header injections (e.g. UA spoof for DashScope).
  const injections = HOST_HEADER_INJECTIONS[host];
  if (injections) {
    for (const [k, v] of Object.entries(injections)) {
      fwdHeaders.set(k, v);
    }
  }

  // Pass body through unchanged. We don't parse it (saves CPU + lets non-JSON
  // bodies through), so we infer "stream" from the URL path alone:
  // chat/completions and messages routes can stream; /models is always sync.
  const isStreamingPath = /\/(chat\/completions|messages|streamGenerateContent)$/.test(upstreamPath);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERIC_PROXY_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      signal: controller.signal,
      // Required when streaming a Request body in Workers
      ...(request.body ? { duplex: 'half' } as any : {}),
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError' || controller.signal.aborted) {
      console.error(`[Proxy] Upstream timeout: ${upstreamUrl}`);
      return errorResponse(`Upstream timeout after ${GENERIC_PROXY_TIMEOUT_MS}ms`, 504);
    }
    console.error(`[Proxy] Upstream unreachable: ${upstreamUrl} — ${e.message}`);
    return errorResponse(`Upstream unreachable: ${e.message}`, 502);
  }
  clearTimeout(timeoutId);

  // Pass status + content-type through; replace CORS headers with our own.
  const respHeaders: Record<string, string> = { ...corsHeaders() };
  const upstreamCT = upstream.headers.get('Content-Type');
  if (upstreamCT) respHeaders['Content-Type'] = upstreamCT;
  if (isStreamingPath) respHeaders['Cache-Control'] = 'no-cache';

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Generic CORS proxy: /api/proxy/<host>/<path...>
      // host must be in PROXY_HOST_WHITELIST. Replaces per-vendor routes —
      // those stay in the file below for back-compat with already-saved
      // ProviderConfigs whose baseURL points at /api/opencode-go/v1 etc.
      if (path.startsWith('/api/proxy/')) {
        // /api/proxy/<host>/<rest>  →  segments[3] = host, segments[4..] = rest
        const segments = path.split('/').filter(Boolean); // drop empty leading segment
        // ['api', 'proxy', '<host>', ...rest]
        if (segments.length < 4) {
          return errorResponse('Bad proxy path: expected /api/proxy/<host>/<path>', 400);
        }
        const host = segments[2];
        const upstreamPath = segments.slice(3).join('/');
        return handleGenericProxy(request, host, upstreamPath);
      }

      // DashScope CORS proxy (client provides own API key)
      if (path === '/api/dashscope/generate' && request.method === 'POST') {
        return handleDashScopeProxy(request, true);
      }
      if (path === '/api/dashscope/generate-sync' && request.method === 'POST') {
        return handleDashScopeProxy(request, false);
      }

      // OpenCode Go CORS proxy (client provides own API key).
      // Path mirrors the upstream `/v1/chat/completions` so the plugin can use
      // baseURL=`<workerOrigin>/api/opencode-go/v1` and the openai-protocol
      // appender (`${baseURL}/chat/completions`) lands here without rewriting.
      // Stream vs sync is derived from `body.stream` so a single route covers
      // both — matches the openai-protocol convention.
      if (path === '/api/opencode-go/v1/chat/completions' && request.method === 'POST') {
        return handleOpenCodeGoProxy(request);
      }

      // OpenCode Go model list CORS proxy — proxies GET /models to upstream.
      if (path === '/api/opencode-go/v1/models' && request.method === 'GET') {
        return handleOpenCodeGoModels(request);
      }

      if (path === '/api/generate' && request.method === 'POST') {
        return handleGenerateStream(request, env);
      }
      if (path === '/api/generate-sync' && request.method === 'POST') {
        return handleGenerateSync(request, env);
      }
      if (path === '/api/models' && request.method === 'GET') {
        return handleModels(request, env);
      }
      if (path === '/api/validate-token' && request.method === 'POST') {
        return handleValidateToken(request, env);
      }
      if (path === '/api/usage' && request.method === 'GET') {
        return handleUsage(request, env);
      }

      return errorResponse('Not found', 404);
    } catch (e: any) {
      console.error(`[Worker] Unhandled exception: ${e.stack || e.message || e}`);
      return errorResponse(`Internal error: ${e.message || 'unknown'}`, 500);
    }
  },
};
