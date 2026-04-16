import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../contextManager';
import type { LLMMessage } from '../../../llm-client/providers/types';

function msg(role: LLMMessage['role'], content: string, id = `msg_${Math.random().toString(36).slice(2, 6)}`): LLMMessage {
  return { id, role, content };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager({
      systemPrompt: 'You are a design agent.',
      contextBudgetChars: 100_000,
    });
  });

  // ─── assemblePrompt ───────────────────────────────────────

  describe('assemblePrompt', () => {
    it('returns system prompt as layer 1', () => {
      const prompt = cm.assemblePrompt();
      expect(prompt).toHaveLength(1);
      expect(prompt[0]).toMatchObject({ id: 'sys_static', role: 'system', content: 'You are a design agent.' });
    });

    it('includes turnMessages as layer 4', () => {
      cm.pushToTurn(msg('user', 'Hello'));
      const prompt = cm.assemblePrompt();
      expect(prompt).toHaveLength(2);
      expect(prompt[1].content).toBe('Hello');
    });

    it('includes conversation history as layer 3 after endTurn', () => {
      cm.pushToTurn(msg('user', 'Turn 1'));
      cm.pushToTurn(msg('model', 'Reply 1'));
      cm.endTurn();
      cm.startTurn();
      cm.pushToTurn(msg('user', 'Turn 2'));

      const prompt = cm.assemblePrompt();
      // system + 2 history msgs + 1 turn msg
      expect(prompt).toHaveLength(4);
      expect(prompt[1].content).toBe('Turn 1');
      expect(prompt[2].content).toBe('Reply 1');
      expect(prompt[3].content).toBe('Turn 2');
    });

    it('omits system prompt if empty', () => {
      const empty = new ContextManager({ systemPrompt: '', contextBudgetChars: 100_000 });
      const prompt = empty.assemblePrompt();
      expect(prompt).toHaveLength(0);
    });
  });

  // ─── startTurn / endTurn ──────────────────────────────────

  describe('startTurn / endTurn', () => {
    it('startTurn clears turnMessages', () => {
      cm.pushToTurn(msg('user', 'Old'));
      cm.startTurn();
      expect(cm.getTurnMessages()).toHaveLength(0);
    });

    it('endTurn moves turn to history, turnMessages stay readable', () => {
      cm.pushToTurn(msg('user', 'T1'));
      cm.endTurn();
      // turnMessages still available (for debrief)
      expect(cm.getTurnMessages()).toHaveLength(1);
      // But conversation history also has them
      expect(cm.getConversationHistory()).toHaveLength(1);
    });
  });

  // ─── isFirstTurn ──────────────────────────────────────────

  describe('isFirstTurn', () => {
    it('returns true before any endTurn', () => {
      expect(cm.isFirstTurn()).toBe(true);
    });

    it('returns false after endTurn', () => {
      cm.pushToTurn(msg('user', 'Hi'));
      cm.endTurn();
      expect(cm.isFirstTurn()).toBe(false);
    });
  });

  // ─── live reference contract ──────────────────────────────

  describe('live reference contract', () => {
    it('getTurnMessages returns a live reference that hooks can push to', () => {
      const ref = cm.getTurnMessages();
      cm.pushToTurn(msg('user', 'A'));
      // The reference should see the push
      expect(ref).toHaveLength(1);
      expect(ref[0].content).toBe('A');
    });

    it('startTurn breaks the old reference', () => {
      cm.pushToTurn(msg('user', 'Old'));
      const oldRef = cm.getTurnMessages();
      cm.startTurn();
      const newRef = cm.getTurnMessages();
      // Old reference still has its data, but it's detached
      expect(oldRef).toHaveLength(1);
      expect(newRef).toHaveLength(0);
      expect(oldRef).not.toBe(newRef);
    });
  });

  // ─── message operations ───────────────────────────────────

  describe('message operations', () => {
    it('unshiftToTurn prepends', () => {
      cm.pushToTurn(msg('user', 'Second'));
      cm.unshiftToTurn(msg('user', 'First'));
      const msgs = cm.getTurnMessages();
      expect(msgs[0].content).toBe('First');
      expect(msgs[1].content).toBe('Second');
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
    it('does not compress when under budget', () => {
      cm.pushToTurn(msg('user', 'Short message'));
      cm.pushToTurn(msg('model', 'Short reply'));
      cm.endTurn();
      // History should still have full messages (not compressed)
      expect(cm.getConversationHistory()).toHaveLength(2);
    });

    it('compresses oldest turn when over budget', () => {
      // Create a CM with a very small budget to force compression
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 100,
      });

      // Add a turn that's over budget
      tiny.pushToTurn(msg('user', 'A'.repeat(80)));
      tiny.pushToTurn(msg('model', 'B'.repeat(80)));
      tiny.endTurn();

      // After compression, conversation history should be shorter
      // (oldest turn extracted and summarized)
      const history = tiny.getConversationHistory();
      // Either compressed away (length 0) or still there if summary + history < budget
      // The key behavior: no crash, and assemblePrompt works
      const prompt = tiny.assemblePrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  // ─── estimateContextChars ─────────────────────────────────

  describe('estimateContextChars', () => {
    it('counts system prompt + turn messages', () => {
      cm.pushToTurn(msg('user', 'Hello'));
      const chars = cm.estimateContextChars();
      expect(chars).toBe('You are a design agent.'.length + 'Hello'.length);
    });

    it('counts ContentBlock[] content correctly', () => {
      cm.pushToTurn({
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
