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
 *
 * CATALOG KEY ORGANIZATION (semantic sections):
 * - IDENTITY / THINKING_PROTOCOL / CONVENTIONS_DESIGN_FREEDOM → "Who am I?"
 * - FIGMA_MENTAL_MODEL → "How does the Figma scene graph work?"
 * - DESIGN_RULES → "What are the sizing/spacing/typography/color rules?"
 * - WORKFLOW → "How do I use tools to complete tasks?"
 * - ERROR_HANDLING → "What do I do when things go wrong?"
 * - MODE_GUIDANCE → "What should I do in the current phase?"
 * - EXAMPLES → "Show me how it's done"
 */

import catalog from '../../generated/prompt-catalog.json';

// ============================================================
// IDENTITY — Agent identity, thinking protocol, design freedom
// ============================================================

export const IDENTITY = catalog.IDENTITY;
export const THINKING_PROTOCOL = catalog.THINKING_PROTOCOL;
export const DESIGN_FREEDOM = catalog.CONVENTIONS_DESIGN_FREEDOM;

// ============================================================
// FIGMA MENTAL MODEL — Scene graph structure and layout constraints
// ============================================================

export const FIGMA_MENTAL_MODEL = (catalog as any).SCENE_GRAPH_MODEL;

// ============================================================
// DESIGN RULES — Sizing, typography, color, spacing, naming, content, icons
// (Merged from: DESIGN_AESTHETICS, Iron Laws, CONVENTIONS_NAMING,
//  CONVENTIONS_CONTENT, CONVENTIONS_ICON_USAGE, root sizing rules)
// ============================================================

export const DESIGN_RULES = [
  (catalog as any).DESIGN_AESTHETICS,
  (catalog as any).CONVENTIONS_NAMING,
  (catalog as any).CONVENTIONS_CONTENT,
  (catalog as any).CONVENTIONS_ICON_USAGE
].filter(Boolean).join('\n\n');

// ============================================================
// WORKFLOW — Tool calling, one-shot creation, modification, verification
// (Merged from: PROTOCOLS_TOOL_CALLING, CONVENTIONS_PARENT_CHILD,
//  PROTOCOLS_DESIGN_GENERATION batch/mod rules, figma-core one-shot)
// ============================================================

export const WORKFLOW = [
  (catalog as any).PROTOCOLS_TOOL_CALLING,
  (catalog as any).CONVENTIONS_PARENT_CHILD,
  (catalog as any).PROTOCOLS_DESIGN_GENERATION
].filter(Boolean).join('\n\n');

// ============================================================
// ERROR HANDLING — Error recovery and warning handling
// ============================================================

export const ERROR_HANDLING = (catalog as any).PROTOCOLS_ERROR_RECOVERY;

// ============================================================
// MODE GUIDANCE — Planning / Execution / Verification / Recovery
// ============================================================

export const MODE_GUIDANCE = catalog.MODE_GUIDANCE;

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
// BACKWARD-COMPATIBLE ALIASES
// These exist solely to avoid breaking existing consumers.
// New code should import the primary exports above.
// ============================================================

// Renamed keys
export const SCENE_GRAPH_MODEL = FIGMA_MENTAL_MODEL;
export const ERROR_RECOVERY = ERROR_HANDLING;

// Merged into DESIGN_RULES (content now lives in the unified section)
export const DESIGN_AESTHETICS = DESIGN_RULES;
export const NAMING_CONVENTION = '';
export const CONTENT_REQUIREMENT = '';
export const ICON_USAGE = '';

// Merged into WORKFLOW
export const TOOL_CALLING_PROTOCOL = WORKFLOW;

// ============================================================
// RE-EXPORTS — Aliases for existing consumers
// ============================================================

// agentPrompts.ts consumers
export {
  IDENTITY as AGENT_IDENTITY,
  THINKING_PROTOCOL as AGENT_THINKING_PROTOCOL,
  DESIGN_FREEDOM as AGENT_DESIGN_FREEDOM,
};

// constants/prompts.ts and sectionRegistry.ts consumers
export {
  ICON_USAGE as ICON_SEMANTIC_TEMPLATE,
  DESIGN_AESTHETICS as DESIGN_AGENT_PERSONA_TEMPLATE,
};
