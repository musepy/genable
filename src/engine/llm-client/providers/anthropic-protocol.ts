/**
 * @file anthropic-protocol.ts
 * @description Generic Anthropic Messages API protocol provider. Replaces the
 * per-vendor anthropic.ts handler with a single dispatcher keyed off
 * ProviderConfig.protocol === 'anthropic'. Vendor differences (DashScope's
 * anthropic-compat endpoint, OpenCode Zen, native Anthropic) come from
 * `config.baseURL` + `config.headers`, not subclasses.
 *
 * Absorbed: anthropic.ts (native Anthropic + DashScope anthropic-compat).
 *
 * Dropped:
 *   - Implicit baseURL fallback (`baseUrl || ANTHROPIC_CONFIG.BASE_URL`).
 *     ProviderConfig.baseURL is required.
 *   - Reference to ANTHROPIC_CONFIG.DASHSCOPE_BASE_URL (deleted in Phase 9).
 *   - Throw-on-unknown-model in resolveAnthropicMaxOutput. Replaced with
 *     warn + DEFAULT_MAX_OUTPUT fallback (matches openai-protocol.ts pattern).
 *
 * Streaming is NOT implemented — supportsTextStreaming: false. Adding SSE for
 * the Anthropic Messages API is out of scope for this refactor; only generate()
 * needs to work.
 */

import type { ProviderConfig } from '../../../types/provider';
import {
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMMessage,
  LLMToolResult,
  LLMProviderCapabilities,
  formatResponseDefault,
  formatToolResultsDefault,
  getToolSystemInstructionDefault,
} from './types';
import type { ToolDefinition } from '../../agent/tools/types';
import { mapMessagesToAnthropic, mapAnthropicToLLMResponse } from './shared/anthropicFormat';
import { withRetry } from './shared/withRetry';
import {
  APIError,
  TransportError,
  EmptyResponseError,
} from './shared/providerErrors';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic API version pinned for native api.anthropic.com requests.
 * Ported from ANTHROPIC_CONFIG.API_VERSION (config.ts:92) so the protocol
 * handler is independent of the global config (which goes away in Phase 9).
 */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Retry budget — mirror openai-protocol.ts. */
const RETRY_MAX = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Default max_output_tokens cap when modelId is not in our hint registry.
 * Anthropic-class models generally support large outputs (Sonnet 4 = 64k,
 * Opus = 32k, Haiku = 16k), so the conservative-but-useful default is 32k.
 * Anthropic hard-rejects over-limit requests, so we always cap; we just don't
 * throw on unknown ids the way the old anthropic.ts did.
 */
const DEFAULT_MAX_OUTPUT = 32_000;

/**
 * Hint registry for known Anthropic model ids. Combines values previously
 * hardcoded in anthropic.ts:27-29 with current published caps from
 * platform.claude.com/docs. Unknown ids fall back to DEFAULT_MAX_OUTPUT
 * with a warn — never throw. This matches openai-protocol.ts:101-112.
 */
const KNOWN_MAX_OUTPUT: Record<string, number> = {
  // Sonnet family
  'claude-sonnet-4-20250514': 64_000, // legacy id, deprecated 2026-04-14
  'claude-sonnet-4-5': 64_000,
  'claude-sonnet-4-6': 64_000,
  'claude-sonnet-4-7': 64_000,
  // Opus family
  'claude-opus-4-5': 32_000,
  'claude-opus-4-6': 32_000,
  'claude-opus-4-7': 32_000,
  // Haiku family
  'claude-haiku-4-5': 16_000,
  'claude-haiku-4-6': 16_000,
};

/** Resolve max output for a model — registry hint, else default. Never throws. */
function resolveMaxOutput(modelId: string, requested?: number): number {
  const cap = KNOWN_MAX_OUTPUT[modelId];
  if (cap == null) {
    console.warn(
      `[anthropic-protocol] Model "${modelId}" not in KNOWN_MAX_OUTPUT registry; ` +
        `falling back to ${DEFAULT_MAX_OUTPUT}. Add an entry if the upstream cap is higher.`,
    );
    const fallback = DEFAULT_MAX_OUTPUT;
    return requested != null ? Math.min(requested, fallback) : fallback;
  }
  return requested != null ? Math.min(requested, cap) : cap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export class AnthropicProtocolProvider implements LLMProvider {
  public readonly name = 'anthropic-protocol';

  constructor(private readonly config: ProviderConfig) {
    if (!config.modelId) {
      throw new Error('[anthropic-protocol] ProviderConfig.modelId is required');
    }
    if (!config.baseURL) {
      throw new Error('[anthropic-protocol] ProviderConfig.baseURL is required');
    }
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsTextStreaming: false,
      supportsReasoningStreaming: false,
      supportsVision: true,
      contextWindow: 200_000,
    };
  }

  // ── LLMProvider surface ────────────────────────────────────────────────────

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(
      () => this.runSync(options),
      {
        maxRetries: RETRY_MAX,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        abortSignal: options.abortSignal,
        providerName: this.name,
      },
    );
  }

  formatResponse(response: LLMResponse): LLMMessage {
    return formatResponseDefault(response);
  }

  formatToolResults(results: LLMToolResult[]): LLMMessage {
    return formatToolResultsDefault(results);
  }

  getToolSystemInstruction(tools: ToolDefinition[]): string {
    return getToolSystemInstructionDefault(tools);
  }

  // ── Request building ───────────────────────────────────────────────────────

  private buildRequestBody(options: LLMGenerateOptions): Record<string, any> {
    const { messages, tools, temperature, maxTokens, toolConfig } = options;

    const body: Record<string, any> = {
      model: this.config.modelId,
      max_tokens: resolveMaxOutput(this.config.modelId!, maxTokens),
      messages: mapMessagesToAnthropic(messages),
    };

    if (options.system) body.system = options.system;
    if (temperature !== undefined) body.temperature = temperature;

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const mode = toolConfig?.mode || 'AUTO';
      if (mode === 'ANY') {
        body.tool_choice = { type: 'any' };
      } else if (mode === 'NONE') {
        // Anthropic has no 'none' tool_choice — drop tools entirely so the
        // model can't be tempted (anthropic.ts:236-238).
        delete body.tools;
      } else {
        body.tool_choice = { type: 'auto' };
      }
    }

    return body;
  }

  /**
   * Build request headers. Native Anthropic requires the version header and
   * the browser-access flag; compat endpoints (DashScope, OpenCode Zen) reject
   * or ignore them, so we gate on the base URL host.
   *
   * Order: vendor headers spread first; auth + content-type pinned last so a
   * malformed preset can't override them.
   */
  private headers(): Record<string, string> {
    const isNativeAnthropic = this.config.baseURL.includes('api.anthropic.com');

    const merged: Record<string, string> = {
      ...(this.config.headers || {}),
      'x-api-key': this.config.apiKey,
      'content-type': 'application/json',
    };

    if (isNativeAnthropic) {
      // DashScope's anthropic-compat endpoint rejects these headers; OpenCode
      // Zen ignores them — only set when we're talking to api.anthropic.com.
      merged['anthropic-version'] = ANTHROPIC_API_VERSION;
      merged['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    return merged;
  }

  private endpoint(): string {
    // ProviderConfig.baseURL ends in /v1 (or equivalent). For native Anthropic,
    // `https://api.anthropic.com/v1` + `/messages` = the documented path.
    // For OpenCode Zen, `https://opencode.ai/zen/v1/messages` is verified.
    return `${this.config.baseURL}/messages`;
  }

  // ── Sync (non-streaming) ───────────────────────────────────────────────────

  private async runSync(options: LLMGenerateOptions): Promise<LLMResponse> {
    const body = this.buildRequestBody(options);

    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new TransportError(this.name, 'Aborted', e);
      throw new TransportError(this.name, e?.message || 'fetch failed', e);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new APIError(this.name, response.status, errText);
    }

    const data = await response.json();
    const mapped = mapAnthropicToLLMResponse(data);

    const hasText = !!mapped.text && mapped.text.length > 0;
    const hasToolCalls = !!mapped.toolCalls && mapped.toolCalls.length > 0;
    if (!hasText && !hasToolCalls) {
      throw new EmptyResponseError(this.name);
    }
    return mapped;
  }
}
