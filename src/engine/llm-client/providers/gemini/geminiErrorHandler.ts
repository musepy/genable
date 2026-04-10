/**
 * @file geminiErrorHandler.ts
 * @description Maps Gemini SDK exceptions and Gemini-specific response shapes
 * to typed `ProviderError` instances.
 *
 * Replaces the previous `GeminiError`/`GeminiErrorType` enum-based design.
 * The enum is preserved as `GeminiErrorTag` metadata for finer-grained logging
 * but the error type seen by callers is the unified `ProviderError` hierarchy.
 */

import { GEMINI_CONFIG } from '../../config';
import { GeminiLogger } from './geminiLogger';
import {
  ProviderError,
  APIError,
  TransportError,
  EmptyResponseError,
  MalformedToolCallError,
  OutputTooLongError,
} from '../shared/providerErrors';

const PROVIDER_NAME = 'gemini';

/**
 * Optional tag for sub-categorizing Gemini errors in logs / analytics.
 * The runtime should NOT branch on these — branch on `ProviderError` subclasses instead.
 */
export enum GeminiErrorTag {
  RECITATION_BLOCKED = 'RECITATION_BLOCKED',
  SAFETY_BLOCKED = 'SAFETY_BLOCKED',
}

/**
 * Content-filter / safety errors. We extend ProviderError so the runtime
 * sees a uniform error type, but tag = which kind of filter triggered.
 */
export class GeminiContentBlockedError extends ProviderError {
  readonly category = 'content';
  readonly userActionable = true;
  readonly userMessage: string;

  constructor(public readonly tag: GeminiErrorTag, message: string) {
    super(PROVIDER_NAME, message);
    if (tag === GeminiErrorTag.RECITATION_BLOCKED) {
      this.userMessage = 'Gemini 因版权过滤拒绝了响应。请改写 prompt 避免直接引用。';
    } else {
      this.userMessage = 'Gemini 因安全过滤拒绝了响应。请改写 prompt 避免敏感内容。';
    }
  }
}

export class GeminiErrorHandler {
  /**
   * Maps an exception thrown by the GenAI SDK to a ProviderError.
   * Always throws — never returns.
   */
  static handleSdkError(error: any): never {
    const message = error?.message || String(error);
    const lowerMessage = message.toLowerCase();

    if (message.includes('503') || lowerMessage.includes('overloaded')) {
      throw new APIError(PROVIDER_NAME, 503, message);
    }

    if (message.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      throw new APIError(PROVIDER_NAME, 429, message);
    }

    if (message.includes('400') || lowerMessage.includes('invalid')) {
      throw new APIError(PROVIDER_NAME, 400, message);
    }

    // Unknown / network — wrap as TransportError for consistency
    throw new TransportError(PROVIDER_NAME, message, error);
  }

  /**
   * Inspects a Gemini API response shape for in-band errors that aren't
   * surfaced as SDK exceptions (e.g. finishReason='MALFORMED_FUNCTION_CALL').
   */
  static handleResponseError(response: any): void {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === 'MALFORMED_FUNCTION_CALL') {
      const usage = response.usageMetadata;
      const configMaxTokens = GEMINI_CONFIG.MAX_OUTPUT_TOKENS;
      const actualOutputTokens = usage?.candidatesTokenCount || 0;
      const isTokenLimitExceeded = actualOutputTokens >= configMaxTokens;

      GeminiLogger.error('MALFORMED_FUNCTION_CALL detected:', {
        finishReason, configMaxTokens, actualOutputTokens, isTokenLimitExceeded,
      });

      // If we exceeded max_tokens, the truncation IS the cause — raise that
      // error so the user sees the correct guidance (raise max_tokens / split task).
      if (isTokenLimitExceeded) {
        throw new OutputTooLongError(PROVIDER_NAME, configMaxTokens, '');
      }

      throw new MalformedToolCallError(PROVIDER_NAME, JSON.stringify(candidate?.content || {}));
    }

    if (finishReason === 'RECITATION') {
      throw new GeminiContentBlockedError(
        GeminiErrorTag.RECITATION_BLOCKED,
        'Gemini blocked the response due to recitation (copyright) filters.',
      );
    }

    if (finishReason === 'SAFETY') {
      throw new GeminiContentBlockedError(
        GeminiErrorTag.SAFETY_BLOCKED,
        'Gemini blocked the response due to safety filters.',
      );
    }
  }

  /**
   * Validates that the streaming accumulator yielded *something*.
   * Empty → throw EmptyResponseError (handled by runtime, surfaces to user).
   */
  static validateResponseContent(text: string, toolCalls: any[] | undefined, thoughts: string): void {
    if (!text && (!toolCalls || toolCalls.length === 0) && !thoughts) {
      GeminiLogger.warn('Empty response detected');
      throw new EmptyResponseError(PROVIDER_NAME, 'Gemini produced no text, thoughts, or tool calls');
    }
  }
}
