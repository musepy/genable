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
 *
 * HISTORICAL NOTE — variable resolution mode (May 2026):
 * This config used to expose a `variableResolution` field with two values
 * ('mode-coverage' / 'strict') controlling the variable resolver. Strict
 * mode rejected bare-name `"$Token"` strings at the tool boundary in favor
 * of structured `{variable_id}` object input. The May 2026 cutover (commits
 * a13ab4a / 05774dc) flipped the default to strict and broke immediately:
 * string-mode LLM providers stringified the structured object form taught
 * in setter descriptions, producing silent-black fills (weather widget E2E
 * generated 36 silent black fills). The cutover was reverted (56aefe6),
 * SYSTEM.md was realigned (a916d95), and the RYOW autopick tie-break
 * landed (2b85730). After all that, the strict enum value had zero callers
 * and was removed entirely. Object-form parsing in strictResolver.ts is
 * preserved as a parallel input shape for callers that pass real objects,
 * but the LLM is only taught the bare-name string form.
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
   * Maximum agent loop iterations (overrides AGENT_RUNTIME_CONSTANTS.DEFAULT_MAX_ITERATIONS).
   */
  maxIterations: number;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  thinkingLevel: 'high',
  maxIterations: 80,
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
  };
}
