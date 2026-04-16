import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';
import { EmptyResponseError } from '../../llm-client/providers/shared/providerErrors';

/**
 * Fail-fast contract: after withRetry exhausts its budget, an EmptyResponseError
 * surfaces to the caller. EmptyResponseError is retryable (transient model
 * hiccup) but bounded — exhausted retries must throw, not fabricate a success.
 *
 * Coordinator config: MAX_RETRIES = 3 → up to 4 provider calls total.
 */
describe('Agent fail-fast on empty response', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    // Use fake timers so the withRetry backoff (500ms → 1s → 2s) completes
    // instantly in test; without this the test would wait ~3.5s real time.
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockProvider = {
      name: 'gemini',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        content: res.toolCalls?.length ? res.toolCalls.map((tc: any) => ({
          type: 'tool_call',
          id: tc.id || 'call_' + Math.random().toString(36).slice(2, 7),
          name: tc.name,
          input: tc.input,
          thoughtSignature: tc.thoughtSignature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          type: 'tool_result',
          id: tr.id || '',
          name: tr.name,
          data: tr.response,
          thoughtSignature: tr.thoughtSignature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Rules')
    } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries EmptyResponseError up to MAX_RETRIES, then surfaces', async () => {
    // Real providers throw EmptyResponseError from finalize() — simulate that here.
    (mockProvider.generate as any).mockRejectedValue(
      new EmptyResponseError('gemini', 'Provider returned no text or tool calls'),
    );

    const runtime = new AgentRuntime({
      provider: mockProvider,
      systemPrompt: 'You are helpful',
      tools: [],
      onIteration: vi.fn(),
      ipcBridge: { callTool: vi.fn(), dispose: vi.fn() } as any,
    });

    const runPromise = runtime.run('Hello');
    // Attach rejection handler BEFORE advancing timers so the unhandled
    // rejection warning from fake-timer drain is avoided.
    const outcome = runPromise.catch(e => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(EmptyResponseError);
    // withRetry budget: 1 initial + 3 retries = 4 calls.
    expect(mockProvider.generate).toHaveBeenCalledTimes(4);
  });
});
