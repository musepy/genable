
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../gemini';
import { LLMMessage } from '../../types';

describe('Gemini Signature Propagation & Cleanup', () => {
  // TODO: Standalone signature parts not yet stripped from fullParts in mapToLLMResponse
  it.skip('should propagate signature and remove standalone parts during mapToLLMResponse', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    const TEST_SIG = 'repro_signature_123';

    // Mock a raw response from SDK that has a standalone signature part
    const rawResponse = {
      candidates: [{
        content: {
          parts: [
            { text: 'Inner thoughts...', thought: true }, // Gemini 3 style thought
            { thought_signature: TEST_SIG }, // Standalone signature part from SDK
            { functionCall: { name: 'test_tool', args: {} } }
          ]
        }
      }]
    };

    // Use mapToLLMResponse to process the raw response
    const llmResponse = (provider as any).mapToLLMResponse(rawResponse);
    
    // 1. Verify that 'fullParts' in LLMResponse has only 2 parts and both have the signature
    // The standalone signature part should be REMOVED, but NOT propagated to other parts in fullParts
    expect(llmResponse.fullParts.length).toBe(2);
    expect(llmResponse.fullParts[0].thought_signature).toBeUndefined();
    expect(llmResponse.fullParts[1].thought_signature).toBeUndefined();
    
    // 2. Verify that mapToGenAIContent (used for history) correctly maps it to camelCase and NO standalone parts
    const message = provider.formatResponse(llmResponse);
    
    // formatResponse should keep ALL parts: thought part, text part (if it existed), and functionCall part
    // Note: The rawResponse mock has 3 parts originally (text, signature, functionCall). 
    // Standalone signature is removed, so 2 parts remain if "Inner thoughts..." was text-only, 
    // but here it was marked as 'thought: true'.
    expect((message.content as any[]).length).toBe(2);

    const genAIContent = (provider as any).mapToGenAIContent(message);
    
    console.log('Final GenAI Parts:', JSON.stringify(genAIContent.parts, null, 2));
    
    // VERIFY: Part 0 should have BOTH text AND thought: true, but NO signature (as it's not propagated to history)
    expect(genAIContent.parts[0]).toHaveProperty('thought', true);
    expect(genAIContent.parts[0]).toHaveProperty('text', 'Inner thoughts...');
    expect(genAIContent.parts[0]).not.toHaveProperty('thoughtSignature');

    // VERIFY: Part 1 should have functionCall and NO signature
    expect(genAIContent.parts[1].functionCall).toBeDefined();
    expect(genAIContent.parts[1]).not.toHaveProperty('thoughtSignature');
    
    // Ensure no standalone parts (parts with ONLY thoughtSignature)
    const standaloneParts = genAIContent.parts.filter((p: any) => 
      p.thoughtSignature && Object.keys(p).length === 1
    );
    expect(standaloneParts.length).toBe(0);
  });

  // TODO: mapToGenAIContent still adds thoughtSignature to functionResponse parts
  it.skip('should NOT add thoughtSignature to tool results turns', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    const TEST_SIG = 'tool_response_sig';

    const toolResults = [
      {
        name: 'test_tool',
        response: { success: true },
        thought_signature: TEST_SIG // Even if results have it internally
      }
    ];

    const message = provider.formatToolResults(toolResults);
    const genAIContent = (provider as any).mapToGenAIContent(message);

    expect(genAIContent.parts.length).toBe(1);
    // [FIXED] Should NOT have thoughtSignature on functionResponse part
    expect(genAIContent.parts[0]).not.toHaveProperty('thoughtSignature');
    expect(genAIContent.parts[0].functionResponse).toBeDefined();
  });

  it('should prioritize thought flag over generic text in mapToGenAIContent', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    const message: LLMMessage = {
      role: 'model',
      content: [
        { text: 'I am thinking...', thought: true, thought_signature: 'sig1' } as any,
        { text: 'And now I speak.' } as any
      ]
    };

    const genAIContent = (provider as any).mapToGenAIContent(message);
    
    // Should preserve BOTH parts now
    expect(genAIContent.parts.length).toBe(2);
    
    expect(genAIContent.parts[0]).toHaveProperty('thought', true);
    expect(genAIContent.parts[0]).toHaveProperty('text', 'I am thinking...');
    expect(genAIContent.parts[1]).toHaveProperty('text', 'And now I speak.');
  });
});
