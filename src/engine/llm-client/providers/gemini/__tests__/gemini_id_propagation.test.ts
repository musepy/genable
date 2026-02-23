
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../gemini';
import { LLMMessage } from '../../types';

describe('Gemini ID Propagation', () => {
  // TODO: ID propagation not yet fully implemented in mapToLLMResponse → fullParts
  it.skip('should generate and preserve IDs across the lifecycle', () => {
    const provider = new GeminiProvider('fake-key', 'gemini-3-flash');
    
    // 1. Mock SDK response with parallel calls
    const rawResponse = {
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: 'tool1', args: {} } },
            { functionCall: { name: 'tool2', args: {} } }
          ]
        }
      }]
    };

    const llmResponse = (provider as any).mapToLLMResponse(rawResponse);
    
    // Verify IDs generated
    expect(llmResponse.toolCalls).toHaveLength(2);
    const id1 = llmResponse.toolCalls[0].id;
    const id2 = llmResponse.toolCalls[1].id;
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);

    // Verify IDs preserved in fullParts
    expect(llmResponse.fullParts).toHaveLength(2);
    expect(llmResponse.fullParts[0].functionCall.id).toBe(id1);
    expect(llmResponse.fullParts[1].functionCall.id).toBe(id2);

    // 2. Format as message and map back to GenAI
    const message = provider.formatResponse(llmResponse);
    const genAIContent = (provider as any).mapToGenAIContent(message);

    expect(genAIContent.parts).toHaveLength(2);
    expect(genAIContent.parts[0].functionCall.id).toBe(id1);
    expect(genAIContent.parts[1].functionCall.id).toBe(id2);

    // 3. Roundtrip tool results
    const results = [
      { name: 'tool1', response: { ok: true }, id: id1 },
      { name: 'tool2', response: { ok: true }, id: id2 }
    ];
    const toolMsg = provider.formatToolResults(results);
    const toolGenAI = (provider as any).mapToGenAIContent(toolMsg);

    expect(toolGenAI.parts).toHaveLength(2);
    expect(toolGenAI.parts[0].functionResponse.id).toBe(id1);
    expect(toolGenAI.parts[1].functionResponse.id).toBe(id2);
  });
});
