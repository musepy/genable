import { describe, it, expect } from 'vitest';
import {
  validateDependencies,
  sortByPropertyOrder,
  PROPERTY_ORDER,
  DEFAULT_TIER,
  DEPENDENCY_RULES,
} from '../propertyDependencies';

// ─── validateDependencies ────────────────────────────────────────────────────

describe('validateDependencies', () => {
  // ── Auto Layout gate ───────────────────────────────────────────────────

  describe('layoutMode gate (the #1 LLM failure mode)', () => {
    it('auto-fixes: padding without layoutMode → injects VERTICAL', () => {
      const { fixes, warnings } = validateDependencies({
        paddingLeft: 16, paddingTop: 24,
      });
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
      expect(warnings).toHaveLength(0);
    });

    it('auto-fixes: alignItems without layoutMode → injects VERTICAL', () => {
      const { fixes } = validateDependencies({
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
      });
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
    });

    it('auto-fixes: itemSpacing without layoutMode → injects VERTICAL', () => {
      const { fixes } = validateDependencies({ itemSpacing: 12 });
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
    });

    it('no fix needed: layoutMode already in ops', () => {
      const { fixes, warnings } = validateDependencies({
        layoutMode: 'HORIZONTAL',
        paddingLeft: 16,
        itemSpacing: 8,
      });
      expect(fixes).toEqual({});
      expect(warnings).toHaveLength(0);
    });

    it('no fix needed: layoutMode already on node', () => {
      const { fixes, warnings } = validateDependencies(
        { paddingLeft: 16 },
        { layoutMode: 'HORIZONTAL' }, // nodeState
      );
      expect(fixes).toEqual({});
      expect(warnings).toHaveLength(0);
    });

    it('warns: layoutMode explicitly NONE but padding set', () => {
      const { fixes, warnings } = validateDependencies({
        layoutMode: 'NONE',
        paddingLeft: 16,
      });
      expect(fixes).toEqual({}); // don't override explicit intent
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('paddingLeft');
      expect(warnings[0]).toContain("'NONE'");
    });

    it('warns: node has layoutMode=NONE, ops add padding', () => {
      const { fixes, warnings } = validateDependencies(
        { paddingLeft: 16 },
        { layoutMode: 'NONE' },
      );
      expect(fixes).toEqual({});
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  // ── layoutSizing conditional gates ─────────────────────────────────────

  describe('layoutSizing conditional gates', () => {
    it('auto-fixes: layoutSizingHorizontal=HUG without layoutMode → injects VERTICAL', () => {
      const { fixes } = validateDependencies({
        layoutSizingHorizontal: 'HUG',
      });
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
    });

    it('no fix for layoutSizingHorizontal=FIXED (no gate required)', () => {
      const { fixes, warnings } = validateDependencies({
        layoutSizingHorizontal: 'FIXED',
      });
      expect(fixes).toEqual({});
      expect(warnings).toHaveLength(0);
    });

    it('warns: layoutSizingHorizontal=FILL without parent layoutMode', () => {
      const { warnings } = validateDependencies(
        { layoutSizingHorizontal: 'FILL' },
        {}, // nodeState
        {}, // parentState — no layoutMode
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('parent');
    });

    it('no warning: layoutSizingHorizontal=FILL with parent auto-layout', () => {
      const { warnings } = validateDependencies(
        { layoutSizingHorizontal: 'FILL' },
        {},
        { layoutMode: 'VERTICAL' },
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Wrap gate ──────────────────────────────────────────────────────────

  describe('layoutWrap gate', () => {
    it('warns: counterAxisSpacing without layoutWrap=WRAP', () => {
      const { warnings } = validateDependencies({
        layoutMode: 'HORIZONTAL',
        counterAxisSpacing: 8,
      });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('counterAxisSpacing');
    });

    it('no warning: counterAxisSpacing with layoutWrap=WRAP', () => {
      const { warnings } = validateDependencies({
        layoutMode: 'HORIZONTAL',
        layoutWrap: 'WRAP',
        counterAxisSpacing: 8,
      });
      expect(warnings).toHaveLength(0);
    });

    it('no warning: counterAxisSpacing when node already has WRAP', () => {
      const { warnings } = validateDependencies(
        { counterAxisSpacing: 8 },
        { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' },
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Corner smoothing gate ──────────────────────────────────────────────

  describe('cornerRadius gate', () => {
    it('warns: cornerSmoothing without cornerRadius', () => {
      const { warnings } = validateDependencies({ cornerSmoothing: 0.6 });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('cornerSmoothing');
    });

    it('warns: cornerSmoothing with cornerRadius=0', () => {
      const { warnings } = validateDependencies({
        cornerRadius: 0,
        cornerSmoothing: 0.6,
      });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('no warning: cornerSmoothing with cornerRadius=12', () => {
      const { warnings } = validateDependencies({
        cornerRadius: 12,
        cornerSmoothing: 0.6,
      });
      expect(warnings).toHaveLength(0);
    });

    it('no warning: cornerSmoothing when node already has radius', () => {
      const { warnings } = validateDependencies(
        { cornerSmoothing: 0.6 },
        { cornerRadius: 8 },
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Stroke gate ────────────────────────────────────────────────────────

  describe('strokes gate', () => {
    it('warns: strokeWeight without strokes', () => {
      const { warnings } = validateDependencies({ strokeWeight: 2 });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('strokeWeight');
    });

    it('no warning: strokeWeight when node has strokes', () => {
      const { warnings } = validateDependencies(
        { strokeWeight: 2 },
        { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] },
      );
      expect(warnings).toHaveLength(0);
    });

    it('warns: strokeWeight with empty strokes array', () => {
      const { warnings } = validateDependencies({
        strokes: [],
        strokeWeight: 2,
      });
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  // ── Mask gate ──────────────────────────────────────────────────────────

  describe('mask gate', () => {
    it('warns: maskType without isMask', () => {
      const { warnings } = validateDependencies({ maskType: 'ALPHA' });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('no warning: maskType with isMask=true', () => {
      const { warnings } = validateDependencies({
        isMask: true,
        maskType: 'ALPHA',
      });
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Text truncation gate ───────────────────────────────────────────────

  describe('textTruncation gate', () => {
    it('warns: maxLines without textTruncation=ENDING', () => {
      const { warnings } = validateDependencies({ maxLines: 3 });
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('no warning: maxLines with textTruncation=ENDING', () => {
      const { warnings } = validateDependencies({
        textTruncation: 'ENDING',
        maxLines: 3,
      });
      expect(warnings).toHaveLength(0);
    });
  });

  // ── Cascading auto-fix ─────────────────────────────────────────────────

  describe('cascading', () => {
    it('auto-fix for layoutMode propagates across rules within one call', () => {
      // layoutWrap depends on layoutMode. If layoutMode is injected by auto-fix,
      // the layoutWrap rule should see it.
      const { fixes, warnings } = validateDependencies({
        layoutWrap: 'WRAP',
        counterAxisSpacing: 8,
      });
      // layoutWrap triggers layoutMode auto-fix
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
      // counterAxisSpacing needs layoutWrap=WRAP — which IS in ops → OK
      expect(warnings).toHaveLength(0);
    });

    it('complex: padding + alignment + wrap deps in one batch', () => {
      const { fixes, warnings } = validateDependencies({
        paddingLeft: 16,
        paddingTop: 24,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        layoutWrap: 'WRAP',
        counterAxisSpacing: 12,
      });
      // All depend on layoutMode → one inject covers them all
      expect(fixes).toEqual({ layoutMode: 'VERTICAL' });
      expect(warnings).toHaveLength(0);
    });
  });
});

// ─── sortByPropertyOrder ─────────────────────────────────────────────────────

describe('sortByPropertyOrder', () => {
  it('puts layoutMode before its dependents', () => {
    const entries: [string, any][] = [
      ['paddingLeft', 16],
      ['layoutMode', 'VERTICAL'],
      ['itemSpacing', 8],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys.indexOf('layoutMode')).toBeLessThan(keys.indexOf('paddingLeft'));
    expect(keys.indexOf('layoutMode')).toBeLessThan(keys.indexOf('itemSpacing'));
  });

  it('puts font properties before characters', () => {
    const entries: [string, any][] = [
      ['characters', 'Hello'],
      ['fontSize', 14],
      ['fontName', { family: 'Inter', style: 'Regular' }],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys.indexOf('fontName')).toBeLessThan(keys.indexOf('characters'));
    expect(keys.indexOf('fontSize')).toBeLessThan(keys.indexOf('characters'));
  });

  it('puts dimensions before textAutoResize', () => {
    const entries: [string, any][] = [
      ['textAutoResize', 'HEIGHT'],
      ['width', 300],
      ['height', 200],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys.indexOf('width')).toBeLessThan(keys.indexOf('textAutoResize'));
    expect(keys.indexOf('height')).toBeLessThan(keys.indexOf('textAutoResize'));
  });

  it('puts layoutWrap before counterAxisSpacing', () => {
    const entries: [string, any][] = [
      ['counterAxisSpacing', 8],
      ['layoutWrap', 'WRAP'],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys.indexOf('layoutWrap')).toBeLessThan(keys.indexOf('counterAxisSpacing'));
  });

  it('puts strokeJoin before strokeMiterLimit', () => {
    const entries: [string, any][] = [
      ['strokeMiterLimit', 4],
      ['strokeJoin', 'MITER'],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys.indexOf('strokeJoin')).toBeLessThan(keys.indexOf('strokeMiterLimit'));
  });

  it('unlisted properties (fills, opacity) get DEFAULT_TIER', () => {
    expect(PROPERTY_ORDER['fills']).toBeUndefined();
    expect(PROPERTY_ORDER['opacity']).toBeUndefined();
    // They should sort after gate properties (tier 0) but not cause errors
    const entries: [string, any][] = [
      ['fills', []],
      ['layoutMode', 'VERTICAL'],
      ['opacity', 0.5],
    ];
    const sorted = sortByPropertyOrder(entries);
    const keys = sorted.map(([k]) => k);
    expect(keys[0]).toBe('layoutMode'); // tier 0, always first
  });
});

// ─── PROPERTY_ORDER structure ────────────────────────────────────────────────

describe('PROPERTY_ORDER derived structure', () => {
  it('all gate properties are at tier 0', () => {
    // Gate properties with no incoming dependencies should be tier 0
    expect(PROPERTY_ORDER['layoutMode']).toBe(0);
    expect(PROPERTY_ORDER['strokes']).toBe(0);
    expect(PROPERTY_ORDER['isMask']).toBe(0);
    expect(PROPERTY_ORDER['cornerRadius']).toBe(0);
    expect(PROPERTY_ORDER['textTruncation']).toBe(0);
  });

  it('second-level dependents are at tier 2', () => {
    // counterAxisSpacing depends on layoutWrap (tier 1), which depends on layoutMode (tier 0)
    expect(PROPERTY_ORDER['counterAxisSpacing']).toBe(2);
    expect(PROPERTY_ORDER['counterAxisAlignContent']).toBe(2);
    // strokeMiterLimit depends on strokeJoin (tier 1)
    expect(PROPERTY_ORDER['strokeMiterLimit']).toBe(2);
    // textAutoResize depends on width/height (tier 1)
    expect(PROPERTY_ORDER['textAutoResize']).toBe(2);
  });

  it('every rule dependent is in PROPERTY_ORDER', () => {
    for (const rule of DEPENDENCY_RULES) {
      if (rule.scope !== 'self') continue;
      for (const dep of rule.dependents) {
        const name = typeof dep === 'string' ? dep : dep.property;
        expect(PROPERTY_ORDER).toHaveProperty(name);
      }
    }
  });
});
