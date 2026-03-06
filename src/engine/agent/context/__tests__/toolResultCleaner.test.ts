import { describe, it, expect } from 'vitest';
import { ToolResultCleaner } from '../toolResultCleaner';

describe('ToolResultCleaner', () => {
  const tools: any[] = [
    { name: 'create', parameters: { properties: { xml: { type: 'string' } } } }
  ];
  const cleaner = new ToolResultCleaner(tools);

  // create/edit data is now a compact receipt from the executor — cleaner passes it through.
  it('passes through create receipt unchanged', () => {
    const rawResult = {
      name: 'create',
      success: true,
      data: { created: 2, idMap: { header: 'node-1', btn: 'node-2' } },
    };
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.data).toEqual({ created: 2, idMap: { header: 'node-1', btn: 'node-2' } });
  });

  it('passes through create receipt with errors unchanged', () => {
    const rawResult = {
      name: 'create',
      success: false,
      error: { code: 'PARTIAL_FAILURE', message: '1 of 2 failed' },
      data: {
        idMap: { header: 'node-1' },
        created: 1,
        failed: 1,
        errors: [{ op: 'icon', error: 'Unknown node type' }],
      },
    };
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.data.created).toBe(1);
    expect(cleaned.data.failed).toBe(1);
    expect(cleaned.data.errors[0]).toEqual({ op: 'icon', error: 'Unknown node type' });
  });

  it('passes through edit receipt unchanged', () => {
    const rawResult = {
      name: 'edit',
      success: true,
      data: { edited: 1, idMap: { 'node-5': 'node-5' } },
    };
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.data.edited).toBe(1);
    expect(cleaned.data.created).toBeUndefined();
    expect(cleaned.data.idMap).toEqual({ 'node-5': 'node-5' });
  });

  it('passes through create receipt with anomalies', () => {
    const rawResult = {
      name: 'create',
      success: true,
      data: {
        created: 1,
        idMap: { frame: 'node-3' },
        anomalies: [{ code: 'CLIPPED', nodeId: 'node-3', message: 'Content clipped' }],
      },
    };
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.data.created).toBe(1);
    expect(cleaned.data.anomalies).toHaveLength(1);
    expect(cleaned.data.anomalies[0].code).toBe('CLIPPED');
  });

  it('caps oversized generic tool data', () => {
    const rawResult = {
      name: 'query',
      success: true,
      data: {
        results: Array(100).fill({ title: 'x'.repeat(100), content: 'y'.repeat(200) }),
      },
    };
    const cleaned = cleaner.cleanToolResult(rawResult);
    expect(cleaned.success).toBe(true);
    // Oversized generic data gets stripped (no idMap to preserve)
    expect(cleaned.data.results).toBeUndefined();
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

      expect(longXml.length).toBeGreaterThan(6000);

      const cleaned = cleaner.cleanToolResult(rawResult);
      expect(cleaned.data.xml.length).toBeLessThan(longXml.length);
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
