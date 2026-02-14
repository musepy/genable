
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../gemini';

describe('GeminiProvider.mapToLLMResponse Propagation', () => {
  it('should propagate thoughtSignature to all tool calls in a turn', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    const TEST_SIG = 'shared_secret_signature';

    // Simulated raw response from Gemini SDK
    const rawResponse = {
      candidates: [{
        content: {
          parts: [
            { text: 'Thinking...', thoughtSignature: TEST_SIG },
            { functionCall: { name: 'tool1', args: {} } }, // Missing sig here
            { functionCall: { name: 'tool2', args: {} }, thought_signature: TEST_SIG }
          ]
        },
        finishReason: 'STOP'
      }]
    };

    // Use any casting to access private method
    const response = (provider as any).mapToLLMResponse(rawResponse);

    expect(response.toolCalls).toHaveLength(2);
    
    // Tool 1 should have received the signature
    expect(response.toolCalls[0].name).toBe('tool1');
    expect(response.toolCalls[0].thought_signature).toBe(TEST_SIG);
    expect(response.toolCalls[0].metadata?.thought_signature).toBe(TEST_SIG);

    // Tool 2 should still have it
    expect(response.toolCalls[1].name).toBe('tool2');
    expect(response.toolCalls[1].thought_signature).toBe(TEST_SIG);

    // fullParts SHOULD be updated with signature (to ensure 400 error in history is fixed)
    const fullParts = response.fullParts as any[];
    const tool1Part = fullParts.find(p => p.functionCall?.name === 'tool1');
    expect(tool1Part.thought_signature).toBe(TEST_SIG);
  });

  it('should work when signature is in a standalone part', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    const TEST_SIG = 'standalone_sig';

    const rawResponse = {
      candidates: [{
        content: {
          parts: [
            { thoughtSignature: TEST_SIG }, // Standalone
            { functionCall: { name: 'tool1', args: {} } }
          ]
        }
      }]
    };

    const response = (provider as any).mapToLLMResponse(rawResponse);
    expect(response.toolCalls[0].thought_signature).toBe(TEST_SIG);
  });
});
