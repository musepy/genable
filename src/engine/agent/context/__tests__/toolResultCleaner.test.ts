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

  it('does not crash on query results with data.results field', () => {
    const rawResult = {
      name: 'query',
      success: true,
      data: {
        results: [
          { title: 'Dashboard layout', content: 'Use grid...', score: 0.85 },
          { title: 'Card patterns', content: 'Cards should...', score: 0.72 }
        ],
        source: 'cross-domain'
      }
    };

    // Should NOT throw "t.results.map is not a function"
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.success).toBe(true);
    // Should fall through to cleanSuccessfulResult, NOT cleanBatchResult
    expect(cleaned.data.results).toBeUndefined(); // cleanSuccessfulResult doesn't preserve .results
  });

  describe('read specific cleaning', () => {
    it('passes through xml and preserves hint/context', () => {
      const rawResult = {
        name: 'read',
        success: true,
        data: {
          xml: '<frame id="root-1" layout="column"><text id="t1">Hello</text></frame>',
          hint: 'auto-degraded to summary',
          context: { pageNodeCount: 42 },
        }
      };

      const cleaned = cleaner.cleanToolResult(rawResult);
      expect(cleaned.data.xml).toBe(rawResult.data.xml);
      expect(cleaned.data.hint).toBe('auto-degraded to summary');
      expect(cleaned.data.context.pageNodeCount).toBe(42);
    });

    it('truncates oversized xml at safe boundary', () => {
      const longXml = '<frame id="root">' + '<text id="t">x</text>\n'.repeat(500) + '</frame>';
      const rawResult = {
        name: 'read',
        success: true,
        data: { xml: longXml }
      };

      // Ensure it's actually oversized
      expect(longXml.length).toBeGreaterThan(6000);

      const cleaned = cleaner.cleanToolResult(rawResult);
      expect(cleaned.data._truncated).toBe(true);
      expect(cleaned.data.xml.length).toBeLessThan(longXml.length);
      // Should not end with a broken tag
      const lastAngleBracket = cleaned.data.xml.lastIndexOf('>');
      const truncationComment = cleaned.data.xml.indexOf('<!-- truncated');
      expect(truncationComment).toBeGreaterThan(0);
      expect(lastAngleBracket).toBeGreaterThan(0);
    });

    it('strips unknown fields, keeps only xml/hint/context', () => {
      const rawResult = {
        name: 'read',
        success: true,
        data: {
          xml: '<frame id="f1"/>',
          hint: 'ok',
          extraField: 'should be dropped',
          nodes: [{ id: '1' }],
        }
      };

      const cleaned = cleaner.cleanToolResult(rawResult);
      expect(cleaned.data.xml).toBe('<frame id="f1"/>');
      expect(cleaned.data.hint).toBe('ok');
      expect(cleaned.data.extraField).toBeUndefined();
      expect(cleaned.data.nodes).toBeUndefined();
    });
  });
});
