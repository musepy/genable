# CLAUDE.md — Figma AI Generator Plugin

Figma plugin that uses an agentic AI loop (Gemini Flash) to generate UI designs from natural language prompts.

## Architecture

### Plugin Architecture (3 threads)
- **UI thread** (Preact) — Chat interface, settings
- **Sandbox** (iframe) — Agent runtime, LLM calls, tool orchestration
- **Main thread** (Figma API) — Node creation/modification, rendering

Communication: IPC via `@create-figma-plugin/utilities` emit/on pattern.

### Agent State Machine (4 phases)
```
PLANNING ──→ EXECUTION ──→ VERIFICATION ──→ complete_task (exit)
                 │                │
                 └── RECOVERY ────┘
```

Phase is **recalculated each iteration** from `planState` + failure counters (implicit state machine, not a transition table).

### Entry Point
```
AgentOrchestrator.generate(prompt)  →  AgentRuntime  →  agent.run(prompt)
```

### Execution Flow (single iteration)
1. Mode determination — reads planState, checks recovery thresholds
2. System prompt hot-swap — rebuilds system message every iteration
3. LLM generation — streams response with tool mode (ANY/AUTO) based on phase
4. Tool execution — workflow tools inline; Figma tools via IpcBridge to main thread
5. Loop detection — signature fingerprinting
6. Post-processing — context compression, recovery entry/exit

### Key Directories
- `src/engine/agent/` — Agent runtime, loop policy, plan state, loop detection
- `src/engine/agent/tools/` — Tool definitions (each declares `modes: AgentMode[]` for phase availability)
- `src/engine/llm-client/` — LLM providers, prompt composition, context management
- `src/engine/actions/` — Typed action executor (sequential, with topological sort and rollback)
- `src/engine/agent/skills/` + `.agent/skills/*/SKILL.md` — Skill system (regex trigger + BM25 knowledge)
- `src/ipc/` — IPC handlers, batch executor
- `src/ui/` — Preact UI components

### Configuration
Two config layers:
- **AgentBehaviorConfig** — LLM-facing: designStrategy, visualQuality, thinkingLevel
- **AgentLoopPolicy** — Runtime control: thresholds, recovery policy, tool call modes, token budgets

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
- Tools declare `modes: AgentMode[]` to control phase availability
- `(node as any)[key] = value` is common in executor — Figma API requires runtime property assignment
- Property application order matters: `PROP_ORDER` in executor ensures layoutMode before sizing, font before characters
