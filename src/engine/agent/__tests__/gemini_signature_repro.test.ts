
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider, LLMGenerateOptions } from '../../llm-client/providers/types';


describe('Gemini Signature Repro', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'gemini',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => {
        // Mock the logic we just implemented: preserve thoughts and functionCalls from fullParts
        if (res.fullParts) {
          // Protocol Transparency: Keep ALL non-empty parts
          const content = res.fullParts.filter((p: any) => 
            p.functionCall || p.thought || (p.text && p.text.trim() !== '') || p.thought_signature
          );
          return { role: 'model', content };
        }
        return {
          role: 'model',
          content: res.toolCalls?.map((tc: any) => ({
            functionCall: { name: tc.name, args: tc.args },
            thought_signature: tc.thought_signature
          })) || res.text
        };
      }),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response }
          // NOTE: thought_signature MUST NOT be included in functionResponse
          // per Gemini API protocol - it's only allowed in model turns
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Rules')
    } as any;
  });

  it('should propagate thought_signature to all tool calls in a turn', async () => {
    const TEST_SIGNATURE = 'multi_call_sig_999';
    
    // Step 1: Mock provider to return TWO tool calls, but only one has the signature in the parts
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Planning steps.',
        toolCalls: [
          { name: 'task_1', args: {}, id: 'c1', thought_signature: TEST_SIGNATURE },
          { name: 'task_2', args: {}, id: 'c2', thought_signature: TEST_SIGNATURE } 
        ],
        fullParts: [
          { thought: true, text: 'Thinking...', thought_signature: TEST_SIGNATURE },
          { functionCall: { name: 'task_1', args: {} }, thought_signature: TEST_SIGNATURE },
          { functionCall: { name: 'task_2', args: {} }, thought_signature: TEST_SIGNATURE }
        ]
      })
      .mockResolvedValueOnce({
        text: 'Done!',
        toolCalls: [],
        fullParts: [
          { text: 'Closing thought...' },
          { text: 'Done!' }
        ]
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn().mockResolvedValue({ success: true }),
        dispose: vi.fn()
    } as any;

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'task_1', description: 'd', parameters: { type: 'object', properties: {} } },
        { name: 'task_2', description: 'd', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge
    });

    await runtime.run('Build something with multiple steps');

    // Verify propagation in the second call
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    const secondCall = (mockProvider.generate as any).mock.calls[1][0] as LLMGenerateOptions;
    const history = secondCall.messages;
    
    // Find model message
    const modelMsg = history.find(m => m.role === 'model' && Array.isArray(m.content));
    expect(modelMsg).toBeDefined();
    
    const parts = modelMsg!.content as any[];
    const calls = parts.filter(p => p.functionCall);
    
    expect(calls).toHaveLength(2);
    // ALL parts in the history turn should have the signature now
    expect(calls[0].thoughtSignature || calls[0].thought_signature).toBe(TEST_SIGNATURE);
    expect(calls[1].thoughtSignature || calls[1].thought_signature).toBe(TEST_SIGNATURE);

    // Find tool results turn
    const toolMsg = history.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const results = toolMsg!.content as any[];
    expect(results).toHaveLength(2);
    // CRITICAL: Tool results (functionResponse) MUST NOT have signatures
    // per Gemini API protocol - thoughtSignature is only for model turns
    expect(results[0].thoughtSignature).toBeUndefined();
    expect(results[0].thought_signature).toBeUndefined();
    expect(results[1].thoughtSignature).toBeUndefined();
    expect(results[1].thought_signature).toBeUndefined();
  });
});
