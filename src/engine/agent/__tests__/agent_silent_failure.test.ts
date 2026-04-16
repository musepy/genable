import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';
import { EmptyResponseError } from '../../llm-client/providers/shared/providerErrors';

/**
 * Fail-fast contract: a provider that throws EmptyResponseError surfaces
 * directly to the caller. The runtime no longer retries empty responses
 * (the old emptyResponseHook was deleted in the fail-fast refactor).
 */
describe('Agent fail-fast on empty response', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
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
          input: tc.args,
          thoughtSignature: tc.thought_signature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          type: 'tool_result',
          id: tr.id || '',
          name: tr.name,
          data: tr.response,
          thoughtSignature: tr.thought_signature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Rules')
    } as any;
  });

  it('surfaces EmptyResponseError immediately, no retry', async () => {
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

    await expect(runtime.run('Hello')).rejects.toBeInstanceOf(EmptyResponseError);
    // Single call, no retry layer above.
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
  });
});
