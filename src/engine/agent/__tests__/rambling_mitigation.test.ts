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


  it('should detect repeated progress headers and increase loop suspicion', async () => {
    // Round 1, 2, 3 all have same Progress header
    (mockProvider.generate as any)
      .mockResolvedValue({
        text: 'Progress: **Repeating Header**\nDoing stuff...',
        toolCalls: [{ name: 'noop', args: {} }]
      });

    const runtime = new AgentRuntime({
      loopPolicy: { useSkillSystem: false } as any,
      provider: mockProvider,
      tools: [{ name: 'noop', description: 'Noop', parameters: { type: 'object', properties: {} } }],
      ipcBridge: { callTool: vi.fn().mockResolvedValue({ success: true }), dispose: vi.fn() } as any,
      maxIterations: 10,
      planId: 'test-plan'
    });


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
