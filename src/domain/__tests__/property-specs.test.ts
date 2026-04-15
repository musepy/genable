/**
 * @file property-specs.test.ts
 * @description Tests for PropertySpecs — paint (direct Figma format), effect, unitValue, etc.
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
  parsePaintToFigma,
  formatPaintForLLM,
  parseEffectToFigma,
  formatEffectForLLM,
} from '../property-specs';
import type {
  UnitValue,
  ConstraintValue,
  FontNameValue,
} from '../property-specs';

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
// Paint — Direct Figma format (no IR)
// ═══════════════════════════════════════════════

describe('parsePaintToFigma', () => {
  it('parses hex string to Figma solid paint', () => {
    const paint = parsePaintToFigma('#FF0000');
    expect(paint.type).toBe('SOLID');
    expect(paint.color.r).toBeCloseTo(1, 2);
    expect(paint.color.g).toBeCloseTo(0, 2);
    expect(paint.color.b).toBeCloseTo(0, 2);
    expect(paint.opacity).toBe(1);
  });

  it('parses hex with alpha', () => {
    const paint = parsePaintToFigma('#FF000080');
    expect(paint.type).toBe('SOLID');
    expect(paint.opacity).toBeCloseTo(0.502, 1);
  });

  it('parses CSS linear-gradient', () => {
    const paint = parsePaintToFigma('linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
    expect(paint.type).toBe('GRADIENT_LINEAR');
    expect(paint.gradientStops).toHaveLength(2);
    expect(paint.gradientTransform).toBeDefined();
  });

  it('parses legacy GRADIENT_LINEAR notation', () => {
    const paint = parsePaintToFigma('GRADIENT_LINEAR(#FF0000@0,#0000FF@1)');
    expect(paint.type).toBe('GRADIENT_LINEAR');
    expect(paint.gradientStops).toHaveLength(2);
  });

  it('parses LLM object syntax with blendMode', () => {
    const paint = parsePaintToFigma({ color: '#FF0000', blendMode: 'MULTIPLY', opacity: 0.5 });
    expect(paint.type).toBe('SOLID');
    expect(paint.color.r).toBeCloseTo(1, 2);
    expect(paint.blendMode).toBe('MULTIPLY');
    expect(paint.opacity).toBe(0.5);
  });

  it('parses LLM object with only color', () => {
    const paint = parsePaintToFigma({ color: '#00FF00' });
    expect(paint.type).toBe('SOLID');
    expect(paint.color.g).toBeCloseTo(1, 2);
    expect(paint.blendMode).toBeUndefined(); // not set = Figma default
  });
});

describe('formatPaintForLLM', () => {
  it('solid with all defaults → hex string', () => {
    const result = formatPaintForLLM({ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    expect(result).toBe('#FF0000');
  });

  it('solid with custom blendMode → object', () => {
    const result = formatPaintForLLM({ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.5, blendMode: 'MULTIPLY' });
    expect(result).toEqual({ color: '#FF000080', blendMode: 'MULTIPLY' });
  });

  it('solid with only non-default visible → object', () => {
    const result = formatPaintForLLM({ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: false });
    expect(result).toEqual({ color: '#FF0000', visible: false });
  });

  it('gradient → string notation', () => {
    const result = formatPaintForLLM({
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
    });
    expect(result).toMatch(/^GRADIENT_LINEAR\(/);
    expect(result).toMatch(/@0/);
    expect(result).toMatch(/@1/);
  });

  it('image → IMAGE notation', () => {
    const result = formatPaintForLLM({ type: 'IMAGE', imageHash: 'abc123' });
    expect(result).toBe('IMAGE(abc123)');
  });
});

describe('paintSpec', () => {
  describe('parseXml → Figma Paint format', () => {
    it('solid color', () => {
      const paints = paintSpec.parseXml('#FF0000');
      expect(paints).toHaveLength(1);
      expect(paints[0].type).toBe('SOLID');
      expect(paints[0].color.r).toBeCloseTo(1, 2);
    });

    it('multiple solid colors', () => {
      const paints = paintSpec.parseXml('#FF0000,#00FF00');
      expect(paints).toHaveLength(2);
      expect(paints[0].type).toBe('SOLID');
      expect(paints[1].type).toBe('SOLID');
    });

    it('transparent', () => {
      expect(paintSpec.parseXml('transparent')).toEqual([]);
      expect(paintSpec.parseXml('none')).toEqual([]);
    });

    it('gradient', () => {
      const paints = paintSpec.parseXml('GRADIENT_LINEAR(#FF0000@0,#0000FF@1)');
      expect(paints).toHaveLength(1);
      expect(paints[0].type).toBe('GRADIENT_LINEAR');
    });
  });

  describe('formatXml', () => {
    it('empty → transparent', () => {
      expect(paintSpec.formatXml([])).toBe('transparent');
    });

    it('solid paint → hex', () => {
      const result = paintSpec.formatXml([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
      expect(result).toBe('#FF0000');
    });
  });

  describe('fromFigma', () => {
    it('filters invisible paints', () => {
      const result = paintSpec.fromFigma([
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1, visible: false },
      ]);
      expect(result).toHaveLength(1);
    });

    it('returns empty for non-array', () => {
      expect(paintSpec.fromFigma(null)).toEqual([]);
    });
  });

  describe('toFigma — identity', () => {
    it('passes through Figma paints unchanged', () => {
      const paints = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
      expect(paintSpec.toFigma(paints)).toBe(paints);
    });
  });

  describe('isEqual', () => {
    it('equal solid paints', () => {
      expect(paintSpec.isEqual(
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
      )).toBe(true);
    });

    it('different colors', () => {
      expect(paintSpec.isEqual(
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
        [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1 }],
      )).toBe(false);
    });

    it('different lengths', () => {
      expect(paintSpec.isEqual(
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
        [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }, { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1 }],
      )).toBe(false);
    });
  });

  describe('roundtrip: parse → format → parse', () => {
    it('solid', () => assertXmlRoundtrip(paintSpec, '#FF0000'));
    it('gradient', () => assertXmlRoundtrip(paintSpec, 'GRADIENT_LINEAR(#FF0000@0,#0000FF@1)'));
  });
});

// ═══════════════════════════════════════════════
// Effect — Direct Figma format (no IR)
// ═══════════════════════════════════════════════

describe('parseEffectToFigma', () => {
  it('parses drop shadow string', () => {
    const e = parseEffectToFigma('0,4,8,0,#00000040');
    expect(e.type).toBe('DROP_SHADOW');
    expect(e.offset).toEqual({ x: 0, y: 4 });
    expect(e.radius).toBe(8);
    expect(e.blendMode).toBe('NORMAL');
  });

  it('parses inner shadow string', () => {
    const e = parseEffectToFigma('inset,0,2,4,0,#00000033');
    expect(e.type).toBe('INNER_SHADOW');
    expect(e.blendMode).toBe('NORMAL');
  });

  it('parses blur', () => {
    const e = parseEffectToFigma('blur(10)');
    expect(e.type).toBe('LAYER_BLUR');
    expect(e.radius).toBe(10);
  });

  it('parses bgblur', () => {
    const e = parseEffectToFigma('bgblur(20)');
    expect(e.type).toBe('BACKGROUND_BLUR');
    expect(e.radius).toBe(20);
  });
});

describe('formatEffectForLLM', () => {
  it('drop shadow → string', () => {
    const result = formatEffectForLLM({
      type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 }, radius: 8, spread: 0,
    });
    expect(result).toContain('0,4,8,0,');
  });

  it('blur → blur(N)', () => {
    expect(formatEffectForLLM({ type: 'LAYER_BLUR', radius: 10 })).toBe('blur(10)');
  });

  it('bgblur → bgblur(N)', () => {
    expect(formatEffectForLLM({ type: 'BACKGROUND_BLUR', radius: 20 })).toBe('bgblur(20)');
  });
});

describe('effectSpec', () => {
  describe('parseXml → Figma Effect format', () => {
    it('shadow', () => {
      const effects = effectSpec.parseXml('0,4,8,0,#00000040');
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('DROP_SHADOW');
    });

    it('multiple', () => {
      const effects = effectSpec.parseXml('0,4,8,0,#00000040;blur(10)');
      expect(effects).toHaveLength(2);
      expect(effects[0].type).toBe('DROP_SHADOW');
      expect(effects[1].type).toBe('LAYER_BLUR');
    });
  });

  describe('roundtrip: parse → format → parse', () => {
    it('shadow', () => assertXmlRoundtrip(effectSpec, '0,4,8,0,#00000040'));
    it('inner shadow', () => assertXmlRoundtrip(effectSpec, 'inset,0,2,4,0,#00000033'));
    it('blur', () => assertXmlRoundtrip(effectSpec, 'blur(10)'));
    it('bgblur', () => assertXmlRoundtrip(effectSpec, 'bgblur(20)'));
    it('multiple', () => assertXmlRoundtrip(effectSpec, '0,4,8,0,#00000040;blur(10)'));
  });

  describe('fromFigma — filter invisible', () => {
    it('keeps visible, drops invisible', () => {
      const result = effectSpec.fromFigma([
        { type: 'DROP_SHADOW', visible: true },
        { type: 'LAYER_BLUR', radius: 5, visible: false },
      ]);
      expect(result).toHaveLength(1);
    });
  });

  describe('isEqual', () => {
    it('equal shadows', () => {
      const a = { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      expect(effectSpec.isEqual([a], [{ ...a }])).toBe(true);
    });

    it('different types', () => {
      const a = { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      const b = { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0 };
      expect(effectSpec.isEqual([a], [b])).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════
// UnitValue Spec
// ═══════════════════════════════════════════════

describe('unitValueSpec', () => {
  describe('XML roundtrip', () => {
    it('pixels', () => assertXmlRoundtrip(unitValueSpec, '24'));
    it('percent', () => assertXmlRoundtrip(unitValueSpec, '160%'));
    it('auto', () => assertXmlRoundtrip(unitValueSpec, 'auto'));
  });

  describe('IR roundtrip', () => {
    it('pixels value', () => assertRoundtrip(unitValueSpec, { value: 24, unit: 'PIXELS' }));
    it('percent value', () => assertRoundtrip(unitValueSpec, { value: 160, unit: 'PERCENT' }));
    it('auto value', () => assertRoundtrip(unitValueSpec, { value: 0, unit: 'AUTO' }));
  });

  describe('Figma roundtrip', () => {
    it('pixels object', () => {
      const ir = unitValueSpec.fromFigma({ value: 24, unit: 'PIXELS' });
      const back = unitValueSpec.toFigma(ir);
      const ir2 = unitValueSpec.fromFigma(back);
      expect(unitValueSpec.isEqual(ir, ir2)).toBe(true);
    });
    it('raw number → pixels', () => {
      expect(unitValueSpec.fromFigma(24)).toEqual({ value: 24, unit: 'PIXELS' });
    });
  });

  describe('isEqual', () => {
    it('equal pixels', () => expect(unitValueSpec.isEqual({ value: 24, unit: 'PIXELS' }, { value: 24, unit: 'PIXELS' })).toBe(true));
    it('different units', () => expect(unitValueSpec.isEqual({ value: 24, unit: 'PIXELS' }, { value: 24, unit: 'PERCENT' })).toBe(false));
    it('auto equals auto', () => expect(unitValueSpec.isEqual({ value: 0, unit: 'AUTO' }, { value: 0, unit: 'AUTO' })).toBe(true));
  });
});

// ═══════════════════════════════════════════════
// Constraints Spec
// ═══════════════════════════════════════════════

describe('constraintsSpec', () => {
  describe('XML roundtrip', () => {
    it('MIN,MIN', () => assertXmlRoundtrip(constraintsSpec, 'MIN,MIN'));
    it('CENTER,STRETCH', () => assertXmlRoundtrip(constraintsSpec, 'CENTER,STRETCH'));
  });

  describe('isEqual', () => {
    it('equal', () => expect(constraintsSpec.isEqual({ horizontal: 'CENTER', vertical: 'STRETCH' }, { horizontal: 'CENTER', vertical: 'STRETCH' })).toBe(true));
    it('different', () => expect(constraintsSpec.isEqual({ horizontal: 'MIN', vertical: 'MIN' }, { horizontal: 'CENTER', vertical: 'MIN' })).toBe(false));
  });
});

// ═══════════════════════════════════════════════
// FontName Spec
// ═══════════════════════════════════════════════

describe('fontNameSpec', () => {
  describe('XML roundtrip', () => {
    it('family with style', () => assertXmlRoundtrip(fontNameSpec, 'Inter/Bold'));
    it('family only', () => assertXmlRoundtrip(fontNameSpec, 'Inter'));
  });

  describe('isEqual', () => {
    it('equal', () => expect(fontNameSpec.isEqual({ family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Bold' })).toBe(true));
    it('different', () => expect(fontNameSpec.isEqual({ family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Regular' })).toBe(false));
  });
});

// ═══════════════════════════════════════════════
// Full pipeline: Figma → format → parse roundtrip
// ═══════════════════════════════════════════════

describe('Full pipeline roundtrips', () => {
  it('Figma solid paint → format → parse → equal', () => {
    const figmaPaint = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    const xml = paintSpec.formatXml(figmaPaint);
    const reparsed = paintSpec.parseXml(xml);
    expect(paintSpec.isEqual(figmaPaint, reparsed)).toBe(true);
  });

  it('Figma gradient → format → parse → equal', () => {
    const figmaGradient = [{
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
    }];
    const xml = paintSpec.formatXml(figmaGradient);
    const reparsed = paintSpec.parseXml(xml);
    expect(reparsed[0].type).toBe('GRADIENT_LINEAR');
    expect(reparsed[0].gradientStops).toHaveLength(2);
  });

  it('Figma shadow → IR → XML → IR: semantic equality', () => {
    const figmaEffect = [{
      type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true, blendMode: 'NORMAL',
    }];
    const ir1 = effectSpec.fromFigma(figmaEffect);
    const xml = effectSpec.formatXml(ir1);
    const ir2 = effectSpec.parseXml(xml);
    expect(effectSpec.isEqual(ir1, ir2)).toBe(true);
  });
});
