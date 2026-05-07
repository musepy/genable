# CLAUDE.md — Figma AI Generator

Figma plugin. Agentic AI loop generates UI from natural-language prompts. Multi-model: Gemini, Claude, Kimi K2.5, DashScope.

## Threads
UI (Preact) / Sandbox (agent runtime, LLM, tool dispatch) / Main (Figma API).
IPC via `@create-figma-plugin/utilities` emit/on.

## Agent Loop
Conversational. `run()` = one user turn. Text-only response → turn end (wait for user). No `signal(complete)` tool.
Session resets only on "New Design".

Hooks:
- `emptyResponseHook` — retry empty LLM (max 2), then abort.
- `loopDetectionHook` — fingerprint tool calls; identical 4+ → abort.

## Context (4 layers)
`staticSystemPrompt` + `summary` + `conversationHistory` + `turnMessages`.
Budget = 70% of model window. Lazy compression at turn boundary. Intra-turn tool results never compressed.

## Property Registry (SSOT)
`src/constants/figma-property-registry.ts` drives read + write + bind + facets.
Add a Figma prop: edit `tools/extract-figma-props.ts`, rerun, every consumer picks it up. Don't hand-sync.

## Configuration
- `AgentBehaviorConfig` — LLM-facing (designStrategy, visualQuality, thinkingLevel).
- `AgentLoopPolicy` — runtime control (iteration limits, loop thresholds).

## Commands
- Build: `node build.js`
- Typecheck: `npx tsc --noEmit`
- Test: `npx vitest run` (NOT jest)
- Lint: `npx eslint "src/**/*.{ts,tsx}"`
- Prompt consistency: `npm run check:prompts` (after editing `src/prompts/`, tool descriptions, skills)

## Hard Rules
- DO NOT mock `figma.*` API. Mock 通过 ≠ 真实通过.
- DO NOT mock LLM SDK for streaming. Real bugs are network / partial JSON.
- Only unit-test pure logic (no Figma/LLM dependency).
- Executor is sequential — topological sort, tempId→realId mapping, Figma single-threaded.
- Property apply order: `layoutMode` before sizing, font before `characters`.

## Conventions
- `(node as any)[key] = value` — Figma API requires runtime assignment.
- Tools declare `executionStrategy: 'parallel' | 'sequential'`.

## Pointers
- E2E: use `figma-http-bridge` or `dogfood-batch-run` skill.
- Errors: `.agent/error-catalog.md`.
- Testing: `docs/TESTING.md`.
