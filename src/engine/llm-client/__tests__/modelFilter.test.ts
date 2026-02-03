import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModels, isAllowedModel } from '../modelFilter';

// Mock global fetch
global.fetch = vi.fn();

describe('modelFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAllowedModel', () => {
    it('should allow Gemini 2.5 Flash', () => {
      expect(isAllowedModel('gemini-2.5-flash', 'Gemini 2.5 Flash')).toBe(true);
    });

    it('should allow Gemini 3.0 Pro', () => {
      expect(isAllowedModel('gemini-3.0-pro', 'Gemini 3.0 Pro')).toBe(true);
    });

    it('should reject legacy Gemini versions', () => {
      expect(isAllowedModel('gemini-1.0-pro', 'Gemini 1.0 Pro')).toBe(false);
    });

    it('should reject excluded keywords', () => {
      expect(isAllowedModel('gemini-1.5-flash-sep', 'Gemini 1.5 Flash Sep')).toBe(false);
    });
  });

  describe('fetchModels', () => {
    it('should fetch Gemini models when provider is gemini', async () => {
      const mockGeminiResponse = {
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-1.0-pro', displayName: 'Gemini 1.0 Pro', supportedGenerationMethods: ['generateContent'] }
        ]
      };

      (global.fetch as any).mockResolvedValueOnce({
        json: async () => mockGeminiResponse
      });

      const models = await fetchModels('gemini', 'fake-key');
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('gemini-2.5-flash');
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com'));
    });

    it('should fetch OpenRouter models when provider is openrouter', async () => {
      const mockOpenRouterResponse = {
        data: [
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
          { id: 'openai/gpt-4o', name: 'GPT-4o' }
        ]
      };

      (global.fetch as any).mockResolvedValueOnce({
        json: async () => mockOpenRouterResponse
      });

      const models = await fetchModels('openrouter', 'fake-key');
      expect(models).toHaveLength(2);
      expect(models[0].name).toBe('anthropic/claude-3.5-sonnet');
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('openrouter.ai'), expect.any(Object));
    });
  });
});
