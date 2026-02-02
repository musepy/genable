
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
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        content: res.fullParts ? res.fullParts.filter((p: any) => p.functionCall || p.thought) : (res.toolCalls?.map((tc: any) => ({
          functionCall: { name: tc.name, args: tc.args },
          thought_signature: tc.thought_signature
        })) || res.text)
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response },
          thought_signature: tr.thought_signature
        }))
      }))
    } as any;
  });

  it('should preserve and echo back thought_signature in tool result messages', async () => {
    const TEST_SIGNATURE = 'test_signature_12345';
    
    // Step 1: Mock provider to return a tool call with a signature
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'I will call a tool.',
        toolCalls: [
          { 
            name: 'test_tool', 
            args: { x: 1 }, 
            thought_signature: TEST_SIGNATURE 
          }
        ]
      })
      // Step 2: Final response
      .mockResolvedValueOnce({
        text: 'Done!',
        toolCalls: []
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;
    
    mockIpcBridge.callTool.mockResolvedValue({ success: true });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'test_tool', description: 'desc', parameters: { type: 'object', properties: {} } }],
      ipcBridge: mockIpcBridge
    });

    await runtime.run('Help me');

    // Verify the second call to generate
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    
    const secondCall = (mockProvider.generate as any).mock.calls[1][0] as LLMGenerateOptions;
    const messages = secondCall.messages;
    
    console.log('Messages in second call:', JSON.stringify(messages, null, 2));
    
    // Find the model message and tool result message
    const modelMsg = messages.find(m => m.role === 'model' && Array.isArray(m.content));
    const toolMsg = messages.find(m => m.role === 'tool');
    
    expect(modelMsg).toBeDefined();
    expect(toolMsg).toBeDefined();

    // Check model message (the call)
    const callPart = (modelMsg!.content as any[]).find(p => p.functionCall);
    expect(callPart.thought_signature).toBe(TEST_SIGNATURE);

    // Check tool message (the result) - THIS IS THE FIX
    const resultPart = (toolMsg!.content as any[]).find(p => p.functionResponse);
    expect(resultPart.thought_signature).toBe(TEST_SIGNATURE);
  });
});
