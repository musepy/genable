import { describe, it, expect } from 'vitest';
import { validateSemantics } from '../semanticValidator';
import type { OperationIR } from '../../../domain/design-ir';

function makeTextOp(overrides: Partial<OperationIR> = {}): OperationIR {
  return {
    command: 'create',
    nodeType: 'TEXT',
    symbol: 'title',
    props: { characters: 'Hello', textAutoResize: 'WIDTH_AND_HEIGHT', fontSize: 20 },
    dependsOn: [],
    ...overrides,
  };
}

function makeFrameOp(overrides: Partial<OperationIR> = {}): OperationIR {
  return {
    command: 'create',
    nodeType: 'FRAME',
    symbol: 'card',
    props: { width: 320, height: 480 },
    dependsOn: [],
    ...overrides,
  };
}

describe('validateSemantics', () => {
  describe('text sizing contract (requireTextAutoResize)', () => {
    it('passes valid intrinsic text (WIDTH_AND_HEIGHT, no dimensions)', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp()],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(1);
      expect(diagnostics).toHaveLength(0);
    });

    it('passes valid fixed-width text (HEIGHT + width)', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Body', textAutoResize: 'HEIGHT', width: 320, fontSize: 14 } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(1);
      expect(diagnostics).toHaveLength(0);
    });

    it('rejects create text without textAutoResize', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Hello', fontSize: 20 } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(0);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe('TEXT_SIZING_MISSING');
      expect(diagnostics[0].severity).toBe('error');
    });

    it('rejects WIDTH_AND_HEIGHT with explicit width', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Hello', textAutoResize: 'WIDTH_AND_HEIGHT', width: 200 } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(0);
      expect(diagnostics[0].code).toBe('TEXT_SIZING_INVALID');
    });

    it('rejects HEIGHT mode without width', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Body', textAutoResize: 'HEIGHT' } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(0);
      expect(diagnostics[0].code).toBe('TEXT_SIZING_INVALID');
      expect(diagnostics[0].message).toMatch(/must declare a numeric width/);
    });

    it('rejects non-numeric width on text', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Body', textAutoResize: 'HEIGHT', width: 'fill' as any } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(0);
      expect(diagnostics[0].code).toBe('TEXT_SIZING_INVALID');
      expect(diagnostics[0].message).toMatch(/does not support/i);
    });

    it('rejects layoutSizingHorizontal on text', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Hello', layoutSizingHorizontal: 'FILL' } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(0);
      expect(diagnostics[0].code).toBe('TEXT_SIZING_INVALID');
    });

    it('skips text sizing validation when requireTextAutoResize is false', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ props: { characters: 'Hello', fontSize: 20 } })],
        { requireTextAutoResize: false },
      );
      expect(validated).toHaveLength(1);
      expect(diagnostics).toHaveLength(0);
    });

    it('skips text sizing for update ops that dont touch sizing props', () => {
      const { validated, diagnostics } = validateSemantics(
        [makeTextOp({ command: 'update', targetRef: '1:1', props: { fills: ['#EF4444'] } })],
        { requireTextAutoResize: true },
      );
      expect(validated).toHaveLength(1);
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('reference validation', () => {
    it('warns on missing symbol reference', () => {
      const op = makeFrameOp({ dependsOn: ['missingParent'] });
      const { validated, diagnostics } = validateSemantics([op]);
      expect(validated).toHaveLength(1); // warning, not error
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe('REF_NOT_FOUND');
      expect(diagnostics[0].severity).toBe('warning');
    });

    it('does not warn when symbol exists in batch', () => {
      const parent = makeFrameOp({ symbol: 'container' });
      const child = makeFrameOp({ symbol: 'child', dependsOn: ['container'] });
      const { diagnostics } = validateSemantics([parent, child]);
      expect(diagnostics).toHaveLength(0);
    });

    it('does not warn for Figma ID references (contain colon)', () => {
      const op = makeFrameOp({ dependsOn: ['100:5'] });
      const { diagnostics } = validateSemantics([op]);
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('mixed operations', () => {
    it('filters only error ops, keeps warning ops', () => {
      const goodFrame = makeFrameOp({ symbol: 'card' });
      const badText = makeTextOp({
        symbol: 'noResize',
        props: { characters: 'Bad', fontSize: 20 },
      });
      const warnFrame = makeFrameOp({ symbol: 'orphan', dependsOn: ['missing'] });

      const { validated, diagnostics } = validateSemantics(
        [goodFrame, badText, warnFrame],
        { requireTextAutoResize: true },
      );

      expect(validated).toHaveLength(2); // goodFrame + warnFrame (warning only)
      expect(diagnostics).toHaveLength(2); // badText error + warnFrame warning
      expect(diagnostics[0].severity).toBe('error');
      expect(diagnostics[1].severity).toBe('warning');
    });
  });
});
