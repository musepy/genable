import { describe, it, expect } from 'vitest';
import { validateSemantics } from '../semanticValidator';
import type { OperationIR } from '../../../domain/design-ir';

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
    it('keeps all valid ops, reports warnings only', () => {
      const goodFrame = makeFrameOp({ symbol: 'card' });
      const warnFrame = makeFrameOp({ symbol: 'orphan', dependsOn: ['missing'] });

      const { validated, diagnostics } = validateSemantics([goodFrame, warnFrame]);

      expect(validated).toHaveLength(2);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe('warning');
    });
  });
});
