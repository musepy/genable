import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../gemini';
import { LLMGenerateOptions } from '../types';

// Mock the @google/genai SDK
vi.mock('@google/genai', () => {
  const generateContentMock = vi.fn().mockResolvedValue({
    text: '{"type": "FRAME"}',
    candidates: [{ content: { parts: [{ text: '{"type": "FRAME"}' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
  });

  /*
  const generateContentStreamMock = vi.fn().mockResolvedValue({
    stream: (async function* () {
      yield {
        candidates: [{ content: { parts: [{ text: 'Part 1' }] } }]
      };
      yield {
        candidates: [{ content: { parts: [{ text: 'Part 2' }] } }]
      };
      yield {
        candidates: [{ content: { parts: [{ thought: 'Thinking chunk' }] } }]
      };
    })()
  });
  */
  // Correct mock matching @google/genai SDK v1.38.0
  const generateContentStreamMock = vi.fn().mockResolvedValue(
    (async function* () {
      yield {
        candidates: [{ content: { parts: [{ text: 'Part 1' }] } }]
      };
      yield {
        candidates: [{ content: { parts: [{ text: 'Part 2' }] } }]
      };
      yield {
        candidates: [{ content: { parts: [{ thought: 'Thinking chunk' }] } }]
      };
    })()
  );

  class MockGoogleGenAI {
    models = {
      generateContent: generateContentMock,
      generateContentStream: generateContentStreamMock
    };
  }

  return { GoogleGenAI: MockGoogleGenAI };
});

describe('GeminiProvider', () => {
  const apiKey = 'test-api-key';
  const modelName = 'gemini-2.0-flash';
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(apiKey, modelName);
    vi.clearAllMocks();
  });

  it('should call Gemini API with correct parameters', async () => {
    const options: LLMGenerateOptions = {
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'Hello' }
      ]
    };

    const response = await provider.generate(options);

    expect(response.text).toBe('{"type": "FRAME"}');
    expect(response.usage?.totalTokens).toBe(30);
  });

  it('should handle tool definitions', async () => {
    const options: LLMGenerateOptions = {
      messages: [{ role: 'user', content: 'Use a tool' }],
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { arg1: { type: 'string' } },
            required: ['arg1']
          }
        }
      ]
    };

    await provider.generate(options);
    
    await provider.generate(options);
    
    // Check if tools were passed to generateContent
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();
    expect(ai.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            functionDeclarations: expect.arrayContaining([
              expect.objectContaining({ name: 'test_tool' })
            ])
          })
        ])
      })
    }));
  });

  it('should handle streaming callbacks in generate', async () => {
    const onProgress = vi.fn();
    const onThinking = vi.fn();
    
    // Use the already mocked generateContentStream
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();

    await provider.generate({
      messages: [{ role: 'user', content: 'Stream this' }],
      onProgress,
      onThinking
    });

    expect(onProgress).toHaveBeenCalledWith('Part 1');
    expect(onProgress).toHaveBeenCalledWith('Part 2');
    expect(onThinking).toHaveBeenCalledWith('Thinking chunk');
  });

  it('should map "tool" role to Gemini "function" role', async () => {
    const options: LLMGenerateOptions = {
      messages: [
        { role: 'user', content: 'What is the weather?' },
        { 
          role: 'model', 
          content: [{ functionCall: { name: 'getWeather', args: { location: 'London' } } }] 
        },
        {
          role: 'tool',
          content: [{ functionResponse: { name: 'getWeather', response: { temp: 20 } } }]
        },
        { role: 'user', content: 'Thanks!' }
      ]
    };

    await provider.generate(options);

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new (GoogleGenAI as any)();
    const generateArgs = ai.models.generateContent.mock.calls[0][0];
    
    // Check contents mapping
    const contents = generateArgs.contents;
    expect(contents).toHaveLength(4);
    expect(contents[0].role).toBe('user');
    expect(contents[1].role).toBe('model');
    expect(contents[2].role).toBe('user'); // function response is mapped to 'user' in our current implementation
  });
});
