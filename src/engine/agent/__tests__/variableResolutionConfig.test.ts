/**
 * @file variableResolutionConfig.test.ts
 * @description Phase 2 step 7 tests for the `variableResolution` settings flag.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §7.1.
 *
 * Asserts:
 *   1. The flag's default in `AgentBehaviorConfig` is "phase2-mode-coverage".
 *   2. AgentRuntime construction propagates the flag to the main-thread
 *      mode-coverage checker via `setVariableResolutionMode`.
 *   3. Setting the flag to "phase1" causes `checkModeCoverage` to short-circuit
 *      with `kind: 'pass'` even on a coverage-failing fixture.
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
  setVariableResolutionMode('phase2-mode-coverage');
});

describe('AgentBehaviorConfig.variableResolution default', () => {
  it('defaults to "phase2-mode-coverage"', () => {
    expect(DEFAULT_BEHAVIOR.variableResolution).toBe('phase2-mode-coverage');
  });

  it('resolveBehavior() preserves the default when not overridden', () => {
    expect(resolveBehavior().variableResolution).toBe('phase2-mode-coverage');
  });

  it('resolveBehavior() honors explicit overrides', () => {
    expect(resolveBehavior({ variableResolution: 'phase1' }).variableResolution).toBe('phase1');
    expect(resolveBehavior({ variableResolution: 'phase2-strict' }).variableResolution).toBe('phase2-strict');
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

  it('sets the main-thread checker to "phase2-mode-coverage" by default', () => {
    new AgentRuntime({
      provider: makeMockProvider(),
      tools: [],
      systemPrompt: 'sys',
    });
    expect(getVariableResolutionMode()).toBe('phase2-mode-coverage');
  });

  it('propagates explicit "phase1" override to the main-thread checker', () => {
    new AgentRuntime({
      provider: makeMockProvider(),
      tools: [],
      systemPrompt: 'sys',
      behaviorConfig: { variableResolution: 'phase1' },
    });
    expect(getVariableResolutionMode()).toBe('phase1');
  });
});

describe('"phase1" setting bypasses mode coverage check', () => {
  // Minimal collection with Light + Dark; variable defines Light only.
  // Node renders in Dark → would fail under "phase2-mode-coverage".

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

  it('FAILS under phase2-mode-coverage (control)', async () => {
    setVariableResolutionMode('phase2-mode-coverage');
    const { node, variable } = setupCoverageFailingFixture();
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fail');
  });

  it('PASSES under phase1 (escape valve)', async () => {
    setVariableResolutionMode('phase1');
    const { node, variable } = setupCoverageFailingFixture();
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('pass');
  });
});
