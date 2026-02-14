
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../gemini';
import { LLMMessage } from '../types';

describe('Gemini ID Repro', () => {
  const provider = new GeminiProvider('fake-key', 'gemini-2.0-flash');

  it('SHOULD NOT include "id" in functionCall parts sent to Gemini', () => {
    const msg: LLMMessage = {
      role: 'model',
      content: [
        { 
          functionCall: { name: 'test_tool', args: { x: 1 }, id: 'call_123' },
          thought_signature: 'sig_456'
        }
      ]
    };

    const genAIContent = (provider as any).mapToGenAIContent(msg);
    const part = genAIContent.parts[0];
    
    expect(part.functionCall).toBeDefined();
    expect(part.functionCall.name).toBe('test_tool');
    expect(part.functionCall.args).toEqual({ x: 1 });
    
    // THE BUG: id is present but should not be
    expect(part.functionCall.id).toBeUndefined();
  });

  it('SHOULD NOT include "id" in functionResponse parts sent to Gemini', () => {
    const msg: LLMMessage = {
      role: 'tool',
      content: [
        { 
          functionResponse: { name: 'test_tool', response: { success: true }, id: 'call_123' }
        }
      ]
    };

    const genAIContent = (provider as any).mapToGenAIContent(msg);
    const part = genAIContent.parts[0];
    
    expect(part.functionResponse).toBeDefined();
    expect(part.functionResponse.name).toBe('test_tool');
    
    // THE BUG: id is present but should not be
    expect(part.functionResponse.id).toBeUndefined();
  });
});
