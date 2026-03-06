import { describe, it, expect } from 'vitest';
import { buildBriefing } from '../briefing';
import type { ChatMessage } from '../../../types/chat';

describe('buildBriefing', () => {
  it('returns null for empty history and no selection', () => {
    expect(buildBriefing([], [])).toBeNull();
  });

  it('includes last model text and aggregated idMap', () => {
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'Make a login form' },
      {
        id: 'm1', role: 'model', text: 'Created a login form.',
        toolCalls: [{
          id: 'tc1', name: 'create', parameters: {}, status: 'success',
          startTime: 0, result: { success: true, data: { idMap: { header: '1:2', btn: '1:3' } } },
        }],
      },
    ];
    const result = buildBriefing(history, []);
    expect(result).toContain('Created a login form.');
    expect(result).toContain('[Nodes]');
    expect(result).toContain('header=1:2');
    expect(result).toContain('btn=1:3');
  });

  it('includes selection context', () => {
    const result = buildBriefing([], [{ id: '1:5', name: 'Card', type: 'FRAME' }]);
    expect(result).toContain('[Selected]');
    expect(result).toContain('"Card"(FRAME,1:5)');
  });

  it('aggregates idMap across multiple turns', () => {
    const history: ChatMessage[] = [
      {
        id: 'm1', role: 'model', text: 'Created header.',
        toolCalls: [{ id: 'tc1', name: 'create', parameters: {}, status: 'success',
          startTime: 0, result: { success: true, data: { idMap: { header: '1:2' } } } }],
      },
      { id: 'u2', role: 'user', text: 'Add button' },
      {
        id: 'm2', role: 'model', text: 'Added button.',
        toolCalls: [{ id: 'tc2', name: 'create', parameters: {}, status: 'success',
          startTime: 0, result: { success: true, data: { idMap: { btn: '1:3' } } } }],
      },
    ];
    const result = buildBriefing(history, []);
    expect(result).toContain('header=1:2');
    expect(result).toContain('btn=1:3');
  });

  it('truncates long model text', () => {
    const history: ChatMessage[] = [
      { id: 'm1', role: 'model', text: 'x'.repeat(1000) },
    ];
    const result = buildBriefing(history, [])!;
    expect(result.length).toBeLessThan(700);
    expect(result).toContain('…');
  });
});
