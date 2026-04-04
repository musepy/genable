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
    const presented = presentForLLM(result, 'cp', 50);
    // Data fields promoted to top level (cp keeps idMap)
    expect(presented.idMap).toEqual({ Card: '100:1', Title: '100:2' });
    // Noise stripped (count, diagnostics not in cp keep-list)
    expect(presented.count).toBeUndefined();
    expect(presented.diagnostics).toBeUndefined();
    // No data wrapper
    expect(presented.data).toBeUndefined();
    expect(presented.success).toBeUndefined();
    expect(presented._meta).toMatch(/\[\d+m?s?\]/);
  });

  it('flattens ls result — listing at top level', () => {
    const result = {
      data: {
        tree: { id: '1:1', name: 'Card', type: 'frame', children: [] },
        count: 3,
      },
    };
    const presented = presentForLLM(result, 'tree', 30);
    expect(presented.tree).toEqual({ id: '1:1', name: 'Card', type: 'frame', children: [] });
    expect(presented.count).toBeUndefined();
    expect(presented.data).toBeUndefined();
  });

  it('flattens cat result — node fields at top level (no node wrapper)', () => {
    const result = {
      data: {
        type: 'frame', id: '1:1', name: 'Card',
        width: 300, height: 400,
      },
    };
    const presented = presentForLLM(result, 'cat', 20);
    expect(presented.type).toBe('frame');
    expect(presented.id).toBe('1:1');
    expect(presented.name).toBe('Card');
    expect(presented.data).toBeUndefined();
  });

  it('flattens grep results to top level', () => {
    const result = {
      data: {
        results: [{ id: '1:1', name: 'Card' }, { id: '1:2', name: 'Button' }],
        totalSearched: 100,
      },
    };
    const presented = presentForLLM(result, 'grep', 15);
    expect(presented.results).toHaveLength(2);
    expect(presented.totalSearched).toBeUndefined();
  });

  it('no success field on success (_meta timing is sufficient)', () => {
    const result = {
      data: { idMap: { Card: '100:1' } },
    };
    const presented = presentForLLM(result, 'mk', 10);
    expect(presented.success).toBeUndefined();
  });

  it('error as string replaces success:false + error object', () => {
    const result = {
      data: {},
      error: 'Failed to create',
    };
    const presented = presentForLLM(result, 'mk', 10);
    expect(presented.error).toBe('Failed to create');
    expect(presented.success).toBeUndefined();
    expect(presented._meta).toMatch(/\[\d+m?s?\]/);
  });

  it('flattens chain sub-results too', () => {
    const result = {
      data: {
        chain: [
          {
            command: 'tree /',
            data: { tree: '<frame/>', nodeCount: 5 },
          },
          {
            command: 'cat /Card/',
            data: { node: { type: 'frame', id: '1:1' }, extra: 'noise' },
          },
        ],
      },
    };
    const presented = presentForLLM(result, 'run', 100);
    const chain = presented.chain;
    expect(chain).toHaveLength(2);
    // tree sub-result: keep tree, strip nodeCount
    expect(chain[0].command).toBe('tree /');
    expect(chain[0].tree).toBe('<frame/>');
    expect(chain[0].data).toBeUndefined();
    // cat sub-result: keep node, strip extra
    expect(chain[1].command).toBe('cat /Card/');
    expect(chain[1].node).toEqual({ type: 'frame', id: '1:1' });
    expect(chain[1].data).toBeUndefined();
  });

  it('chain sub-result error flattened to string', () => {
    const result = {
      data: {
        chain: [
          {
            command: 'cat /Missing/',
            error: 'Node not found',
            data: {},
          },
        ],
      },
    };
    const presented = presentForLLM(result, 'run', 50);
    expect(presented.chain[0].error).toBe('Node not found');
    expect(presented.chain[0].success).toBeUndefined();
  });

  it('passes through unknown command data unchanged', () => {
    const result = {
      data: { foo: 'bar', baz: 42 },
    };
    const presented = presentForLLM(result, 'unknown_cmd', 10);
    expect(presented.foo).toBe('bar');
    expect(presented.baz).toBe(42);
  });

  it('wraps string data as output field', () => {
    const result = {
      data: 'mk — create nodes\n\nUsage: mk /path/ [type]',
    };
    const presented = presentForLLM(result, 'man', 5);
    expect(presented.output).toBe('mk — create nodes\n\nUsage: mk /path/ [type]');
  });

  it('strips result to lean shape per keep-list', () => {
    const result = {
      data: {
        id: '100:1',
        name: 'Card',
        type: 'frame',
        updated: 3,
        results: [{ prop: 'fill', status: 'ok' }],
        defaultsApplied: [{ property: 'textAutoResize' }],
        warningCount: 1,
      },
    };
    const presented = presentForLLM(result, 'edit', 200);
    // edit keeps: id, name, type, updated, results
    expect(presented.id).toBe('100:1');
    expect(presented.name).toBe('Card');
    expect(presented.updated).toBe(3);
    expect(presented.results).toHaveLength(1);
    // Noise stripped
    expect(presented.defaultsApplied).toBeUndefined();
    expect(presented.warningCount).toBeUndefined();
  });

  it('skips empty arrays and empty objects in keep fields', () => {
    const result = {
      data: {
        idMap: {},
        deleted: 0,
        results: [],
      },
    };
    // edit has a keep-list: ['id', 'name', 'type', 'updated', 'results']
    const presented = presentForLLM(result, 'edit', 10);
    // Empty object and empty array stripped even if in keep-list
    expect(presented.idMap).toBeUndefined();
    expect(presented.results).toBeUndefined();
  });

  it('preserves stderr extraction before stripping', () => {
    const result = {
      data: {
        idMap: { Card: '100:1' },
        warnings: [{ message: 'font fallback' }],
        violations: [{ message: 'sizing reverted' }],
      },
    };
    // cp has a keep-list: ['idMap'] — warnings/violations stripped from output
    const presented = presentForLLM(result, 'cp', 50);
    expect(presented._stderr).toContain('font fallback');
    expect(presented._stderr).toContain('sizing reverted');
    expect(presented.warnings).toBeUndefined();
    expect(presented.violations).toBeUndefined();
  });

  it('jsx result: node fields spread to top level', () => {
    const result = {
      data: {
        id: '1:1', name: 'Card', type: 'frame', children: ['Title#1:2'],
        created: 5,
      },
    };
    const presented = presentForLLM(result, 'jsx', 2000);
    expect(presented.id).toBe('1:1');
    expect(presented.name).toBe('Card');
    expect(presented.children).toEqual(['Title#1:2']);
    expect(presented.created).toBe(5);
    expect(presented.data).toBeUndefined();
  });
});
