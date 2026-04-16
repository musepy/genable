/**
 * @file providerErrors.ts
 * @description Typed error hierarchy for LLM providers.
 *
 * Design principles (Fail-Fast + Decoupled Layers):
 * - Providers throw typed errors instead of fabricating LLMResponse fields
 * - Each error knows whether it is user-actionable and carries a Chinese
 *   user-facing message for direct UI display
 * - The runtime never silently retries provider failures — it surfaces them
 *
 * Replaces the old string-matching `classifyError` in retryPolicy.ts.
 */

export type ProviderErrorCategory = 'transport' | 'protocol' | 'api' | 'content';

/**
 * Base class for all provider-layer errors.
 * Subclasses must declare category, userActionable, and userMessage.
 */
export abstract class ProviderError extends Error {
  abstract readonly category: ProviderErrorCategory;
  /** Should the UI surface this in an ErrorBanner with a retry CTA? */
  abstract readonly userActionable: boolean;
  /** Chinese, user-facing message with concrete next steps. */
  abstract readonly userMessage: string;

  constructor(public readonly providerName: string, message: string, public readonly cause?: unknown) {
    super(`[${providerName}] ${message}`);
    this.name = this.constructor.name;
  }
}

// ---------------------------------------------------------------------------
// Transport category — network / streaming layer
// Providers throw these raw; the shared withRetry layer decides if it is
// worth another attempt. After exhaustion these surface to the user.
// ---------------------------------------------------------------------------

export class ConnectTimeoutError extends ProviderError {
  readonly category = 'transport';
  readonly userActionable = true;
  readonly userMessage = '连接超时。请检查网络后重试，或换一个 provider。';

  constructor(providerName: string, public readonly timeoutMs: number) {
    super(providerName, `Connect timed out after ${timeoutMs}ms`);
  }
}

export class TransportError extends ProviderError {
  readonly category = 'transport';
  readonly userActionable = true;
  readonly userMessage = '网络请求失败。请检查网络后重试。';

  constructor(providerName: string, message: string, cause?: unknown) {
    super(providerName, message, cause);
  }
}

// ---------------------------------------------------------------------------
// API category — HTTP-level error from upstream
// Providers throw these raw; withRetry (isRetryable) decides 5xx/429 = retry,
// 4xx = fail-fast. These surface to the user after retry exhaustion.
// ---------------------------------------------------------------------------

export class APIError extends ProviderError {
  readonly category = 'api';
  readonly userActionable: boolean;
  readonly userMessage: string;

  constructor(
    providerName: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(providerName, `API error ${statusCode}: ${body.slice(0, 200)}`);

    if (statusCode === 401 || statusCode === 403) {
      this.userActionable = true;
      this.userMessage = 'API key 无效或权限不足。请到设置里检查 API key。';
    } else if (statusCode === 429) {
      this.userActionable = true;
      this.userMessage = 'API 限流或额度耗尽。请稍后重试，或检查 provider 账户余额。';
    } else if (statusCode >= 500) {
      this.userActionable = true;
      this.userMessage = `Provider 服务端错误 (${statusCode})。请稍后重试，或换一个 provider。`;
    } else if (statusCode === 400) {
      this.userActionable = true;
      this.userMessage = '请求参数无效。可能是 prompt 太长或包含模型不接受的内容。请精简 prompt 后重试。';
    } else {
      this.userActionable = false;
      this.userMessage = `请求被拒绝 (${statusCode})。这通常是程序 bug，请反馈。`;
    }
  }
}

// ---------------------------------------------------------------------------
// Content category — LLM responded successfully but the content is unusable
// ---------------------------------------------------------------------------

/**
 * The provider received a complete response but it contained no text and
 * no tool calls. This used to be silently retried by emptyResponseHook.
 */
export class EmptyResponseError extends ProviderError {
  readonly category = 'content';
  readonly userActionable = true;
  readonly userMessage = 'LLM 返回了空响应。可能是模型困惑或 prompt 触发了拒答。请改写 prompt 或换一个模型。';

  constructor(providerName: string, message = 'Provider returned empty content') {
    super(providerName, message);
  }
}

/**
 * The model genuinely hit max_tokens (finishReason='length' from the API).
 * This is a real LLM-level truncation — distinct from network idle timeout
 * which used to be conflated with this case.
 */
export class OutputTooLongError extends ProviderError {
  readonly category = 'content';
  readonly userActionable = true;
  readonly userMessage: string;

  constructor(
    providerName: string,
    public readonly maxTokens: number | undefined,
    public readonly completedText: string,
  ) {
    super(providerName, `Output reached max_tokens=${maxTokens ?? 'unknown'}`);
    this.userMessage = `LLM 输出达到 max_tokens 上限${maxTokens ? ` (${maxTokens})` : ''}。建议：(1) 把任务拆成多步，(2) 让 LLM 用更紧凑的格式（jsx 优于 mk），(3) 在设置里调高 max_tokens。`;
  }
}

/**
 * The model produced a tool call whose JSON arguments could not be parsed.
 * Used to be silently retried with a "malformed hint" injected message.
 */
export class MalformedToolCallError extends ProviderError {
  readonly category = 'content';
  readonly userActionable = true;
  readonly userMessage = 'LLM 生成的工具调用语法错误。建议：换一个模型，或简化请求让 LLM 一次少做点事。';

  constructor(providerName: string, public readonly rawCall: string, cause?: unknown) {
    super(providerName, `Malformed tool call: ${rawCall.slice(0, 200)}`, cause);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard. Use this in catch blocks to avoid `instanceof` chains. */
export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/**
 * Maps a ProviderError category to a stable error code for tool-result
 * payloads and analytics. Replaces categoryToErrorCode from retryPolicy.ts.
 */
export function providerErrorToCode(e: ProviderError): string {
  if (e instanceof ConnectTimeoutError) return 'CONNECT_TIMEOUT';
  if (e instanceof TransportError) return 'TRANSPORT_ERROR';
  if (e instanceof APIError) return `API_ERROR_${e.statusCode}`;
  if (e instanceof EmptyResponseError) return 'EMPTY_RESPONSE';
  if (e instanceof OutputTooLongError) return 'OUTPUT_TOO_LONG';
  if (e instanceof MalformedToolCallError) return 'MALFORMED_TOOL_CALL';
  return 'PROVIDER_ERROR';
}
