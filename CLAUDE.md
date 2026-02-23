# CLAUDE.md — Figma AI Generator Plugin

Figma plugin that uses an agentic AI loop (Gemini Flash) to generate UI designs from natural language prompts.

## Architecture

### Entry Flow
```
AgentOrchestrator.generate(prompt)     // src/engine/services/AgentOrchestrator.ts
  → new AgentRuntime(options)          // src/engine/agent/agentRuntime.ts
    → agent.run(prompt)                // Main loop: iterates until complete_task or maxIterations
```

### Agent State Machine (4 phases)
```
PLANNING ──→ EXECUTION ──→ VERIFICATION ──→ complete_task (exit)
                 │                │
                 └── RECOVERY ────┘
```

Phase is **recalculated each iteration** from `planState` + failure counters (implicit state machine, not a transition table).

### Execution Flow (single iteration)
1. **Mode determination** — reads planState, auto-activates pending steps, checks recovery thresholds
2. **System prompt hot-swap** — rebuilds and replaces system message every iteration via `composeAgentSystemPrompt()`
3. **LLM generation** — streams response with tool mode (ANY/AUTO) based on phase and failure count
4. **Tool execution** — workflow tools handled inline; Figma tools dispatched via IpcBridge
5. **Loop detection** — signature fingerprinting, identical/monotone/planning loop checks
6. **Post-processing** — operation log, context compression, recovery entry/exit

### Plugin Architecture (3 threads)
- **UI thread** (Preact) — Chat interface, settings
- **Sandbox** (iframe) — Agent runtime, LLM calls, tool orchestration
- **Main thread** (Figma API) — Node creation/modification, rendering

Communication: IPC via `@create-figma-plugin/utilities` emit/on pattern.

## Key Files

### Agent Core
| File | Purpose |
|------|---------|
| `src/engine/agent/agentRuntime.ts` | Main agent loop, state machine, tool execution (~1500 lines) |
| `src/engine/agent/agentLoopPolicy.ts` | Phase transitions, recovery rules, thresholds |
| `src/engine/agent/agentBehaviorConfig.ts` | LLM-facing knobs: designStrategy, visualQuality, thinkingLevel |
| `src/engine/agent/planState.ts` | Singleton: plan steps, active task, todos |
| `src/engine/agent/loopDetector.ts` | Extracted loop detection (signature fingerprinting) |
| `src/engine/agent/constants.ts` | Iteration limits, timeouts, detection thresholds |
| `src/engine/agent/ipcBridge.ts` | RPC bridge to main thread for Figma tool execution |
| `src/engine/services/AgentOrchestrator.ts` | Thin entry point: creates runtime with provider + tools |

### Tools (~21 tools, 3 generations)
| File | Tools |
|------|-------|
| `src/engine/agent/tools/index.ts` | Tool registry + mode-based filtering |
| `src/engine/agent/tools/types.ts` | ToolDefinition, AgentMode, ToolExecutor types |
| `src/engine/agent/tools/designSuperTools.ts` | batchOperations, applyDesignPatch (super tools) |
| `src/engine/agent/tools/stateTools.ts` | renderSubtree, patchNode (state-driven) |
| `src/engine/agent/tools/generateDesignTool.ts` | generateDesign (one-shot component tree) |
| `src/engine/agent/tools/legacy/atomicTools.ts` | createNode, setNodeLayout, setNodeStyles, updateNodeProperties |
| `src/engine/agent/tools/knowledgeTools.ts` | searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules |
| `src/engine/agent/tools/workflowTools.ts` | new_task, update_todo_list, summarize_progress, complete_task |
| `src/engine/agent/tools/planningTools.ts` | planDesign |
| `src/engine/agent/tools/inspectTool.ts` | inspectDesign |
| `src/engine/agent/tools/validationTools.ts` | validateLayout |
| `src/engine/agent/tools/iconTools.ts` | createIcon |
| `src/engine/agent/tools/nodeTools.ts` | deleteNode |
| `src/engine/agent/tools/projectUITools.ts` | Dynamic project-specific tools |

Each tool declares its `modes: AgentMode[]` — which phases it's available in (PLANNING, EXECUTION, VERIFICATION, RECOVERY).

### Prompt System
| File | Purpose |
|------|---------|
| `src/engine/llm-client/context/promptComposer.ts` | Main prompt composer: liquid token budgeting, AGENT_SECTION_REGISTRY |
| `src/engine/agent/agentPrompts.ts` | AGENT_IDENTITY, DYNAMIC_GUIDANCE, naming/content rules |
| `src/engine/prompt/promptRegistry.ts` | SCHEMA_RULES, DESIGN_AESTHETICS, TOOL_EXAMPLES |
| `src/engine/agent/context/contextManager.ts` | Message history, token estimation, compression |
| `src/engine/agent/context/tokenEstimator.ts` | Token counting heuristics |
| `src/engine/agent/context/toolResultCleaner.ts` | Per-tool result truncation |

### Skill System
| File | Purpose |
|------|---------|
| `src/engine/agent/skills/SkillRegistry.ts` | Singleton registry: register, activate, buildPromptSections |
| `src/engine/agent/skills/` | Skill initialization and loader |
| `.agent/skills/*/SKILL.md` | Skill definitions (6 skills: figma-core, figma-sandbox, knowledge, project-ui, workflow, figma-to-code) |
| `src/engine/llm-client/knowledge/knowledgeHub.ts` | BM25 (MiniSearch) search across 10 knowledge domains |

Skills use regex `triggerPatterns` for activation + BM25 search for knowledge retrieval (not RAG).

### Render Pipeline
| File | Purpose |
|------|---------|
| `src/engine/pipeline/RenderOrchestrator.ts` | DSL → Figma SceneNode rendering (warmup, normalize, position) |
| `src/ipc/handlers/batchExecutor.ts` | Batch ops with dependency tracking, virtual ID resolution, rollback |

## Configuration

Two config layers:
- **AgentBehaviorConfig** (`agentBehaviorConfig.ts`): LLM-facing — designStrategy (`create`/`refine`), visualQuality, thinkingLevel, enableEffects
- **AgentLoopPolicy** (`agentLoopPolicy.ts`): Runtime control — staleStepThreshold (15), monotoneLoopThreshold (8), recovery policy, tool call modes, token budgets

`inferBehavior()` auto-detects edit intent from selection + prompt keywords.

## Known Architecture Issues

1. **God Object**: `agentRuntime.ts` (~1500 lines) mixes loop control, prompt composition, tool execution, recovery, and auto-batching
2. **O(n^2) token consumption**: Sequential node creation rebuilds prompt each iteration; one-shot infra exists but LLM often falls back to single-tool patterns
3. **Dual prompt registries**: `agentPrompts.ts` and `promptRegistry.ts` both define identity/rules with some overlap
4. **System prompt rebuilt every iteration**: Defeats prefix caching, mutates message array directly

## Development

- **Test framework**: vitest (NOT jest)
- **Build**: `node build.js` (custom esbuild)
- **Type check**: `npx tsc --noEmit`
- **Run tests**: `npx vitest run`
- **Lint**: `npx eslint "src/**/*.{ts,tsx}"`
- **Skill system**: `USE_SKILL_SYSTEM = true` by default in `AgentLoopPolicy`
- **LLM providers**: Gemini Flash (primary), OpenRouter (alternative)
- **UI framework**: Preact with `@create-figma-plugin/ui`
