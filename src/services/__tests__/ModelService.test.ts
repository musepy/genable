import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelService } from '../ModelService';

// Mock fetchModels
vi.mock('../../engine/llm-client/modelFilter', () => ({
  fetchModels: vi.fn(),
}));

describe('ModelService', () => {
  beforeEach(() => {
    ModelService.clearCache();
    vi.clearAllMocks();
  });

  it('should return static models when no API key', async () => {
    const result = await ModelService.getModels('gemini', '');
    expect(result.success).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.fromCache).toBe(false);
  });

  it('should deduplicate concurrent requests', async () => {
    const { fetchModels } = await import('../../engine/llm-client/modelFilter');
    (fetchModels as any).mockResolvedValue([{ name: 'test', displayName: 'Test' }]);

    // 并发 3 个请求
    const results = await Promise.all([
      ModelService.getModels('gemini', 'key', true),
      ModelService.getModels('gemini', 'key', true),
      ModelService.getModels('gemini', 'key', true),
    ]);

    // 只应调用 1 次 API
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should fallback to static models on API error', async () => {
    const { fetchModels } = await import('../../engine/llm-client/modelFilter');
    (fetchModels as any).mockRejectedValue(new Error('Network error'));

    const result = await ModelService.getModels('gemini', 'key', true);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
    expect(result.models.length).toBeGreaterThan(0); // 有降级模型
  });
});
