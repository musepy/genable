/**
 * @file geminiErrorHandler.ts
 * @description Centralized error handling logic for Gemini LLM Provider.
 */

import { GEMINI_CONFIG } from '../../config';
import { GeminiLogger } from './geminiLogger';

export enum GeminiErrorType {
  OVERLOADED = 'OVERLOADED',
  MALFORMED_FUNCTION_CALL = 'MALFORMED_FUNCTION_CALL',
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  RECITATION_BLOCKED = 'RECITATION_BLOCKED',
  SAFETY_BLOCKED = 'SAFETY_BLOCKED',
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Unified error object for Gemini provider
 */
export class GeminiError extends Error {
  constructor(
    public type: GeminiErrorType,
    message: string,
    public details?: Record<string, any>,
    public rawError?: any
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Utility class to handle and unify Gemini-specific errors
 */
export class GeminiErrorHandler {
  /**
   * Processes exceptions thrown by the GenAI SDK
   */
  static handleSdkError(error: any): never {
    const message = error.message || String(error);
    const lowerMessage = message.toLowerCase();

    // 503 Overloaded
    if (message.includes('503') || lowerMessage.includes('overloaded')) {
      throw new GeminiError(
        GeminiErrorType.OVERLOADED,
        'Gemini model is currently overloaded (503). This usually happens during high traffic. Please try again in a few moments.',
        undefined,
        error
      );
    }

    // 429 Quota Exceeded
    if (message.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      throw new GeminiError(
        GeminiErrorType.QUOTA_EXCEEDED,
        'Gemini API quota exceeded (429). Please check your billing status or wait for the quota to reset.',
        undefined,
        error
      );
    }

    // 400 Invalid Argument
    if (message.includes('400') || lowerMessage.includes('invalid')) {
      throw new GeminiError(
        GeminiErrorType.INVALID_ARGUMENT,
        `Gemini received an invalid argument: ${message}`,
        undefined,
        error
      );
    }

    // Default rethrow - but ensure it's a useful string if the source is an unknown object
    if (typeof error === 'object' && error !== null && !error.message) {
      const fallbackMsg = `Unknown SDK Error: ${JSON.stringify(error)}`;
      const wrappedError = new Error(fallbackMsg);
      (wrappedError as any).rawError = error;
      throw wrappedError;
    }
    
    throw error;
  }

  /**
   * Processes errors found within the response structure (e.g. Candidates)
   */
  static handleResponseError(response: any): void {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === 'MALFORMED_FUNCTION_CALL') {
      const usage = response.usageMetadata;
      const configMaxTokens = GEMINI_CONFIG.MAX_OUTPUT_TOKENS;
      const actualOutputTokens = usage?.candidatesTokenCount || 0;
      const isTokenLimitExceeded = actualOutputTokens >= configMaxTokens;

      const details = {
        finishReason,
        configMaxTokens,
        actualOutputTokens,
        isTokenLimitExceeded,
        promptTokens: usage?.promptTokenCount,
        totalTokens: usage?.totalTokenCount,
      };

      GeminiLogger.error('MALFORMED_FUNCTION_CALL detected:', details);

      let errorMessage = 'Gemini produced a malformed function call (MALFORMED_FUNCTION_CALL).';
      if (isTokenLimitExceeded) {
        errorMessage += ` This was likely caused by exceeding the output token limit (${actualOutputTokens} >= ${configMaxTokens}), which truncated the function call.`;
      } else {
        errorMessage += ' This can happen if the model fails to follow the tool call syntax correctly.';
      }

      throw new GeminiError(GeminiErrorType.MALFORMED_FUNCTION_CALL, errorMessage, details);
    }

    if (finishReason === 'RECITATION') {
      throw new GeminiError(
        GeminiErrorType.RECITATION_BLOCKED,
        'Gemini blocked the response due to recitation (copyright) filters.'
      );
    }

    if (finishReason === 'SAFETY') {
      throw new GeminiError(
        GeminiErrorType.SAFETY_BLOCKED,
        'Gemini blocked the response due to safety filters.'
      );
    }
  }

  /**
   * Validates that the response contains at least some useful content
   */
  static validateResponseContent(text: string, toolCalls: any[] | undefined, thoughts: string): void {
    if (!text && (!toolCalls || toolCalls.length === 0) && !thoughts) {
      GeminiLogger.warn('Empty response detected');
      throw new GeminiError(
        GeminiErrorType.EMPTY_RESPONSE,
        'Gemini produced an empty response (no text, thoughts, or tool calls).'
      );
    }
  }
}
