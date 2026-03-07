/**
 * Figma AI Generator — Cloudflare Worker
 * API proxy: Token auth + Gemini forwarding + streaming SSE + KV usage tracking
 */

export interface Env {
  GEMINI_API_KEY: string;
  USERS: KVNamespace;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserRecord {
  email: string;
  plan: 'free' | 'pro' | 'team' | 'unlimited';
  status: 'active' | 'inactive' | 'expired';
  created_at: string;
  expires_at: string;
}

interface UsageRecord {
  calls: number;
  tokens_used: number;
  last_call: string;
}

const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  pro: 200,
  team: 1000,
  unlimited: Infinity,
};

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

  const user = JSON.parse(raw) as UserRecord;
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
    ? JSON.parse(raw)
    : { calls: 0, tokens_used: 0, last_call: '' };

  if (isFinite(limit) && usage.calls >= limit) {
    return errorResponse(
      `Monthly limit reached (${limit} calls). Please upgrade your plan.`,
      429
    );
  }

  // Increment (fire and forget — don't block the streaming response)
  const updated: UsageRecord = {
    calls: usage.calls + 1,
    tokens_used: usage.tokens_used + tokensUsed,
    last_call: new Date().toISOString(),
  };
  // TTL: 35 days so old months auto-expire
  env.USERS.put(key, JSON.stringify(updated), { expirationTtl: 35 * 24 * 3600 });

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
    ? JSON.parse(raw)
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
    ? JSON.parse(raw)
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

/** Generic CORS proxy for DashScope — forwards client's own API key, adds UA */
async function handleDashScopeProxy(request: Request, stream: boolean): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON body', 400); }

  const apiKey = request.headers.get('Authorization') || '';
  if (!apiKey) return errorResponse('Missing Authorization header', 401);

  if (stream) body.stream = true;

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
    });
  } catch (e: any) {
    return errorResponse(`DashScope upstream unreachable: ${e.message}`, 502);
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const contentType = stream ? 'text/event-stream' : 'application/json';
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', ...corsHeaders() },
  });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // DashScope CORS proxy (client provides own API key)
    if (path === '/api/dashscope/generate' && request.method === 'POST') {
      return handleDashScopeProxy(request, true);
    }
    if (path === '/api/dashscope/generate-sync' && request.method === 'POST') {
      return handleDashScopeProxy(request, false);
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
  },
};
