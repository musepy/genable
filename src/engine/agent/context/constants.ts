/**
 * @file constants.ts
 * @description Centralized constants for context management.
 *
 * Context limits are parameterized via ContextProfile.
 * The active profile is selected based on model capabilities —
 * strong models get relaxed limits, weaker models keep tight budgets.
 */

// ---------------------------------------------------------------------------
// Context Profile — model-capability-driven limits
// ---------------------------------------------------------------------------

export interface ContextProfile {
  /** Maximum chars for standard tool result data before truncation */
  toolResultMaxDataChars: number;

  /** Char threshold for auto-degrading inspect full → structural + hint */
  readAutoDegradeChars: number;

  /** Max chars for a single tool call's args when stored in history */
  maxHistoryArgsChars: number;

  /** Max chars for user request in summary (0 = no truncation) */
  summaryUserRequestChars: number;

  /** Max chars for agent response in summary (0 = no truncation) */
  summaryAgentResponseChars: number;

  /** Max chars for the rolling summary. Oldest turns are dropped when exceeded. 0 = no cap. */
  summaryMaxChars: number;
}

/**
 * Tight profile — for models with small effective context or weak attention.
 * Aggressive truncation to stay within ~12K effective tokens.
 */
export const TIGHT_PROFILE: ContextProfile = {
  toolResultMaxDataChars: 3000,
  readAutoDegradeChars: 2500,
  maxHistoryArgsChars: 1500,
  summaryUserRequestChars: 120,
  summaryAgentResponseChars: 150,
  summaryMaxChars: 2000,
};

/**
 * Relaxed profile — for models with large context windows and strong attention.
 * Minimal truncation; lets the model see full tool results and history.
 */
export const RELAXED_PROFILE: ContextProfile = {
  toolResultMaxDataChars: 30000,
  readAutoDegradeChars: 25000,
  maxHistoryArgsChars: 15000,
  summaryUserRequestChars: 500,
  summaryAgentResponseChars: 500,
  summaryMaxChars: 8000,
};

// ---------------------------------------------------------------------------
// Derive profile from context window — replaces regex-based model guessing
// ---------------------------------------------------------------------------

/**
 * Derive a ContextProfile from the model's declared context window.
 * Replaces the old regex-based heuristic (e.g. `/pro|kimi|k2/i.test(modelName)`).
 *
 * Threshold: 100K tokens → RELAXED, else TIGHT.
 * The actual compression trigger is in AgentRuntime (lazy, budget-based),
 * so this profile mainly controls per-message truncation limits.
 */
export function deriveContextProfile(contextWindowTokens: number): ContextProfile {
  return contextWindowTokens >= 100_000 ? RELAXED_PROFILE : TIGHT_PROFILE;
}

// ---------------------------------------------------------------------------
// Active profile — selected at runtime, defaults to tight (backward compat)
// ---------------------------------------------------------------------------

let activeProfile: ContextProfile = TIGHT_PROFILE;

export function setContextProfile(profile: ContextProfile): void {
  activeProfile = profile;
}

export function getContextProfile(): ContextProfile {
  return activeProfile;
}

// ---------------------------------------------------------------------------
// Legacy export — reads from active profile for backward compatibility
// ---------------------------------------------------------------------------

export const CONTEXT_CONSTANTS = {
  get TOOL_RESULT_MAX_DATA_CHARS() { return activeProfile.toolResultMaxDataChars; },
  get READ_AUTO_DEGRADE_CHARS() { return activeProfile.readAutoDegradeChars; },
  get MAX_HISTORY_ARGS_CHARS() { return activeProfile.maxHistoryArgsChars; },
} as const;
