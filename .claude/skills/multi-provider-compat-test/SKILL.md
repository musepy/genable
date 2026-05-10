---
name: multi-provider-compat-test
description: Sweep every model in the active provider's preset to detect per-vendor protocol quirks (Kimi-style reasoning_content, DeepSeek-style image_url rejection, etc). Switch models autonomously via dev bridge, run a vision + non-vision prompt, capture provider_error events, classify the failure shape, and propose a quirks-table fix. Use after adding a new provider preset, after Worker route changes, before promoting a new model to default, or when "kimi works but deepseek doesn't" symptoms appear.
triggers:
  - "测试所有模型"
  - "model 兼容性"
  - "provider compat"
  - "kimi 修了 deepseek 还坏"
  - "openai 协议白名单"
  - "扫一遍 provider 模型"
  - "multi-model sweep"
---

# Multi-Provider Compatibility Test

Sweep every model in a provider preset (e.g. all 10 OpenCode Go models) to detect per-vendor quirks that the OpenAI-protocol abstraction does NOT cover. Goal: catch failures like the kimi-k2.6 `reasoning_content` 400 or the deepseek-v4-pro `image_url` 400 **before** users hit them.

## Why this matters

The plugin's transport stack assumes "OpenAI protocol = one handler" (`openai-protocol.ts`). In practice each downstream vendor has its own quirks under the same wire format:

- **Kimi K2.x**: thinking enabled by default, requires `reasoning_content` field on assistant tool-call messages — see `a808d50` ([openai-protocol.ts:191](src/engine/llm-client/providers/openai-protocol.ts#L191), [openaiFormat.ts:55-90](src/engine/llm-client/providers/shared/openaiFormat.ts#L55))
- **DeepSeek V4 Pro**: rejects `{type:"image_url", image_url:{...}}` content blocks — `unknown variant 'image_url', expected 'text'` (captured 2026-05-10, trigger-1778377943791)
- **GLM / MiMo / others**: untested as of 2026-05-10

A protocol whitelist + endpoint whitelist (the current `provider-presets.json`/Worker design) is **not sufficient**. We need a per-model **capabilities + quirks** layer. This skill captures the data needed to build that layer empirically.

## Scope

In scope:
- Models inside ONE provider preset (e.g. all OpenCode Go models)
- OpenAI protocol quirks (anthropic-protocol and gemini-protocol have a separate skill scope)
- Vision (`image_url`) and reasoning (`reasoning_content`) compat
- Tool-call roundtrip compat (kimi K2.5 historically required temperature ≥ 0.7)

Out of scope:
- Adding a NEW provider — see `provider-addition-checklist`
- Single-prompt rule iteration on one model — see `prompt-iteration-e2e`
- Post-hoc analysis of already-run triggers — see `trigger-log-audit`

## Background — what's already wired

### Dev bridge supports model switching ([useDevBridge.ts:484](src/dev/useDevBridge.ts#L484))

```ts
if (trigger.model && callbacksRef.current.switchModel) {
  const [provider, ...modelParts] = trigger.model.split('/')
  const model = modelParts.join('/')
  callbacksRef.current.switchModel(provider, model)
}
```

The legacy `validProviders = ['gemini','openrouter','dashscope']` gate in [useChat.ts:858](src/features/chat/useChat.ts#L858) only accepts those three names — but the second hop ([ui.tsx:86](src/ui.tsx#L86)) **ignores the provider name and only uses the model**:

```ts
(window as any).__GENABLE_SWITCH_PROVIDER__ = (_provider, model) => { if (model) setModelName(model) }
```

**So**: send `"model": "dashscope/<modelId>"` in the trigger payload — the prefix is just to satisfy the legacy gate; the actual provider used is whichever is `activeProviderId` (e.g. opencode-go). Do NOT use `opencode-go/<modelId>`; the gate would silently drop it.

This is also why I can run this skill autonomously without asking the user to switch in the UI.

### SSE termination signal ([server.ts:382](tools/dev-bridge/server.ts#L382))

The bridge emits three terminal-ish SSE events. Their semantics differ:

| Event | When | Treat as terminal? |
|---|---|---|
| `event: done` | server got a `POST /result` with `status != "timeout"` (real agent completion) | ✅ yes — immediate, accurate, fires the moment the agent's turn ends |
| `event: timeout-placeholder` | plugin posted a 300s `status:"timeout"` placeholder while agent is still running | ❌ no — keep listening; a real `done` will arrive when the agent actually finishes |
| `event: disconnected` | plugin reload tore down the in-flight run | ❌ no — the trigger may need to be retried (swallowed-trigger case) |

So to chain sweep runs back-to-back with **zero added latency**:

```bash
# Subscribe to SSE; the first 'done' is your immediate completion signal.
curl -N "http://localhost:3456/stream/$TID" 2>/dev/null \
  | awk '/^event: done$/{print "DONE"; exit} /^event: timeout-placeholder$/{print "[still running...]" > "/dev/stderr"}'
```

Only fall back to the filesystem predicate (`status != "timeout"` AND mtime stable ≥ 20s) if you missed SSE — e.g., your subscription started after the run finished, or the connection dropped. See `prompt-iteration-e2e` § Step 3 for the full polling predicate.

**Why not `?wait=N`**: caps at 300s, returns `{status:"pending"}` on timeout — gives you no signal for runs that legitimately exceed 5min (kimi reasoning can hit 6+ min on complex prompts).

## Prerequisites

1. Dev bridge running: `curl -s localhost:3456/health` returns `ok`
2. Plugin loaded in Figma desktop, on a blank file (test runs add new roots)
3. Active provider in plugin = the one whose models you want to sweep (e.g. OpenCode Go). Confirm with most recent meta:
   ```bash
   ls -t /tmp/figma-bridge/results/*/meta.json | head -1 | xargs jq -r '.modelName'
   ```
4. Build is current. If you edited provider/transport code: `node build.js && sleep 3` before the first trigger (build → reload window can swallow triggers — see `prompt-iteration-e2e` § Swallowed-trigger recovery)

## Step 1 — Pick the model list

Pull the live list from the active provider's `availableModels` (probed at validate time):

```bash
# Open the plugin's localStorage / IndexedDB via DevTools, or just read the
# screenshot of the model picker. As of 2026-05-10 OpenCode Go shipped:
MODELS=(
  "kimi-k2.6"          # known-good (a808d50 fix landed)
  "kimi-k2.5"          # known-good
  "deepseek-v4-flash"  # untested
  "deepseek-v4-pro"    # known-bad: image_url 400 (2026-05-10)
  "glm-5"              # known-good non-vision
  "glm-5.1"            # untested
  "mimo-v2-pro"        # untested
  "mimo-v2.5-pro"      # untested
  "mimo-v2-omni"       # untested
  "mimo-v2.5"          # untested
)
```

**Always hard-code the list in the test script and commit it** — not pulled from `localStorage` at runtime. The list IS the test plan; if probe results drift, the diff in this skill is your audit log.

## Step 2 — Pick two prompts: one vision, one text-only

Vendor quirks split along two axes:

| Quirk | Triggered by | Failure shape |
|---|---|---|
| `image_url` rejection | message contains `{type:"image_url"}` (any user paste-image OR any tool result feeding screenshot back) | API 400 `unknown variant 'image_url'` |
| `reasoning_content` required | thinking-enabled vendor + assistant message with `tool_calls` | API 400 `thinking is enabled but reasoning_content is missing` |
| temperature < 1.0 with tools | low temp + `tool_choice` (Kimi K2.5) | empty `tool_calls` (`finish_reason:"tool_calls"`, `arguments:null`) |

So run TWO prompts per model:

- **A. Text-only**: `"Design a 3-tier pricing card: Free, Pro, Enterprise."` — exercises tool-calls, multi-turn, no images.
- **B. Vision**: same prompt + an attached image (use the [vision-reference](.agent/skills/vision-reference) skill's recipe, or trigger payload `images: [{ mimeType, data: <base64> }]` per [server.ts handleTriggerPost](tools/dev-bridge/server.ts) and [useDevBridge.ts attachments handling](src/dev/useDevBridge.ts#L508)).

Vision prompt only needs to run once per provider once we know the vendor's `image_url` policy — but the agent also feeds back screenshots from `inspect`/`get_screenshot` tools, which produce `image_url` blocks downstream. So even a "text-only" prompt that triggers screenshot inspection will hit the bug. Run B explicitly anyway to fail fast before the agent gets there organically.

## Step 3 — Sweep one model at a time

Don't parallelize: plugin is single-threaded, dev bridge is single-slot.

```bash
# Helper script — drop into tools/multi-provider-sweep.sh if you'll re-run often
sweep_model() {
  local MODEL=$1 PROMPT=$2 LABEL=$3 IMG_JSON=$4
  local payload="{\"prompt\":\"$PROMPT\",\"reset\":true,\"model\":\"dashscope/$MODEL\""
  [ -n "$IMG_JSON" ] && payload="$payload,\"images\":$IMG_JSON"
  payload="$payload}"

  TID=$(curl -s -X POST http://localhost:3456/trigger \
    -H 'Content-Type: application/json' -d "$payload" | jq -r '.id')
  echo "[$LABEL] $MODEL → $TID"

  local RD="/tmp/figma-bridge/results/$TID"
  local end=$(($(date +%s)+600))   # 10 min ceiling per run
  while [ $(date +%s) -lt $end ]; do
    if [ -f "$RD/meta.json" ]; then
      ok=$(python3 -c "
import json
d=json.load(open('$RD/meta.json'))
print('yes' if (d.get('status')!='timeout' and d.get('durationMs',0)!=300000) else 'no')
" 2>/dev/null)
      if [ "$ok" = "yes" ]; then
        mt=$(stat -f %m "$RD/meta.json")
        [ $(($(date +%s) - mt)) -ge 20 ] && break
      fi
    fi
    sleep 5
  done

  jq -c '{trigger: .triggerId, model: .modelName, status, durationMs, tools: .toolCallSummary.total,
          err: ([.runtimeEvents[]? | select(.type=="provider_error") | .errorMessage // .message] | first // null)}' \
     "$RD/meta.json" 2>/dev/null
}

# Text-only sweep
for M in "${MODELS[@]}"; do sweep_model "$M" "Design a 3-tier pricing card: Free, Pro, Enterprise" "TEXT" ""; done

# Vision sweep — tiny 1×1 PNG keeps it cheap; the failure surface is the
# request body shape, not the image content
TINY_IMG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
IMG_PAYLOAD="[{\"mimeType\":\"image/png\",\"data\":\"$TINY_IMG_B64\",\"name\":\"probe.png\"}]"
for M in "${MODELS[@]}"; do sweep_model "$M" "Use this reference to design something similar" "VISION" "$IMG_PAYLOAD"; done
```

Run in `run_in_background: true` so you don't block the conversation. Each model takes 30s–10min. The whole sweep is ~1–2 hours for 10 models × 2 prompts.

### Hang detection

If `events.jsonl` shows no new `tool` lines for 3+ min AND no `meta.json`, the LLM hung (silent — no `provider_error`, no `abort`). Document in `docs/knowledge/`, kill via `curl -X DELETE localhost:3456/trigger`, move on. Don't block the sweep.

### Sanity check: is the model actually switching?

After each trigger, the first `llm_request` runtime event has the modelId in its body. If you see kimi-k2.6 in `meta.modelName` but `provider_error` says `[deepseek]`, the legacy provider gate may have dropped your switch — re-check that you used `dashscope/<model>`, not `opencode-go/<model>`.

## Step 4 — Classify failures

Every `provider_error` event has a stereotyped shape. Map to the quirks table:

| `errorMessage` substring | Vendor | Quirk class | Fix shape |
|---|---|---|---|
| `unknown variant \`image_url\`` | DeepSeek | no-vision | strip `{type:'image_url'}` blocks at request time, OR `supportsVision:false` + reject vision tools |
| `thinking is enabled but reasoning_content is missing` | Kimi | reasoning-required | inject `reasoning_content:''` on assistant tool-call messages — already shipped (`a808d50`) |
| `tool_calls.arguments` is null with `finish_reason:tool_calls` | Kimi K2.5 | low-temp-empty-args | clamp `temperature ≥ 0.7` for kimi (already in [openai-protocol.ts:191](src/engine/llm-client/providers/openai-protocol.ts#L191)) |
| `max_tokens` 400 / unknown model | Any | maxOutput unmapped | add to `KNOWN_MAX_OUTPUT` in [openai-protocol.ts:74](src/engine/llm-client/providers/openai-protocol.ts#L74) |
| network / 5xx repeated | Worker / vendor outage | infra | retry next day; not a quirk |

If you see a NEW shape (none of the rows match), record:
- exact `errorMessage` (the bit before the truncation)
- which `messages[N]` index
- whether the failing message has tool_calls / images / role:user/assistant

That tuple is enough to propose a quirks-table entry. Without it the fix is guesswork.

## Step 5 — Propose the quirks layer

After 1–2 sweeps the pattern is clear: the `openai-protocol.ts` handler needs a per-model adapter table. Concretely:

```ts
// src/engine/llm-client/providers/shared/modelQuirks.ts (proposed)
export interface ModelQuirks {
  supportsVision?: boolean;          // false → strip image_url blocks
  requiresReasoningContent?: boolean; // true → inject reasoning_content:''
  minTemperature?: number;           // clamp .temperature up to this
  maxOutputCap?: number;             // overrides KNOWN_MAX_OUTPUT
}

export const MODEL_QUIRKS: Record<string, ModelQuirks> = {
  'deepseek-v4-pro':    { supportsVision: false },
  'deepseek-v4-flash':  { supportsVision: false }, // pending verify
  'kimi-k2.5':          { requiresReasoningContent: true, minTemperature: 0.7 },
  'kimi-k2.6':          { requiresReasoningContent: true, minTemperature: 0.7 },
  // … fill in from sweep results
};
```

Apply in `buildRequestBody` and `mapMessagesToOpenAI`. Don't do this BEFORE the sweep — empirical data first, abstraction second. See `feedback_no_capability_castration.md` (memory) — defaults stay open; quirks subtract from defaults, never the reverse.

For a fresh provider with no sweep data, the default should remain "vision on, no special headers" — fail loud, not silent.

## Step 6 — Write the report

Drop it at `docs/knowledge/archive/multi-provider-compat-DATE.md` (per memory: archive for one-time observations, not the root). Format:

```markdown
# OpenCode Go model compat sweep — 2026-05-10

## Result table
| Model | Text-only | Vision | Quirk class | Trigger ID |
|---|---|---|---|---|
| kimi-k2.6 | ✅ | ✅ | reasoning-required (fixed) | trigger-A |
| deepseek-v4-pro | ✅ | ❌ image_url 400 | no-vision | trigger-B |
| ... | | | | |

## New quirks discovered
- `<model>`: <one sentence, error substring quoted>

## Proposed MODEL_QUIRKS additions
[paste the diff]

## Open questions
- (e.g. "mimo-v2-omni timed out — vendor or our side?")
```

Don't overwrite an existing dated file; create a new one. Memory rule: `docs/knowledge/archive/` is the right home, NOT the root and NOT memory.

## Common pitfalls

1. **Sending `opencode-go/<model>`** — legacy gate at [useChat.ts:858](src/features/chat/useChat.ts#L858) silently drops it. Use `dashscope/<model>`. Symptom: `meta.modelName` doesn't change between runs.
2. **Treating `kimi works = OpenAI protocol works`** — kimi is the most-tested OpenAI-compat model in this codebase, NOT a representative one. The whole point of this skill is to escape that bias.
3. **Skipping the vision prompt** — most "headless" prompts also produce `image_url` blocks downstream when the agent calls `inspect`/`get_screenshot`. You'll discover image quirks anyway, just later, with a more confusing trace.
4. **Running models in parallel** — single-slot trigger queue + single-threaded plugin. Sequential only.
5. **Trusting `?wait=N` or first SSE `done`** — same race as `prompt-iteration-e2e`. Filesystem + full predicate is ground truth.
6. **Forgetting to `reset:true`** — kimi reasoning_content from prior turn pollutes deepseek run; deepseek then 400s for the wrong reason.
7. **Adding the quirks table BEFORE sweeping** — premature abstraction. The data tells you the shape, not your intuition. See `feedback_no_capability_castration.md`.

## Anti-patterns

- **"All openai-protocol models share the same quirks"** — provably false (kimi vs deepseek). Sweep before assuming.
- **Patching only the model that failed in production** — the next user complaint will be a different model. Sweep the whole preset once; ship one quirks table.
- **Removing `image_url` globally** — that breaks kimi vision. Strip per-model, never global.
- **Saving the result table to memory** — it's a snapshot; goes in `docs/knowledge/archive/`. Memory only gets the *methodology* lessons (this SKILL.md and any feedback derived).

## Linked skills + commands

- `prompt-iteration-e2e` — when one specific model fails one specific prompt; iterate the SYSTEM.md or quirks fix
- `dogfood-batch-run` — orthogonal axis: same model, many prompts (breadth across scenarios)
- `provider-addition-checklist` — when sweep reveals we need a new preset entry
- `figma-http-bridge` — bypass the LLM entirely; useful when isolating "is it the agent or the API?" — call `tool/jsx` directly via curl
- `httpbridge-api-test` — Figma-API-side correctness, complements LLM-side check
- `trigger-log-audit` — post-hoc reading of past sweep runs

Key code:
- [src/engine/llm-client/providers/openai-protocol.ts](src/engine/llm-client/providers/openai-protocol.ts) — protocol handler, KNOWN_MAX_OUTPUT registry, kimi quirks
- [src/engine/llm-client/providers/shared/openaiFormat.ts:46](src/engine/llm-client/providers/shared/openaiFormat.ts#L46) — `image_url` mapping (the deepseek failure point)
- [src/config/provider-presets.json](src/config/provider-presets.json) — preset whitelist + `requiresProxy`
- [worker/src/index.ts](worker/src/index.ts) — Cloudflare Worker `/api/proxy/<host>/<path>` route + host whitelist
- [src/dev/useDevBridge.ts:484](src/dev/useDevBridge.ts#L484) — model-switch entry point
- [tools/dev-bridge/server.ts:382](tools/dev-bridge/server.ts#L382) — SSE `done` emission (read alongside the placeholder caveat)

Memory:
- `feedback_dev_bridge_patience.md` — SSE termination semantics
- `feedback_no_capability_castration.md` — defaults stay open, quirks only subtract
- `feedback_two_layer_testing.md` — separate LLM-layer vs API-layer when localizing a bug
