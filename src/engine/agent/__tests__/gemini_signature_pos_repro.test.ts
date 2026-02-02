
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider, LLMGenerateOptions } from '../../llm-client/providers/types';


describe('Gemini Signature Position Repro', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'gemini',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        // In this test, we want to see if fullParts are preserved
        content: res.fullParts ? res.fullParts : (res.toolCalls?.map((tc: any) => ({
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

  it('should preserve the exact sequence of parts (text, thought, call) in model history', async () => {
    const TEST_SIGNATURE = 'sig_pos_2';
    
    // Step 1: Mock provider
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'I am thinking...',
        thoughts: 'Hmm, I should call a tool.',
        toolCalls: [
          { 
            name: 'get_weather', 
            args: { city: 'HK' }, 
            thought_signature: TEST_SIGNATURE 
          }
        ],
        fullParts: [
          { text: 'I am thinking...' },
          { text: 'Hmm, I should call a tool.', thought: true },
          { 
            functionCall: { name: 'get_weather', args: { city: 'HK' } },
            thought_signature: TEST_SIGNATURE
          }
        ]
      })
      .mockResolvedValueOnce({
        text: 'It is sunny!',
        toolCalls: []
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;
    
    mockIpcBridge.callTool.mockResolvedValue({ status: 'success' });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      systemPrompt: 'You are helpful',
      tools: [{ name: 'get_weather', description: 'desc', parameters: { type: 'object', properties: {} } }],
      ipcBridge: mockIpcBridge
    });

    await runtime.run('Weather info');

    // Verify the second call to generate
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    
    const secondCall = (mockProvider.generate as any).mock.calls[1][0] as LLMGenerateOptions;
    const messages = secondCall.messages;
    
    console.log('Final messages count:', messages.length);
    
    // Messages: [system, user, model, tool]
    expect(messages.length).toBeGreaterThanOrEqual(3);
    
    const modelMsg = messages.find(m => m.role === 'model' && Array.isArray(m.content));
    expect(modelMsg).toBeDefined();
    
    const content = modelMsg!.content as any[];
    
    // VERIFY EXACT SEQUENCE PRESERVATION - This confirms position 2 is maintained
    expect(content).toHaveLength(3);
    expect(content[0].text).toBe('I am thinking...');
    expect(content[1].thought).toBe(true);
    expect(content[2].functionCall.name).toBe('get_weather');
    expect(content[2].thought_signature).toBe(TEST_SIGNATURE);

    const toolMsg = messages.find(m => m.role === 'tool');
    const resultPart = (toolMsg!.content as any[])[0];
    expect(resultPart.thought_signature).toBe(TEST_SIGNATURE);
  });
});
