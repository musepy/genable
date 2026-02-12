/**
 * @file agentBehaviorConfig.ts
 * @description Centralized configuration for agent behavior knobs.
 *
 * WHY THIS FILE EXISTS:
 * Agent behavior was previously controlled by hardcoded values scattered across
 * agentRuntime.ts, promptComposer.ts, and promptRegistry.ts. This made it
 * impossible to understand or adjust agent behavior without reading 5+ files.
 *
 * ALL agent behavior toggles should be defined here. Consumers import from
 * this file. Never hardcode agent behavior elsewhere.
 *
 * CURRENT TOOL & SYSTEM NOTES:
 * - Mode filtering (PLANNING/EXECUTION/VERIFICATION) is in tools/index.ts getToolsForMode()
 * - Runtime constants (max iterations, thresholds) are in constants.ts
 * - Feature flags (postprocessor rules, architecture toggles) are in constants/featureFlags.ts
 * - Dead tools: getSelection, getVariables, getStyles, getNodeDSL (replaced by inspectDesign)
 * - Node types limited to: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, ICON (no IMAGE/COMPONENT)
 * - Colors: hex only (#RRGGBB or #RRGGBBAA for effects)
 */

import { ThinkingLevel } from '../llm-client/config';

// ============================================================
// AGENT BEHAVIOR CONFIGURATION
// ============================================================

export interface AgentBehaviorConfig {
  /**
   * Design strategy: how the agent approaches the task.
   * - 'create': Generate new design from scratch (uses generateDesign)
   * - 'refine': Modify existing design incrementally (uses inspectDesign → applyDesignPatch)
   */
  designStrategy: 'create' | 'refine';

  /**
   * Visual quality level injected into the system prompt.
   * - 'fast': Structure-only, no aesthetics guidance (minimal tokens)
   * - 'standard': Basic styling guidance
   * - 'rich': Full aesthetics + effects + visual checklist (~300 extra tokens)
   */
  visualQuality: 'fast' | 'standard' | 'rich';

  /**
   * Thinking level for Gemini 3.0+ models.
   * Controls reasoning depth and token budget for thoughts.
   */
  thinkingLevel: ThinkingLevel;

  /**
   * Prompt assembly policies.
   */
  promptPolicy: {
    /** Whether to use the skill-based prompt system (True) or legacy composer (False) */
    useSkillSystem: boolean;
  };

  /**
   * Whether to encourage effects (DROP_SHADOW, INNER_SHADOW, etc.) in generateDesign output.
   * When true, the effects schema is detailed and examples include shadows.
   * When false, effects are still available but not emphasized.
   */
  enableEffects: boolean;

  /**
   * Whether to inject DESIGN_AESTHETICS into the EXECUTION mode system prompt.
   * Controls depth/shadow guidance, color strategy, typography hierarchy, visual checklist.
   */
  enableAestheticsGuidance: boolean;

  /**
   * Whether to pin the original user request so it survives context compression.
   * Prevents the agent from "forgetting" what was asked after many iterations.
   */
  enableInstructionAnchoring: boolean;

  /**
   * Maximum agent loop iterations (overrides AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_ITERATIONS).
   */
  maxIterations: number;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  designStrategy: 'create',
  visualQuality: 'rich',
  thinkingLevel: 'minimal',
  promptPolicy: {
    useSkillSystem: true,
  },
  enableEffects: true,
  enableAestheticsGuidance: true,
  enableInstructionAnchoring: true,
  maxIterations: 40,
};

// ============================================================
// INFERENCE
// ============================================================

/**
 * Infer behavior configuration from runtime context.
 * Called by AgentOrchestrator before creating the runtime.
 *
 * Heuristic: if there's a selection or the prompt contains edit-intent keywords,
 * switch to 'refine' strategy.
 */
export function inferBehavior(context: {
  hasSelection: boolean;
  userPrompt: string;
}): Partial<AgentBehaviorConfig> {
  const editPatterns = /改|调整|修改|大一|小一|换|变|更|优化|微调|move|change|update|resize|bigger|smaller|adjust|tweak|fix|refine/i;
  const isEditIntent = context.hasSelection || editPatterns.test(context.userPrompt);

  return {
    designStrategy: isEditIntent ? 'refine' : 'create',
  };
}

/**
 * Merge partial overrides into defaults.
 */
export function resolveBehavior(
  overrides?: Partial<AgentBehaviorConfig>
): AgentBehaviorConfig {
  return {
    ...DEFAULT_BEHAVIOR,
    ...overrides,
    promptPolicy: {
      ...DEFAULT_BEHAVIOR.promptPolicy,
      ...overrides?.promptPolicy,
    },
  };
}
