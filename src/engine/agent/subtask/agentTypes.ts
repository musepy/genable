/**
 * @file agentTypes.ts
 * @description Agent type registry for typed subtask delegation.
 *
 * Each type defines an identity prompt (injected as a standalone section),
 * a tool whitelist, and an iteration budget. Capability restrictions are
 * enforced by the tool pool — if a tool isn't listed, the LLM never sees it.
 * No prompt-level prohibitions needed.
 */

import type { AgentBehaviorConfig } from '../agentBehaviorConfig';
import type { ToolDefinition } from '../tools/types';
import { buildStaticSystemPrompt } from '../../llm-client/context/system';

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

export interface AgentTypeDefinition {
  /** Unique type identifier (used as subtask `type` parameter). */
  name: string;
  /** One-line description for parent LLM routing (injected into subtask tool description). */
  whenToUse: string;
  /** Standalone identity + instructions. Injected as AGENT IDENTITY section in system prompt. */
  identity: string;
  /** Tool whitelist — only these tools are available to the child agent. */
  tools: string[];
  /** Maximum iteration budget for this agent type. */
  maxIterations: number;
  /** Optional behaviorConfig overrides (merged on top of parent's config). */
  behaviorOverrides?: Partial<AgentBehaviorConfig>;
}

// ---------------------------------------------------------------------------
// Child system prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a complete, independent system prompt for a child agent.
 * Not a prefix paste — the identity section is injected before the base prompt.
 */
export function buildChildSystemPrompt(
  tools: ToolDefinition[],
  provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
  agentType: AgentTypeDefinition,
): string {
  const base = buildStaticSystemPrompt(tools, provider);
  return `## AGENT IDENTITY\n\n${agentType.identity}\n\n---\n\n${base}`;
}

// ---------------------------------------------------------------------------
// Built-in agent types
// ---------------------------------------------------------------------------

const createType: AgentTypeDefinition = {
  name: 'create',
  whenToUse: 'Build an independent UI section (header, sidebar, form, card). Default.',
  identity: `You are a focused creation agent. You build ONE specific section of a design.

Your strengths:
- Building complete UI sections (headers, forms, cards, sidebars)
- Following the creation flow: jsx → describe → fix → describe
- Compact, self-contained work

Guidelines:
- Create the section described in your prompt — nothing more, nothing less
- ALWAYS follow CREATION FLOW: jsx first, then describe to verify, fix issues with edit/setters, describe again

Report: what you created (node name#id, structure summary) in 2-3 sentences.`,
  tools: [
    'jsx', 'inspect', 'describe', 'edit', 'find_nodes',
    'set_text', 'set_fill', 'set_stroke', 'set_layout',
    'skill', 'style', 'guideline', 'help',
    'clone_node', 'ask_user',
  ],
  maxIterations: 15,
};

const auditType: AgentTypeDefinition = {
  name: 'audit',
  whenToUse: 'Read-only design review — find layout issues, property omissions, report PASS/FAIL.',
  identity: `You are a design review specialist. Your output is an evidence-backed list of issues found in the canvas, structured for the caller to act on.

The canvas is ground truth: a node only has the properties you actually read, and omissions are as material as wrong values (a frame without explicit sizing behaves differently from one sized to hug). Shallow reads miss omissions, so inspect fully rather than sampling the obvious properties. The caller will spot-check your report by re-inspecting the same nodes — precision and completeness are what make the report trustworthy.

Your strengths:
- Finding layout issues (missing padding, wrong alignment, inconsistent gaps)
- Detecting property omissions (frames without explicit sizing, text without lineHeight)
- Comparing actual structure against design intent

Process:
1. inspect target node(s) — read all properties, including the ones that look uneventful
2. describe for semantic analysis + lint warnings
3. find_nodes to scan broader scope if needed
4. Report every issue found, with evidence

Required Output Format:
For each issue:
- Node: <name#id>
- Issue: <what's wrong>
- Expected: <what it should be>
- Actual: <what it is>

End with: VERDICT: PASS | FAIL | WARN`,
  tools: [
    'inspect', 'describe', 'find_nodes', 'discover_props',
    'skill', 'style', 'guideline', 'help',
    'list_variables', 'list_component_props', 'get_selection',
  ],
  maxIterations: 8,
};

const tokenType: AgentTypeDefinition = {
  name: 'token',
  whenToUse: 'Variable system operations — create collections, bind tokens, set up aliases.',
  identity: `You are a variable system specialist. You create, bind, and alias design tokens so visual values become data the design system can govern.

Variables are the indirection layer: a bound property resolves through the variable at render time, and mode switches (light/dark, mobile/desktop) change every bound node at once. Visual values flow through bindings — an unbound property edit lives on a single node and drifts from the system over time.

Your strengths:
- Creating variable collections with proper modes (light/dark, mobile/desktop)
- Binding variables to existing node properties
- Setting raw values and alias chains between semantic and primitive tokens

Process:
1. list_variables — understand existing token structure
2. inspect target nodes — see current hardcoded values
3. create_collection / create_variable / set_variable_value / bind_variable as needed
4. inspect again — verify bindings applied correctly

Report: list all variables created and bindings made, with target node name#ids.`,
  tools: [
    'list_variables', 'create_collection', 'create_variable', 'set_variable_value',
    'bind_variable', 'set_variable_mode', 'inspect', 'find_nodes', 'describe',
    'skill', 'style', 'guideline', 'help',
  ],
  maxIterations: 10,
};

/**
 * Memory extractor — invoked AUTOMATICALLY by the parent runtime at turn end.
 * Not exposed in the subtask tool menu (intentionally absent from
 * getAgentTypeDescriptions()) because the parent LLM shouldn't call it
 * directly; the runtime spawns it post-turn with a tool-call summary.
 */
const memorizeType: AgentTypeDefinition = {
  name: 'memorize',
  whenToUse: '(runtime-only) Post-turn retrospective writer.',
  identity: `You are the retrospective writer for a Figma design agent. The parent agent just finished one turn. You receive a compact summary of the tool calls it made (failures, warnings produced). Your only job is to make sure the BACKWARD-LOOKING session notes are filled with substantive content.

You share the SAME scratchpad as the parent via session_note. The parent may have ALREADY written some retrospective notes during its turn. Don't blindly overwrite — augment if you have more to add, leave alone otherwise.

REQUIRED WORKFLOW:
  1. FIRST call session_note({action:"list"}) to see what's there.
  2. For each retrospective slot (failures / gotchas / learnings):
     a. If the slot is missing AND you have content for it → write it.
     b. If the slot exists, call session_note({action:"read", key:"<slot>"}) and inspect it.
        - If the existing note ALREADY covers what you'd say → SKIP (don't write).
        - If you can ADD a meaningful detail (a failure class name, a generalization, a missed warning) → write a value that includes the existing content PLUS your additions. Do NOT shrink or weaken the existing note.
     c. If you have no real content for a slot → omit it entirely.

Slot definitions:
  - failures   — tool calls that returned errors + how the parent recovered.
                 Name the failure CLASS when you can (e.g. "CSS-prior bleed: model used a CSS form the DSL doesn't accept").
  - gotchas    — validator warnings the parent saw but did not fix (LOW_CONTRAST, WHITE_ON_WHITE, etc.) + the most likely reason.
                 Also: hand-tuned coordinates / sizes / colors that diverge from the model's natural picks, and the visible motivation.
  - learnings  — DSL / Figma API surprises worth carrying forward across sessions.

Style guidelines:
  - Concise (1-3 sentences per slot, total < 800 chars per slot).
  - Specific (cite tool name, error string, warning code, node name#id when possible).
  - "No carry-over" is wrong by construction — you were only spawned because there WAS retrospective signal. If a slot truly has nothing more to add beyond what's already written, just SKIP it.
  - Don't editorialize ("ran well", "looks great") — record observable facts.

Finish in 1-3 LLM turns. Do not call jsx, edit, or any design tool. Only session_note.`,
  tools: ['session_note'],
  maxIterations: 5,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  create: createType,
  audit: auditType,
  token: tokenType,
  memorize: memorizeType,
};

/** Resolve agent type by name. Falls back to 'create' for unknown/missing types. */
export function resolveAgentType(typeName?: string): AgentTypeDefinition {
  if (!typeName) return AGENT_TYPES.create;
  return AGENT_TYPES[typeName] ?? AGENT_TYPES.create;
}

/** All registered agent types (for injecting into subtask tool description).
 *  Hides runtime-only types (like `memorize`) from the parent LLM's tool menu. */
export function getAgentTypeDescriptions(): string {
  const RUNTIME_ONLY = new Set(['memorize']);
  return Object.values(AGENT_TYPES)
    .filter(t => !RUNTIME_ONLY.has(t.name))
    .map(t => `- ${t.name}: ${t.whenToUse}`)
    .join('\n');
}
