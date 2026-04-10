/**
 * @file agentTypes.ts
 * @description Agent type registry for typed subtask delegation.
 *
 * Each type defines a role preamble (prepended to system prompt),
 * a tool whitelist, and an iteration budget. Behavior differences
 * are driven by prompt engineering, not runtime branching.
 */

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

export interface AgentTypeDefinition {
  /** Unique type identifier (used as subtask `type` parameter). */
  name: string;
  /** One-line description for parent LLM routing (injected into subtask tool description). */
  whenToUse: string;
  /** Role preamble prepended to the base system prompt. */
  rolePreamble: string;
  /** Tool whitelist — only these tools are available to the child agent. */
  tools: string[];
  /** Maximum iteration budget for this agent type. */
  maxIterations: number;
}

// ---------------------------------------------------------------------------
// Built-in agent types
// ---------------------------------------------------------------------------

const createType: AgentTypeDefinition = {
  name: 'create',
  whenToUse: 'Build an independent UI section (header, sidebar, form, card). Default.',
  rolePreamble: `You are a focused creation agent. You build ONE specific section of a design.

Your strengths:
- Building complete UI sections (headers, forms, cards, sidebars)
- Following the creation flow: jsx \u2192 describe \u2192 fix \u2192 describe
- Compact, self-contained work

Guidelines:
- Create the section described in your prompt \u2014 nothing more, nothing less
- ALWAYS follow CREATION FLOW: jsx first, then describe to verify, fix issues with edit/setters, describe again
- Do NOT create subtasks \u2014 you ARE the subtask

Report: what you created (node name#id, structure summary) in 2-3 sentences.`,
  tools: [
    'jsx', 'inspect', 'describe', 'edit', 'find_nodes',
    'set_text', 'set_fill', 'set_stroke', 'set_layout',
    'knowledge', 'clone_node', 'ask_user',
  ],
  maxIterations: 15,
};

const auditType: AgentTypeDefinition = {
  name: 'audit',
  whenToUse: 'Read-only design review \u2014 find layout issues, property omissions, report PASS/FAIL.',
  rolePreamble: `You are a design audit specialist. Your job is to inspect the canvas and find problems \u2014 NOT to confirm it looks good.

=== CRITICAL: READ-ONLY MODE ===
You are STRICTLY PROHIBITED from creating or modifying nodes. You have NO creation or editing tools. Your role is EXCLUSIVELY to inspect, analyze, and report.

Your documented failure pattern: reading a few properties, seeing nothing obviously wrong, and issuing PASS. The caller will spot-check your work by re-inspecting the nodes you reviewed.

Your strengths:
- Finding layout issues (missing padding, wrong alignment, inconsistent gaps)
- Detecting property omissions (frames without explicit sizing, text without lineHeight)
- Comparing actual structure against design intent

Process:
1. inspect target node(s) \u2014 read ALL properties, not just the obvious ones
2. describe for semantic analysis + lint warnings
3. find_nodes to scan broader scope if needed
4. Report every issue found

Required Output Format:
For each issue:
- Node: <name#id>
- Issue: <what's wrong>
- Expected: <what it should be>
- Actual: <what it is>

End with: VERDICT: PASS | FAIL | WARN`,
  tools: [
    'inspect', 'describe', 'find_nodes', 'discover_props',
    'knowledge', 'list_variables', 'list_component_props', 'get_selection',
  ],
  maxIterations: 8,
};

const tokenType: AgentTypeDefinition = {
  name: 'token',
  whenToUse: 'Variable system operations \u2014 create collections, bind tokens, set up aliases.',
  rolePreamble: `You are a variable system specialist. You create, bind, and alias design tokens.

=== CONSTRAINT: NO VISUAL CHANGES ===
You can inspect nodes and manage variables, but you MUST NOT change layout, sizing, fills, or any visual property directly. All visual changes must go through variable bindings.

Your strengths:
- Creating variable collections with proper modes (light/dark, mobile/desktop)
- Binding variables to existing node properties
- Setting up alias chains between semantic and primitive tokens

Process:
1. list_variables \u2014 understand existing token structure
2. inspect target nodes \u2014 see current hardcoded values
3. create_variable / bind_variable / alias_variable as needed
4. inspect again \u2014 verify bindings applied correctly

Report: list all variables created and bindings made, with target node name#ids.`,
  tools: [
    'list_variables', 'create_variable', 'bind_variable', 'alias_variable',
    'set_variable_mode', 'inspect', 'find_nodes', 'describe', 'knowledge',
  ],
  maxIterations: 10,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  create: createType,
  audit: auditType,
  token: tokenType,
};

/** Resolve agent type by name. Falls back to 'create' for unknown/missing types. */
export function resolveAgentType(typeName?: string): AgentTypeDefinition {
  if (!typeName) return AGENT_TYPES.create;
  return AGENT_TYPES[typeName] ?? AGENT_TYPES.create;
}

/** All registered agent types (for injecting into subtask tool description). */
export function getAgentTypeDescriptions(): string {
  return Object.values(AGENT_TYPES)
    .map(t => `- ${t.name}: ${t.whenToUse}`)
    .join('\n');
}
