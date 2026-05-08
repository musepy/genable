/**
 * @file providerProbe.ts
 * @description Pure probe of an LLM provider endpoint. Sends a tiny
 * `max_tokens:1` request (or, for Gemini, a model list GET) and classifies
 * the response into a ProviderProbeResult. No IPC, no figma APIs — reusable
 * from anywhere with `fetch` available.
 *
 * Classification rules (see Phase 6 spec):
 *   200/2xx  → ok (with optional models[] from a secondary list call)
 *   401      → auth-error, OR credits-error if the body implies billing/quota
 *   403      → auth-error
 *   404      → not-found
 *   429      → rate-limited
 *   other    → unknown { status, message }
 *   throw    → network-error (AbortError → "Probe timed out")
 *
 * Timeout: 8s via AbortController. Single shot — no retries.
 */
import type { ProviderConfig, ProviderProbeResult } from '../../types/provider';
import { wrapBaseURLForProxy } from './proxyWrap';

/** 12s covers cold-start latency on free-tier model queues (OpenRouter,
 *  Moonshot) plus Figma's network proxy overhead. Going lower than 10s causes
 *  spurious "Probe timed out" on legitimate slow first responses. */
const PROBE_TIMEOUT_MS = 12000;
const URL_REGEX = /https?:\/\/[^\s)"'<>]+/;
const CREDIT_HINT = /payment|billing|quota|insufficient|balance|fund|credit|不足|余额|额度/i;

/**
 * Best-guess probe model when config.modelId is empty. The probe still works
 * even if the guess is wrong: a 400 "model not found" surfaces as `unknown`,
 * which the UI can display verbatim, prompting the user to add a model id.
 */
function guessProbeModel(config: ProviderConfig): string {
  if (config.modelId) return config.modelId;
  if (config.protocol === 'anthropic') return 'claude-3-5-haiku-latest';
  if (config.protocol === 'gemini') return 'gemini-2.5-flash';
  return 'gpt-4o-mini';
}

/** Defensive JSON parse — falls back to raw text if body isn't valid JSON. */
function parseBody(raw: string): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Pull human-readable error message out of either parsed JSON or raw text. */
function extractMessage(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 500) || fallback;
  return body?.error?.message || body?.message || body?.error || fallback;
}

/** Find first http(s) URL in a string — used to surface billing links. */
function extractUrl(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(URL_REGEX);
  return m ? m[0] : undefined;
}

/** Detects credits/billing 401s vs invalid-key 401s. */
function isCreditsError(body: any): boolean {
  if (!body || typeof body === 'string') {
    return typeof body === 'string' && CREDIT_HINT.test(body);
  }
  const errType = String(body?.error?.type || body?.type || '').toLowerCase();
  if (errType.includes('credit') || errType.includes('billing') || errType.includes('quota')) {
    return true;
  }
  const msg = String(body?.error?.message || body?.message || '');
  return CREDIT_HINT.test(msg);
}

/** Build per-protocol probe URL + headers + body. Auth headers added here. */
function buildProbeRequest(config: ProviderConfig): { url: string; init: RequestInit } {
  const userHeaders = config.headers || {};
  if (config.protocol === 'gemini') {
    // Use AI Studio's list-models endpoint — cheap, doesn't burn quota.
    const url = `${config.baseURL}/models?key=${encodeURIComponent(config.apiKey)}`;
    return { url, init: { method: 'GET', headers: { ...userHeaders } } };
  }
  if (config.protocol === 'anthropic') {
    const isNative = config.baseURL.includes('api.anthropic.com');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      ...userHeaders,
    };
    if (isNative) {
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    const body = JSON.stringify({
      model: guessProbeModel(config),
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });
    return { url: `${config.baseURL}/messages`, init: { method: 'POST', headers, body } };
  }
  // openai
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...userHeaders,
  };
  const body = JSON.stringify({
    model: guessProbeModel(config),
    messages: [{ role: 'user', content: '.' }],
    max_tokens: 1,
    stream: false,
  });
  return { url: `${config.baseURL}/chat/completions`, init: { method: 'POST', headers, body } };
}

/**
 * Secondary "list models" call — only attempted after the probe succeeds.
 * Failures are swallowed: `ok` without `models` is a fine outcome.
 */
async function fetchModels(config: ProviderConfig, signal: AbortSignal | undefined): Promise<string[] | undefined> {
  try {
    if (config.protocol === 'openai') {
      const res = await fetch(`${config.baseURL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.headers || {}),
        },
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) return undefined;
      const body = parseBody(await res.text());
      const data = body?.data;
      if (Array.isArray(data)) {
        return data.map((m: any) => String(m?.id || '')).filter(Boolean);
      }
      return undefined;
    }
    // Anthropic has no public list endpoint; Gemini's probe IS the list.
    return undefined;
  } catch {
    return undefined;
  }
}

/** Extract models[] from the body of a successful Gemini list-models probe. */
function modelsFromGeminiBody(body: any): string[] | undefined {
  const arr = body?.models;
  if (!Array.isArray(arr)) return undefined;
  return arr.map((m: any) => String(m?.name || m?.id || '')).filter(Boolean);
}

/**
 * Build a fetch init with an optional abort signal. Figma's main-thread sandbox
 * doesn't reliably have AbortController, so we feature-detect and fall back to
 * a Promise.race-based timeout that lets the fetch keep running in the
 * background (we just stop awaiting it).
 */
type ProbeFetcher = (url: string, init: RequestInit) => Promise<Response>;

function makeProbeFetcher(): { fetcher: ProbeFetcher; signal: AbortSignal | undefined; cleanup: () => void } {
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    return {
      fetcher: (url, init) => fetch(url, { ...init, signal: controller.signal }),
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
  }
  // No AbortController — race the fetch against a timeout promise.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('__probe_timeout__')), PROBE_TIMEOUT_MS);
  });
  return {
    fetcher: (url, init) => Promise.race([fetch(url, init), timeoutPromise]) as Promise<Response>,
    signal: undefined,
    cleanup: () => { if (timer) clearTimeout(timer); },
  };
}

/**
 * Probe a provider config. Returns a structured ProviderProbeResult — never
 * throws. 8 second timeout, no retry. Works in both browser and Figma main
 * thread (where AbortController may be missing).
 */
export async function probeProvider(rawConfig: ProviderConfig): Promise<ProviderProbeResult> {
  // Apply Worker proxy wrap if the preset opts in. Probe and live requests must
  // hit the same URL — otherwise probe-ok in settings doesn't predict runtime.
  const config = wrapBaseURLForProxy(rawConfig);
  const { fetcher, signal, cleanup } = makeProbeFetcher();
  try {
    const { url, init } = buildProbeRequest(config);
    const res = await fetcher(url, init);
    const raw = await res.text();
    const body = parseBody(raw);

    if (res.status >= 200 && res.status < 300) {
      let models: string[] | undefined;
      if (config.protocol === 'gemini') {
        models = modelsFromGeminiBody(body);
      } else if (config.protocol === 'openai') {
        models = await fetchModels(config, signal);
      }
      return models && models.length > 0 ? { kind: 'ok', models } : { kind: 'ok' };
    }

    if (res.status === 401) {
      if (isCreditsError(body)) {
        const message = extractMessage(body, 'Credits or billing required');
        const billingUrl = extractUrl(message);
        return billingUrl
          ? { kind: 'credits-error', message, billingUrl }
          : { kind: 'credits-error', message };
      }
      return { kind: 'auth-error', message: extractMessage(body, 'Invalid API key') };
    }
    if (res.status === 403) {
      return { kind: 'auth-error', message: extractMessage(body, 'Forbidden') };
    }
    if (res.status === 404) {
      return { kind: 'not-found', message: extractMessage(body, 'Endpoint not found') };
    }
    if (res.status === 429) {
      return { kind: 'rate-limited', message: extractMessage(body, 'Rate limited') };
    }
    return { kind: 'unknown', status: res.status, message: extractMessage(body, `HTTP ${res.status}`) };
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.message === '__probe_timeout__') {
      return { kind: 'network-error', message: 'Probe timed out (12s) — endpoint may be slow or rate-limited; try again' };
    }
    return { kind: 'network-error', message: e?.message || 'Network error' };
  } finally {
    cleanup();
  }
}

