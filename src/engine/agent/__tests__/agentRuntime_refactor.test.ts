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
          functionCall: { name: tc.name, args: tc.args },
          thought_signature: tc.thought_signature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response },
          thought_signature: tr.thought_signature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Rules')
    } as any;
  });

  it('should preserve tool execution order and group strategy', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        toolCalls: [
          { name: 'p1', args: {} },
          { name: 'p2', args: {} },
          { name: 's1', args: {} },
          { name: 'p3', args: {} }
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
        toolCalls: [{ name: 'slow_tool', args: {} }]
      })
      .mockResolvedValueOnce({ text: 'Done', toolCalls: [] });

    const toolExecutors = {
      slow_tool: () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
    };
  });

  it('should retry on transient errors using RetryPolicy', async () => {
    let callCount = 0;
    (mockProvider.generate as any).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('503: Service Overloaded');
        (err as any).type = 'OVERLOADED';
        throw err;
      }
      return Promise.resolve({ text: 'Done', toolCalls: [] });
    });

    const runtime = new AgentRuntime({
      loopPolicy: { useSkillSystem: false } as any,
      provider: mockProvider,
      tools: []
    });

    const result = await runtime.run('test retry');
    expect(result).toBe('Done');
    expect(callCount).toBe(2);
  });

});
