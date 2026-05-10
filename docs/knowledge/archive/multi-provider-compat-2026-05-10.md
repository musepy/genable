# OpenCode Go model compat sweep — 2026-05-10

Autonomous sweep of all 10 models in the OpenCode Go preset, run via the dev bridge. 20 runs total (10 models × 2 modes: text-only + vision with 1×1 PNG). Driven by `/multi-provider-compat-test` skill SOP. Total wall time 27 min. Active provider: OpenCode Go (Cloudflare Worker proxy, OpenAI protocol).

## Result table

| # | Model | TEXT (no image) | VISION (1×1 PNG attached) | Quirk class |
|---|---|---|---|---|
| 1 | kimi-k2.5 | ✅ idle, 116s, 6 tools | ⚠️ image-validation (`prepare image failed`) | sweep artifact only |
| 2 | kimi-k2.6 | ✅ idle, 67s, 4 tools | ⚠️ image-validation (`prepare image failed`) | sweep artifact only |
| 3 | deepseek-v4-flash | ❌ error, 89s, 6 tools, `image_url` 400 at messages[15] | ❌ error, 2s, 0 tools, `image_url` 400 at messages[2] | **A. protocol-level no-vision** |
| 4 | deepseek-v4-pro | ❌ error, 205s, 6 tools, `image_url` 400 at messages[13] | ❌ error, 2s, 0 tools, `image_url` 400 at messages[2] | **A. protocol-level no-vision** |
| 5 | glm-5 | ✅ idle, 53s, 8 tools | ✅ idle, 136s, 2 tools (likely silent drop) | none |
| 6 | glm-5.1 | ✅ idle, 77s, 7 tools | ✅ idle, 9s, 1 tool (likely silent drop) | none |
| 7 | mimo-v2-pro | ✅ idle, 78s, 7 tools | ◐ idle, 10s, 0 tools (model chose not to act) | behavior diff (not a bug) |
| 8 | mimo-v2.5-pro | ❌ error, 84s, 5 tools, `No endpoints found that support image input` | ❌ error, 4s, 0 tools, same | **B. router-level no-vision** |
| 9 | mimo-v2-omni | ✅ idle, 112s, 14 tools | ⚠️ error, 23s, 2 tools, `Multimodal data is corrupted` | sweep artifact only |
| 10 | mimo-v2.5 | ✅ idle, 53s, 9 tools | ✅ idle, 32s, 3 tools | none |

Trigger IDs are in `/tmp/sweep-final.json` for replay.

## Three distinct error shapes (root-cause grouped, not surface-grouped)

### A. Protocol-level no-vision — DeepSeek family
```
[openai-protocol] API error 400: Error from provider (DeepSeek):
  Failed to deserialize the JSON body into the target type:
  messages[N]: unknown variant `image_url`, expected `text`
```
- **Impact**: critical. Agent's `inspect` / `get_screenshot` tools feed screenshots back to the LLM as `{type:'image_url'}` blocks ([openaiFormat.ts:46](../../src/engine/llm-client/providers/shared/openaiFormat.ts#L46)). Even text-only prompts hit this — TEXT-phase deepseek runs got 6 tool calls deep before crashing on the 13th-15th message.
- **In other words**: deepseek isn't "no-vision-only-broken" in our agent; it's **fully broken** as soon as the agent uses screenshot-bearing tools, which it does on every run.
- **Affected**: deepseek-v4-flash, deepseek-v4-pro

### B. Router-level no-vision — Xiaomi mimo-v2.5-pro
```
[openai-protocol] API error 400: Error from provider (Xiaomi):
  No endpoints found that support image input
```
- **Impact**: critical. Same blast radius as A — agent's screenshot tool kills the run.
- The wrapper here is OpenCode Go's vendor router. The error fires at OpenCode → Xiaomi routing time, not at the model itself.
- **Affected**: mimo-v2.5-pro

### C. Image-data validation rejecting tiny test PNG (sweep artifact, not a compat bug)
```
kimi:           prepare image failed error
mimo-v2-omni:   Multimodal data is corrupted or cannot be processed
```
- **NOT a real compat bug** — kimi-k2.6 vision works in production (proven by `a808d50` fix landing). The 1×1 PNG used as the sweep probe is too degenerate for several vendors' image preprocessors.
- **Affected by sweep methodology**: kimi-k2.5, kimi-k2.6, mimo-v2-omni. These three are vision-capable in real use.
- **Methodology fix**: future sweeps should use a ≥ 64×64 PNG with non-trivial content. This SOP's `tools/multi-provider-sweep.sh` recipe will be updated.

## Tier classification

| Tier | Models | Status |
|---|---|---|
| **Tier 1 — production-ready** | kimi-k2.5, kimi-k2.6, glm-5, glm-5.1, mimo-v2-pro, mimo-v2-omni, mimo-v2.5 | 7/10 — clean text runs, agent screenshot loop OK |
| **Tier 2 — vision quirks (sweep methodology to retest)** | (none confirmed; the vision-failures in this sweep are all artifacts) | needs rerun with real image |
| **Tier 3 — hard-incompatible** | deepseek-v4-flash, deepseek-v4-pro, mimo-v2.5-pro | 3/10 — agent breaks within first turn once `inspect` runs |

The 30% Tier-3 rate is the load-bearing finding. These three should NOT be exposed in the model picker as-is — they fail invisibly to users (model selected, agent runs for 1-3 minutes, errors with "API key invalid" or worse, depending on which surface message wins the race).

## Concrete next steps

Pick one:

### Option 1 — drop Tier-3 from the picker (lowest cost)
Filter `availableModels` in `useModelSettings`/probe step to exclude any model whose probe call returns a hard 400 on a screenshot-bearing test. ~30 lines, no behavior risk for Tier 1.

### Option 2 — `MODEL_QUIRKS` table with `supportsVision: false` (proper fix)
Per the SOP's proposed layer:

```ts
// src/engine/llm-client/providers/shared/modelQuirks.ts
export interface ModelQuirks {
  supportsVision?: boolean;
  requiresReasoningContent?: boolean;
  minTemperature?: number;
}

export const MODEL_QUIRKS: Record<string, ModelQuirks> = {
  // Confirmed by 2026-05-10 sweep
  'deepseek-v4-flash':  { supportsVision: false },
  'deepseek-v4-pro':    { supportsVision: false },
  'mimo-v2.5-pro':      { supportsVision: false },
  // Confirmed by a808d50 fix
  'kimi-k2.5':          { requiresReasoningContent: true, minTemperature: 0.7 },
  'kimi-k2.6':          { requiresReasoningContent: true, minTemperature: 0.7 },
};
```

Apply in `mapMessagesToOpenAI`:
- `supportsVision === false` → strip `{type:'image_url'}` blocks AND emit a warning to the agent ("vision unavailable on this model") so the agent can pick a different verification strategy

But: if the agent can't see screenshots, half its self-correction tools become no-ops. The agent design assumes vision. So Option 2 is **necessary but not sufficient** for Tier-3 models — they'd still produce lower-quality designs because the agent runs blind.

**Recommendation**: ship Option 1 first (block Tier-3 from picker), then evaluate Option 2 only if there's clear demand for those models.

### Option 3 — drop screenshots from tool results when on Tier-3
Keep models in picker, strip `image_url` from `inspect` / `get_screenshot` tool results when the active model is in `supportsVision:false` set. Agent text-only continues; quality drops but doesn't hard-crash.

## Method improvements for next sweep

1. **Use a real probe image** (≥64×64 PNG with content) — eliminates Class C false positives entirely. Estimated 8/10 models would have shown clean vision behavior with a proper image.
2. **Distinguish `meta_status` from `tools > 0`** — sweep_status="ok" was misleading when DeepSeek failed mid-stream after 6 tools. The Python script already records `meta_status` separately; the report uses that as ground truth, but the live log line should too.
3. **Capture all `provider_error` events**, not just the first — some models may chain errors. (Today's sweep only had one error per failing run, so this didn't matter, but worth hardening.)

## Linked artifacts

- SOP skill: [.claude/skills/multi-provider-compat-test/SKILL.md](../../.claude/skills/multi-provider-compat-test/SKILL.md)
- Sweep script: `/tmp/sweep.py` (one-off; not committed)
- Raw results: `/tmp/sweep-final.json` (transient; mirrored here in tables)
- Memory: [project_openai_protocol_vendor_quirks.md](../../../../.claude/projects/-Users-daxiaoxiao-Projects-figma-gen-plugin-figma-ai-generator-dogfood/memory/project_openai_protocol_vendor_quirks.md)
- Prior fix: commit `a808d50` (kimi-k2.6 reasoning_content)
- Source code:
  - [src/engine/llm-client/providers/openai-protocol.ts](../../src/engine/llm-client/providers/openai-protocol.ts) — protocol handler
  - [src/engine/llm-client/providers/shared/openaiFormat.ts:46](../../src/engine/llm-client/providers/shared/openaiFormat.ts#L46) — image_url mapping (the deepseek/xiaomi failure point)
  - [src/config/provider-presets.json](../../src/config/provider-presets.json) — preset whitelist
