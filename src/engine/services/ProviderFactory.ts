/**
 * @file ProviderFactory.ts
 * @description Pure factory for LLM provider instantiation.
 *
 * Primary entry: createProviderFromConfig(ProviderConfig) — dispatches by
 * `protocol` field to one of three protocol handlers (openai / anthropic /
 * gemini). This is what the post-Phase-7 codebase will use exclusively.
 *
 * Legacy entry: createProvider(ProviderFactoryInput) — kept during the
 * transition while AgentOrchestrator still receives the pre-V2 settings shape
 * (providerName + apiKey + modelName). Internally translates to a
 * ProviderConfig and calls createProviderFromConfig. Phase 9 deletes this.
 *
 * Proxy provider (subscription-token auth, Cloudflare Worker SSE) sits outside
 * the protocol model and stays in the legacy adapter only.
 */

import { OpenAIProtocolProvider } from '../llm-client/providers/openai-protocol';
import { AnthropicProtocolProvider } from '../llm-client/providers/anthropic-protocol';
import { GeminiProtocolProvider } from '../llm-client/providers/gemini-protocol';
import { ProxyProvider } from '../llm-client/providers/proxy';
import { LLMProvider } from '../llm-client/providers/types';
import type { ProviderConfig } from '../../types/provider';
import { wrapBaseURLForProxy } from '../llm-client/proxyWrap';

export interface ProviderFactoryOutput {
  provider: LLMProvider;
  /** Human-readable label, e.g. "OpenRouter", "Claude (DashScope)", "Gemini". */
  resolvedDisplayName: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Primary entry — protocol dispatch
// ─────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a ProviderConfig to the right protocol handler. Pure function.
 *
 * If `config.requiresProxy` is set, the baseURL is rewritten to go through the
 * Worker proxy before instantiation — protocol handlers stay unaware of the
 * proxy and just see a baseURL they can append paths to.
 */
export function createProviderFromConfig(config: ProviderConfig): ProviderFactoryOutput {
  const cfg = wrapBaseURLForProxy(config);
  switch (cfg.protocol) {
    case 'openai':
      return {
        provider: new OpenAIProtocolProvider(cfg),
        resolvedDisplayName: cfg.name,
      };
    case 'anthropic':
      return {
        provider: new AnthropicProtocolProvider(cfg),
        resolvedDisplayName: cfg.name,
      };
    case 'gemini':
      return {
        provider: new GeminiProtocolProvider(cfg),
        resolvedDisplayName: cfg.name,
      };
    default: {
      // Exhaustiveness check — adding a new Protocol forces a compile error here
      const _exhaustive: never = cfg.protocol;
      throw new Error(`[ProviderFactory] Unknown protocol: ${String(_exhaustive)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy entry — adapter kept until Phase 7 wires the new settings shape.
// Phase 9 deletes everything below this line.
// ─────────────────────────────────────────────────────────────────────────

export interface ProviderFactoryInput {
  providerName: string;
  modelName: string;
  apiKey: string;
  workerUrl?: string;
  subscriptionToken?: string;
}

/**
 * @deprecated Use createProviderFromConfig with a ProviderConfig.
 * Translates the legacy (providerName, modelName, apiKey) shape to a
 * ProviderConfig and dispatches via the protocol handler. Proxy provider
 * stays as a special path here.
 */
export function createProvider(input: ProviderFactoryInput): ProviderFactoryOutput {
  const { providerName, modelName, apiKey, workerUrl, subscriptionToken } = input;

  // Proxy — subscription-token auth via Cloudflare Worker SSE. Does not fit
  // the protocol model; stays as its own path.
  if (providerName === 'proxy') {
    if (!workerUrl || !subscriptionToken) {
      throw new Error('[ProviderFactory] ProxyProvider requires workerUrl and subscriptionToken');
    }
    const provider = new ProxyProvider(workerUrl, subscriptionToken, modelName);
    return { provider, resolvedDisplayName: `Proxy (${workerUrl})` };
  }

  const { config, displayName } = legacyToConfig(providerName, modelName, apiKey);
  const out = createProviderFromConfig(config);
  return { provider: out.provider, resolvedDisplayName: displayName };
}

/**
 * Translate a legacy provider name + key + model into a ProviderConfig.
 * Mirrors the baseURL/headers conventions previously hardcoded in the
 * per-vendor provider classes (preserved verbatim for behavior parity).
 */
function legacyToConfig(
  providerName: string,
  modelName: string,
  apiKey: string,
): { config: ProviderConfig; displayName: string } {
  switch (providerName) {
    case 'openrouter':
      return {
        config: {
          id: 'legacy-openrouter',
          name: 'OpenRouter',
          protocol: 'openai',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
          modelId: modelName,
          headers: {
            'HTTP-Referer': 'https://github.com/musepy/genable',
            'X-Title': 'Genable Figma Plugin',
          },
        },
        displayName: 'OpenRouter',
      };

    case 'dashscope':
      return {
        config: {
          id: 'legacy-dashscope',
          name: 'DashScope',
          protocol: 'openai',
          baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
          apiKey,
          modelId: modelName,
          headers: {
            'User-Agent': 'claude-cli/2.0.57 (external, cli)',
          },
        },
        displayName: 'DashScope',
      };

    case 'claude': {
      // Legacy heuristic: sk-ant- prefix → native Anthropic; else → DashScope-compat
      const isNative = apiKey.startsWith('sk-ant-');
      return {
        config: {
          id: 'legacy-claude',
          name: isNative ? 'Claude' : 'Claude (DashScope)',
          protocol: 'anthropic',
          baseURL: isNative
            ? 'https://api.anthropic.com/v1'
            : 'https://dashscope.aliyuncs.com/apps/anthropic/v1',
          apiKey,
          modelId: modelName,
        },
        displayName: isNative ? 'Claude' : 'Claude (DashScope)',
      };
    }

    case 'gemini':
    default:
      return {
        config: {
          id: 'legacy-gemini',
          name: 'Gemini',
          protocol: 'gemini',
          baseURL: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey,
          modelId: modelName,
        },
        displayName: 'Gemini',
      };
  }
}
