import { describe, it, expect } from 'vitest';
import { presentForLLM } from '../presentation';

describe('presentForLLM — noise stripping', () => {
  it('strips mk result to idMap only', () => {
    const result = {
      success: true,
      data: {
        idMap: { Card: '100:1', Title: '100:2' },
        created: 2,
        count: 2,
        diagnostics: { elapsed: 42 },
      },
    };
    const presented = presentForLLM(result, 'mk', 50);
    expect(presented.data).toEqual({ idMap: { Card: '100:1', Title: '100:2' } });
    expect(presented.data.created).toBeUndefined();
    expect(presented.data.count).toBeUndefined();
    expect(presented._meta).toContain('exit:0');
  });

  it('strips ls result to listing only', () => {
    const result = {
      success: true,
      data: {
        listing: 'Card\nButton\nHeader',
        count: 3,
        path: '/',
      },
    };
    const presented = presentForLLM(result, 'ls', 30);
    expect(presented.data).toEqual({ listing: 'Card\nButton\nHeader' });
    expect(presented.data.count).toBeUndefined();
    expect(presented.data.path).toBeUndefined();
  });

  it('strips cat result to tree only', () => {
    const result = {
      success: true,
      data: {
        tree: '<frame name="Card">...</frame>',
        path: '/Card/',
        nodeCount: 5,
      },
    };
    const presented = presentForLLM(result, 'cat', 20);
    expect(presented.data).toEqual({ tree: '<frame name="Card">...</frame>' });
  });

  it('strips grep node-search to results only', () => {
    const result = {
      success: true,
      data: {
        results: [{ id: '1:1', name: 'Card' }, { id: '1:2', name: 'Button' }],
        totalSearched: 100,
        elapsed: 15,
      },
    };
    const presented = presentForLLM(result, 'grep', 15);
    expect(presented.data).toEqual({
      results: [{ id: '1:1', name: 'Card' }, { id: '1:2', name: 'Button' }],
    });
  });

  it('strips grep property-mode to properties only', () => {
    const result = {
      success: true,
      data: {
        properties: { bg: '#FFF', color: '#000' },
        nodeCount: 5,
      },
    };
    const presented = presentForLLM(result, 'grep', 10);
    expect(presented.data).toEqual({
      properties: { bg: '#FFF', color: '#000' },
    });
  });

  it('strips success:true (redundant with exit:0)', () => {
    const result = {
      success: true,
      data: { idMap: { Card: '100:1' } },
    };
    const presented = presentForLLM(result, 'mk', 10);
    expect(presented.data.success).toBeUndefined();
  });

  it('keeps success:false and error for failures (top-level)', () => {
    const result = {
      success: false,
      data: { idMap: {} },
      error: { code: 'EXEC_ERROR', message: 'Failed to create' },
    };
    const presented = presentForLLM(result, 'mk', 10);
    // success/error live at result top-level, not inside data
    expect(presented.success).toBe(false);
    expect(presented.error).toEqual({ code: 'EXEC_ERROR', message: 'Failed to create' });
    expect(presented._meta).toContain('exit:1');
  });

  it('strips chain results per sub-command name', () => {
    const result = {
      success: true,
      data: {
        chain: [
          {
            command: 'tree /',
            success: true,
            data: { tree: '<frame/>', nodeCount: 5 },
          },
          {
            command: 'cat /Card/',
            success: true,
            data: { tree: '<frame name="Card">...</frame>', path: '/Card/' },
          },
        ],
      },
    };
    const presented = presentForLLM(result, 'run', 100);
    const chain = presented.data.chain;
    expect(chain).toHaveLength(2);
    // tree sub-result: keep tree, strip nodeCount
    expect(chain[0].command).toBe('tree /');
    expect(chain[0].data).toEqual({ tree: '<frame/>' });
    // cat sub-result: keep tree, strip path
    expect(chain[1].command).toBe('cat /Card/');
    expect(chain[1].data).toEqual({ tree: '<frame name="Card">...</frame>' });
  });

  it('passes through unknown command data unchanged', () => {
    const result = {
      success: true,
      data: { foo: 'bar', baz: 42 },
    };
    const presented = presentForLLM(result, 'unknown_cmd', 10);
    expect(presented.data).toEqual({ foo: 'bar', baz: 42 });
  });

  it('passes through man command data unchanged (null keep list)', () => {
    const result = {
      success: true,
      data: 'mk — create nodes\n\nUsage: mk /path/ [type]',
    };
    const presented = presentForLLM(result, 'man', 5);
    expect(presented.data).toBe('mk — create nodes\n\nUsage: mk /path/ [type]');
  });

  it('strips design result to lean shape', () => {
    const result = {
      success: true,
      data: {
        idMap: { Card: '100:1' },
        created: 3,
        edited: 1,
        deleted: 0,
        defaultsApplied: [{ property: 'textAutoResize' }],
        defaultsAppliedCount: 2,
        violations: [{ code: 'TEXT_OVERFLOW' }],
        warningCount: 1,
        nodeLimitWarning: 'too many',
      },
    };
    const presented = presentForLLM(result, 'design', 200);
    expect(presented.data.idMap).toEqual({ Card: '100:1' });
    expect(presented.data.created).toBe(3);
    expect(presented.data.edited).toBe(1);
    // Noise fields stripped
    expect(presented.data.defaultsApplied).toBeUndefined();
    expect(presented.data.defaultsAppliedCount).toBeUndefined();
    expect(presented.data.violations).toBeUndefined();
    expect(presented.data.warningCount).toBeUndefined();
    expect(presented.data.nodeLimitWarning).toBeUndefined();
    // deleted:0 is kept (numeric zero is still a valid value)
    expect(presented.data.deleted).toBe(0);
  });

  it('skips empty arrays and empty objects in keep fields', () => {
    const result = {
      success: true,
      data: {
        idMap: {},
        created: 0,
        edited: 0,
        degraded: [],
        failed: 0,
      },
    };
    const presented = presentForLLM(result, 'design', 10);
    // All kept fields are empty/zero → stripped
    expect(presented.data.idMap).toBeUndefined();
    expect(presented.data.degraded).toBeUndefined();
  });

  it('preserves stderr extraction before stripping', () => {
    const result = {
      success: true,
      data: {
        idMap: { Card: '100:1' },
        warnings: [{ message: 'font fallback' }],
        violations: [{ message: 'sizing reverted' }],
      },
    };
    const presented = presentForLLM(result, 'mk', 50);
    // Stderr should capture warnings/violations
    expect(presented._stderr).toContain('font fallback');
    expect(presented._stderr).toContain('sizing reverted');
    // But they should be stripped from data
    expect(presented.data.warnings).toBeUndefined();
    expect(presented.data.violations).toBeUndefined();
  });
});
