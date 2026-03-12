import { describe, it, expect } from 'vitest';
import { compileDesignOps } from '../../flat/flatOpsParser';

describe('compileDesignOps — symbol reference validation', () => {
  it('warns on missing symbol reference', () => {
    const input = `child = frame(missingParent, {name: 'Child', w: 100, h: 100})`;
    const { ops, diagnostics } = compileDesignOps(input);
    expect(ops).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('REF_NOT_FOUND');
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('does not warn when symbol exists in batch', () => {
    const input = [
      `container = frame('root', {name: 'Container', w: 320, h: 480})`,
      `child = frame(container, {name: 'Child', w: 100, h: 100})`,
    ].join('\n');
    const { diagnostics } = compileDesignOps(input);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn for Figma ID references (contain colon)', () => {
    const input = `child = frame('100:5', {name: 'Child', w: 100, h: 100})`;
    const { diagnostics } = compileDesignOps(input);
    expect(diagnostics).toHaveLength(0);
  });
});
