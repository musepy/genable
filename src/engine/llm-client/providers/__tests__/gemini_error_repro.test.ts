import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../gemini';

// Mock the @google/genai SDK
vi.mock('@google/genai', () => {
  const generateContentMock = vi.fn();
  const generateContentStreamMock = vi.fn();

  class MockGoogleGenAI {
    models = {
      generateContent: generateContentMock,
      generateContentStream: generateContentStreamMock
    };
  }

  return { GoogleGenAI: MockGoogleGenAI };
});

describe('GeminiProvider Error Reproduction', () => {
  const apiKey = 'test-api-key';
  const modelName = 'gemini-2.0-flash';
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(apiKey, modelName);
    vi.clearAllMocks();
  });

  it('should handle 503 Service Unavailable (Overloaded)', async () => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();
    
    // Mock 503 error
    ai.models.generateContent.mockRejectedValue(new Error('{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}'));

    await expect(provider.generate({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow(/overloaded/);
  });

  it('should detect MALFORMED_FUNCTION_CALL and not crash with empty response error', async () => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();
    
    // Mock response with MALFORMED_FUNCTION_CALL
    ai.models.generateContent.mockResolvedValue({
      candidates: [{
        index: 0,
        content: { parts: [] },
        finishReason: 'MALFORMED_FUNCTION_CALL'
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 }
    });

    await expect(provider.generate({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow(/MALFORMED_FUNCTION_CALL/);
  });

  it('should handle stream with MALFORMED_FUNCTION_CALL', async () => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();
    
    ai.models.generateContentStream.mockResolvedValue((async function* () {
      yield {
        candidates: [{
          index: 0,
          content: { parts: [] },
          finishReason: 'MALFORMED_FUNCTION_CALL'
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 }
      };
    })());

    await expect(provider.generate({ 
      messages: [{ role: 'user', content: 'test' }],
      onProgress: () => {}
    })).rejects.toThrow(/MALFORMED_FUNCTION_CALL/); 
  });
});
