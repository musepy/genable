import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENT_LOOP_POLICY,
  resolveAgentLoopPolicy,
} from '../agentLoopPolicy';

describe('AgentLoopPolicy', () => {
  it('should use default values if no overrides are provided', () => {
    const policy = resolveAgentLoopPolicy();

    expect(policy.monotoneLoopThreshold).toBe(DEFAULT_AGENT_LOOP_POLICY.monotoneLoopThreshold);
    expect(policy.maxOutputTokens).toBe(DEFAULT_AGENT_LOOP_POLICY.maxOutputTokens);
  });

  it('should apply overrides', () => {
    const policy = resolveAgentLoopPolicy({
      monotoneLoopThreshold: 5,
      maxOutputTokens: 2000,
    });

    expect(policy.monotoneLoopThreshold).toBe(5);
    expect(policy.maxOutputTokens).toBe(2000);
  });
});
