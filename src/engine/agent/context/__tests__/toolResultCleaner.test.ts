import { describe, it, expect } from 'vitest';
import { ToolResultCleaner } from '../toolResultCleaner';

describe('ToolResultCleaner', () => {
  const tools: any[] = [
    { name: 'create', parameters: { properties: { xml: { type: 'string' } } } }
  ];
  const cleaner = new ToolResultCleaner(tools);

  it('preserves rollback information in create failure results', () => {
    const rawResult = {
      success: false,
      name: 'create',
      error: { code: 'PARTIAL_FAILURE', message: 'One or more lines failed.' },
      data: {
        results: [
          { opId: 'op1', action: 'createFrame', success: true, nodeId: 'node-1' },
          { opId: 'op2', action: 'createFrame', success: false, error: { code: 'APPLY_ERROR', message: 'failed' } }
        ],
        idMap: { op1: 'node-1' },
        rollback: {
          attempted: 1,
          removed: 1,
          failed: []
        }
      }
    };

    const cleaned = cleaner.cleanToolResult(rawResult);

    expect(cleaned.data.rollback).toBeDefined();
    expect(cleaned.data.rollback.removed).toBe(1);
    expect(cleaned.data.idMap).toBeDefined();
    expect(cleaned.data.results.length).toBe(2);
  });

  it('preserves visibilityWarnings and visibilityAutoFixed in successful results', () => {
    const rawResult = {
      success: true,
      data: {
        nodeId: 'node-1',
        name: 'My Frame',
        visibilityWarnings: [{ message: 'Hidden element', severity: 'warning' }],
        visibilityAutoFixed: ['Fixed overlap']
      }
    };

    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.data.visibilityWarnings).toBeDefined();
    expect(cleaned.data.visibilityWarnings[0].message).toBe('Hidden element');
    expect(cleaned.data.visibilityAutoFixed).toContain('Fixed overlap');
  });

  it('preserves diff and diffInfo in create results', () => {
    const rawResult = {
      success: false,
      name: 'create',
      data: {
        results: [
          {
            opId: 'op1',
            action: 'createFrame',
            success: true,
            nodeId: 'node-1',
            diff: ['layoutMode mismatch'],
            diffInfo: ['[Auto-corrected] Text node limitation']
          }
        ],
        idMap: { op1: 'node-1' }
      }
    };

    const cleaned = cleaner.cleanToolResult(rawResult);
    const op1 = cleaned.data.results[0];
    expect(op1.diff).toBeDefined();
    expect(op1.diffInfo).toBeDefined();
  });

  it('preserves validation error details for TOOL_VALIDATION_ERROR', () => {
    const rawResult = {
      success: false,
      error: {
        code: 'TOOL_VALIDATION_ERROR',
        message: 'Validation Error: create is missing required parameter(s): xml.',
        details: {
          tool: 'create',
          mode: 'EXECUTION',
          missing: ['xml'],
          invalid: [],
          receivedKeys: ['parentId'],
          repairHint: 'provide a non-empty "xml" string with design markup',
          extra: 'should be dropped'
        }
      }
    };

    const cleaned = cleaner.cleanToolResult(rawResult);

    expect(cleaned.error.details).toEqual({
      tool: 'create',
      mode: 'EXECUTION',
      missing: ['xml'],
      invalid: [],
      receivedKeys: ['parentId'],
      repairHint: 'provide a non-empty "xml" string with design markup'
    });
  });

  it('keeps non-validation errors compact (details stripped)', () => {
    const rawResult = {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: 'Something failed',
        details: { deep: true }
      }
    };

    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.error.details).toBeUndefined();
  });

  describe('read specific cleaning', () => {
    it('preserves visual properties in hierarchy mode', () => {
      const rawResult = {
        name: 'read',
        success: true,
        data: {
          id: 'root-1',
          type: 'FRAME',
          props: {
            name: 'Main Frame',
            layoutMode: 'VERTICAL',
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
            extraneousProp: 'should_be_stripped'
          },
          children: [
            {
              id: 'child-1',
              type: 'TEXT',
              props: {
                name: 'Title',
                fontSize: 16,
                characters: 'Hello World'
              }
            }
          ]
        }
      };

      const cleaned = cleaner.cleanToolResult(rawResult);

      // Verify root
      expect(cleaned.data.id).toBe('root-1');
      expect(cleaned.data.props.layoutMode).toBe('VERTICAL');
      expect(cleaned.data.props.fills).toBeDefined();
      expect(cleaned.data.props.extraneousProp).toBeUndefined();

      // Verify child
      expect(cleaned.data.children[0].id).toBe('child-1');
      expect(cleaned.data.children[0].props.fontSize).toBe(16);
      expect(cleaned.data.children[0].props.characters).toBe('Hello World');
    });

    it('preserves structured anomalies in read hierarchy mode', () => {
      const rawResult = {
        name: 'read',
        success: true,
        data: {
          id: 'root-1',
          type: 'FRAME',
          props: { name: 'Root', layoutMode: 'VERTICAL' },
          anomalies: [
            {
              code: 'SIZING_REVERTED',
              message: 'Child reverted from FILL to FIXED',
              nodeId: 'child-1',
              nodeName: 'Card Row',
              context: {
                'parent.layoutMode': 'NONE',
                intended: 'FILL',
                actual: 'FIXED',
                veryLong: 'x'.repeat(300),
              },
              hints: [
                'Set parent layoutMode first',
                'Reapply FILL',
              ],
            }
          ],
          children: []
        }
      };

      const cleaned = cleaner.cleanToolResult(rawResult);

      expect(Array.isArray(cleaned.data.anomalies)).toBe(true);
      expect(cleaned.data.anomalies[0].code).toBe('SIZING_REVERTED');
      expect(cleaned.data.anomalies[0].nodeId).toBe('child-1');
      expect(cleaned.data.anomalies[0].hints.length).toBeGreaterThan(0);
      expect(typeof cleaned.data.anomalies[0].context.veryLong).toBe('string');
      expect(cleaned.data.anomalies[0].context.veryLong.length).toBeLessThanOrEqual(121);
    });

    it('preserves visual properties even when result is oversized (> MAX_DATA_CHARS)', () => {
      // Create a massive children array to exceed 6000 chars limit in stringified form
      const massiveChildren = Array.from({ length: 20 }, (_, i) => ({
        id: `child-${i}`,
        type: 'FRAME',
        props: {
          name: `Row ${i}`,
          layoutMode: 'HORIZONTAL',
          padding: 16,
          garbage: 'x'.repeat(500) // Inflate size
        }
      }));

      const rawResult = {
        name: 'read',
        success: true,
        data: {
          id: 'root-1',
          type: 'FRAME',
          props: {
            name: 'List Container',
            layoutMode: 'VERTICAL'
          },
          children: massiveChildren
        }
      };

      // Ensure raw result is actually oversized
      expect(JSON.stringify(rawResult).length).toBeGreaterThan(6000);

      const cleaned = cleaner.cleanToolResult(rawResult);

      // It should still process structurally, not just truncate to text
      expect(cleaned.data.id).toBe('root-1');
      expect(cleaned.data.props.layoutMode).toBe('VERTICAL');

      // Children should be capped at 15
      expect(cleaned.data.children.length).toBe(15);
      expect(cleaned.data._moreChildren).toBe(5);

      // Child props should be preserved and garbage stripped
      expect(cleaned.data.children[0].props.layoutMode).toBe('HORIZONTAL');
      expect(cleaned.data.children[0].props.padding).toBe(16);
      expect(cleaned.data.children[0].props.garbage).toBeUndefined();
    });

    it('preserves selection format (nodes array + count)', () => {
      const rawResult = {
        name: 'read',
        success: true,
        data: {
          count: 2,
          nodes: [
            { id: '1', name: 'N1', type: 'FRAME', extraneous: true },
            { id: '2', name: 'N2', type: 'TEXT', extraneous: true }
          ]
        }
      };

      const cleaned = cleaner.cleanToolResult(rawResult);
      expect(cleaned.data.count).toBe(2);
      expect(cleaned.data.nodes.length).toBe(2);
      expect(cleaned.data.nodes[0].name).toBe('N1');
      expect(cleaned.data.nodes[0].extraneous).toBeUndefined();
    });
  });
});
