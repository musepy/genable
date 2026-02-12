import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENT_LOOP_POLICY,
  getMaxTokensForPhase,
  getToolModeForPhase,
  resolveAgentLoopPolicy,
} from '../agentLoopPolicy';

describe('AgentLoopPolicy', () => {
  it('should use ANY in EXECUTION/VERIFICATION until failure threshold is hit', () => {
    const policy = resolveAgentLoopPolicy();

    expect(getToolModeForPhase('EXECUTION', policy, 0)).toBe('ANY');
    expect(getToolModeForPhase('VERIFICATION', policy, 1)).toBe('ANY');
    expect(getToolModeForPhase('EXECUTION', policy, policy.anyToAutoFailureThreshold)).toBe('AUTO');
  });

  it('should use configured RECOVERY tool mode', () => {
    const policy = resolveAgentLoopPolicy({
      recovery: {
        toolMode: 'NONE',
      },
    });

    expect(getToolModeForPhase('RECOVERY', policy, 0)).toBe('NONE');
  });

  it('should resolve phase token budgets from policy', () => {
    const policy = resolveAgentLoopPolicy({
      executionMaxOutputTokens: 5000,
      verificationMaxOutputTokens: 3000,
      recovery: {
        maxOutputTokens: 2000,
      },
    });

    expect(getMaxTokensForPhase('PLANNING', policy)).toBeUndefined();
    expect(getMaxTokensForPhase('EXECUTION', policy)).toBe(5000);
    expect(getMaxTokensForPhase('VERIFICATION', policy)).toBe(3000);
    expect(getMaxTokensForPhase('RECOVERY', policy)).toBe(2000);
  });

  it('should deep-merge nested recovery overrides', () => {
    const policy = resolveAgentLoopPolicy({
      recovery: {
        maxIterations: 9,
      },
    });

    expect(policy.recovery.maxIterations).toBe(9);
    expect(policy.recovery.entryFailureThreshold).toBe(DEFAULT_AGENT_LOOP_POLICY.recovery.entryFailureThreshold);
  });
});
