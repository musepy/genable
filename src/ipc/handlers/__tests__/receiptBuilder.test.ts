import { describe, it, expect } from 'vitest';
import { buildCreateReceipt, buildEditReceipt } from '../receiptBuilder';
import { LineResult, CreateExecutionResult } from '../../../engine/actions/createTypes';
import { ValidationViolation } from '../../../engine/validation/postOpValidator';

function makeLineResult(overrides: Partial<LineResult> = {}): LineResult {
  return {
    line: 1,
    raw: '{}',
    status: 'ok',
    command: 'create',
    symbol: 'node1',
    nodeId: '1:1',
    ...overrides,
  };
}

function makeResult(lineResults: LineResult[], idMap: Record<string, string> = {}): CreateExecutionResult {
  const created = lineResults.filter(lr => lr.status === 'ok' || lr.status === 'warning').length;
  const failed = lineResults.filter(lr => lr.status === 'failed').length;
  const skipped = lineResults.filter(lr => lr.status === 'skipped').length;
  const warnings = lineResults.filter(lr => lr.status === 'warning').length;
  return {
    success: failed === 0,
    hasErrors: failed > 0,
    idMap,
    lineResults,
    stats: { total: lineResults.length, created, failed, skipped, warnings },
  };
}

function makeViolation(overrides: Partial<ValidationViolation> = {}): ValidationViolation {
  return {
    code: 'TEXT_OVERFLOW',
    message: "'Label' text overflows",
    nodeId: '1:2',
    nodeName: 'Label',
    context: {},
    hints: ['Set textAutoResize to "HEIGHT"'],
    ...overrides,
  };
}

describe('buildCreateReceipt', () => {
  it('returns correct created count and idMap', () => {
    const lr1 = makeLineResult({ symbol: 'a', nodeId: '1:1' });
    const lr2 = makeLineResult({ line: 2, symbol: 'b', nodeId: '1:2' });
    const result = makeResult([lr1, lr2], { a: '1:1', b: '1:2' });

    const receipt = buildCreateReceipt({ result });

    expect(receipt.created).toBe(2);
    expect(receipt.idMap).toEqual({ a: '1:1', b: '1:2' });
    expect(receipt.failed).toBeUndefined();
    expect(receipt.errors).toBeUndefined();
  });

  it('populates defaultsApplied from *_DEFAULT warnings', () => {
    const lr = makeLineResult({
      status: 'warning',
      symbol: 'frame1',
      warnings: [
        {
          code: 'SIZING_DEFAULT',
          message: 'layoutSizingHorizontal defaulted to "FILL" (child frame without explicit width). Set width or layoutSizingHorizontal explicitly.',
        },
        {
          code: 'CLIPS_CONTENT_DEFAULT',
          message: 'clipsContent defaulted to false (auto-layout frame). Set explicitly to override.',
        },
      ],
    });
    const result = makeResult([lr], { frame1: '1:1' });

    const receipt = buildCreateReceipt({ result });

    expect(receipt.defaultsAppliedCount).toBe(2);
    expect(receipt.defaultsApplied).toHaveLength(2);
    expect(receipt.defaultsApplied[0]).toEqual({
      property: 'layoutSizingHorizontal',
      value: 'FILL',
      node: 'frame1',
      reason: 'child frame without explicit width',
    });
    expect(receipt.defaultsApplied[1]).toEqual({
      property: 'clipsContent',
      value: 'false',
      node: 'frame1',
      reason: 'auto-layout frame',
    });
  });

  it('caps defaultsApplied at 10 while preserving total count', () => {
    const lineResults = Array.from({ length: 12 }, (_, index) =>
      makeLineResult({
        line: index + 1,
        symbol: `node${index + 1}`,
        status: 'warning',
        warnings: [
          {
            code: 'SIZING_DEFAULT',
            message: `width defaulted to ${320 + index}px (generated reason ${index + 1}). Set explicitly to override.`,
          },
        ],
      })
    );
    const result = makeResult(lineResults);

    const receipt = buildCreateReceipt({ result });

    expect(receipt.defaultsAppliedCount).toBe(12);
    expect(receipt.defaultsApplied).toHaveLength(10);
    expect(receipt.defaultsApplied[0].node).toBe('node1');
    expect(receipt.defaultsApplied[9].node).toBe('node10');
  });

  it('maps violations to receipt violations with correct severity and fix', () => {
    const result = makeResult([makeLineResult()], { node1: '1:1' });
    const violations: ValidationViolation[] = [
      makeViolation({ code: 'TEXT_OVERFLOW', message: 'text overflows', nodeId: '1:2' }),
      makeViolation({ code: 'TEXT_WIDTH_COLLAPSED', message: 'text collapsed to a narrow width', nodeId: '1:3', hints: ['Use WIDTH_AND_HEIGHT'] }),
    ];

    const receipt = buildCreateReceipt({ result, violations });

    expect(receipt.violations).toHaveLength(2);
    expect(receipt.violations[0]).toMatchObject({
      code: 'TEXT_OVERFLOW',
      severity: 'warning',
      node: '1:2',
      message: 'text overflows',
      fix: 'Set textAutoResize to "HEIGHT"',
    });
    expect(receipt.violations[1]).toMatchObject({
      code: 'TEXT_WIDTH_COLLAPSED',
      severity: 'error',
      node: '1:3',
      message: 'text collapsed to a narrow width',
      fix: 'Use WIDTH_AND_HEIGHT',
    });
  });

  it('caps violations at 10', () => {
    const result = makeResult([makeLineResult()], { node1: '1:1' });
    const violations = Array.from({ length: 12 }, (_, index) =>
      makeViolation({
        code: index % 2 === 0 ? 'TEXT_OVERFLOW' : 'WHITE_ON_WHITE',
        nodeId: `1:${index + 1}`,
        message: `violation ${index + 1}`,
      })
    );

    const receipt = buildCreateReceipt({ result, violations });

    expect(receipt.violations).toHaveLength(10);
    expect(receipt.violations[0].message).toBe('violation 1');
    expect(receipt.violations[9].message).toBe('violation 10');
  });

  it('includes error list when there are failures', () => {
    const lr1 = makeLineResult({ symbol: 'a', nodeId: '1:1' });
    const lr2 = makeLineResult({
      line: 2,
      symbol: 'b',
      status: 'failed',
      error: 'invalid prop',
      nodeId: undefined,
    });
    const result = makeResult([lr1, lr2], { a: '1:1' });

    const receipt = buildCreateReceipt({ result });

    expect(receipt.failed).toBe(1);
    expect(receipt.errors).toEqual([{ op: 'b', error: 'invalid prop' }]);
  });

  it('omits empty arrays and counts', () => {
    const result = makeResult([makeLineResult()], { node1: '1:1' });

    const receipt = buildCreateReceipt({ result });

    expect(receipt.defaultsApplied).toBeUndefined();
    expect(receipt.defaultsAppliedCount).toBeUndefined();
    expect(receipt.violations).toBeUndefined();
    expect(receipt.degraded).toBeUndefined();
  });

  it('includes degraded nodes with hint', () => {
    const lr = makeLineResult({
      status: 'warning',
      symbol: 'card',
      warnings: [
        {
          code: 'DEGRADED_FALLBACK',
          message: 'Created as minimal frame (original: unknown). Use edit to apply styles.',
        },
      ],
    });
    const result = makeResult([lr], { card: '1:1' });

    const receipt = buildCreateReceipt({ result });

    expect(receipt.degraded).toEqual(['card']);
    expect(receipt.degradedHint).toContain('minimal props');
  });

  it('includes nodeLimitWarning when exceeding soft limit', () => {
    const result = makeResult([makeLineResult()], { node1: '1:1' });

    const receipt = buildCreateReceipt({ result, softCreateLimit: 20, createLineCount: 25 });

    expect(receipt.nodeLimitWarning).toContain('25 nodes');
    expect(receipt.nodeLimitWarning).toContain('recommended max: 20');
  });

});

describe('buildEditReceipt', () => {
  it('returns correct edited count and idMap', () => {
    const allResults = [
      { success: true, nodeId: '1:1' },
      { success: true, nodeId: '1:2' },
    ];

    const receipt = buildEditReceipt({ allResults });

    expect(receipt.edited).toBe(2);
    expect(receipt.idMap).toEqual({ '1:1': '1:1', '1:2': '1:2' });
    expect(receipt.failed).toBeUndefined();
  });

  it('includes failures', () => {
    const allResults = [
      { success: true, nodeId: '1:1' },
      { success: false, nodeId: '1:2', error: 'node not found' },
    ];

    const receipt = buildEditReceipt({ allResults });

    expect(receipt.edited).toBe(1);
    expect(receipt.failed).toBe(1);
    expect(receipt.errors).toEqual([{ op: '1:2', error: 'node not found' }]);
  });

  it('includes per-node warnings', () => {
    const allResults = [
      { success: true, nodeId: '1:1', warnings: [{ code: 'FONT_FALLBACK', message: 'Font not found' }] },
    ];

    const receipt = buildEditReceipt({ allResults });

    expect(receipt.warnings).toHaveLength(1);
    expect(receipt.warningCount).toBe(1);
  });

  it('maps violations', () => {
    const allResults = [{ success: true, nodeId: '1:1' }];
    const violations = [makeViolation({ code: 'HUG_FILL_CYCLE' })];

    const receipt = buildEditReceipt({ allResults, violations });

    expect(receipt.violations).toHaveLength(1);
    expect(receipt.violations[0].severity).toBe('error');
    expect(receipt.violations[0].code).toBe('HUG_FILL_CYCLE');
  });

  it('omits empty arrays', () => {
    const allResults = [{ success: true, nodeId: '1:1' }];

    const receipt = buildEditReceipt({ allResults });

    expect(receipt.violations).toBeUndefined();
    expect(receipt.warnings).toBeUndefined();
    expect(receipt.errors).toBeUndefined();
  });
});
