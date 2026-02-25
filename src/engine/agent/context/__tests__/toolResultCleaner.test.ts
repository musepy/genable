import { describe, it, expect } from 'vitest';
import { ToolResultCleaner } from '../toolResultCleaner';

describe('ToolResultCleaner', () => {
  const tools: any[] = [
    { name: 'batchOperations', parameters: { properties: { operations: { type: 'array' } } } }
  ];
  const cleaner = new ToolResultCleaner(tools);

  it('preserves rollback information in batchOperations failure results', () => {
    const rawResult = {
      success: false,
      error: { code: 'PARTIAL_FAILURE', message: 'One or more operations failed.' },
      data: {
        results: [
          { opId: 'op1', action: 'createNode', success: true, nodeId: 'node-1' },
          { opId: 'op2', action: 'createNode', success: false, error: { code: 'APPLY_ERROR', message: 'failed' } }
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

  it('preserves diff and diffInfo in batchOperations results', () => {
    const rawResult = {
      success: false,
      data: {
        results: [
          { 
            opId: 'op1', 
            action: 'setNodeLayout', 
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

  describe('inspectDesign specific cleaning', () => {
    it('preserves visual properties in hierarchy mode', () => {
      const rawResult = {
        name: 'inspectDesign',
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
        name: 'inspectDesign',
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
        name: 'inspectDesign',
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
