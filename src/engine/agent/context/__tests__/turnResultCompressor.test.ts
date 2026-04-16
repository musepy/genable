import { describe, it, expect } from 'vitest';
import { compressConsumedToolResults } from '../turnResultCompressor';
import { LLMMessage } from '../../../llm-client/providers/types';

// Helper: create a tool result message with ToolResultBlock parts
// Response format matches presentForLLM output (flat, no success/data wrapper)
function toolMsg(id: string, parts: Array<{ name: string; response: any }>): LLMMessage {
  return {
    id,
    role: 'tool',
    content: parts.map((p, i) => ({
      type: 'tool_result' as const,
      id: `${id}_${i}`,
      name: p.name,
      data: p.response,
    })),
  };
}

function userMsg(text: string): LLMMessage {
  return { id: 'usr_1', role: 'user', content: text };
}

function modelMsg(text: string): LLMMessage {
  return { id: 'mdl_1', role: 'model', content: text };
}

describe('compressConsumedToolResults', () => {
  it('does nothing with fewer than 2 tool results', () => {
    const messages: LLMMessage[] = [
      userMsg('Create a card'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'jsx', response: { id: '100:1', name: 'Card', type: 'frame', created: 1 } }]),
    ];
    const count = compressConsumedToolResults(messages);
    expect(count).toBe(0);
    const resp = (messages[2].content as any)[0].data;
    expect(resp._compressed).toBeUndefined();
  });

  it('compresses all tool results except the last one, preserving idMap', () => {
    const messages: LLMMessage[] = [
      userMsg('Design a page'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'jsx', response: { idMap: { Card: '100:1', Title: '100:2' }, created: 2 } }]),
      modelMsg('Now editing'),
      toolMsg('tol_2', [{ name: 'edit', response: { edited: 2 } }]),
      modelMsg('Inspecting'),
      toolMsg('tol_3', [{ name: 'inspect', response: { tree: 'line1\nline2\nline3' } }]),
    ];

    const count = compressConsumedToolResults(messages);
    expect(count).toBe(2);

    // tol_1: idMap survives (required for cross-iteration ID resolution)
    const resp1 = (messages[2].content as any)[0].data;
    expect(resp1._compressed).toBe(true);
    expect(resp1.idMap).toEqual({ Card: '100:1', Title: '100:2' });
    // verbose fields discarded
    expect(resp1.created).toBeUndefined();

    // tol_2: no idMap / id / error → stub marker
    const resp2 = (messages[4].content as any)[0].data;
    expect(resp2._compressed).toBe(true);
    expect(resp2.stub).toBe('[old tool result: edit]');
    expect(resp2.edited).toBeUndefined();

    // tol_3: NOT compressed (latest)
    const resp3 = (messages[6].content as any)[0].data;
    expect(resp3._compressed).toBeUndefined();
    expect(resp3.tree).toBe('line1\nline2\nline3');
  });

  it('skips already-compressed results on subsequent calls', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'jsx', response: { idMap: { A: '1:1' }, created: 1 } }]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'edit', response: { edited: 1 } }]),
    ];

    compressConsumedToolResults(messages);
    const resp1After = (messages[2].content as any)[0].data;
    expect(resp1After._compressed).toBe(true);

    messages.push(modelMsg(''));
    messages.push(toolMsg('tol_3', [{ name: 'inspect', response: { tree: 'x\ny' } }]));

    const count = compressConsumedToolResults(messages);
    expect(count).toBe(1);

    const resp2After = (messages[4].content as any)[0].data;
    expect(resp2After._compressed).toBe(true);
  });

  it('preserves error details in compressed results', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{
        name: 'jsx',
        response: {
          error: '2 ops failed',
          idMap: { Card: '100:1' },
          errors: [{ op: 'create Title', error: 'invalid color' }],
        },
      }]),
      modelMsg('fixing'),
      toolMsg('tol_2', [{ name: 'edit', response: { edited: 1 } }]),
    ];

    compressConsumedToolResults(messages);

    const resp1 = (messages[2].content as any)[0].data;
    expect(resp1._compressed).toBe(true);
    expect(resp1.error).toBe('2 ops failed');
    expect(resp1.idMap).toEqual({ Card: '100:1' });
    expect(resp1.errors).toEqual([{ op: 'create Title', error: 'invalid color' }]);
  });

  it('marks tool_result as isError when error is present', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'edit', response: { error: 'NODE_NOT_FOUND: 99:1' } }]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'inspect', response: { tree: 'x' } }]),
    ];

    compressConsumedToolResults(messages);

    const block = (messages[2].content as any)[0];
    expect(block.isError).toBe(true);
    expect(block.data.error).toBe('NODE_NOT_FOUND: 99:1');
    expect(block.data._compressed).toBe(true);
  });

  it('handles multi-part tool result messages', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [
        { name: 'jsx', response: { idMap: { A: '1:1' }, created: 1 } },
        { name: 'edit', response: { edited: 3 } },
      ]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'inspect', response: { tree: 'x' } }]),
    ];

    compressConsumedToolResults(messages);

    const parts = (messages[2].content as any);
    expect(parts[0].data._compressed).toBe(true);
    expect(parts[0].data.idMap).toEqual({ A: '1:1' });
    expect(parts[1].data._compressed).toBe(true);
    expect(parts[1].data.stub).toBe('[old tool result: edit]');
  });

  it('discards verbose tree content and adds stub when no id/idMap', () => {
    const treeContent = Array.from({ length: 50 }, (_, i) => `  Node_${i}`).join('\n');
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'inspect', response: { tree: treeContent } }]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'jsx', response: { idMap: { X: '1:1' }, created: 1 } }]),
    ];

    compressConsumedToolResults(messages);

    const resp = (messages[2].content as any)[0].data;
    expect(resp._compressed).toBe(true);
    expect(resp.tree).toBeUndefined();
    expect(resp.stub).toBe('[old tool result: inspect]');
    expect(resp.idMap).toBeUndefined();
  });

  it('preserves jsx node identity (id + name) in compressed results', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'jsx', response: { id: '1:1', name: 'Card', type: 'frame', children: ['Title#1:2'], created: 5 } }]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'inspect', response: { tree: 'x' } }]),
    ];

    compressConsumedToolResults(messages);

    const resp = (messages[2].content as any)[0].data;
    expect(resp._compressed).toBe(true);
    expect(resp.id).toBe('1:1');
    expect(resp.name).toBe('Card');
    // Verbose children/created/type discarded
    expect(resp.children).toBeUndefined();
    expect(resp.created).toBeUndefined();
    expect(resp.type).toBeUndefined();
  });

  it('survives empty idMap without preserving it', () => {
    const messages: LLMMessage[] = [
      userMsg('go'),
      modelMsg(''),
      toolMsg('tol_1', [{ name: 'jsx', response: { idMap: {}, created: 0 } }]),
      modelMsg(''),
      toolMsg('tol_2', [{ name: 'inspect', response: { tree: 'x' } }]),
    ];

    compressConsumedToolResults(messages);

    const resp = (messages[2].content as any)[0].data;
    expect(resp._compressed).toBe(true);
    expect(resp.idMap).toBeUndefined();
    expect(resp.stub).toBe('[old tool result: jsx]');
  });
});
