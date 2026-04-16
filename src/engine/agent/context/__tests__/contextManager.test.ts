import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../contextManager';
import type { LLMMessage, LLMProvider } from '../../../llm-client/providers/types';

function msg(role: LLMMessage['role'], content: string, id = `msg_${Math.random().toString(36).slice(2, 6)}`): LLMMessage {
  return { id, role, content };
}

function stubProvider(summaryText = 'compressed summary'): LLMProvider {
  return {
    name: 'stub',
    getCapabilities: () => ({ supportsTextStreaming: false, supportsReasoningStreaming: false, contextWindow: 200_000 }),
    generate: async () => ({ text: summaryText }),
    formatResponse: () => ({ id: 'x', role: 'model', content: '' }),
    formatToolResults: () => ({ id: 'x', role: 'tool', content: '' }),
    getToolSystemInstruction: () => '',
  };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager({
      systemPrompt: 'You are a design agent.',
      contextBudgetChars: 100_000,
      provider: stubProvider(),
    });
  });

  // ─── assemblePrompt ───────────────────────────────────────

  describe('assemblePrompt', () => {
    it('returns system prompt separately with empty messages when journal is empty', () => {
      const { system, messages } = cm.assemblePrompt();
      expect(system).toBe('You are a design agent.');
      expect(messages).toHaveLength(0);
    });

    it('includes added messages in the flat journal', () => {
      cm.addMessage(msg('user', 'Hello'));
      const { messages } = cm.assemblePrompt();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('preserves turn ordering across multiple turns', async () => {
      cm.addMessage(msg('user', 'Turn 1'));
      cm.addMessage(msg('model', 'Reply 1'));
      await cm.endTurn();
      cm.addMessage(msg('user', 'Turn 2'));

      const { messages } = cm.assemblePrompt();
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('Turn 1');
      expect(messages[1].content).toBe('Reply 1');
      expect(messages[2].content).toBe('Turn 2');
    });

    it('omits system prompt if empty', () => {
      const empty = new ContextManager({
        systemPrompt: '',
        contextBudgetChars: 100_000,
        provider: stubProvider(),
      });
      const { system, messages } = empty.assemblePrompt();
      expect(system).toBe('');
      expect(messages).toHaveLength(0);
    });
  });

  // ─── endTurn ──────────────────────────────────────────────

  describe('endTurn', () => {
    it('retains messages in the journal after a turn ends', async () => {
      cm.addMessage(msg('user', 'T1'));
      await cm.endTurn();
      expect(cm.getMessages()).toHaveLength(1);
    });
  });

  // ─── isFirstTurn ──────────────────────────────────────────

  describe('isFirstTurn', () => {
    it('returns true before any user message', () => {
      expect(cm.isFirstTurn()).toBe(true);
    });

    it('returns true while only the first user turn exists', () => {
      cm.addMessage(msg('user', 'Hi'));
      expect(cm.isFirstTurn()).toBe(true);
    });

    it('returns false once a second user turn has been added', async () => {
      cm.addMessage(msg('user', 'First'));
      cm.addMessage(msg('model', 'Reply'));
      await cm.endTurn();
      cm.addMessage(msg('user', 'Second'));
      expect(cm.isFirstTurn()).toBe(false);
    });
  });

  // ─── live reference contract ──────────────────────────────

  describe('live reference contract', () => {
    it('getMessages returns the live journal', () => {
      const ref = cm.getMessages();
      cm.addMessage(msg('user', 'A'));
      expect(ref).toHaveLength(1);
      expect(ref[0].content).toBe('A');
    });

    it('getCurrentTurnMessages returns the slice since the last user message', () => {
      cm.addMessage(msg('user', 'First'));
      cm.addMessage(msg('model', 'Reply'));
      cm.addMessage(msg('user', 'Second'));
      cm.addMessage(msg('model', 'Reply2'));

      const current = cm.getCurrentTurnMessages();
      expect(current).toHaveLength(2);
      expect(current[0].content).toBe('Second');
      expect(current[1].content).toBe('Reply2');
    });
  });

  // ─── message operations ───────────────────────────────────

  describe('message operations', () => {
    it('insertBeforeCurrentTurn places a message before the current user message', () => {
      cm.addMessage(msg('user', 'Prompt'));
      cm.insertBeforeCurrentTurn(msg('user', 'Preamble'));
      const msgs = cm.getMessages();
      expect(msgs[0].content).toBe('Preamble');
      expect(msgs[1].content).toBe('Prompt');
    });

    it('insertBeforeCurrentTurn prepends when no user message is present', () => {
      cm.insertBeforeCurrentTurn(msg('user', 'Preamble'));
      expect(cm.getMessages()[0].content).toBe('Preamble');
    });
  });

  // ─── token tracking ───────────────────────────────────────

  describe('token tracking', () => {
    it('get/set lastPromptTokens', () => {
      expect(cm.getLastPromptTokens()).toBe(0);
      cm.setLastPromptTokens(1234);
      expect(cm.getLastPromptTokens()).toBe(1234);
    });
  });

  // ─── getSystemPrompt ──────────────────────────────────────

  it('getSystemPrompt returns the static system prompt', () => {
    expect(cm.getSystemPrompt()).toBe('You are a design agent.');
  });

  // ─── compression ──────────────────────────────────────────

  describe('lazy compression', () => {
    it('does not compress when under budget', async () => {
      cm.addMessage(msg('user', 'Short message'));
      cm.addMessage(msg('model', 'Short reply'));
      await cm.endTurn();
      expect(cm.getMessages()).toHaveLength(2);
      expect(cm.getMessages()[0].summaryOf).toBeUndefined();
    });

    it('summarizes oldest turns into a head summary message when over budget', async () => {
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 200,
        provider: stubProvider('compacted'),
      });

      tiny.addMessage(msg('user', 'A'.repeat(150)));
      tiny.addMessage(msg('model', 'B'.repeat(150)));
      await tiny.endTurn();
      tiny.addMessage(msg('user', 'next turn'));
      await tiny.endTurn();

      const all = tiny.getMessages();
      const head = all[0];
      expect(head.summaryOf).toBeDefined();
      expect(typeof head.content).toBe('string');
      expect(head.content as string).toContain('compacted');
    });

    it('assemblePrompt still returns valid output after compression', async () => {
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 100,
        provider: stubProvider(),
      });
      tiny.addMessage(msg('user', 'A'.repeat(80)));
      tiny.addMessage(msg('model', 'B'.repeat(80)));
      await tiny.endTurn();

      const { system, messages } = tiny.assemblePrompt();
      expect(system.length + messages.length).toBeGreaterThan(0);
    });
  });

  // ─── estimateContextChars ─────────────────────────────────

  describe('estimateContextChars', () => {
    it('counts system prompt + journal messages', () => {
      cm.addMessage(msg('user', 'Hello'));
      const chars = cm.estimateContextChars();
      expect(chars).toBe('You are a design agent.'.length + 'Hello'.length);
    });

    it('counts ContentBlock[] content correctly', () => {
      cm.addMessage({
        id: 'test',
        role: 'model',
        content: [
          { type: 'text', text: 'Some text' },
          { type: 'tool_call', id: 'call_1', name: 'jsx', input: { xml: '<frame/>' } },
        ],
      });
      const chars = cm.estimateContextChars();
      const expected = 'You are a design agent.'.length
        + 'Some text'.length
        + 'jsx'.length
        + JSON.stringify({ xml: '<frame/>' }).length;
      expect(chars).toBe(expected);
    });
  });
});
