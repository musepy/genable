/**
 * @file promptRegistry.ts
 * @description Single source of truth for ALL prompt fragments used across the system.
 *
 * WHY THIS FILE EXISTS:
 * Prompt definitions were previously scattered across 7+ files, leading to:
 * - 4 conflicting identity definitions
 * - Duplicate / inconsistent examples
 * - Stale aliases that no longer match code behavior
 *
 * RULES FOR CONTRIBUTORS:
 * 1. ALL prompt text that the LLM sees MUST be defined here (or re-exported from here).
 * 2. Consumers import from this file. Never hard-code prompt text elsewhere.
 * 3. Each fragment has a unique `id` for traceability.
 */

import catalog from '../../generated/prompt-catalog.json';

// ============================================================
// IDENTITY — Single unified agent identity
// ============================================================

export const IDENTITY = catalog.IDENTITY;

// ============================================================
// PROTOCOLS — Thinking, execution, and error recovery
// ============================================================

export const THINKING_PROTOCOL = catalog.THINKING_PROTOCOL;
export const ERROR_RECOVERY = catalog.PROTOCOLS_ERROR_RECOVERY;
export const TOOL_CALLING_PROTOCOL = catalog.PROTOCOLS_TOOL_CALLING;

// ============================================================
// DESIGN GENERATION — generateDesign & batchOperations guidance
// ============================================================

export const DESIGN_GENERATION_PROTOCOL = catalog.PROTOCOLS_DESIGN_GENERATION;

// ============================================================
// MODE GUIDANCE — Planning / Execution / Verification
// ============================================================

export const MODE_GUIDANCE = catalog.MODE_GUIDANCE;

// ============================================================
// CONVENTIONS — Naming, content, parent-child rules
// ============================================================

export const NAMING_CONVENTION = catalog.CONVENTIONS_NAMING;
export const CONTENT_REQUIREMENT = catalog.CONVENTIONS_CONTENT;
export const PARENT_CHILD_RULE = catalog.CONVENTIONS_PARENT_CHILD;
export const DESIGN_FREEDOM = catalog.CONVENTIONS_DESIGN_FREEDOM;

// ============================================================
// AESTHETICS — Design persona for visual quality
// ============================================================

export const DESIGN_AESTHETICS = catalog.DESIGN_AESTHETICS;

// ============================================================
// ICONS — Semantic naming strategy
// ============================================================

export const ICON_USAGE = catalog.CONVENTIONS_ICON_USAGE;

// ============================================================
// SCENE GRAPH — Mental model for tree structure and layout constraints
// ============================================================

export const SCENE_GRAPH_MODEL = catalog.SCENE_GRAPH_MODEL;

// ============================================================
// SCHEMA RULES — Output format constraints (replaces stale JSON_FORMAT_RULES)
// ============================================================

export const SCHEMA_RULES = catalog.SCHEMA_RULES;

// ============================================================
// EXAMPLES — Unified example set
// ============================================================

export const TOOL_EXAMPLES = catalog.EXAMPLES;

// ============================================================
// SECTION HEADERS — Structured section delimiters
// ============================================================

export const PROMPT_HEADERS = {
    IDENTITY: '==== SYSTEM IDENTITY ====',
    TOOLS: '==== AVAILABLE TOOLS ====',
    CONSTRAINTS: '==== OUTPUT CONSTRAINTS ====',
    CONTEXT: '==== DESIGN CONTEXT ====',
    SELECTION: '==== CURRENT SELECTION ====',
};

// ============================================================
// LINEAR PIPELINE SECTIONS — Used by sectionRegistry for non-agent mode
// ============================================================

export const LINEAR_ROLE_TEMPLATE = `You are an expert Figma UI designer. Your task is to generate production-ready, responsive Figma designs.

{{{formatRules}}}

### MODE: {{#if isModifyMode}}MODIFY EXISTING{{else}}CREATE NEW{{/if}} DESIGN
- Output nodes in a logical order (Parent before its children).
- Return ONLY the valid JSON array.`;

export const LINEAR_CONSTRAINT_TEMPLATE = `
### OUTPUT CONSTRAINTS
1. **Adjacency List Strategy**: ALWAYS output a flat array.
2. **Flexible Values**: You may use direct hex codes (#RRGGBB) or design system tokens (e.g. "$primary") if provided. 
3. **Sizing**: Use "layoutSizingHorizontal" and "layoutSizingVertical".
4. **Format**: Return ONLY a valid JSON array. No markdown code blocks.`;

// ============================================================
// RE-EXPORTS — Backward-compatible aliases for existing consumers
// ============================================================

// agentPrompts.ts consumers
export {
  IDENTITY as AGENT_IDENTITY,
  THINKING_PROTOCOL as AGENT_THINKING_PROTOCOL,
  MODE_GUIDANCE as DYNAMIC_GUIDANCE,
  NAMING_CONVENTION as AGENT_NAMING_CONVENTION,
  CONTENT_REQUIREMENT as AGENT_CONTENT_REQUIREMENT,
  PARENT_CHILD_RULE as AGENT_PARENT_CHILD_RULE,
  DESIGN_FREEDOM as AGENT_DESIGN_FREEDOM,
  DESIGN_GENERATION_PROTOCOL as DEEP_NODE_PROCESSING_PROTOCOL,
};

// constants/prompts.ts consumers
export {
  ICON_USAGE as ICON_SEMANTIC_TEMPLATE,
  DESIGN_AESTHETICS as DESIGN_AGENT_PERSONA_TEMPLATE,
  SCHEMA_RULES as JSON_FORMAT_RULES,
};
