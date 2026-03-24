import { describe, it, expect, vi } from 'vitest';
import { AgentRuntime, AgentRuntimeCanceledError } from '../agentRuntime';
import type { LLMProvider, LLMResponse, LLMToolResult } from '../../llm-client/providers/types';
import type { AgentRuntimeEvent } from '../../../shared/protocol/agentRuntimeEvents';

function createMockProvider(scriptedResponses: LLMResponse[]): LLMProvider {
  let callIndex = 0;

  return {
    name: 'mock',
    generate: vi.fn(async () => {
      const idx = Math.min(callIndex, scriptedResponses.length - 1);
      callIndex += 1;
      return scriptedResponses[idx];
    }),
    formatResponse: vi.fn((response: LLMResponse) => ({
      id: `mdl_${Math.random().toString(36).slice(2, 7)}`,
      role: 'model',
      content: response.toolCalls && response.toolCalls.length > 0
        ? response.toolCalls.map(tc => ({ functionCall: { id: tc.id, name: tc.name, args: tc.args } }))
        : (response.text || ''),
    })),
    formatToolResults: vi.fn((results: LLMToolResult[]) => ({
      id: `tool_${Math.random().toString(36).slice(2, 7)}`,
      role: 'tool',
      content: results.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
    })),
    getToolSystemInstruction: vi.fn(() => 'mock'),
  } as unknown as LLMProvider;
}

const emptyParams = { type: 'object', properties: {} } as const;

describe('AgentRuntime Event E2E Scenarios', () => {
  it('Scenario 1: normal completion emits full trajectory and completed status', async () => {
    const provider = createMockProvider([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'mock_tool', args: { query: 'hello' } }],
      },
      {
        text: 'Done',
        toolCalls: [],
      },
    ]);

    const events: AgentRuntimeEvent[] = [];

    const runtime = new AgentRuntime({
      provider,
      tools: [
        { name: 'mock_tool', description: 'Mock tool', parameters: emptyParams },
      ],
      loopPolicy: { useSkillSystem: false } as any,
      toolExecutors: {
        mock_tool: async () => ({ data: { ok: true } }),
      },
      onRuntimeEvent: (event) => events.push(event),
    });

    const result = await runtime.run('normal-flow');

    expect(result).toBe('Done');
    expect(events.some(e => e.type === 'iteration_start')).toBe(true);
    expect(events.some(e => e.type === 'tool_call' && e.toolCall.name === 'mock_tool')).toBe(true);
    expect(events.some(e => e.type === 'tool_result' && e.toolResult.name === 'mock_tool' && !e.toolResult.error)).toBe(true);
    expect(events.some(e => e.type === 'turn_end' && e.summary === 'Done')).toBe(true);
  });

  it('Scenario 2: tool error then recovery keeps visible error trail and still completes', async () => {
    const provider = createMockProvider([
      {
        text: '',
        toolCalls: [{ id: 'f1', name: 'fail_tool', args: { nodeId: 'n1' } }],
      },
      {
        text: '',
        toolCalls: [{ id: 'f2', name: 'fix_tool', args: { nodeId: 'n1' } }],
      },
      {
        text: 'Recovered',
        toolCalls: [],
      },
    ]);

    const events: AgentRuntimeEvent[] = [];

    const runtime = new AgentRuntime({
      provider,
      tools: [
        { name: 'fail_tool', description: 'Fails intentionally', parameters: emptyParams },
        { name: 'fix_tool', description: 'Fixes previous error', parameters: emptyParams },
      ],
      loopPolicy: { useSkillSystem: false } as any,
      toolExecutors: {
        fail_tool: async () => ({
          error: { code: 'FAIL_TOOL', message: 'Intentional failure' },
        }),
        fix_tool: async () => ({ data: { repaired: true } }),
      },
      onRuntimeEvent: (event) => events.push(event),
    });

    const result = await runtime.run('error-recovery-flow');

    expect(result).toBe('Recovered');
    expect(events.some(e => e.type === 'tool_result' && e.toolResult.name === 'fail_tool' && !!e.toolResult.error)).toBe(true);
    expect(events.some(e => e.type === 'tool_result' && e.toolResult.name === 'fail_tool' && (e.toolResult.error || '').includes('Intentional failure'))).toBe(true);
    expect(events.some(e => e.type === 'turn_end' && e.summary === 'Recovered')).toBe(true);
  });

  it('Scenario 3: user cancel stops issuing new tool calls and ends with canceled status', async () => {
    const provider = createMockProvider([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'slow_tool', args: { action: 'run' } },
          { id: 'c2', name: 'after_tool', args: { action: 'follow' } },
        ],
      },
    ]);

    const events: AgentRuntimeEvent[] = [];
    const afterTool = vi.fn(async () => ({}));

    const runtime = new AgentRuntime({
      provider,
      tools: [
        { name: 'slow_tool', description: 'Slow tool', parameters: emptyParams },
        { name: 'after_tool', description: 'Should not run', parameters: emptyParams },
      ],
      loopPolicy: { useSkillSystem: false } as any,
      toolExecutors: {
        slow_tool: async () => new Promise(resolve => setTimeout(() => resolve({}), 40)),
        after_tool: afterTool,
      },
      onRuntimeEvent: (event) => events.push(event),
    });

    const runPromise = runtime.run('cancel-flow');
    setTimeout(() => runtime.cancel('Canceled by user'), 10);

    await expect(runPromise).rejects.toBeInstanceOf(AgentRuntimeCanceledError);
    expect(afterTool).not.toHaveBeenCalled();

    const calledTools = events.filter(e => e.type === 'tool_call').map(e => e.toolCall.name);
    expect(calledTools).not.toContain('after_tool');
    expect(events.some(e => e.type === 'canceled' && e.reason === 'Canceled by user')).toBe(true);
  });
});
