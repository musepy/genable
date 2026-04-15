# CLAUDE.md — Figma AI Generator Plugin

Figma plugin that uses an agentic AI loop (Gemini Flash) to generate UI designs from natural language prompts.

> **Error Catalog**: `.agent/error-catalog.md` — known error patterns, check when debugging.

## Architecture

### Plugin Architecture (3 threads)
- **UI thread** (Preact) — Chat interface, settings
- **Sandbox** (iframe) — Agent runtime, LLM calls, tool orchestration
- **Main thread** (Figma API) — Node creation/modification, rendering

Communication: IPC via `@create-figma-plugin/utilities` emit/on pattern.

### Agent Loop (Conversational)
Multi-turn conversational agent. Each `run()` call is one user turn. Text-only response = turn ends (pause, wait for user). No `signal(complete)` tool — the agent just speaks and waits.

```
user message → run() → [iteration loop] → text-only response → turn end (wait for user)
                              │
                    LLM generate → tool dispatch → hooks → next iteration
```

Session lifecycle: plugin open → multiple `run()` calls → "New Design" (session reset).

Safety hooks (2):
- **emptyResponseHook** — retries empty LLM responses (max 2), then aborts
- **loopDetectionHook** — fingerprints tool call signatures; identical pattern 4+ times → abort

### Context Management (Layered)
Context is structured in 3 layers, NOT a flat message array:

```
Layer 1: staticSystemPrompt  — set once at construction, never changes
Layer 2: summary             — rolling summary of previous turns, updated at turn boundaries
Layer 3: turnMessages        — current turn only, cleared at next run() start
```

Each LLM call receives `[systemPrompt, summary, ...turnMessages]`. Context is always bounded (~12K tokens) regardless of conversation length. No `hidden`/`pinned` flags, no reactive compression.

At turn end: `endTurn()` summarizes current turn → appends to `summary` → `turnMessages` stay for debrief, cleared at next `run()`.

### Entry Point
```
AgentOrchestrator.generate(prompt)  →  AgentRuntime  →  agent.run(prompt)
```

### Execution Flow (single iteration)
1. Assemble prompt from 3 layers
2. LLM generation — streams response with tool mode AUTO, all tools available
3. Hook pipeline — emptyResponse → loopDetection (priority-ordered)
4. Tool dispatch — sequential execution via IPC to main thread (or local for query_knowledge)
5. Turn end — text-only response (no tool calls) = turn ends, wait for user

### Key Directories
- `src/engine/agent/` — Agent runtime, loop policy, loop detection, hooks
- `src/engine/agent/tools/` — 4 unified tool definitions (create, edit, read, query_knowledge)
- `src/engine/agent/context/` — Context summarizer (`contextSummarizer.ts`), tool result cleaner
- `src/engine/llm-client/` — LLM providers, prompt composition
- `src/engine/actions/` — Typed action executor (sequential, with topological sort and rollback)
- `src/engine/agent/skills/` + `.agent/skills/*/SKILL.md` — Skill system (regex trigger + BM25 knowledge)
- `src/ipc/` — IPC handlers, batch executor
- `src/ui/` — Preact UI components

### Configuration
Two config layers:
- **AgentBehaviorConfig** — LLM-facing: designStrategy, visualQuality, thinkingLevel
- **AgentLoopPolicy** — Runtime control: iteration limits, loop thresholds

## Development

- **Build**: `node build.js` (custom esbuild)
- **Type check**: `npx tsc --noEmit`
- **Test**: `npx vitest run` (NOT jest)
- **Lint**: `npx eslint "src/**/*.{ts,tsx}"`
- **LLM providers**: Gemini Flash (primary), OpenRouter (alternative), DashScope/Kimi K2.5 (via Cloudflare Worker proxy)
- **UI framework**: Preact with `@create-figma-plugin/ui`

## Local E2E Testing (Dev Bridge)

Automated end-to-end testing via the dev bridge — Claude Code sends prompts to the Figma plugin and collects results without manual interaction.

### Quick Start
```bash
# 1. Build plugin
node build.js

# 2. Start dev bridge server
npx tsx tools/dev-bridge/server.ts          # → localhost:3456

# 3. Open Figma desktop → run plugin (it auto-connects to bridge)

# 4. Trigger a design prompt
curl -X POST http://localhost:3456/trigger \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Design a login page with email, password, and sign-in button"}'
# → {"ok":true,"id":"trigger-xxx"}

# 5. Poll for result
curl http://localhost:3456/result/trigger-xxx
# → {status: "done", logs, toolCalls, ...}
```

### Architecture
```
Claude Code ──curl──▶ dev-bridge server (localhost:3456)
                          │ writes /tmp/figma-bridge/triggers/
                          │ reads  /tmp/figma-bridge/results/
                          ▼
              Figma plugin (useDevBridge.ts polls filesystem)
                          │ injects prompt → agent runs → writes result
```

### Key Files
- `tools/dev-bridge/server.ts` — HTTP server: /trigger, /result/:id, /health
- `src/dev/useDevBridge.ts` — Plugin-side hook, polls triggers, collects results
- `src/dev/nodeTreeSerializer.ts` — Serializes Figma node tree for export

### When to Use
- After changing executor/tool/prompt logic — run E2E to validate design output
- After changing LLM provider code — verify tool calls work end-to-end
- Result includes: agent digest (iterations, duration, tool calls), full tool call log with params/results/errors

## Testing Rules

See [docs/TESTING.md](docs/TESTING.md) for full guide. Key rules:

- **DO NOT** mock `figma.*` API for unit tests — mock 通过 ≠ 真实通过
- **DO NOT** mock LLM SDK to test streaming — real issues are network/partial JSON
- **Only unit-test pure logic** — functions with no Figma/LLM dependency (loop detection, topological sort, token estimation, parsers)
- **Real API harness** is the most valuable test: `GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts`
- **Figma desktop smoke test** after changing executor/tool logic — build and run in Figma desktop app
- **Dev bridge E2E** is the most comprehensive test — see "Local E2E Testing" section above

## Conventions

- Executor is **sequential** (topological sort → sequential await) due to dependency chains, tempId→realId mapping, and Figma sandbox single-threading
- Tools declare `executionStrategy: 'parallel' | 'sequential'` to control dispatch behavior
- `(node as any)[key] = value` is common in executor — Figma API requires runtime property assignment
- Property application order matters: `PROP_ORDER` in executor ensures layoutMode before sizing, font before characters
