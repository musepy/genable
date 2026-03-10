/**
 * @file property-specs.test.ts
 * @description Roundtrip tests for all PropertySpecs.
 *
 * Hard invariant: spec.parseXml(spec.formatXml(value)) must be semantically
 * equal to the original value (via spec.isEqual).
 */

import { describe, it, expect } from 'vitest';
import {
  paintSpec,
  effectSpec,
  unitValueSpec,
  constraintsSpec,
  fontNameSpec,
  parseHexToRGBA,
  rgbaToHex,
} from '../property-specs';
import type {
  PaintValue,
  EffectValue,
  UnitValue,
  ConstraintValue,
  FontNameValue,
} from '../design-ir';

// ═══════════════════════════════════════════════
// Helper: assert roundtrip
// ═══════════════════════════════════════════════

function assertRoundtrip<T>(spec: { parseXml: (s: string) => T; formatXml: (v: T) => string; isEqual: (a: T, b: T) => boolean }, value: T) {
  const xml = spec.formatXml(value);
  const parsed = spec.parseXml(xml);
  expect(spec.isEqual(value, parsed)).toBe(true);
}

function assertXmlRoundtrip<T>(spec: { parseXml: (s: string) => T; formatXml: (v: T) => string; isEqual: (a: T, b: T) => boolean }, xml: string) {
  const parsed = spec.parseXml(xml);
  const formatted = spec.formatXml(parsed);
  const reparsed = spec.parseXml(formatted);
  expect(spec.isEqual(parsed, reparsed)).toBe(true);
}

function assertFigmaRoundtrip<T>(spec: { fromFigma: (v: any) => T; toFigma: (v: T) => any; fromFigma: (v: any) => T; isEqual: (a: T, b: T) => boolean }, figmaValue: any) {
  const ir = spec.fromFigma(figmaValue);
  const back = spec.toFigma(ir);
  const ir2 = spec.fromFigma(back);
  expect(spec.isEqual(ir, ir2)).toBe(true);
}

// ═══════════════════════════════════════════════
// Color helpers
// ═══════════════════════════════════════════════

describe('Color helpers', () => {
  it('parseHexToRGBA handles 6-digit hex', () => {
    const rgba = parseHexToRGBA('#FF0000');
    expect(rgba.r).toBeCloseTo(1, 2);
    expect(rgba.g).toBeCloseTo(0, 2);
    expect(rgba.b).toBeCloseTo(0, 2);
    expect(rgba.a).toBe(1);
  });

  it('parseHexToRGBA handles 8-digit hex', () => {
    const rgba = parseHexToRGBA('#FF000080');
    expect(rgba.r).toBeCloseTo(1, 2);
    expect(rgba.a).toBeCloseTo(0.502, 1);
  });

  it('parseHexToRGBA handles 3-digit hex', () => {
    const rgba = parseHexToRGBA('#F00');
    expect(rgba.r).toBeCloseTo(1, 2);
    expect(rgba.g).toBeCloseTo(0, 2);
    expect(rgba.b).toBeCloseTo(0, 2);
  });

  it('rgbaToHex roundtrips with parseHexToRGBA', () => {
    const original = '#FF8040';
    const rgba = parseHexToRGBA(original);
    const hex = rgbaToHex(rgba);
    expect(hex).toBe(original);
  });

  it('rgbaToHex includes alpha when < 1', () => {
    const hex = rgbaToHex({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(hex).toMatch(/^#FF0000/);
    expect(hex.length).toBe(9); // #RRGGBBAA
  });
});

// ═══════════════════════════════════════════════
// Paint Spec
// ═══════════════════════════════════════════════

describe('paintSpec', () => {
  describe('XML roundtrip', () => {
    it('solid color', () => {
      assertXmlRoundtrip(paintSpec, '#FF0000');
    });

    it('multiple solid colors', () => {
      assertXmlRoundtrip(paintSpec, '#FF0000,#00FF00,#0000FF');
    });

    it('transparent', () => {
      const parsed = paintSpec.parseXml('transparent');
      expect(parsed).toEqual([]);
      expect(paintSpec.formatXml([])).toBe('transparent');
    });

    it('none', () => {
      const parsed = paintSpec.parseXml('none');
      expect(parsed).toEqual([]);
    });

    it('gradient', () => {
      assertXmlRoundtrip(paintSpec, 'GRADIENT_LINEAR(#FF0000@0,#0000FF@1)');
    });

    it('gradient with multiple stops', () => {
      assertXmlRoundtrip(paintSpec, 'GRADIENT_LINEAR(#FF0000@0,#00FF00@0.5,#0000FF@1)');
    });

    it('mixed solid and gradient', () => {
      assertXmlRoundtrip(paintSpec, '#FF0000,GRADIENT_LINEAR(#00FF00@0,#0000FF@1)');
    });
  });

  describe('IR roundtrip', () => {
    it('solid paint', () => {
      const value: PaintValue[] = [{ kind: 'solid', color: '#FF0000' }];
      assertRoundtrip(paintSpec, value);
    });

    it('gradient paint', () => {
      const value: PaintValue[] = [{
        kind: 'gradient',
        type: 'GRADIENT_LINEAR',
        stops: [
          { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
        ],
      }];
      assertRoundtrip(paintSpec, value);
    });

    it('empty (transparent)', () => {
      assertRoundtrip(paintSpec, []);
    });
  });

  describe('Figma roundtrip', () => {
    it('solid fill', () => {
      assertFigmaRoundtrip(paintSpec, [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 },
      ]);
    });

    it('gradient fill', () => {
      assertFigmaRoundtrip(paintSpec, [
        {
          type: 'GRADIENT_LINEAR',
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
          ],
        },
      ]);
    });

    it('image fill', () => {
      assertFigmaRoundtrip(paintSpec, [
        { type: 'IMAGE', imageHash: 'abc123', scaleMode: 'FILL' },
      ]);
    });

    it('empty array', () => {
      assertFigmaRoundtrip(paintSpec, []);
    });

    it('filters invisible paints', () => {
      const ir = paintSpec.fromFigma([
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1, visible: false },
      ]);
      expect(ir.length).toBe(1);
    });
  });

  describe('isEqual', () => {
    it('equal solids', () => {
      expect(paintSpec.isEqual(
        [{ kind: 'solid', color: '#FF0000' }],
        [{ kind: 'solid', color: '#ff0000' }],
      )).toBe(true);
    });

    it('different colors', () => {
      expect(paintSpec.isEqual(
        [{ kind: 'solid', color: '#FF0000' }],
        [{ kind: 'solid', color: '#00FF00' }],
      )).toBe(false);
    });

    it('different lengths', () => {
      expect(paintSpec.isEqual(
        [{ kind: 'solid', color: '#FF0000' }],
        [{ kind: 'solid', color: '#FF0000' }, { kind: 'solid', color: '#00FF00' }],
      )).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// Effect Spec
// ═══════════════════════════════════════════════

describe('effectSpec', () => {
  describe('XML roundtrip', () => {
    it('drop shadow', () => {
      assertXmlRoundtrip(effectSpec, '0,4,8,0,#00000040');
    });

    it('inner shadow', () => {
      assertXmlRoundtrip(effectSpec, 'inset,0,2,4,0,#00000033');
    });

    it('layer blur', () => {
      assertXmlRoundtrip(effectSpec, 'blur(10)');
    });

    it('background blur', () => {
      assertXmlRoundtrip(effectSpec, 'bgblur(20)');
    });

    it('multiple effects', () => {
      assertXmlRoundtrip(effectSpec, '0,4,8,0,#00000040;inset,0,2,4,0,#00000033');
    });

    it('shadow + blur', () => {
      assertXmlRoundtrip(effectSpec, '0,4,8,0,#00000040;blur(10)');
    });
  });

  describe('IR roundtrip', () => {
    it('drop shadow', () => {
      const value: EffectValue[] = [{
        kind: 'drop-shadow',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        radius: 8,
        spread: 0,
      }];
      assertRoundtrip(effectSpec, value);
    });

    it('blur', () => {
      const value: EffectValue[] = [{
        kind: 'blur',
        type: 'layer',
        radius: 10,
      }];
      assertRoundtrip(effectSpec, value);
    });
  });

  describe('Figma roundtrip', () => {
    it('drop shadow', () => {
      assertFigmaRoundtrip(effectSpec, [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
          visible: true,
          blendMode: 'NORMAL',
        },
      ]);
    });

    it('inner shadow', () => {
      assertFigmaRoundtrip(effectSpec, [
        {
          type: 'INNER_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.1 },
          offset: { x: 0, y: 2 },
          radius: 4,
          spread: 0,
          visible: true,
          blendMode: 'NORMAL',
        },
      ]);
    });

    it('layer blur', () => {
      assertFigmaRoundtrip(effectSpec, [
        { type: 'LAYER_BLUR', radius: 10, visible: true },
      ]);
    });

    it('background blur', () => {
      assertFigmaRoundtrip(effectSpec, [
        { type: 'BACKGROUND_BLUR', radius: 20, visible: true },
      ]);
    });

    it('filters invisible effects', () => {
      const ir = effectSpec.fromFigma([
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true },
        { type: 'LAYER_BLUR', radius: 5, visible: false },
      ]);
      expect(ir.length).toBe(1);
    });
  });

  describe('isEqual', () => {
    it('equal drop shadows', () => {
      const a: EffectValue = { kind: 'drop-shadow', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      const b: EffectValue = { kind: 'drop-shadow', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      expect(effectSpec.isEqual([a], [b])).toBe(true);
    });

    it('different shadow kinds', () => {
      const a: EffectValue = { kind: 'drop-shadow', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      const b: EffectValue = { kind: 'inner-shadow', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      expect(effectSpec.isEqual([a], [b])).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// UnitValue Spec
// ═══════════════════════════════════════════════

describe('unitValueSpec', () => {
  describe('XML roundtrip', () => {
    it('pixels', () => {
      assertXmlRoundtrip(unitValueSpec, '24');
    });

    it('percent', () => {
      assertXmlRoundtrip(unitValueSpec, '160%');
    });

    it('auto', () => {
      assertXmlRoundtrip(unitValueSpec, 'auto');
    });
  });

  describe('IR roundtrip', () => {
    it('pixels value', () => {
      assertRoundtrip(unitValueSpec, { value: 24, unit: 'PIXELS' });
    });

    it('percent value', () => {
      assertRoundtrip(unitValueSpec, { value: 160, unit: 'PERCENT' });
    });

    it('auto value', () => {
      assertRoundtrip(unitValueSpec, { value: 0, unit: 'AUTO' });
    });
  });

  describe('Figma roundtrip', () => {
    it('pixels object', () => {
      assertFigmaRoundtrip(unitValueSpec, { value: 24, unit: 'PIXELS' });
    });

    it('percent object', () => {
      assertFigmaRoundtrip(unitValueSpec, { value: 160, unit: 'PERCENT' });
    });

    it('auto object', () => {
      assertFigmaRoundtrip(unitValueSpec, { value: 0, unit: 'AUTO' });
    });

    it('raw number → pixels', () => {
      const ir = unitValueSpec.fromFigma(24);
      expect(ir).toEqual({ value: 24, unit: 'PIXELS' });
    });
  });

  describe('isEqual', () => {
    it('equal pixels', () => {
      expect(unitValueSpec.isEqual(
        { value: 24, unit: 'PIXELS' },
        { value: 24, unit: 'PIXELS' },
      )).toBe(true);
    });

    it('different units', () => {
      expect(unitValueSpec.isEqual(
        { value: 24, unit: 'PIXELS' },
        { value: 24, unit: 'PERCENT' },
      )).toBe(false);
    });

    it('auto equals auto', () => {
      expect(unitValueSpec.isEqual(
        { value: 0, unit: 'AUTO' },
        { value: 0, unit: 'AUTO' },
      )).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════
// Constraints Spec
// ═══════════════════════════════════════════════

describe('constraintsSpec', () => {
  describe('XML roundtrip', () => {
    it('MIN,MIN', () => {
      assertXmlRoundtrip(constraintsSpec, 'MIN,MIN');
    });

    it('CENTER,STRETCH', () => {
      assertXmlRoundtrip(constraintsSpec, 'CENTER,STRETCH');
    });

    it('SCALE,SCALE', () => {
      assertXmlRoundtrip(constraintsSpec, 'SCALE,SCALE');
    });
  });

  describe('IR roundtrip', () => {
    it('default constraints', () => {
      assertRoundtrip(constraintsSpec, { horizontal: 'MIN', vertical: 'MIN' });
    });

    it('mixed constraints', () => {
      assertRoundtrip(constraintsSpec, { horizontal: 'CENTER', vertical: 'MAX' });
    });
  });

  describe('Figma roundtrip', () => {
    it('object constraints', () => {
      assertFigmaRoundtrip(constraintsSpec, { horizontal: 'MIN', vertical: 'MIN' });
    });

    it('handles null/undefined', () => {
      const ir = constraintsSpec.fromFigma(null);
      expect(ir).toEqual({ horizontal: 'MIN', vertical: 'MIN' });
    });
  });

  describe('isEqual', () => {
    it('equal constraints', () => {
      expect(constraintsSpec.isEqual(
        { horizontal: 'CENTER', vertical: 'STRETCH' },
        { horizontal: 'CENTER', vertical: 'STRETCH' },
      )).toBe(true);
    });

    it('different horizontal', () => {
      expect(constraintsSpec.isEqual(
        { horizontal: 'MIN', vertical: 'MIN' },
        { horizontal: 'CENTER', vertical: 'MIN' },
      )).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// FontName Spec
// ═══════════════════════════════════════════════

describe('fontNameSpec', () => {
  describe('XML roundtrip', () => {
    it('family with style', () => {
      assertXmlRoundtrip(fontNameSpec, 'Inter/Bold');
    });

    it('family only (default Regular)', () => {
      assertXmlRoundtrip(fontNameSpec, 'Inter');
    });

    it('complex family name', () => {
      assertXmlRoundtrip(fontNameSpec, 'Noto Sans SC/Medium');
    });
  });

  describe('IR roundtrip', () => {
    it('full font spec', () => {
      assertRoundtrip(fontNameSpec, { family: 'Inter', style: 'Bold' });
    });

    it('default style', () => {
      assertRoundtrip(fontNameSpec, { family: 'Inter', style: 'Regular' });
    });
  });

  describe('Figma roundtrip', () => {
    it('font name object', () => {
      assertFigmaRoundtrip(fontNameSpec, { family: 'Inter', style: 'Bold' });
    });

    it('handles null', () => {
      const ir = fontNameSpec.fromFigma(null);
      expect(ir).toEqual({ family: 'Inter', style: 'Regular' });
    });
  });

  describe('isEqual', () => {
    it('equal fonts', () => {
      expect(fontNameSpec.isEqual(
        { family: 'Inter', style: 'Bold' },
        { family: 'Inter', style: 'Bold' },
      )).toBe(true);
    });

    it('different style', () => {
      expect(fontNameSpec.isEqual(
        { family: 'Inter', style: 'Bold' },
        { family: 'Inter', style: 'Regular' },
      )).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// Cross-spec: full pipeline roundtrips
// ═══════════════════════════════════════════════

describe('Full pipeline roundtrips', () => {
  it('Figma solid paint → IR → XML → IR: semantic equality', () => {
    const figmaPaint = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    const ir1 = paintSpec.fromFigma(figmaPaint);
    const xml = paintSpec.formatXml(ir1);
    const ir2 = paintSpec.parseXml(xml);
    expect(paintSpec.isEqual(ir1, ir2)).toBe(true);
  });

  it('Figma gradient → IR → XML → IR: semantic equality', () => {
    const figmaGradient = [{
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
    }];
    const ir1 = paintSpec.fromFigma(figmaGradient);
    const xml = paintSpec.formatXml(ir1);
    const ir2 = paintSpec.parseXml(xml);
    expect(paintSpec.isEqual(ir1, ir2)).toBe(true);
  });

  it('Figma shadow → IR → XML → IR: semantic equality', () => {
    const figmaEffect = [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    }];
    const ir1 = effectSpec.fromFigma(figmaEffect);
    const xml = effectSpec.formatXml(ir1);
    const ir2 = effectSpec.parseXml(xml);
    expect(effectSpec.isEqual(ir1, ir2)).toBe(true);
  });

  it('Figma lineHeight → IR → XML → IR: semantic equality', () => {
    const figmaLH = { value: 160, unit: 'PERCENT' };
    const ir1 = unitValueSpec.fromFigma(figmaLH);
    const xml = unitValueSpec.formatXml(ir1);
    const ir2 = unitValueSpec.parseXml(xml);
    expect(unitValueSpec.isEqual(ir1, ir2)).toBe(true);
  });

  it('XML gradient → IR → Figma → IR: semantic equality', () => {
    const xml = 'GRADIENT_LINEAR(#FF0000@0,#0000FF@1)';
    const ir1 = paintSpec.parseXml(xml);
    const figma = paintSpec.toFigma(ir1);
    const ir2 = paintSpec.fromFigma(figma);
    expect(paintSpec.isEqual(ir1, ir2)).toBe(true);
  });

  it('XML shadow → IR → Figma → IR: semantic equality', () => {
    const xml = '0,4,8,0,#00000040';
    const ir1 = effectSpec.parseXml(xml);
    const figma = effectSpec.toFigma(ir1);
    const ir2 = effectSpec.fromFigma(figma);
    expect(effectSpec.isEqual(ir1, ir2)).toBe(true);
  });
});
