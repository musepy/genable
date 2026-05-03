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

    it('strips image blocks from prior turns when a new user turn starts', async () => {
      const fakeBase64 = 'A'.repeat(20_000);
      // Turn 1: user → tool result with image
      cm.addMessage(msg('user', 'screenshot the canvas'));
      cm.addMessage({
        id: 'tool_result_1',
        role: 'tool',
        content: [
          { type: 'tool_result', id: 't1', name: 'get_screenshot', data: { ok: true } },
          { type: 'image', mimeType: 'image/png', data: fakeBase64 },
        ],
      });
      // Sanity: image is counted in budget while in current turn (patch #3 byte counting)
      const beforeChars = cm.estimateContextChars();
      expect(beforeChars).toBeGreaterThan(20_000);

      // Adding the next user message marks Turn 1 as "prior" — strip happens here.
      await cm.endTurn();
      cm.addMessage(msg('user', 'next turn'));

      const afterChars = cm.estimateContextChars();
      // Was ~20K with the image; should now be just the placeholder + text.
      expect(afterChars).toBeLessThan(2_000);

      // Image block was replaced with a placeholder, not deleted.
      const messages = cm.getMessages();
      const toolMsg = messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      const blocks = toolMsg!.content as any[];
      expect(blocks.find(b => b.type === 'image')).toBeUndefined();
      expect(blocks.find(b => b.type === 'text' && /screenshot.*omitted/i.test(b.text))).toBeDefined();
    });

    it('keeps image blocks intact within the current turn', async () => {
      const fakeBase64 = 'A'.repeat(15_000);
      cm.addMessage(msg('user', 'go'));
      cm.addMessage({
        id: 'tool_result_1',
        role: 'tool',
        content: [
          { type: 'tool_result', id: 't1', name: 'get_screenshot', data: { ok: true } },
          { type: 'image', mimeType: 'image/png', data: fakeBase64 },
        ],
      });
      // No new user message yet → image stays. The screenshot was just taken,
      // the LLM still needs to see it.
      await cm.endTurn();
      const blocks = cm.getMessages().find(m => m.role === 'tool')!.content as any[];
      expect(blocks.find(b => b.type === 'image')).toBeDefined();
    });

    it('estimateContextChars counts image base64 bytes', () => {
      const fakeBase64 = 'A'.repeat(50_000);
      cm.addMessage(msg('user', 'go'));
      cm.addMessage({
        id: 't1',
        role: 'tool',
        content: [
          { type: 'tool_result', id: 'x', name: 'get_screenshot', data: {} },
          { type: 'image', mimeType: 'image/png', data: fakeBase64 },
        ],
      });
      // Total >= image bytes proves the image is counted, not silently zero.
      expect(cm.estimateContextChars()).toBeGreaterThan(50_000);
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

  // ─── tryCompress / applyCompressionResult (无副作用 API) ───

  describe('tryCompress / applyCompressionResult', () => {
    it('tryCompress returns result without modifying messages', async () => {
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 200,
        provider: stubProvider('summary text'),
      });

      tiny.addMessage(msg('user', 'A'.repeat(150)));
      tiny.addMessage(msg('model', 'B'.repeat(150)));
      tiny.addMessage(msg('user', 'current turn'));  // second turn starts

      const beforeCount = tiny.getMessages().length;
      const result = await tiny.tryCompress();

      expect(result).not.toBeNull();
      expect(tiny.getMessages().length).toBe(beforeCount);  // unchanged
      expect(result!.messagesEvicted.length).toBe(2);  // user A + model B
    });

    it('applyCompressionResult modifies messages after tryCompress', async () => {
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 200,
        provider: stubProvider('summary text'),
      });

      tiny.addMessage(msg('user', 'A'.repeat(150)));
      tiny.addMessage(msg('model', 'B'.repeat(150)));
      tiny.addMessage(msg('user', 'current turn'));

      const result = await tiny.tryCompress();
      expect(result).not.toBeNull();

      tiny.applyCompressionResult(result!);

      const after = tiny.getMessages();
      expect(after[0].summaryOf).toBeDefined();
      expect(after[0].content).toContain('summary text');
      expect(after.length).toBe(2);  // summary + current turn user
    });

    it('tryCompress returns null when under budget', async () => {
      const result = await cm.tryCompress();  // cm has budget 100_000
      expect(result).toBeNull();
    });

    it('tryCompress returns null when summarization fails', async () => {
      const failProvider: LLMProvider = {
        name: 'fail',
        getCapabilities: () => ({ supportsTextStreaming: false, supportsReasoningStreaming: false, contextWindow: 200_000 }),
        generate: async () => { throw new Error('LLM error'); },
        formatResponse: () => ({ id: 'x', role: 'model', content: '' }),
        formatToolResults: () => ({ id: 'x', role: 'tool', content: '' }),
        getToolSystemInstruction: () => '',
      };

      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 200,
        provider: failProvider,
      });

      tiny.addMessage(msg('user', 'A'.repeat(150)));
      tiny.addMessage(msg('model', 'B'.repeat(150)));
      tiny.addMessage(msg('user', 'current turn'));

      const beforeCount = tiny.getMessages().length;
      const result = await tiny.tryCompress();

      expect(result).toBeNull();
      expect(tiny.getMessages().length).toBe(beforeCount);  // unchanged on failure
    });

    it('tryCompress returns null when nothing to evict (single turn)', async () => {
      const tiny = new ContextManager({
        systemPrompt: 'S',
        contextBudgetChars: 50,
        provider: stubProvider('summary'),
      });

      tiny.addMessage(msg('user', 'long message'));

      const result = await tiny.tryCompress();
      expect(result).toBeNull();  // cannot evict current turn
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
