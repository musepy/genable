/**
 * @file ProviderFactory.ts
 * @description Pure factory function for LLM provider instantiation.
 * Takes a provider name + credentials and returns the concrete LLMProvider
 * along with a human-readable display name (for SEND_LOG, telemetry, etc).
 *
 * Design: pure function — no side-effects (no emit, no console). The caller
 * (AgentOrchestrator) is responsible for logging/emitting after calling this.
 */

import { GeminiProvider, OpenRouterProvider, DashScopeProvider, AnthropicProvider, ANTHROPIC_CONFIG } from '../llm-client';
import { ProxyProvider } from '../llm-client/providers/proxy';
import { LLMProvider } from '../llm-client/providers/types';

export interface ProviderFactoryInput {
  providerName: string;
  modelName: string;
  apiKey: string;
  workerUrl?: string;
  subscriptionToken?: string;
}

export interface ProviderFactoryOutput {
  provider: LLMProvider;
  /** Human-readable label, e.g. "OpenRouter", "Claude (DashScope)", "Gemini". */
  resolvedDisplayName: string;
}

/**
 * Instantiate the correct LLMProvider for the given provider name + credentials.
 * Pure function — throws on missing required fields, never emits or logs.
 */
export function createProvider(input: ProviderFactoryInput): ProviderFactoryOutput {
  const { providerName, modelName, apiKey, workerUrl, subscriptionToken } = input;

  if (providerName === 'openrouter') {
    const provider = new OpenRouterProvider(apiKey, modelName);
    return { provider, resolvedDisplayName: 'OpenRouter' };
  }

  if (providerName === 'dashscope') {
    let fetchProxy: ((url: string, init: any) => Promise<{ ok: boolean; status: number; body: string }>) | undefined;
    if (workerUrl) {
      // Sync fallback: route through Worker CORS proxy (sandbox fetch → Worker → DashScope)
      fetchProxy = async (_url: string, init: any) => {
        const res = await fetch(`${workerUrl}/api/dashscope/generate-sync`, {
          method: 'POST',
          headers: init.headers,
          body: init.body,
        });
        const body = await res.text();
        return { ok: res.ok, status: res.status, body };
      };
    }
    // workerUrl enables streaming (SSE via /api/dashscope/generate); fetchProxy is sync fallback
    // Vision capability: VL models, kimi-k2.5, and qwen3.* series
    const supportsVision = /vl|kimi|qwen3/i.test(modelName);
    const provider = new DashScopeProvider(apiKey, modelName, fetchProxy, workerUrl, { supportsVision });
    return { provider, resolvedDisplayName: 'DashScope' };
  }

  if (providerName === 'claude') {
    // Auto-detect: sk-ant- prefix = native Anthropic, otherwise DashScope-compatible
    const isNativeKey = apiKey.startsWith('sk-ant-');
    const baseUrl = isNativeKey ? undefined : ANTHROPIC_CONFIG.DASHSCOPE_BASE_URL;
    const provider = new AnthropicProvider(apiKey, modelName, baseUrl);
    const resolvedDisplayName = isNativeKey ? 'Claude' : 'Claude (DashScope)';
    return { provider, resolvedDisplayName };
  }

  if (providerName === 'proxy') {
    if (!workerUrl || !subscriptionToken) {
      throw new Error('[ProviderFactory] ProxyProvider requires workerUrl and subscriptionToken');
    }
    const provider = new ProxyProvider(workerUrl, subscriptionToken, modelName);
    return { provider, resolvedDisplayName: `Proxy (${workerUrl})` };
  }

  // Default: Gemini
  const provider = new GeminiProvider(apiKey, modelName);
  return { provider, resolvedDisplayName: 'Gemini' };
}
