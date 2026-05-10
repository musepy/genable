/**
 * @file modelQuirks.ts
 * @description Per-model capability overrides for the OpenAI protocol shim.
 *
 * Background — see docs/knowledge/archive/multi-provider-compat-2026-05-10.md.
 * The OpenAI-compat protocol abstracts wire format but NOT vendor-specific
 * acceptance rules. Vendors disagree on what content blocks they accept under
 * the same `protocol: 'openai'` umbrella:
 *
 *   - DeepSeek (V4 Flash, V4 Pro): rejects {type:"image_url"} blocks at JSON
 *     deserialization time → 400 "unknown variant `image_url`, expected `text`".
 *   - Xiaomi mimo-v2.5-pro: OpenCode router has no multimodal endpoint for it
 *     → 400 "No endpoints found that support image input".
 *   - Kimi K2.x, glm-5/5.1, mimo-v2-pro/-omni/-2.5, Qwen3-* etc.: accept
 *     image_url at the wire level (whether they actually USE the image is a
 *     separate question — see "silent drop" caveat below).
 *
 * Why per-model and not per-vendor: OpenCode Go's `mimo-v2.5-pro` rejects
 * images while `mimo-v2-pro` accepts them — same vendor (Xiaomi), different
 * router behavior. So vendor-name regex is wrong; modelId is the only
 * stable key.
 *
 * Defense in depth — capability is consumed at three layers, each correct
 * on its own:
 *
 *   1. Tool list (toolDispatcher / agentFactory): filter out
 *      `get_screenshot` when supportsVision === false. The LLM never sees
 *      the tool, so it never tries to call it.
 *
 *   2. Message mapping (openaiFormat.mapMessagesToOpenAI): strip
 *      {type:'image'} blocks when supportsVision === false. Catches
 *      user-pasted images and any tool result that snuck past layer 1.
 *
 *   3. Retry (openai-protocol.runStreaming/runSync): if 400 + 'image_url'
 *      substring AND we haven't retried, re-send without image content.
 *      Last-line defense for unknown-future quirks not yet in this table.
 *
 * Adding a new entry: run `/multi-provider-compat-test` (skill), classify
 * the failure shape, then add { supportsVision: false } here keyed by the
 * exact modelId reported by the API. Don't pre-populate from vendor docs;
 * docs and reality disagree often enough that empirical proof is required.
 *
 * Silent-drop caveat: glm-5/5.1, deepseek-chat, and similar text-first
 * models accept image_url at the wire level but the LLM never actually
 * processes the image. This table CANNOT detect that — only a real-image
 * probe (Wave 5: 64×64 PNG + "what color is this?" prompt) can.
 * Conservative default for unknowns is `undefined` (treat as vision-capable
 * until proven otherwise) — false negatives here are visible (user gets
 * worse results), false positives would be invisible (model crashes
 * silently to user, looks like a plugin bug).
 */

/** Per-model capability overrides. Undefined fields fall back to provider default. */
export interface ModelQuirks {
  /**
   * If false, the model rejects image content at the API or router layer.
   * Triggers tool filtering + message stripping. If undefined, model is
   * assumed vision-capable (open by default — this matches "defaults stay
   * open, quirks only subtract" from feedback_no_capability_castration.md).
   */
  supportsVision?: boolean;
}

/**
 * Empirically verified quirks. Keyed by exact modelId as reported by the
 * vendor's `/v1/models` endpoint or the model picker.
 *
 * Source of truth: docs/knowledge/archive/multi-provider-compat-2026-05-10.md
 */
export const MODEL_QUIRKS: Readonly<Record<string, ModelQuirks>> = Object.freeze({
  // Confirmed protocol-level no-vision (DeepSeek API rejects image_url shape)
  'deepseek-v4-flash': { supportsVision: false },
  'deepseek-v4-pro':   { supportsVision: false },
  // Confirmed router-level no-vision (OpenCode→Xiaomi has no multimodal endpoint for this id)
  'mimo-v2.5-pro':     { supportsVision: false },
});

/**
 * Runtime-learned quirks. Populated when a request fails with a stereotyped
 * vendor-side image rejection (see openai-protocol.ts retry path). Survives
 * the rest of the session — next request with the same modelId pre-emptively
 * strips images instead of repeating the failed round-trip.
 *
 * Resets on plugin reload (in-memory only). The static MODEL_QUIRKS table
 * above is the persistent / authoritative source; this is a self-healing
 * cache for models we haven't catalogued yet.
 */
const LEARNED_QUIRKS = new Map<string, ModelQuirks>();

/** Mark a model as no-vision after observing an image-rejection failure. */
export function learnModelQuirk(modelId: string, patch: ModelQuirks): void {
  if (!modelId) return;
  const prior = LEARNED_QUIRKS.get(modelId) ?? {};
  LEARNED_QUIRKS.set(modelId, { ...prior, ...patch });
}

/**
 * Lookup helper. Merges static MODEL_QUIRKS (authoritative) with runtime
 * LEARNED_QUIRKS (self-healed). Static wins on conflict — the table reflects
 * empirically verified findings, runtime is for unknown-future cases.
 *
 * Returns empty object for unknown ids — don't throw.
 */
export function getModelQuirks(modelId: string | undefined | null): ModelQuirks {
  if (!modelId) return {};
  const learned = LEARNED_QUIRKS.get(modelId) ?? {};
  const stat = MODEL_QUIRKS[modelId] ?? {};
  return { ...learned, ...stat };
}

/**
 * Heuristic — does this 400 error message look like a vendor rejecting our
 * image content? Matches both the wire-shape rejection (DeepSeek's
 * `unknown variant 'image_url'`) and the router-level rejection
 * (Xiaomi's `No endpoints found that support image input` /
 * `Multimodal data is corrupted`). Conservative — only matches obvious
 * image cues so we don't strip on unrelated 400s.
 */
export function isImageRejection400(errorMessage: string): boolean {
  const m = errorMessage.toLowerCase();
  return (
    m.includes('image_url') ||
    m.includes('image input') ||
    m.includes('multimodal data') ||
    m.includes('does not support image')
  );
}
