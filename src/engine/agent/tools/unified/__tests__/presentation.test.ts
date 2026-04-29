import { describe, it, expect } from 'vitest';
import { presentForLLM } from '../presentation';

describe('presentForLLM — flat response format', () => {
  it('flattens data to top level, strips noise', () => {
    const result = {
      data: {
        idMap: { Card: '100:1', Title: '100:2' },
        count: 2,
        diagnostics: { elapsed: 42 },
      },
    };
    const presented = presentForLLM(result, 'clone_node');
    // Data fields promoted to top level (clone_node keeps idMap)
    expect(presented.idMap).toEqual({ Card: '100:1', Title: '100:2' });
    // Noise stripped (count, diagnostics not in clone_node keep-list)
    expect(presented.count).toBeUndefined();
    expect(presented.diagnostics).toBeUndefined();
    // No data wrapper
    expect(presented.data).toBeUndefined();
    expect(presented.success).toBeUndefined();
  });

  it('flattens inspect result — pass through (no keep-list)', () => {
    const result = {
      data: {
        tree: { id: '1:1', name: 'Card', type: 'frame', children: [] },
        count: 3,
      },
    };
    const presented = presentForLLM(result, 'inspect');
    expect(presented.tree).toEqual({ id: '1:1', name: 'Card', type: 'frame', children: [] });
    expect(presented.count).toBe(3); // inspect passes through all fields
    expect(presented.data).toBeUndefined();
  });

  it('flattens describe result — node fields at top level', () => {
    const result = {
      data: {
        type: 'frame', id: '1:1', name: 'Card',
        width: 300, height: 400,
      },
    };
    const presented = presentForLLM(result, 'describe');
    expect(presented.type).toBe('frame');
    expect(presented.id).toBe('1:1');
    expect(presented.name).toBe('Card');
    expect(presented.data).toBeUndefined();
  });

  it('flattens find_nodes results to top level', () => {
    const result = {
      data: {
        results: [{ id: '1:1', name: 'Card' }, { id: '1:2', name: 'Button' }],
        totalSearched: 100,
      },
    };
    const presented = presentForLLM(result, 'find_nodes');
    expect(presented.results).toHaveLength(2);
    expect(presented.totalSearched).toBe(100);
    expect(presented.data).toBeUndefined();
  });

  it('no success field on success', () => {
    const result = {
      data: { idMap: { Card: '100:1' } },
    };
    const presented = presentForLLM(result, 'jsx');
    expect(presented.success).toBeUndefined();
  });

  it('error as string replaces success:false + error object', () => {
    const result = {
      data: {},
      error: 'Failed to create',
    };
    const presented = presentForLLM(result, 'jsx');
    expect(presented.error).toBe('Failed to create');
    expect(presented.success).toBeUndefined();
  });

  it('flattens chain sub-results too', () => {
    const result = {
      data: {
        chain: [
          {
            command: 'inspect 1:1',
            data: { tree: '<frame/>', nodeCount: 5 },
          },
          {
            command: 'describe 1:2',
            data: { node: { type: 'frame', id: '1:1' }, extra: 'noise' },
          },
        ],
      },
    };
    const presented = presentForLLM(result, 'js');
    const chain = presented.chain;
    expect(chain).toHaveLength(2);
    // inspect sub-result: pass through (no keep-list)
    expect(chain[0].command).toBe('inspect 1:1');
    expect(chain[0].tree).toBe('<frame/>');
    expect(chain[0].data).toBeUndefined();
    // describe sub-result: pass through (no keep-list)
    expect(chain[1].command).toBe('describe 1:2');
    expect(chain[1].node).toEqual({ type: 'frame', id: '1:1' });
    expect(chain[1].data).toBeUndefined();
  });

  it('chain sub-result error flattened to string', () => {
    const result = {
      data: {
        chain: [
          {
            command: 'describe /Missing/',
            error: 'Node not found',
            data: {},
          },
        ],
      },
    };
    const presented = presentForLLM(result, 'js');
    expect(presented.chain[0].error).toBe('Node not found');
    expect(presented.chain[0].success).toBeUndefined();
  });

  it('passes through unknown command data unchanged', () => {
    const result = {
      data: { foo: 'bar', baz: 42 },
    };
    const presented = presentForLLM(result, 'unknown_cmd');
    expect(presented.foo).toBe('bar');
    expect(presented.baz).toBe(42);
  });

  it('wraps string data as output field', () => {
    const result = {
      data: 'multi-line\nstring payload\nfrom an arbitrary tool',
    };
    const presented = presentForLLM(result, 'arbitrary_tool');
    expect(presented.output).toBe('multi-line\nstring payload\nfrom an arbitrary tool');
  });

  it('passes through edit result fields (no per-tool filter)', () => {
    const result = {
      data: {
        id: '100:1',
        name: 'Card',
        type: 'frame',
        changed: true,
        count: 3,
        results: [{ prop: 'fill', status: 'ok' }],
        defaultsApplied: [{ property: 'textAutoResize' }],
        warningCount: 1,
      },
    };
    const presented = presentForLLM(result, 'edit');
    expect(presented.id).toBe('100:1');
    expect(presented.name).toBe('Card');
    expect(presented.changed).toBe(true);
    expect(presented.count).toBe(3);
    expect(presented.results).toHaveLength(1);
    expect(presented.defaultsApplied).toHaveLength(1);
    expect(presented.warningCount).toBe(1);
  });

  it('clone_node keepFields skips empty objects', () => {
    const result = {
      data: {
        idMap: {},
        createdIds: ['100:1', '100:2'],
      },
    };
    const presented = presentForLLM(result, 'clone_node');
    expect(presented.idMap).toBeUndefined();
    expect(presented.createdIds).toBeUndefined();
  });

  it('jsx result: node fields spread to top level', () => {
    const result = {
      data: {
        id: '1:1', name: 'Card', type: 'frame', children: ['Title#1:2'],
        created: 5,
      },
    };
    const presented = presentForLLM(result, 'jsx');
    expect(presented.id).toBe('1:1');
    expect(presented.name).toBe('Card');
    expect(presented.children).toEqual(['Title#1:2']);
    expect(presented.created).toBe(5);
    expect(presented.data).toBeUndefined();
  });
});
