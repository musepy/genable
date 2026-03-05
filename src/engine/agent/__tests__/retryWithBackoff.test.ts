import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithBackoff, calculateDelay } from '../retry/retryWithBackoff';
import { isNetworkError, isFetchError, getNetworkErrorCode } from '../retry/networkErrors';
import { classifyError, isRetryableError, AgentErrorCategory, categoryToErrorCode } from '../retryPolicy';

// ─── retryWithBackoff ─────────────────────────────────────────

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('should succeed on first try without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await retryWithBackoff(fn, {
      shouldRetry: () => true,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error and succeed on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Overloaded'))
      .mockResolvedValueOnce('success');

    const onRetry = vi.fn();

    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      shouldRetry: () => true,
      onRetry,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.any(Error),
      expect.any(Number)
    );
  });

  it('should throw immediately on non-retryable error', async () => {
    const error = new Error('400 Invalid Argument');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 3,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('400 Invalid Argument');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should exhaust all attempts and throw the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Keep failing'));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        shouldRetry: () => true,
      })
    ).rejects.toThrow('Keep failing');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should call onBeforeRetry before each retry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('ok');

    const onBeforeRetry = vi.fn();

    await retryWithBackoff(fn, {
      maxAttempts: 4,
      initialDelayMs: 10,
      maxDelayMs: 100,
      shouldRetry: () => true,
      onBeforeRetry,
    });

    expect(onBeforeRetry).toHaveBeenCalledTimes(2);
    expect(onBeforeRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onBeforeRetry).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it('should abort immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue('should not reach');

    await expect(
      retryWithBackoff(fn, {
        signal: controller.signal,
        shouldRetry: () => true,
      })
    ).rejects.toThrow('Retry aborted');

    expect(fn).not.toHaveBeenCalled();
  });

  it('should throw on abort during retry delay', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('transient'));

    const promise = retryWithBackoff(fn, {
      maxAttempts: 5,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
      shouldRetry: () => true,
      signal: controller.signal,
    });

    // Abort shortly after the first failure
    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toThrow('Retry aborted');
  });
});

// ─── calculateDelay ───────────────────────────────────────────

describe('calculateDelay', () => {
  it('should increase with attempt number (exponential backoff)', () => {
    const d1 = calculateDelay(1, 1000, 30000, 2, 0);
    const d2 = calculateDelay(2, 1000, 30000, 2, 0);
    const d3 = calculateDelay(3, 1000, 30000, 2, 0);

    expect(d1).toBe(1000);
    expect(d2).toBe(2000);
    expect(d3).toBe(4000);
  });

  it('should respect maxDelayMs cap', () => {
    const delay = calculateDelay(10, 1000, 5000, 2, 0);
    expect(delay).toBe(5000);
  });

  it('should add jitter within expected range', () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      results.add(calculateDelay(1, 1000, 30000, 2, 0.3));
    }
    // With jitter factor 0.3, delay should be between 700 and 1300
    for (const d of results) {
      expect(d).toBeGreaterThanOrEqual(700);
      expect(d).toBeLessThanOrEqual(1300);
    }
    // Should have some variance (not all the same)
    expect(results.size).toBeGreaterThan(1);
  });
});

// ─── networkErrors ────────────────────────────────────────────

describe('networkErrors', () => {
  it('should detect ECONNRESET', () => {
    const err = new Error('connection reset');
    (err as any).code = 'ECONNRESET';
    expect(isNetworkError(err)).toBe(true);
  });

  it('should detect ETIMEDOUT', () => {
    const err = new Error('timed out');
    (err as any).code = 'ETIMEDOUT';
    expect(isNetworkError(err)).toBe(true);
  });

  it('should detect nested cause chain errors', () => {
    const innerErr = new Error('ssl error');
    (innerErr as any).code = 'EPROTO';
    const outerErr = new Error('request failed');
    (outerErr as any).cause = innerErr;
    expect(isNetworkError(outerErr)).toBe(true);
    expect(getNetworkErrorCode(outerErr)).toBe('EPROTO');
  });

  it('should return false for non-network errors', () => {
    expect(isNetworkError(new Error('400 Bad Request'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('should detect fetch failed errors', () => {
    expect(isFetchError(new Error('fetch failed'))).toBe(true);
    expect(isFetchError(new Error('Fetch Failed: network issue'))).toBe(true);
    expect(isFetchError(new Error('normal error'))).toBe(false);
  });
});

// ─── classifyError ────────────────────────────────────────────

describe('classifyError (retryPolicy)', () => {
  it('should classify network errors as RETRYABLE_NETWORK', () => {
    const err = new Error('connection issue');
    (err as any).code = 'ECONNRESET';
    expect(classifyError(err)).toBe(AgentErrorCategory.RETRYABLE_NETWORK);
  });

  it('should classify fetch errors as RETRYABLE_NETWORK', () => {
    expect(classifyError(new Error('fetch failed'))).toBe(AgentErrorCategory.RETRYABLE_NETWORK);
  });

  it('should classify 429 as RETRYABLE_RATE_LIMIT', () => {
    expect(classifyError(new Error('429 Too Many Requests'))).toBe(AgentErrorCategory.RETRYABLE_RATE_LIMIT);
  });

  it('should classify temporarily rate-limited as RETRYABLE_RATE_LIMIT', () => {
    expect(classifyError(new Error('temporarily rate-limited upstream'))).toBe(AgentErrorCategory.RETRYABLE_RATE_LIMIT);
  });

  it('should classify GeminiErrorType.QUOTA_EXCEEDED as RETRYABLE_RATE_LIMIT', () => {
    const err = { type: 'QUOTA_EXCEEDED', message: 'resource exhausted' };
    expect(classifyError(err)).toBe(AgentErrorCategory.RETRYABLE_RATE_LIMIT);
  });

  it('should classify billing/quota exhausted as NON_RETRYABLE_QUOTA', () => {
    expect(classifyError(new Error('quota exceeded, check billing'))).toBe(AgentErrorCategory.NON_RETRYABLE_QUOTA);
    expect(classifyError(new Error('insufficient credits'))).toBe(AgentErrorCategory.NON_RETRYABLE_QUOTA);
    expect(classifyError(new Error('billing limit reached'))).toBe(AgentErrorCategory.NON_RETRYABLE_QUOTA);
  });

  it('should NOT classify "temporarily" quota messages as NON_RETRYABLE_QUOTA', () => {
    expect(classifyError(new Error('temporarily quota exceeded'))).toBe(AgentErrorCategory.RETRYABLE_RATE_LIMIT);
  });

  it('should classify 503 as RETRYABLE_TRANSIENT', () => {
    expect(classifyError(new Error('503 Service Unavailable'))).toBe(AgentErrorCategory.RETRYABLE_TRANSIENT);
  });

  it('should classify OVERLOADED as RETRYABLE_TRANSIENT', () => {
    const err = { type: 'OVERLOADED', message: 'overloaded' };
    expect(classifyError(err)).toBe(AgentErrorCategory.RETRYABLE_TRANSIENT);
  });

  it('should classify MALFORMED_FUNCTION_CALL as RETRYABLE_MALFORMED', () => {
    expect(classifyError(new Error('MALFORMED_FUNCTION_CALL'))).toBe(AgentErrorCategory.RETRYABLE_MALFORMED);
  });

  it('should classify INVALID_ARGUMENT as NON_RETRYABLE_INPUT', () => {
    const err = { type: 'INVALID_ARGUMENT', message: 'invalid argument' };
    expect(classifyError(err)).toBe(AgentErrorCategory.NON_RETRYABLE_INPUT);
  });

  it('should classify LOCAL_EXEC_ERROR as LOCAL_TOOL_ERROR', () => {
    const err = { code: 'LOCAL_EXEC_ERROR', message: 'exec failed' };
    expect(classifyError(err)).toBe(AgentErrorCategory.LOCAL_TOOL_ERROR);
  });

  it('should classify unknown errors as NON_RETRYABLE_LOGIC', () => {
    expect(classifyError(new Error('something weird'))).toBe(AgentErrorCategory.NON_RETRYABLE_LOGIC);
  });

  it('isRetryableError should return true for retryable categories', () => {
    expect(isRetryableError(new Error('503 overloaded'))).toBe(true);
    expect(isRetryableError(new Error('429 rate limit'))).toBe(true);
    expect(isRetryableError(new Error('MALFORMED_FUNCTION_CALL'))).toBe(true);
  });

  it('isRetryableError should return false for non-retryable categories', () => {
    expect(isRetryableError(new Error('something unknown'))).toBe(false);
    expect(isRetryableError(new Error('quota exceeded, check billing'))).toBe(false);
  });
});

// ─── categoryToErrorCode ──────────────────────────────────────

describe('categoryToErrorCode', () => {
  it('should map categories to error codes', () => {
    expect(categoryToErrorCode(AgentErrorCategory.RETRYABLE_TRANSIENT)).toBe('TOOL_TRANSIENT_ERROR');
    expect(categoryToErrorCode(AgentErrorCategory.RETRYABLE_MALFORMED)).toBe('TOOL_FORMAT_ERROR');
    expect(categoryToErrorCode(AgentErrorCategory.RETRYABLE_RATE_LIMIT)).toBe('TOOL_RATE_LIMIT');
    expect(categoryToErrorCode(AgentErrorCategory.NON_RETRYABLE_QUOTA)).toBe('TOOL_QUOTA_ERROR');
    expect(categoryToErrorCode(AgentErrorCategory.RETRYABLE_NETWORK)).toBe('TOOL_NETWORK_ERROR');
    expect(categoryToErrorCode(AgentErrorCategory.NON_RETRYABLE_INPUT)).toBe('TOOL_INVALID_INPUT');
    expect(categoryToErrorCode(AgentErrorCategory.LOCAL_TOOL_ERROR)).toBe('TOOL_EXECUTION_ERROR');
    expect(categoryToErrorCode(AgentErrorCategory.NON_RETRYABLE_LOGIC)).toBe('TOOL_UNKNOWN_ERROR');
  });
});
