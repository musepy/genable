import { describe, it, expect } from 'vitest';
import { buildSeedMessagesFromChatHistory } from '../historySeed';
import type { ChatMessage } from '../../../types/chat';

function msg(id: string, role: 'user' | 'model', text: string): ChatMessage {
  return { id, role, text };
}

describe('buildSeedMessagesFromChatHistory', () => {
  it('maps user/model history to seed LLM messages in order', () => {
    const history: ChatMessage[] = [
      msg('u1', 'user', 'Design a login form'),
      msg('m1', 'model', 'I created the structure and button.'),
    ];

    const seed = buildSeedMessagesFromChatHistory(history, 'continue');

    expect(seed).toEqual([
      { id: 'seed_u1', role: 'user', content: 'Design a login form' },
      { id: 'seed_m1', role: 'model', content: 'I created the structure and button.' },
    ]);
  });

  it('drops a trailing user message if it is the same as current prompt', () => {
    const history: ChatMessage[] = [
      msg('u1', 'user', 'Build a card'),
      msg('m1', 'model', 'Card built.'),
      msg('u2', 'user', '继续'),
    ];

    const seed = buildSeedMessagesFromChatHistory(history, '继续');

    expect(seed).toEqual([
      { id: 'seed_u1', role: 'user', content: 'Build a card' },
      { id: 'seed_m1', role: 'model', content: 'Card built.' },
    ]);
  });

  it('keeps newest history when exceeding limits', () => {
    const history: ChatMessage[] = Array.from({ length: 40 }, (_, i) =>
      msg(
        `h${i}`,
        i % 2 === 0 ? 'user' : 'model',
        `msg-${i} ${'x'.repeat(700)}`
      )
    );

    const seed = buildSeedMessagesFromChatHistory(history, 'new prompt');
    const allText = seed.map(m => String(m.content)).join('\n');

    expect(seed.length).toBeLessThanOrEqual(24);
    expect(allText.includes('msg-39')).toBe(true);
    expect(allText.includes('msg-0')).toBe(false);
  });
});
