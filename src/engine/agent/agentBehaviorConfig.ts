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

/**
 * Variable resolution mode — Phase 2 step 4 + 7 of the variable resolver
 * redesign (docs/knowledge/variable-resolver-design-2026-05.md §5.4 / §9).
 *
 * - 'phase1'                — pre-step-4 behavior. Bare-name binding still
 *   silently picks first match; mode coverage check is SKIPPED. This is the
 *   emergency-rollback escape valve.
 * - 'phase2-mode-coverage'  — step 4 active. Bare-name silent-pick still
 *   occurs (Phase 1 warn_pick_record), but mode coverage validation now
 *   blocks bindings with missing modes and emits MISSING_MODE_VALUES.
 * - 'phase2-strict'         — full Phase 2 (steps 5+6 cutover). Bare-name
 *   bindings rejected at the tool boundary. Not yet wired — gated on §5.2
 *   advance condition.
 * - 'auto'                  — self-managed via rollback metrics. Reserved
 *   for Phase 3 of the rollout; behaves as 'phase2-mode-coverage' until
 *   the auto-rollback path lands.
 */
export type VariableResolutionMode =
  | 'phase1'
  | 'phase2-mode-coverage'
  | 'phase2-strict'
  | 'auto';

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

  /**
   * Variable-resolver phase. See VariableResolutionMode.
   * Default: 'phase2-mode-coverage' — bare-name binding still works (Phase 1
   * warn_pick_record), with mode-coverage validation enforced at the tool
   * boundary. 'phase2-strict' remains an opt-in pending a real strict-mode
   * E2E validation cycle (the May 2026 cutover attempt produced a silent-
   * black fill regression because string-mode providers stringified the
   * structured `{variable_id}` object form taught in setter descriptions —
   * see commits a13ab4a / 05774dc and the May 2026 revert).
   */
  variableResolution: VariableResolutionMode;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  thinkingLevel: 'minimal',
  maxIterations: 80,
  variableResolution: 'phase2-mode-coverage',
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
