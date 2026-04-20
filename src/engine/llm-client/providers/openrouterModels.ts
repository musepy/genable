/**
 * @file openrouterModels.ts
 * @description Dynamic per-model max_output_tokens resolver for OpenRouter.
 *
 * OpenRouter routes to 300+ underlying models, so a static whitelist cannot
 * scale. Instead we consume OpenRouter's own public `/api/v1/models`
 * declaration, which reports `top_provider.max_completion_tokens` per model.
 *
 * Lazy + cached: first call triggers a single fetch; concurrent calls share
 * the same in-flight Promise. On network failure we fall back to a
 * conservative cap — below what almost every modern model supports — so
 * an OpenRouter outage degrades to slow-but-working, never a hard fail.
 */

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

/**
 * Conservative fallback when `/models` is unreachable or a model is missing
 * from the response. 32K covers the middle of the market (most Claude/GPT/
 * Gemini/Qwen SKUs accept at least this much); under-requesting here is
 * cheaper than a 400 rejection from the underlying provider.
 */
const FALLBACK_CAP = 32_768;

let capCache: Map<string, number> | null = null;
let capLoading: Promise<Map<string, number>> | null = null;

/**
 * Resolve max_output_tokens for an OpenRouter model.
 * - If cache populated: O(1) lookup, returns `min(requested, cap)` or cap.
 * - If cache empty: triggers a one-shot `/models` fetch (concurrent callers share it).
 * - If fetch fails or model is unknown: returns FALLBACK_CAP clamped by requested.
 */
export async function resolveOpenRouterMax(
  modelName: string,
  requested?: number,
): Promise<number> {
  let caps: Map<string, number>;
  try {
    caps = await ensureCaps();
  } catch (e) {
    console.warn(
      `[openrouter] /models fetch failed, using fallback ${FALLBACK_CAP}:`,
      e,
    );
    return requested != null ? Math.min(requested, FALLBACK_CAP) : FALLBACK_CAP;
  }

  const cap = caps.get(modelName);
  if (cap == null) {
    console.warn(
      `[openrouter] Model "${modelName}" not in /models response, using fallback ${FALLBACK_CAP}`,
    );
    return requested != null ? Math.min(requested, FALLBACK_CAP) : FALLBACK_CAP;
  }

  return requested != null ? Math.min(requested, cap) : cap;
}

async function ensureCaps(): Promise<Map<string, number>> {
  if (capCache) return capCache;
  if (capLoading) return capLoading;

  capLoading = fetchCaps()
    .then((map) => {
      capCache = map;
      return map;
    })
    .finally(() => {
      capLoading = null;
    });
  return capLoading;
}

async function fetchCaps(): Promise<Map<string, number>> {
  const res = await fetch(MODELS_ENDPOINT);
  if (!res.ok) {
    throw new Error(`OpenRouter /models returned HTTP ${res.status}`);
  }
  const data = await res.json();
  const list: any[] = Array.isArray(data) ? data : data?.data ?? [];
  const map = new Map<string, number>();
  for (const m of list) {
    const id = m?.id;
    const cap = m?.top_provider?.max_completion_tokens;
    if (typeof id === 'string' && typeof cap === 'number' && cap > 0) {
      map.set(id, cap);
    }
  }
  console.log(`[openrouter] Loaded ${map.size} model caps from /models`);
  return map;
}

/** Test hook: reset the in-memory cache. Not used at runtime. */
export function _resetOpenRouterCapCacheForTest(): void {
  capCache = null;
  capLoading = null;
}
