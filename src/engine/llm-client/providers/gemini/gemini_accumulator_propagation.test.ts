
import { describe, it, expect } from 'vitest';
import { GeminiResponseAccumulator } from './geminiResponseAccumulator';

describe('GeminiResponseAccumulator Propagation', () => {
  it('should propagate signature across all accumulated parts in finalize', () => {
    const accumulator = new GeminiResponseAccumulator();
    const TEST_SIG = 'streaming_batch_sig';

    // Chunk 1: Has one tool call
    accumulator.append({
      text: '',
      toolCalls: [{ name: 'tool1', args: {}, id: 'c1' }],
      fullParts: [{ functionCall: { name: 'tool1', args: {} } }]
    });

    // Chunk 2: Has another tool call and THE signature
    accumulator.append({
      text: '',
      toolCalls: [{ name: 'tool2', args: {}, id: 'c2', thought_signature: TEST_SIG }],
      fullParts: [
        { thought: true, text: 'Thinking...', thought_signature: TEST_SIG },
        { functionCall: { name: 'tool2', args: {} }, thought_signature: TEST_SIG }
      ]
    });

    const final = accumulator.finalize();

    expect(final.toolCalls).toHaveLength(2);
    // Tool 1 should have received the signature from Tool 2's turn
    expect(final.toolCalls[0].name).toBe('tool1');
    expect(final.toolCalls[0].thought_signature).toBe(TEST_SIG);

    // Tool 2 should still have it
    expect(final.toolCalls[1].thought_signature).toBe(TEST_SIG);

    // Full parts should get updated (history supports signatures now)
    const tool1Part = (final.fullParts as any[]).find(p => p.functionCall?.name === 'tool1');
    expect(tool1Part.thought_signature).toBe(TEST_SIG);
  });
});
