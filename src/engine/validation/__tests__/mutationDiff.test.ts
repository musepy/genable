import { describe, it, expect } from 'vitest';
import { diffIntendedVsActual } from '../mutationDiff';

describe('mutationDiff', () => {
  // --- Backward compatibility: messages array still works ---
  it('should detect layoutMode discrepancy (non-TEXT node) as actionable', () => {
    const intended = { layoutMode: 'HORIZONTAL' };
    const actual = { type: 'FRAME', props: { layoutMode: 'NONE' } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(true);
    expect(diff.actionable).toHaveLength(1);
    expect(diff.actionable[0]).toContain("layoutMode: intended 'HORIZONTAL', but Figma reset to 'NONE'");
    expect(diff.informational).toHaveLength(0);
    // backward compat
    expect(diff.messages[0]).toContain("layoutMode: intended 'HORIZONTAL'");
  });

  it('should classify TEXT node layoutMode correction as informational (not actionable)', () => {
    const intended = { layoutMode: 'HORIZONTAL' };
    const actual = { type: 'TEXT', props: { layoutMode: 'NONE' } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(true);
    expect(diff.actionable).toHaveLength(0);
    expect(diff.informational).toHaveLength(1);
    expect(diff.informational[0]).toContain('TEXT nodes do not support auto-layout');
    expect(diff.informational[0]).toContain('No action needed');
  });

  it('should detect gap discrepancy when layoutMode is NONE as informational', () => {
    const intended = { gap: 10 };
    const actual = { props: { layoutMode: 'NONE', gap: 0 } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(true);
    expect(diff.informational).toHaveLength(1);
    expect(diff.informational[0]).toContain("gap: '10' ignored because layoutMode is 'NONE'");
    expect(diff.actionable).toHaveLength(0);
  });

  it('should classify FILL sizing as informational when parent lacks auto-layout', () => {
    const intended = { sizing: { horizontal: 'FILL' } };
    const actual = { props: { sizing: { horizontal: 'FIXED' } } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(true);
    expect(diff.informational).toHaveLength(1);
    expect(diff.informational[0]).toContain('Parent lacks auto-layout');
    expect(diff.actionable).toHaveLength(0);
  });

  it('should classify FILL sizing as actionable when parent has auto-layout', () => {
    const intended = { sizing: { horizontal: 'FILL' } };
    const actual = {
      props: { sizing: { horizontal: 'FIXED' } },
      parent: { props: { layoutMode: 'HORIZONTAL' } }
    };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(true);
    expect(diff.actionable).toHaveLength(1);
    expect(diff.actionable[0]).toContain('execution order issue');
    expect(diff.informational).toHaveLength(0);
  });

  it('should classify vertical FILL sizing correctly', () => {
    const intended = { sizing: { vertical: 'FILL' } };
    const actual = {
      props: { sizing: { vertical: 'FIXED' } },
      parent: { props: { layoutMode: 'VERTICAL' } }
    };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.actionable).toHaveLength(1);
    expect(diff.actionable[0]).toContain('verticalSizing');
  });

  it('should not detect discrepancy when matched', () => {
    const intended = { layoutMode: 'VERTICAL', gap: 8 };
    const actual = { props: { layoutMode: 'VERTICAL', gap: 8 } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.hasDiscrepancy).toBe(false);
    expect(diff.actionable).toHaveLength(0);
    expect(diff.informational).toHaveLength(0);
  });

  it('should handle null/undefined inputs gracefully', () => {
    expect(diffIntendedVsActual(null, null).hasDiscrepancy).toBe(false);
    expect(diffIntendedVsActual(undefined, {}).hasDiscrepancy).toBe(false);
    expect(diffIntendedVsActual({}, undefined).hasDiscrepancy).toBe(false);
  });

  it('should also read nodeType from props.type fallback', () => {
    const intended = { layoutMode: 'VERTICAL' };
    const actual = { props: { type: 'TEXT', layoutMode: 'NONE' } };
    const diff = diffIntendedVsActual(intended, actual);
    expect(diff.informational).toHaveLength(1);
    expect(diff.actionable).toHaveLength(0);
  });
});
