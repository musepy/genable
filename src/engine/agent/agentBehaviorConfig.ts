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
 * - Runtime constants (max iterations, thresholds) are in constants.ts
 * - Feature flags (postprocessor rules, architecture toggles) are in constants/featureFlags.ts
 * - 4 unified tools: read, create, edit, query
 * - Node types limited to: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, ICON (no IMAGE/COMPONENT)
 * - Colors: hex only (#RRGGBB or #RRGGBBAA for effects)
 */

import { ThinkingLevel } from '../llm-client/config';

// ============================================================
// AGENT BEHAVIOR CONFIGURATION
// ============================================================

export interface AgentBehaviorConfig {
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
   * Maximum agent loop iterations (overrides AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_ITERATIONS).
   */
  maxIterations: number;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  thinkingLevel: 'minimal',
  promptPolicy: {
    useSkillSystem: true,
  },
  maxIterations: 40,
};

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
