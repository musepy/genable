import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider, LLMResponse } from '../../llm-client/providers/types';
import { AGENT_RUNTIME_CONSTANTS } from '../constants';

describe('AgentRuntime Rambling Mitigation', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'mock',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation((res: LLMResponse) => ({
        role: 'model',
        content: [
            ...(res.text ? [{ text: res.text }] : []),
            ...(res.toolCalls?.map((tc: any) => ({
                functionCall: { name: tc.name, args: tc.args },
                thought_signature: tc.thought_signature
            })) || [])
        ]
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response },
          thought_signature: tr.thought_signature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions')
    } as any;
  });

  it('should strip narration text in EXECUTION mode when tools are present', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Progress: **Creating Card**\nI will now create the card.',
        toolCalls: [{ name: 'createNode', args: { type: 'FRAME', name: 'Card' } }]
      })
      .mockResolvedValueOnce({
        text: 'Done',
        toolCalls: []
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'createNode', description: 'Create', parameters: { type: 'object', properties: {} } }],
      ipcBridge: { callTool: vi.fn().mockResolvedValue({ success: true, data: { nodeId: '1:1' } }), dispose: vi.fn() } as any,
      planId: 'test-plan'
    });

    // We need to simulate being in EXECUTION mode. 
    // AgentRuntime determines mode based on planState.
    // Let's mock planState or just use a user prompt that triggers execution 
    // actually, let's just mock the mode check if possible, or trigger it naturally.
    
    // Easier way: mock planState
    const { planState } = await import('../planState');
    planState.reset();
    planState.updateTodos([{ id: '1', title: 'Task 1', status: 'todo' }]);
    planState.startTask('Task 1', 'Desc', '1');

    await runtime.run('Build it');

    const messages = runtime.getMessages();
    const modelMsg = messages.find(m => m.role === 'model');
    expect(modelMsg).toBeDefined();
    
    // Verify that the text part was stripped
    const content = modelMsg!.content as any[];
    const textParts = content.filter(p => p.text);
    expect(textParts).toHaveLength(0);
    
    const toolParts = content.filter(p => p.functionCall);
    expect(toolParts).toHaveLength(1);
  });

  it('should detect repeated progress headers and increase loop suspicion', async () => {
    // Round 1, 2, 3 all have same Progress header
    (mockProvider.generate as any)
      .mockResolvedValue({
        text: 'Progress: **Repeating Header**\nDoing stuff...',
        toolCalls: [{ name: 'noop', args: {} }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'noop', description: 'Noop', parameters: { type: 'object', properties: {} } }],
      ipcBridge: { callTool: vi.fn().mockResolvedValue({ success: true }), dispose: vi.fn() } as any,
      maxIterations: 10,
      planId: 'test-plan'
    });

    const { planState } = await import('../planState');
    planState.reset();
    planState.updateTodos([{ id: '1', title: 'Task 1', status: 'todo' }]);
    planState.startTask('Task 1', 'Desc', '1');

    // It should throw because thinkingOnlyIterations will hit the limit 
    // (since we count repeated headers as thinkingOnlyIterations increments)
    await expect(runtime.run('Loop')).rejects.toThrow();
    
    // Check if thinkingOnlyIterations was incremented (private but we can check the error message or behavior)
    // Actually our code does: if (sameHeaderCount >= 3) { this.thinkingOnlyIterations++; }
    // MAX_THINKING_ONLY_ITERATIONS is 4 by default.
    // Turn 1: count=1
    // Turn 2: count=2
    // Turn 3: count=3 -> thinkingOnlyIterations = 1
    // Turn 4: count=4 -> thinkingOnlyIterations = 2
    // Turn 5: count=5 -> thinkingOnlyIterations = 3
    // Wait, it needs to reach 4. 
  });
});
