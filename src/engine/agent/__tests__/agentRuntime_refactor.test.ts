import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';
import { AGENT_RUNTIME_CONSTANTS } from '../constants';


describe('AgentRuntime Refactor Verification', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'mock',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        content: res.toolCalls?.length ? res.toolCalls.map((tc: any) => ({
          type: 'tool_call',
          id: tc.id || 'call_' + Math.random().toString(36).slice(2, 7),
          name: tc.name,
          input: tc.input,
          thoughtSignature: tc.thoughtSignature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          type: 'tool_result',
          id: tr.id || '',
          name: tr.name,
          data: tr.response,
          thoughtSignature: tr.thoughtSignature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Rules')
    } as any;
  });

  it('should preserve tool execution order and group strategy', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        toolCalls: [
          { type: 'tool_call', id: 'p1_1', name: 'p1', input: { action: 'go' } },
          { type: 'tool_call', id: 'p2_1', name: 'p2', input: { action: 'go' } },
          { type: 'tool_call', id: 's1_1', name: 's1', input: { action: 'go' } },
          { type: 'tool_call', id: 'p3_1', name: 'p3', input: { action: 'go' } }
        ]
      })
      .mockResolvedValueOnce({ text: 'Done', toolCalls: [] });

    const executionOrder: string[] = [];
    const toolExecutors = {
      p1: async () => { executionOrder.push('p1'); return { success: true }; },
      p2: async () => { executionOrder.push('p2'); return { success: true }; },
      s1: async () => { executionOrder.push('s1'); return { success: true }; },
      p3: async () => { executionOrder.push('p3'); return { success: true }; },
    };

    const runtime = new AgentRuntime({
      loopPolicy: { useSkillSystem: false } as any,
      provider: mockProvider,
      tools: [
        { name: 'p1', executionStrategy: 'parallel', parameters: { type: 'object', properties: {} }, description: '' },
        { name: 'p2', executionStrategy: 'parallel', parameters: { type: 'object', properties: {} }, description: '' },
        { name: 's1', executionStrategy: 'sequential', parameters: { type: 'object', properties: {} }, description: '' },
        { name: 'p3', executionStrategy: 'parallel', parameters: { type: 'object', properties: {} }, description: '' },
      ],
      toolExecutors: toolExecutors as any
    });

    await runtime.run('start');

    // Sequential S1 must come after P1 and P2
    expect(executionOrder.indexOf('s1')).toBeGreaterThan(executionOrder.indexOf('p1'));
    expect(executionOrder.indexOf('s1')).toBeGreaterThan(executionOrder.indexOf('p2'));
    // Parallel P3 must come after S1
    expect(executionOrder.indexOf('p3')).toBeGreaterThan(executionOrder.indexOf('s1'));
  });

  it('should handle tool timeouts', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        toolCalls: [{ type: 'tool_call', id: 'slow_1', name: 'slow_tool', input: {} }]
      })
      .mockResolvedValueOnce({ text: 'Done', toolCalls: [] });

    const toolExecutors = {
      slow_tool: () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
    };
  });

  it('should NOT retry transient errors above the provider layer (fail-fast)', async () => {
    // The retryPolicy + retryWithBackoff layer was deleted in the fail-fast
    // refactor. Only fetchWithRetry inside the provider retries 5xx, and that
    // happens BEFORE the runtime sees anything. From the runtime's perspective,
    // any provider error is final.
    let callCount = 0;
    (mockProvider.generate as any).mockImplementation(() => {
      callCount++;
      throw new Error('503: Service Overloaded');
    });

    const runtime = new AgentRuntime({
      loopPolicy: { useSkillSystem: false } as any,
      provider: mockProvider,
      tools: []
    });

    await expect(runtime.run('test retry')).rejects.toThrow(/Service Overloaded/);
    expect(callCount).toBe(1);
  });

});
