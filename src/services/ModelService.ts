/**
 * @file src/services/ModelService.ts
 * @description Model API Service - 独立的模型获取服务
 * 
 * 职责：
 * 1. 封装 API 调用逻辑
 * 2. 错误处理和重试
 * 3. 缓存管理
 */

import { fetchModels, LLMModel } from '../engine/llm-client/modelFilter';
import { SUPPORTED_MODELS, MODEL_CACHE_TTL_MS, ModelConfig } from '../ui/constants/models';

export type ProviderName = 'gemini' | 'openrouter' | 'dashscope';

export interface ModelFetchResult {
  models: LLMModel[];
  error?: string;
  fromCache: boolean;
}

interface CacheEntry {
  models: LLMModel[];
  timestamp: number;
  provider: ProviderName;
}

/**
 * 模型服务 - 单例模式
 * 解耦 API 调用与 UI 状态管理
 */
class ModelServiceImpl {
  private cache: Map<ProviderName, CacheEntry> = new Map();
  private pendingRequests: Map<ProviderName, Promise<ModelFetchResult>> = new Map();

  /**
   * 获取模型列表（优先返回缓存，后台刷新）
   * 
   * @param provider - 提供商名称
   * @param apiKey - API 密钥
   * @param forceRefresh - 是否强制刷新
   */
  async getModels(
    provider: ProviderName,
    apiKey: string,
    forceRefresh = false
  ): Promise<ModelFetchResult> {
    // 1. 无 API Key 时返回静态列表
    if (!apiKey) {
      return {
        models: this.getStaticModels(provider),
        fromCache: false,
      };
    }

    // 2. 检查缓存（非强制刷新时）
    if (!forceRefresh) {
      const cached = this.cache.get(provider);
      if (cached && !this.isCacheStale(cached.timestamp)) {
        return {
          models: cached.models,
          fromCache: true,
        };
      }
    }

    // 3. 防止重复请求（请求去重）
    const pendingKey = provider;
    if (this.pendingRequests.has(pendingKey)) {
      return this.pendingRequests.get(pendingKey)!;
    }

    // 4. 发起 API 请求
    const requestPromise = this.fetchFromAPI(provider, apiKey);
    this.pendingRequests.set(pendingKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.pendingRequests.delete(pendingKey);
    }
  }

  /**
   * 实际 API 调用（内部方法）
   */
  private async fetchFromAPI(
    provider: ProviderName,
    apiKey: string
  ): Promise<ModelFetchResult> {
    try {
      const models = await fetchModels(provider, apiKey);
      
      // Ensure we don't return models already in static list with different display names
      // or duplicate models by name from the API
      const staticModels = this.getStaticModels(provider);
      const uniqueModelsMap = new Map<string, LLMModel>();
      
      // Seed with static models (favors API display names if we find matches)
      staticModels.forEach(m => uniqueModelsMap.set(m.name, m));
      models.forEach(m => uniqueModelsMap.set(m.name, m));
      
      const uniqueModels = Array.from(uniqueModelsMap.values());

      // 更新缓存
      this.cache.set(provider, {
        models: uniqueModels,
        timestamp: Date.now(),
        provider,
      });

      return {
        models: uniqueModels,
        fromCache: false,
      };
    } catch (error) {
      // API 失败时降级到静态列表，增加上下文日志
      const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'none';
      console.warn(`[ModelService] API fetch failed for provider: ${provider}, key: ${maskedKey}, Error:`, error);
      
      return {
        models: this.getStaticModels(provider),
        error: error instanceof Error ? error.message : 'Unknown error',
        fromCache: false,
      };
    }
  }

  /**
   * 获取静态模型列表（降级方案）
   */
  getStaticModels(provider: ProviderName): LLMModel[] {
    const configs: ModelConfig[] = SUPPORTED_MODELS[provider] || SUPPORTED_MODELS.gemini;
    return configs.map(c => ({
      name: c.name,
      displayName: c.displayName,
      isFree: c.isFree,
    }));
  }

  /**
   * 检查缓存是否过期
   */
  private isCacheStale(timestamp: number): boolean {
    return Date.now() - timestamp > MODEL_CACHE_TTL_MS;
  }

  /**
   * 清除缓存（用于测试或手动刷新）
   */
  clearCache(provider?: ProviderName): void {
    if (provider) {
      this.cache.delete(provider);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 预热缓存（后台静默刷新）
   */
  async warmCache(provider: ProviderName, apiKey: string): Promise<void> {
    if (!apiKey) return;
    
    const cached = this.cache.get(provider);
    if (!cached || this.isCacheStale(cached.timestamp)) {
      // 静默刷新，不返回错误
      await this.getModels(provider, apiKey, false).catch(() => {});
    }
  }
}

// 导出单例
export const ModelService = new ModelServiceImpl();
