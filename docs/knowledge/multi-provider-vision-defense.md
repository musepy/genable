# Multi-provider vision defense — architecture

How the agent stays alive when the active model can't see images. Timeless reference for the architecture; for the dated sweep that revealed the problem, see [archive/multi-provider-compat-2026-05-10.md](./archive/multi-provider-compat-2026-05-10.md).

## The problem

The OpenAI-compat protocol is one wire format. The vendors behind it are not one acceptance policy:

- **DeepSeek** rejects `{type:"image_url"}` content blocks at JSON deserialization (`unknown variant 'image_url', expected 'text'`).
- **Xiaomi** mimo-v2.5-pro's OpenCode router has no multimodal endpoint at all (`No endpoints found that support image input`).
- **Kimi K2.x, Qwen-VL, GPT-4o** etc. accept `image_url` natively.
- **glm-5/5.1, plain deepseek-chat** appear to accept the wire shape but may silently drop the image (only confirmable via a real-image probe — see Wave 5).

A protocol-level handler that assumes "all OpenAI-compat models accept image_url" crashes 30% of OpenCode Go's catalog the moment the agent invokes `inspect`/`get_screenshot`. Even text-only prompts hit it, because the agent always self-verifies with screenshots.

## Defense in depth — four layers

Each layer is correct on its own; together they bound the failure.

```
┌─ Layer 1: tool list filtering ────────────────────────────┐
│   AgentOrchestrator.createAgent → filterToolsByCapabilities │
│   When supportsVision === false, drop `get_screenshot`     │
│   from the tool set passed to the LLM.                    │
│   Effect: agent never produces an image_url block via     │
│   tool results, because it never has the tool.            │
└────────────────────────────────────────────────────────────┘
            ↓ blocks the dominant failure path
┌─ Layer 2: message strip ─────────────────────────────────┐
│   openaiFormat.mapMessagesToOpenAI(messages, {            │
│     stripImages: !supportsVision                          │
│   })                                                      │
│   Replaces ImageBlock with a text marker:                 │
│   "[image attached — not visible to this model; ask user  │
│    for a text description or switch to a vision-capable   │
│    model]"                                                │
│   Effect: catches user-pasted images and any tool output  │
│   that snuck past Layer 1.                                │
└────────────────────────────────────────────────────────────┘
            ↓ blocks user-attachment vector
┌─ Layer 3: UI banner ─────────────────────────────────────┐
│   features/chat/index.tsx renders a thin warning bar      │
│   above PromptInput when:                                 │
│     attachments.some(a => a.type === 'image')             │
│       && !modelSupportsVision                             │
│   Effect: closes the loop on the user side. They can      │
│   switch model BEFORE sending instead of after seeing     │
│   degraded results.                                       │
└────────────────────────────────────────────────────────────┘
            ↓ informs the user
┌─ Layer 4: runtime self-heal ─────────────────────────────┐
│   openai-protocol.generate → catch APIError 400           │
│     where isImageRejection400(message) === true           │
│   Calls learnModelQuirk(modelId, {supportsVision:false}). │
│   Re-dispatches once with stripped images.                │
│   Effect: catches NEW vendors not yet in MODEL_QUIRKS.    │
│   Self-corrects without code changes.                     │
└────────────────────────────────────────────────────────────┘
```

## Capability source — `MODEL_QUIRKS`

Single table at `src/engine/llm-client/providers/shared/modelQuirks.ts`. Static entries are authoritative; runtime `LEARNED_QUIRKS` (from Layer 4) overlays for unknown models, but the static table always wins on conflict.

```ts
export interface ModelQuirks {
  supportsVision?: boolean;  // false → strip image content
}

export const MODEL_QUIRKS: Readonly<Record<string, ModelQuirks>> = Object.freeze({
  'deepseek-v4-flash': { supportsVision: false },
  'deepseek-v4-pro':   { supportsVision: false },
  'mimo-v2.5-pro':     { supportsVision: false },
});
```

**Adding entries** (procedure):
1. Run `/multi-provider-compat-test` against the new model.
2. Classify the failure shape (image_url 400, router 400, prepare-image, multimodal-corrupted).
3. If protocol/router rejection → add `{ supportsVision: false }` here.
4. If image-validation rejection (kimi/mimo-omni with 1×1 PNG) → it's a sweep methodology issue, NOT a real quirk. Don't add.
5. If silent-drop suspected → run `probeVision()` (Wave 5) with the three solid-color PNGs and `summarizeVisionProbe()` to confirm before adding.

**Don't pre-populate from vendor docs.** Docs and current API behavior diverge often. Empirical proof only.

## What each layer does NOT do

- **Layer 1 doesn't strip image content** — only filters which tools the LLM can call. If the LLM somehow produces image content via another tool (current set: only `get_screenshot`), Layer 1 won't catch it.
- **Layer 2 doesn't filter tools** — only rewrites already-produced messages. If `get_screenshot` somehow ends up in the tool list (e.g., custom tool subset), Layer 2 still strips its output.
- **Layer 3 isn't a hard block** — user can still send. Sending with image + non-vision model is fine; Layer 2 strips, the model sees the marker text and continues.
- **Layer 4 only fires on the specific 400 shapes in `isImageRejection400()`.** Unknown error formats fall through unchanged. Add new substrings here when sweep finds them.

## The "silent drop" gap

None of these layers detects a model that ACCEPTS `image_url` at the wire layer but never actually uses the image content (suspected of glm-5/5.1, deepseek-chat, possibly others). The only way to settle that is a real-image probe with a color discriminator (Wave 5: `probeVision()`). Run it manually before declaring a new model "vision-capable" for the purposes of MODEL_QUIRKS authoring.

## Anti-patterns

- **Globally stripping `image_url`** to "fix DeepSeek" — breaks kimi/Qwen/GPT-4o vision. Quirks subtract from defaults; never invert.
- **Detecting by `baseURL` or vendor-name regex** — OpenCode Go serves 10 different vendors at one URL with one auth header; behavior varies per modelId, not per host.
- **Auto-running `probeVision` on every key save** — burns tokens; vision probe is on-demand, not part of the cheap connectivity probe.
- **Adding `requiresReasoningContent` etc. to MODEL_QUIRKS speculatively.** The current table only has `supportsVision`. Add new fields ONLY when a sweep produces evidence that justifies them.

## Linked code

- [src/engine/llm-client/providers/shared/modelQuirks.ts](../../src/engine/llm-client/providers/shared/modelQuirks.ts) — static table + runtime cache + classifier
- [src/engine/llm-client/providers/shared/openaiFormat.ts](../../src/engine/llm-client/providers/shared/openaiFormat.ts) — Layer 2 strip
- [src/engine/llm-client/providers/openai-protocol.ts](../../src/engine/llm-client/providers/openai-protocol.ts) — Layer 4 retry
- [src/engine/agent/tools/index.ts](../../src/engine/agent/tools/index.ts) — `filterToolsByCapabilities` (Layer 1)
- [src/engine/services/AgentOrchestrator.ts](../../src/engine/services/AgentOrchestrator.ts) — capability resolution + Layer 1 application
- [src/features/chat/index.tsx](../../src/features/chat/index.tsx) — Layer 3 banner
- [src/engine/llm-client/visionProbe.ts](../../src/engine/llm-client/visionProbe.ts) — Wave 5 real-image probe

## Linked tests

- `src/engine/llm-client/providers/shared/__tests__/modelQuirks.test.ts` — 13 tests
- `src/engine/llm-client/__tests__/visionProbe.test.ts` — 12 tests

## Linked skill

- `.claude/skills/multi-provider-compat-test/SKILL.md` — how to sweep new providers/models and feed results back into this defense
