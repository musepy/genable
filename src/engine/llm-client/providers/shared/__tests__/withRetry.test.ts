import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../withRetry';
import {
  TransportError,
  APIError,
  EmptyResponseError,
  MalformedToolCallError,
} from '../providerErrors';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first call succeeds → does not retry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, providerName: 't' });
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('first attempt throws retryable, second succeeds → returns result', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransportError('t', 'dropped'))
      .mockResolvedValueOnce('recovered');

    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, providerName: 't' });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries → throws the last error as-is', async () => {
    const lastErr = new APIError('t', 503, 'still down');
    const fn = vi.fn()
      .mockRejectedValueOnce(new APIError('t', 502, 'bad gw'))
      .mockRejectedValueOnce(new APIError('t', 503, 'unavail'))
      .mockRejectedValueOnce(new APIError('t', 503, 'unavail'))
      .mockRejectedValueOnce(lastErr);

    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, providerName: 't' });
    // Attach rejection handler BEFORE advancing timers so vitest doesn't flag
    // a transient "unhandled rejection" during the fake-timer drain.
    const observed = p.catch(e => e);
    await vi.runAllTimersAsync();
    expect(await observed).toBe(lastErr);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('non-retryable error → throws immediately, no retry', async () => {
    const fatal = new APIError('t', 401, 'bad key');
    const fn = vi.fn().mockRejectedValue(fatal);

    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, providerName: 't' });
    await expect(p).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('MalformedToolCallError → fails fast, no retry', async () => {
    const err = new MalformedToolCallError('t', '{broken');
    const fn = vi.fn().mockRejectedValue(err);

    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, providerName: 't' });
    await expect(p).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('EmptyResponseError retries up to maxRetries then throws', async () => {
    const err = new EmptyResponseError('t');
    const fn = vi.fn().mockRejectedValue(err);

    const p = withRetry(fn, { maxRetries: 2, baseDelayMs: 100, providerName: 't' });
    const observed = p.catch(e => e);
    await vi.runAllTimersAsync();
    expect(await observed).toBeInstanceOf(EmptyResponseError);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('exponential backoff: delays are base, 2×base, 4×base', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransportError('t', 'x'))
      .mockRejectedValueOnce(new TransportError('t', 'x'))
      .mockRejectedValueOnce(new TransportError('t', 'x'))
      .mockResolvedValueOnce('ok');

    const observed: number[] = [];
    const p = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      providerName: 't',
      onRetry: (_attempt, _err, delayMs) => { observed.push(delayMs); },
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');

    // attempt 1 sleeps 100, attempt 2 sleeps 200, attempt 3 sleeps 400
    expect(observed).toEqual([100, 200, 400]);
  });

  it('onRetry receives attempt number, error, and delay', async () => {
    const err1 = new TransportError('t', 'a');
    const fn = vi.fn()
      .mockRejectedValueOnce(err1)
      .mockResolvedValueOnce('ok');

    const onRetry = vi.fn();
    const p = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      providerName: 't',
      onRetry,
    });
    await vi.runAllTimersAsync();
    await p;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, err1, 100);
  });

  it('AbortSignal fired during backoff → throws TransportError', async () => {
    const controller = new AbortController();
    const fn = vi.fn()
      .mockRejectedValueOnce(new TransportError('t', 'first fail'))
      .mockResolvedValueOnce('should-not-reach');

    const p = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      providerName: 't',
      abortSignal: controller.signal,
    });

    // Let the first attempt run and enter backoff, then abort.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(p).rejects.toBeInstanceOf(TransportError);
    await expect(p).rejects.toMatchObject({ message: expect.stringContaining('Aborted') });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('AbortSignal already aborted before backoff → throws TransportError', async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn()
      .mockRejectedValueOnce(new TransportError('t', 'first'))
      .mockResolvedValueOnce('nope');

    const p = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      providerName: 't',
      abortSignal: controller.signal,
    });

    await expect(p).rejects.toBeInstanceOf(TransportError);
    // First attempt runs, then we check abort before sleeping → throws.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxRetries=0 → single attempt, no retry even on retryable error', async () => {
    const err = new TransportError('t', 'x');
    const fn = vi.fn().mockRejectedValue(err);

    const p = withRetry(fn, { maxRetries: 0, baseDelayMs: 100, providerName: 't' });
    await expect(p).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
