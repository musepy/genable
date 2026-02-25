
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';

describe('Summarization Turn-Taking Violation Repro', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'gemini',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        content: res.text || []
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response }
        }))
      }))
    } as any;
  });

  it('summarizeConversation should NOT orphan tool results', async () => {
    const runtime = new AgentRuntime({
        provider: mockProvider,
        maxContextTokens: 1000,
        tools: []
    });

    // Setup history that will be split by current 50/50 slice logic
    // Messages: System(0), User(1), Model(2), Tool(3), User(4), Model(5)
    // slice(0, 3) would hide 0, 1, 2. But Tool(3) would be left visible without Model(2).
    (runtime['context'] as any).messages = [
        { id: 'sys', role: 'system', content: 'Sys' },
        { id: 'u1', role: 'user', content: 'User 1' },
        { id: 'm1', role: 'model', content: [{ functionCall: { name: 't1', args: {} } }] },
        { id: 't1_res', role: 'tool', content: [{ functionResponse: { name: 't1', response: {} } }] },
        { id: 'u2', role: 'user', content: 'User 2' },
        { id: 'm2', role: 'model', content: 'Model 2' }
    ];

    // Manually trigger summarization with a mock summarizer
    await (runtime['context'] as any).summarizeConversation(async () => 'Summary');

    const visibleMessages = (runtime['context'] as any).messages.filter((m: any) => !m.hidden);
    
    // Validate sequence
    // Explicitly check that if 't1_res' is visible, its partner 'm1' must also be visible (or first visible is user)
    const t1Res = visibleMessages.find(m => m.id === 't1_res');
    if (t1Res) {
        const m1 = visibleMessages.find(m => m.id === 'm1');
        expect(m1).toBeDefined();
    }
  });
});
