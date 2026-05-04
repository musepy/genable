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
 * Variable resolution mode — two-mode enum for the variable resolver.
 *
 * - 'mode-coverage' (default) — bare-name bindings still resolve via the
 *   legacy `variableBindingHandler` path (silent-pick first match), AND the
 *   write-time mode coverage check is enforced (missing modes for the
 *   target render mode → MISSING_MODE_VALUES error envelope). This is the
 *   safe everyday default.
 * - 'strict' (opt-in) — bare-name bindings (`"$Token"`) are rejected at
 *   the tool boundary with BARE_NAME_REJECTED_PHASE2; only structured
 *   `{variable_id}` / `{collection_id, name, type}` / `{color}` inputs are
 *   accepted on set_fill / set_stroke. Mode coverage check still runs.
 *
 * Historical context: this used to be a 4-value enum (`phase1` /
 * `phase2-mode-coverage` / `phase2-strict` / `auto`) tracking the May 2026
 * rollout of strict mode. The cutover (commits a13ab4a / 05774dc) flipped
 * the default to `phase2-strict` and broke catastrophically — string-mode
 * providers stringified the structured `{variable_id}` object form taught
 * in setter descriptions, causing silent-black fills. The cutover was
 * reverted (commit 56aefe6) and the dead `phase1` / `auto` values were
 * removed; what remained collapsed to the two booleans the enum was
 * always encoding (`bare-name rejection on/off`).
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §5.4 / §9.
 */
export type VariableResolutionMode = 'mode-coverage' | 'strict';

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
   * Variable-resolver mode. See VariableResolutionMode.
   * Default: 'mode-coverage' — bare-name binding still works (legacy
   * silent-pick path), with mode-coverage validation enforced at the tool
   * boundary. 'strict' remains an opt-in pending real strict-mode E2E
   * validation (the May 2026 cutover attempt produced a silent-black fill
   * regression because string-mode providers stringified the structured
   * `{variable_id}` object form taught in setter descriptions — see commits
   * a13ab4a / 05774dc and the May 2026 revert in 56aefe6).
   */
  variableResolution: VariableResolutionMode;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_BEHAVIOR: AgentBehaviorConfig = {
  thinkingLevel: 'minimal',
  maxIterations: 80,
  variableResolution: 'mode-coverage',
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
