
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../llm-client/providers/gemini';
import { LLMMessage } from '../../llm-client/providers/types';

describe('GeminiProvider Debug', () => {
  const provider = new GeminiProvider('fake-key', 'gemini-2.0-flash-exp');

  it('should map functionCall properly with thought signature', () => {
    const msg: LLMMessage = {
      role: 'model',
      content: [
        { 
          functionCall: { name: 'testTool', args: { foo: 'bar' }, id: 'call_1' },
          thought_signature: 'sig123'
        }
      ]
    };

    const genAIContent = (provider as any).mapToGenAIContent(msg);
    
    expect(genAIContent.role).toBe('model');
    const part = genAIContent.parts[0];
    expect(part.functionCall).toBeDefined();
    // Check if thoughtSignature is camelCase or snake_case
    console.log('Mapped Part Keys:', Object.keys(part));
    if (part.thoughtSignature) console.log('thoughtSignature present');
    if (part.thought_signature) console.log('thought_signature present');
    
    expect(part.functionCall.name).toBe('testTool');
  });

  it('should handle large args in functionCall', () => {
    const largeArgs = {
       analysis: "Use a card-based layout...",
       steps: Array(50).fill(null).map((_, i) => ({
         stepNumber: i,
         reasoning: "Some long reasoning text that might cause issues if not handled correctly..."
       }))
    };

    const msg: LLMMessage = {
      role: 'model',
      content: [
        { 
          functionCall: { name: 'planDesign', args: largeArgs, id: 'call_plan' },
          thought_signature: 'sig_plan'
        }
      ]
    };

    const genAIContent = (provider as any).mapToGenAIContent(msg);
    const args = genAIContent.parts[0].functionCall.args;
    expect(args).toBeDefined();
    expect(args.steps).toHaveLength(50);
  });
});
