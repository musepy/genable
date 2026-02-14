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
    // This will fail currently as the cleaner doesn't keep these fields!
    // We will fix the implementation next.
    expect(op1.diff).toBeDefined();
    expect(op1.diffInfo).toBeDefined();
  });
});
