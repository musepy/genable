import { describe, it, expect } from 'vitest';
import { parseFlatOps } from '../../flat/flatOpsParser';

/**
 * Inline symbol reference validation — same logic as executor.executeDesignOps pre-processing.
 * Extracted here for unit testing without Figma runtime.
 */
function validateSymbolRefs(ops: Array<{ symbol?: string; dependsOn: string[]; lineNumber?: number }>) {
  const allSymbols = new Set(ops.filter(o => o.symbol).map(o => o.symbol!));
  const diagnostics: Array<{ code: string; severity: string; message: string; lineNumber: number }> = [];
  for (const op of ops) {
    for (const dep of op.dependsOn) {
      if (!allSymbols.has(dep) && !dep.includes(':') && dep !== 'root') {
        diagnostics.push({
          code: 'REF_NOT_FOUND', severity: 'warning',
          message: `Symbol "${dep}" referenced by "${op.symbol ?? 'unnamed'}" not found in this batch.`,
          lineNumber: op.lineNumber ?? 0,
        });
      }
    }
  }
  return diagnostics;
}

describe('symbol reference validation', () => {
  it('warns on missing symbol reference', () => {
    const input = `child = frame(missingParent, {name: 'Child', w: 100, h: 100})`;
    const { lines } = parseFlatOps(input);
    const diagnostics = validateSymbolRefs(lines);
    expect(lines).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('REF_NOT_FOUND');
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('does not warn when symbol exists in batch', () => {
    const input = [
      `container = frame('root', {name: 'Container', w: 320, h: 480})`,
      `child = frame(container, {name: 'Child', w: 100, h: 100})`,
    ].join('\n');
    const { lines } = parseFlatOps(input);
    const diagnostics = validateSymbolRefs(lines);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn for Figma ID references (contain colon)', () => {
    const input = `child = frame('100:5', {name: 'Child', w: 100, h: 100})`;
    const { lines } = parseFlatOps(input);
    const diagnostics = validateSymbolRefs(lines);
    expect(diagnostics).toHaveLength(0);
  });
});
