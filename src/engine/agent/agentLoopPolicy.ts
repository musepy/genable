/**
 * @file agentLoopPolicy.ts
 * @description Unified control-loop policy for AgentRuntime.
 *
 * WHY THIS FILE EXISTS:
 * Runtime loop behavior was spread across AgentRuntime, constants, and
 * orchestrator-local switches. This file consolidates decision policy for:
 * - phase transitions (including RECOVERY)
 * - tool calling mode selection (AUTO/ANY)
 * - output token budgets per phase
 * - loop/failure thresholds
 */

import { AGENT_RUNTIME_CONSTANTS } from './constants';
import { AgentMode } from './tools/types';

export type ToolCallMode = 'AUTO' | 'ANY' | 'NONE';

export interface RecoveryPolicy {
  enabled: boolean;
  /**
   * Enter RECOVERY mode after this many consecutive all-failure iterations.
   */
  entryFailureThreshold: number;
  /**
   * Maximum consecutive iterations to stay in RECOVERY before forcing progress.
   */
  maxIterations: number;
  /**
   * Read/diagnostic tool names expected in RECOVERY.
   */
  preferredTools: string[];
  /**
   * RECOVERY should allow reasoning, so default is AUTO.
   */
  toolMode: ToolCallMode;
  /**
   * Token cap for RECOVERY phase responses.
   */
  maxOutputTokens: number;
  /**
   * Maximum total times RECOVERY mode can be entered per run.
   * Prevents Recovery ↔ Execution oscillation that wastes iterations.
   */
  maxTotalCycles: number;
  /**
   * After the first recovery cycle, raise the entry threshold to this value.
   * Makes re-entry harder, giving EXECUTION more room to self-correct.
   */
  escalatedFailureThreshold: number;
}

export interface AgentLoopPolicy {
  staleStepThreshold: number;
  monotoneLoopThreshold: number;
  anyModeNoToolRetryLimit: number;
  anyToAutoFailureThreshold: number;
  planningRamblingMultiplier: number;
  executionMaxOutputTokens: number;
  verificationMaxOutputTokens: number;
  promptBudgetTokens: number;
  useSkillSystem: boolean;
  recovery: RecoveryPolicy;
  /**
   * Max iterations VERIFICATION mode can spend fixing constraint violations
   * before forcing completion. Prevents infinite fix loops.
   */
  verificationFixLimit: number;
}

export const DEFAULT_AGENT_LOOP_POLICY: AgentLoopPolicy = {
  staleStepThreshold: 15,
  monotoneLoopThreshold: 8,
  anyModeNoToolRetryLimit: 2,
  anyToAutoFailureThreshold: 2,
  planningRamblingMultiplier: 4,
  executionMaxOutputTokens: 16384,
  verificationMaxOutputTokens: 16384,
  promptBudgetTokens: 8000,
  useSkillSystem: true,
  verificationFixLimit: 5,
  recovery: {
    enabled: true,
    entryFailureThreshold: AGENT_RUNTIME_CONSTANTS.CONSECUTIVE_FAILURE_THRESHOLD,
    maxIterations: 3,
    preferredTools: ['inspectDesign', 'validateLayout'],
    toolMode: 'AUTO',
    maxOutputTokens: 4096,
    maxTotalCycles: 2,
    escalatedFailureThreshold: 5,
  },
};

export function resolveAgentLoopPolicy(overrides?: Partial<AgentLoopPolicy>): AgentLoopPolicy {
  return {
    ...DEFAULT_AGENT_LOOP_POLICY,
    ...overrides,
    recovery: {
      ...DEFAULT_AGENT_LOOP_POLICY.recovery,
      ...overrides?.recovery,
    },
  };
}

export function isAnyModeByPolicy(mode: AgentMode, policy: AgentLoopPolicy, consecutiveFailures: number): boolean {
  return getToolModeForPhase(mode, policy, consecutiveFailures) === 'ANY';
}

export function getToolModeForPhase(
  mode: AgentMode,
  policy: AgentLoopPolicy,
  consecutiveFailures: number,
  isThinkingModel: boolean = false
): ToolCallMode {
  if (mode === 'PLANNING') return 'AUTO';
  if (mode === 'RECOVERY') return policy.recovery.toolMode;
  if (mode === 'EXECUTION' || mode === 'VERIFICATION') {
    // [FIX] Thinking models (Gemini 3.x) conflict with ANY + thinkingConfig,
    // causing 400 INVALID_ARGUMENT. They follow instructions well enough
    // that ANY is unnecessary — AUTO avoids the conflict.
    if (isThinkingModel) return 'AUTO';
    return consecutiveFailures >= policy.anyToAutoFailureThreshold ? 'AUTO' : 'ANY';
  }
  return 'AUTO';
}

export function getMaxTokensForPhase(mode: AgentMode, policy: AgentLoopPolicy): number | undefined {
  if (mode === 'EXECUTION') return policy.executionMaxOutputTokens;
  if (mode === 'VERIFICATION') return policy.verificationMaxOutputTokens;
  if (mode === 'RECOVERY') return policy.recovery.maxOutputTokens;
  return undefined;
}
