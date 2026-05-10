# Failure Pattern: Silent LLM Hang After Tool Call

**Date observed:** 2026-04-13
**Trigger:** `trigger-1776073508683` (AI chat interface prompt, qwen3.6-plus)
**Symptom:** Agent makes a successful tool call, then LLM never responds. Plugin console shows no further events for 5+ minutes. DevBridge 300s placeholder timeout fires but no real result ever overwrites it.

## Evidence

Plugin console (last events before hang):
```
[call] delete_node({"node":"1542:1821"})          ← success
[Step warning] Only 1 step remaining.             ← iteration budget near exhausted
[result] delete_node: {"deleted":"Send",...}
[call] jsx({"markup":"<text name=\"SendIcon\"...} ← final tool call
[result] jsx ok (135ms)
[Context] Lazy: 82271 chars, budget 2800000 — no compression needed
[DevBridge] Result timeout after 300000ms        ← placeholder fires
⋯ no further output for 5+ minutes ⋯
```

Files written:
- `meta.json` — only the 300s placeholder (status=timeout, dur=300000, tools=0)
- `tool-calls.json`, `tree.json`, `logs.txt`, `runtime-events.json` — **not written** (would only appear on real completion)

## Likely root cause

LLM stream from `qwen3.6-plus` (DashScope) hung without producing any tokens after the `jsx` tool result was sent back. Since `StreamIdleTimeoutError` + `STREAM_IDLE_TIMEOUT_MS` were removed across all providers (April 2026, see `project_stream_timeout_removal.md`), there is **no client-side idle timeout** on the LLM stream. A stalled-but-live TCP connection will sit forever.

Contributing factor: `[Step warning] Only 1 step remaining` — agent near iteration limit, runtime injected a "wrap up" hint. If the LLM responds to this hint with empty/incomplete stream, `emptyResponseHook` should retry up to 2×, but if the stream itself stalls (no data frames at all), emptyResponseHook never sees a response to react to.

## Recovery

User-facing: click **"New Design"** in plugin to reset session, or close/reopen plugin.

No automatic recovery exists today.

## Proposed fixes (not yet implemented)

1. **Re-introduce idle timeout for LLM streams** — bounded per-chunk idle threshold (e.g. 60s between tokens). Distinguishes stalled streams from slow-but-live. Would conflict with the prior removal rationale — revisit tradeoff.
2. **Watchdog in `agentRuntime.ts`** — if no `tool_call` or `assistant_text` event for 90s after the last tool result, abort the turn with a user-visible error instead of silent hang.
3. **DevBridge escalation** — if placeholder timeout fires AND no tool events for 120s afterward, post a final failure result with diagnostic (last tool call + runtime state).

## Repro ingredients

- Complex multi-component prompt (AI chat, dashboard, multi-section layouts)
- qwen3.6-plus model (DashScope)
- Run accumulates 20+ tool calls before LLM hang
- Step warning ("1 step remaining") often precedes the hang

Prompts that triggered similar behavior: "AI chat interface with tool-call cards, model selector, input" (this run).

Prompts that completed normally same session (same model):
- Music player (29 tools, 309s, 4 errors)
- Calendar week view (39 tools, 548s, 7 errors)

Hang appears **stochastic** — model provider issue, not prompt content.
