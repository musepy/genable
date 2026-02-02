
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';

describe('Gemini Turn-Taking Violation Repro', () => {
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

  it('should maintain role alternation (User/Tool -> Model -> User/Tool)', async () => {
    const runtime = new AgentRuntime({
        provider: mockProvider,
        maxContextTokens: 20, // Forces truncation
        tools: []
    });

    // Realistic history: Every Tool Result is followed by a Model Turn
    (runtime as any).messages = [
        { id: 'sys', role: 'system', content: 'Sys' },
        { id: 'u1', role: 'user', content: 'helloooooooo' },
        { id: 'm1', role: 'model', content: [{ functionCall: { name: 't1', args: {} } }] },
        { id: 't1_res', role: 'tool', content: [{ functionResponse: { name: 't1', response: {} } }] },
        { id: 'm1_ack', role: 'model', content: 'I did it' },
        { id: 'u2', role: 'user', content: 'worldddddddd' },
        { id: 'm2', role: 'model', content: 'rep' }
    ];

    // Trigger truncation
    // Use type casting to call private/protected method for testing
    await (runtime as any).manageContext();

    const visibleMessages = (runtime as any).messages.filter((m: any) => !m.hidden);
    
    console.log('Visible roles:', visibleMessages.map((m: any) => m.role));

    // Check for role alternation in visible history (skipping system)
    const history = visibleMessages.filter((m: any) => m.role !== 'system');
    for (let i = 0; i < history.length - 1; i++) {
        const current = history[i].role;
        const next = history[i + 1].role;
        
        if (current === 'model' && next === 'model') {
            throw new Error(`Invalid alternation: model followed by model at index ${i}`);
        }
        if ((current === 'user' || current === 'tool') && (next === 'user' || next === 'tool')) {
            throw new Error(`Invalid alternation: ${current} followed by ${next} at index ${i}`);
        }
    }

    // Ensure it starts with user/tool if history is not empty
    if (history.length > 0) {
        expect(['user', 'tool']).toContain(history[0].role);
    }
  });
});
