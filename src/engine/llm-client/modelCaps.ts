/**
 * @file modelCaps.ts
 * @description Per-model max_output_tokens registry. Single source of truth for
 * the real output-token cap each LLM enforces server-side. Used to clamp
 * `max_tokens` at request time so we neither (a) over-request and get rejected
 * (Anthropic, some DashScope models) nor (b) under-request and cause premature
 * truncation.
 *
 * All values verified against official docs or empirically probed on 2026-04-20.
 * Unknown models MUST throw — do NOT invent a default. Update this file when
 * adding/upgrading models.
 */

/** Max tokens the provider will actually produce in ONE response. */
export const MODEL_MAX_OUTPUT: Record<string, number> = {
  // ── Gemini (Google AI / Vertex docs) ────────────────────────────────
  'gemini-3-flash-preview': 65_536,    // ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview
  'gemini-2.5-pro': 65_535,            // docs.cloud.google.com/vertex-ai .../2-5-pro
  'gemini-2.5-flash': 65_535,          // docs.cloud.google.com/vertex-ai .../2-5-flash
  'gemini-2.0-flash': 8_192,           // deprecated 2026-06-01

  // ── Anthropic (platform.claude.com/docs) ────────────────────────────
  'claude-sonnet-4-20250514': 64_000,  // deprecated 2026-04-14, retires 2026-06-15

  // ── DashScope: documented (help.aliyun.com/zh/model-studio/models) ──
  'qwen3.6-plus': 65_536,
  'qwen3.5-plus': 65_536,
  'qwen3-max-2026-01-23': 32_768,
  'qwen3-coder-plus': 65_536,
  'glm-5': 65_536,                     // default; docs show max 131_072 via max_tokens

  // ── DashScope: empirically probed 2026-04-20 via tools/probe-max-tokens.ts ──
  'kimi-k2.5': 98_304,                 // 400 error: "Range of max_tokens should be [1, 98304]"
  'qwen3-coder-next': 65_536,          // 400 error: "Range of max_tokens should be [1, 65536]"
  'MiniMax-M2.5': 32_768,              // 400 error: "Range of max_tokens should be [1, 32768]"
  'glm-4.7': 131_072,                  // DashScope accepts any; Z.AI native docs: 128K out

  // NOTE: OpenRouter is intentionally absent. Its 300+ routes can't be
  // statically registered — OpenRouterProvider uses the public `/api/v1/models`
  // endpoint (via openrouterModels.ts) to resolve `max_completion_tokens`
  // per model at runtime.
};

/**
 * Resolve the max_tokens to send to the provider for this model.
 *
 * Fail-fast: unknown model throws, because silent defaults cause either
 * rejection (over-request) or truncation (under-request), both of which
 * waste a request and confuse the caller.
 *
 * @param modelName  concrete model ID (e.g. `'claude-sonnet-4-20250514'`)
 * @param requested  optional caller-requested max_tokens (user budget)
 * @returns          `min(requested, cap)` or `cap` if requested is unset
 * @throws           if `modelName` is not in MODEL_MAX_OUTPUT
 */
export function resolveMaxOutput(modelName: string, requested?: number): number {
  const cap = MODEL_MAX_OUTPUT[modelName];
  if (cap == null) {
    throw new Error(
      `Unknown model "${modelName}": no max_output_tokens in MODEL_MAX_OUTPUT. ` +
      `Add to src/engine/llm-client/modelCaps.ts with a verified value from official docs ` +
      `or tools/probe-max-tokens.ts.`
    );
  }
  if (requested == null) return cap;
  return Math.min(requested, cap);
}
