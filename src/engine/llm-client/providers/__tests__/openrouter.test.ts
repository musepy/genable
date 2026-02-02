import { describe, it, expect, vi } from 'vitest';
import { OpenRouterProvider } from '../openrouter';

describe('OpenRouterProvider', () => {
  it('should map messages correctly to OpenAI format', async () => {
    const provider = new OpenRouterProvider('fake-key', 'gpt-4');
    
    // Stub fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      })
    });

    const response = await provider.generate({
      messages: [
        { id: '1', role: 'system', content: 'System instruction' },
        { id: '2', role: 'user', content: 'User message' }
      ]
    });

    expect(response.text).toBe('Hello');
    expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('openrouter.ai'),
        expect.objectContaining({
            body: expect.stringContaining('"role":"system","content":"System instruction"')
        })
    );
  });

  it('should handle tool calls in mapping', async () => {
      const provider = new OpenRouterProvider('fake-key', 'gpt-4');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'test', arguments: '{}' } }] } }],
        })
      });

      const response = await provider.generate({
        messages: [{ id: '1', role: 'user', content: 'Use tool' }],
        tools: [{ name: 'test', description: 'test tool', parameters: { type: 'object', properties: {} } }]
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe('test');
  });

  it('should support multiple models for fallback', async () => {
      const provider = new OpenRouterProvider('fake-key', 'gpt-4');
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Fallback result' } }],
        })
      });

      const modelsToTry = ['anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash:free'];
      const response = await provider.generate({
        messages: [{ id: '1', role: 'user', content: 'Test fallback' }],
        models: modelsToTry
      });

      expect(response.text).toBe('Fallback result');
      expect(fetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
              body: expect.stringContaining('"models":["anthropic/claude-3.5-sonnet","google/gemini-2.0-flash:free"]')
          })
      );
      // Ensure 'model' field is NOT present when 'models' is used
      const callArgs = (fetch as any).mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.models).toEqual(modelsToTry);
      expect(body.model).toBeUndefined();
  });
});
