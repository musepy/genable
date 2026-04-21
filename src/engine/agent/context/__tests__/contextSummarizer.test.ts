import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildCompressionSummary, capSummary } from '../contextSummarizer';
import type {
  LLMMessage,
  LLMProvider,
  LLMGenerateOptions,
  LLMResponse,
  LLMToolResult,
} from '../../../llm-client/providers/types';
import type { ToolDefinition } from '../../tools/types';

// -----------------------------------------------------------------------------
// Stubbed LLM provider — captures the last request so tests can assert on it
// -----------------------------------------------------------------------------

interface StubProviderOptions {
  response?: LLMResponse;
  contextWindow?: number;
  throwOnGenerate?: Error;
}

function createStubProvider(opts: StubProviderOptions = {}): LLMProvider & { lastRequest?: LLMGenerateOptions } {
  const provider: any = {
    name: 'stub',
    lastRequest: undefined,
    getCapabilities() {
      return {
        supportsTextStreaming: false,
        supportsReasoningStreaming: false,
        contextWindow: opts.contextWindow ?? 200_000,
      };
    },
    async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
      provider.lastRequest = options;
      if (opts.throwOnGenerate) throw opts.throwOnGenerate;
      return opts.response ?? { text: 'stub summary' };
    },
    formatResponse(): LLMMessage {
      return { id: 'x', role: 'model', content: '' };
    },
    formatToolResults(_results: LLMToolResult[]): LLMMessage {
      return { id: 'x', role: 'tool', content: '' };
    },
    getToolSystemInstruction(_tools: ToolDefinition[]): string {
      return '';
    },
  };
  return provider;
}

describe('buildCompressionSummary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for no messages (skips LLM call)', async () => {
    const provider = createStubProvider();
    const result = await buildCompressionSummary(provider, []);
    expect(result).toBe('');
    expect(provider.lastRequest).toBeUndefined();
  });

  it('routes through the provider with no tools and a bounded maxTokens', async () => {
    const provider = createStubProvider({
      response: { text: 'Summary: user wanted a login page. Created Card=1:1.' },
    });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Make a login page' },
      { id: 'm1', role: 'model', content: 'Done — created Card 1:1.' },
    ];

    const summary = await buildCompressionSummary(provider, messages);

    expect(summary).toContain('Summary');
    expect(provider.lastRequest).toBeDefined();
    expect(provider.lastRequest!.tools).toEqual([]);
    expect(provider.lastRequest!.maxTokens).toBe(500);
    expect(provider.lastRequest!.system).toMatch(/summariz/i);
  });

  it('wraps messages in <conversation> XML tags', async () => {
    const provider = createStubProvider({ response: { text: 'ok' } });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Build a card' },
      {
        id: 'm1', role: 'model', content: [
          { type: 'tool_call', id: 'call_1', name: 'jsx', input: { xml: '<frame/>', parent: '0:1' } },
        ],
      },
    ];
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string'
      ? userMsg.content
      : userMsg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    expect(prompt).toContain('<conversation>');
    expect(prompt).toContain('</conversation>');
    expect(prompt).toContain('<user>Build a card</user>');
    expect(prompt).toContain('tool_call name="jsx"');
  });

  it('serializes tool results including _compressed pre-summaries', async () => {
    const provider = createStubProvider({ response: { text: 'ok' } });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Create dashboard' },
      {
        id: 'm1', role: 'model', content: [
          { type: 'tool_call', id: 'call_1', name: 'jsx', input: { parent: '0:1' } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          {
            type: 'tool_result', id: 'call_1', name: 'jsx',
            data: {
              _compressed: true,
              summary: 'created 3 nodes',
              idMap: { Dashboard: '1:1', Header: '1:2', Footer: '1:3' },
            },
          },
        ],
      },
    ];
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(prompt).toContain('created 3 nodes');
    expect(prompt).toContain('Dashboard');
    expect(prompt).toContain('tool_result');
  });

  it('marks error results with error="true"', async () => {
    const provider = createStubProvider({ response: { text: 'ok' } });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Edit the card' },
      {
        id: 'm1', role: 'model', content: [
          { type: 'tool_call', id: 'call_2', name: 'edit', input: { xml: '<frame/>' } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { type: 'tool_result', id: 'call_2', name: 'edit', data: { error: 'NODE_NOT_FOUND' } },
        ],
      },
    ];
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(prompt).toContain('error="true"');
    expect(prompt).toContain('NODE_NOT_FOUND');
  });

  it('throws when LLM returns empty text', async () => {
    const provider = createStubProvider({ response: { text: '' } });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello' },
    ];
    await expect(buildCompressionSummary(provider, messages)).rejects.toThrow(/empty summary/);
  });

  it('propagates LLM errors (no silent fallback)', async () => {
    const provider = createStubProvider({ throwOnGenerate: new Error('NETWORK_DOWN') });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello' },
    ];
    await expect(buildCompressionSummary(provider, messages)).rejects.toThrow(/NETWORK_DOWN/);
  });

  it('respects the input budget — huge payloads get trimmed before the LLM call', async () => {
    // contextWindow 10K tokens → 0.2 * 10_000 * 4 = 8000 chars input cap
    const provider = createStubProvider({
      contextWindow: 10_000,
      response: { text: 'ok' },
    });

    const messages: LLMMessage[] = [];
    // 20 user turns, each 2000 chars — 40K of content, well above 8K cap
    for (let i = 0; i < 20; i++) {
      messages.push({ id: `u${i}`, role: 'user', content: 'X'.repeat(2000) });
    }
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string' ? userMsg.content : '';
    // Should be capped well below the total 40K input
    expect(prompt.length).toBeLessThan(15_000);
  });

  it('truncates individual tool results that exceed TOOL_RESULT_MAX_CHARS', async () => {
    const provider = createStubProvider({ response: { text: 'ok' } });

    const fatData = { xml: 'X'.repeat(10_000) };
    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'Inspect' },
      {
        id: 'm1', role: 'model', content: [
          { type: 'tool_call', id: 'call_1', name: 'inspect', input: { node: '1:1' } },
        ],
      },
      {
        id: 't1', role: 'tool', content: [
          { type: 'tool_result', id: 'call_1', name: 'inspect', data: fatData },
        ],
      },
    ];
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(prompt).toContain('truncated');
    // Full 10K payload should not be present verbatim
    expect(prompt).not.toContain('X'.repeat(10_000));
  });

  it('caps output when the LLM over-produces (safety rail)', async () => {
    const huge = 'A'.repeat(5000);
    const provider = createStubProvider({ response: { text: huge } });

    const messages: LLMMessage[] = [
      { id: 'u1', role: 'user', content: 'hi' },
    ];
    const summary = await buildCompressionSummary(provider, messages);
    expect(summary.length).toBeLessThanOrEqual(2600);
  });

  it('skips system messages and prior summaries during serialization', async () => {
    const provider = createStubProvider({ response: { text: 'ok' } });

    const messages: LLMMessage[] = [
      { id: 's1', role: 'system', content: 'SECRET SYSTEM PROMPT' },
      { id: 'sum1', role: 'user', content: '[prior summary]', summaryOf: ['old1'] },
      { id: 'u1', role: 'user', content: 'Keep this one' },
    ];
    await buildCompressionSummary(provider, messages);

    const userMsg = provider.lastRequest!.messages[0];
    const prompt = typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(prompt).not.toContain('SECRET SYSTEM PROMPT');
    expect(prompt).not.toContain('[prior summary]');
    expect(prompt).toContain('Keep this one');
  });
});

describe('capSummary', () => {
  it('returns unchanged when under limit', () => {
    const s = 'User: Hello\nAgent: Hi';
    expect(capSummary(s, 100)).toBe(s);
  });

  it('truncates overflowing strings with ellipsis', () => {
    const capped = capSummary('A'.repeat(500), 50);
    expect(capped.length).toBe(50);
    expect(capped.endsWith('…')).toBe(true);
  });

  it('returns unchanged when maxChars <= 0 (opt-out)', () => {
    const s = 'anything';
    expect(capSummary(s, 0)).toBe(s);
    expect(capSummary(s, -1)).toBe(s);
  });
});
