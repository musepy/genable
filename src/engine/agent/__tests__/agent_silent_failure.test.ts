import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';



describe('Agent Silent Failure Repro', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'gemini',
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

  it('reproduces silent failure when provider returns empty response', async () => {
    // Simulating Gemini returning a completely empty response (which happens if stream yields nothing)
    (mockProvider.generate as any).mockResolvedValue({
      text: '',
      thoughts: undefined,
      toolCalls: undefined,
      fullParts: undefined
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      systemPrompt: 'You are helpful',
      tools: [],
      // Mock callbacks to see if they get called
      onIteration: vi.fn(),
      onThinking: vi.fn(),
      ipcBridge: { callTool: vi.fn(), dispose: vi.fn() } as any
    });

    // The user experiences "Agent starting..." then nothing.
    // This translates to run() resolving quickly with empty content.
    // CURRENT BUG FIX: It should now throw an error instead of failing silently (after 3 retries).
    await expect(runtime.run('Hello')).rejects.toThrow('LLM Provider returned an empty response');
    
    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
  });
});
