/**
 * @file agentLoopPolicy.ts
 * @description Unified control-loop policy for AgentRuntime.
 *
 * WHY THIS FILE EXISTS:
 * Consolidates safety-guardrail thresholds for the autonomous agent loop.
 * With the state machine removed, only safety parameters remain:
 * - loop detection thresholds
 * - output token budgets
 * - prompt budget
 */

import { AGENT_RUNTIME_CONSTANTS } from './constants';

export type ToolCallMode = 'AUTO' | 'ANY' | 'NONE';

export interface AgentLoopPolicy {
  /** Max consecutive iterations on the same step before force-advancing. */
  monotoneLoopThreshold: number;
  /** Max output tokens for LLM generation. */
  maxOutputTokens: number;
  /** Whether to use the skill system for prompt composition. */
  useSkillSystem: boolean;
}

export const DEFAULT_AGENT_LOOP_POLICY: AgentLoopPolicy = {
  monotoneLoopThreshold: 8,
  maxOutputTokens: 16384,
  useSkillSystem: true,
};

export function resolveAgentLoopPolicy(overrides?: Partial<AgentLoopPolicy>): AgentLoopPolicy {
  return {
    ...DEFAULT_AGENT_LOOP_POLICY,
    ...overrides,
  };
}
