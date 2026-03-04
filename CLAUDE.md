# CLAUDE.md — Figma AI Generator Plugin

Figma plugin that uses an agentic AI loop (Gemini Flash) to generate UI designs from natural language prompts.

## Architecture

### Plugin Architecture (3 threads)
- **UI thread** (Preact) — Chat interface, settings
- **Sandbox** (iframe) — Agent runtime, LLM calls, tool orchestration
- **Main thread** (Figma API) — Node creation/modification, rendering

Communication: IPC via `@create-figma-plugin/utilities` emit/on pattern.

### Agent Loop (Autonomous)
Single-mode autonomous loop — no phase transitions. The agent decides its own plan/execute/verify rhythm.

```
user prompt → [iteration loop] → text-only response (implicit completion)
                   │
              LLM generate → tool dispatch → hook guardrails → next iteration
```

Safety is enforced by 3 built-in hooks (not phase transitions):
- **emptyResponseHook** — retries empty LLM responses (max 2), then aborts
- **ramblingGuardHook** — detects text-only iterations without tool calls (max 4), then aborts
- **loopDetectionHook** — fingerprints tool call signatures; identical pattern 4+ times → grace warning → fatal abort; monotone tool-name pattern → hint injection

### Entry Point
```
AgentOrchestrator.generate(prompt)  →  AgentRuntime  →  agent.run(prompt)
```

### Execution Flow (single iteration)
1. Context management — compression if prompt tokens > 70% budget
2. Dynamic context update — mode tag updated in-place (KV-cache friendly)
3. LLM generation — streams response with tool mode AUTO, all tools available
4. Hook pipeline — emptyResponse → ramblingGuard → loopDetection (priority-ordered)
5. Tool dispatch — sequential execution via IPC to main thread (or local for signal/query_knowledge)
6. Termination — text-only response (no tool calls) = implicit completion

### Key Directories
- `src/engine/agent/` — Agent runtime, loop policy, loop detection, hooks
- `src/engine/agent/tools/` — 7 unified tool definitions (read_node, build_design, patch_node, delete_node, query_knowledge, capture_screenshot, signal)
- `src/engine/llm-client/` — LLM providers, prompt composition, context management
- `src/engine/actions/` — Typed action executor (sequential, with topological sort and rollback)
- `src/engine/agent/skills/` + `.agent/skills/*/SKILL.md` — Skill system (regex trigger + BM25 knowledge)
- `src/ipc/` — IPC handlers, batch executor
- `src/ui/` — Preact UI components

### Configuration
Two config layers:
- **AgentBehaviorConfig** — LLM-facing: designStrategy, visualQuality, thinkingLevel
- **AgentLoopPolicy** — Runtime control: iteration limits, loop thresholds, token budgets

## Development

- **Build**: `node build.js` (custom esbuild)
- **Type check**: `npx tsc --noEmit`
- **Test**: `npx vitest run` (NOT jest)
- **Lint**: `npx eslint "src/**/*.{ts,tsx}"`
- **LLM providers**: Gemini Flash (primary), OpenRouter (alternative)
- **UI framework**: Preact with `@create-figma-plugin/ui`

## Testing Rules

See [docs/TESTING.md](docs/TESTING.md) for full guide. Key rules:

- **DO NOT** mock `figma.*` API for unit tests — mock 通过 ≠ 真实通过
- **DO NOT** mock LLM SDK to test streaming — real issues are network/partial JSON
- **Only unit-test pure logic** — functions with no Figma/LLM dependency (loop detection, topological sort, token estimation, parsers)
- **Real API harness** is the most valuable test: `GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts`
- **Figma desktop smoke test** after changing executor/tool logic — build and run in Figma desktop app

## Conventions

- Executor is **sequential** (topological sort → sequential await) due to dependency chains, tempId→realId mapping, and Figma sandbox single-threading
- Tools declare `executionStrategy: 'parallel' | 'sequential'` to control dispatch behavior
- `(node as any)[key] = value` is common in executor — Figma API requires runtime property assignment
- Property application order matters: `PROP_ORDER` in executor ensures layoutMode before sizing, font before characters
