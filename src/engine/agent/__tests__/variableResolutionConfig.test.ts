/**
 * @file variableResolutionConfig.test.ts
 * @description Tests for the `variableResolution` settings flag (post May
 * 2026 phased-rollout collapse — see agentBehaviorConfig.ts JSDoc for the
 * historical context).
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §7.1.
 *
 * Asserts:
 *   1. The flag's default in `AgentBehaviorConfig` is "mode-coverage" —
 *      bare-name binding still works (legacy silent-pick path), with the
 *      mode-coverage check enforced. Strict remains opt-in pending real E2E
 *      validation (the May 2026 cutover regressed silent-black fills).
 *   2. AgentRuntime construction propagates the flag to the main-thread
 *      mode-coverage checker via `setVariableResolutionMode`.
 *   3. Both modes ('mode-coverage' and 'strict') run the mode-coverage check;
 *      the modes differ only in bare-name string handling at the tool boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_BEHAVIOR,
  resolveBehavior,
} from '../agentBehaviorConfig';
import {
  checkModeCoverage,
  setVariableResolutionMode,
  getVariableResolutionMode,
} from '../../actions/handlers/modeCoverageCheck';
import { AgentRuntime } from '../agentRuntime';
import type { LLMProvider } from '../../llm-client/providers/types';

beforeEach(() => {
  // Restore default between tests so flag leakage doesn't pollute.
  setVariableResolutionMode('mode-coverage');
});

describe('AgentBehaviorConfig.variableResolution default', () => {
  it('defaults to "mode-coverage"', () => {
    expect(DEFAULT_BEHAVIOR.variableResolution).toBe('mode-coverage');
  });

  it('resolveBehavior() preserves the default when not overridden', () => {
    expect(resolveBehavior().variableResolution).toBe('mode-coverage');
  });

  it('resolveBehavior() honors explicit overrides', () => {
    expect(resolveBehavior({ variableResolution: 'mode-coverage' }).variableResolution).toBe('mode-coverage');
    expect(resolveBehavior({ variableResolution: 'strict' }).variableResolution).toBe('strict');
  });
});

describe('AgentRuntime construction propagates variableResolution to mode-coverage checker', () => {
  function makeMockProvider(): LLMProvider {
    return {
      name: 'mock',
      generate: vi.fn(),
      formatResponse: vi.fn().mockReturnValue({ role: 'model', content: '' }),
      formatToolResults: vi.fn().mockReturnValue({ role: 'tool', content: [] }),
      getCapabilities: vi.fn().mockReturnValue({}),
      getToolSystemInstruction: vi.fn().mockReturnValue(''),
    } as any;
  }

  it('sets the main-thread checker to "mode-coverage" by default', () => {
    new AgentRuntime({
      provider: makeMockProvider(),
      tools: [],
      systemPrompt: 'sys',
    });
    expect(getVariableResolutionMode()).toBe('mode-coverage');
  });

  it('propagates explicit "strict" override to the main-thread checker', () => {
    new AgentRuntime({
      provider: makeMockProvider(),
      tools: [],
      systemPrompt: 'sys',
      behaviorConfig: { variableResolution: 'strict' },
    });
    expect(getVariableResolutionMode()).toBe('strict');
  });
});

describe('mode-coverage check runs in both modes', () => {
  // Minimal collection with Light + Dark; variable defines Light only.
  // Node renders in Dark → fails coverage regardless of mode.

  function setupCoverageFailingFixture() {
    const collection = {
      id: 'VariableCollectionId:1:1',
      name: 'Theme',
      modes: [
        { modeId: 'm:light', name: 'Light' },
        { modeId: 'm:dark', name: 'Dark' },
      ],
    };

    vi.stubGlobal('figma', {
      variables: {
        getVariableCollectionByIdAsync: vi.fn(async (id: string) =>
          id === collection.id ? collection : null,
        ),
      },
    });

    const variable = {
      id: 'VariableID:1:5',
      name: 'Text/Primary',
      variableCollectionId: collection.id,
      resolvedType: 'COLOR' as const,
      valuesByMode: { 'm:light': '#FFFFFF' },  // Dark missing
      getPluginData: () => '',
    } as unknown as Variable;

    const node = {
      id: 'node:1',
      type: 'FRAME',
      resolvedVariableModes: { [collection.id]: 'm:dark' },  // renders Dark → uncovered
    } as unknown as SceneNode;

    return { node, variable };
  }

  it('FAILS under mode-coverage', async () => {
    setVariableResolutionMode('mode-coverage');
    const { node, variable } = setupCoverageFailingFixture();
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fail');
  });

  it('FAILS under strict (same coverage check, no escape valve)', async () => {
    setVariableResolutionMode('strict');
    const { node, variable } = setupCoverageFailingFixture();
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fail');
  });
});
