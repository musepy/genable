import { describe, it, expect } from 'vitest';
import { expandShorthands } from '../expandShorthands';

describe('expandShorthands', () => {

  // ── Layout ─────────────────────────────────────────────────────────────

  describe('layout', () => {
    it('row → HORIZONTAL', () => {
      expect(expandShorthands({ layout: 'row' })).toMatchObject({ layoutMode: 'HORIZONTAL' });
    });
    it('column → VERTICAL', () => {
      expect(expandShorthands({ layout: 'column' })).toMatchObject({ layoutMode: 'VERTICAL' });
    });
    it('explicit layoutMode overrides layout shorthand', () => {
      expect(expandShorthands({ layout: 'row', layoutMode: 'VERTICAL' }))
        .toMatchObject({ layoutMode: 'VERTICAL' });
    });
  });

  describe('pattern', () => {
    it('row pattern sets layout + sizing + transparent', () => {
      const result = expandShorthands({ pattern: 'row' });
      expect(result.layoutMode).toBe('HORIZONTAL');
      expect(result.layoutSizingHorizontal).toBe('HUG');
      expect(result.layoutSizingVertical).toBe('HUG');
      expect(result.fills).toEqual([]);
    });
    it('pattern does not override explicit fill', () => {
      const result = expandShorthands({ pattern: 'row', fill: '#FF0000' });
      expect(result.fills).toEqual(['#FF0000']);
    });
  });

  // ── Alignment ──────────────────────────────────────────────────────────

  describe('align', () => {
    it('"center" → both axes CENTER (LLM mental model)', () => {
      const result = expandShorthands({ align: 'center' });
      expect(result.primaryAxisAlignItems).toBe('CENTER');
      expect(result.counterAxisAlignItems).toBe('CENTER');
    });
    it('"center center" → both axes CENTER', () => {
      const result = expandShorthands({ align: 'center center' });
      expect(result.primaryAxisAlignItems).toBe('CENTER');
      expect(result.counterAxisAlignItems).toBe('CENTER');
    });
    it('"space-between center" → primary SPACE_BETWEEN, counter CENTER', () => {
      const result = expandShorthands({ align: 'space-between center' });
      expect(result.primaryAxisAlignItems).toBe('SPACE_BETWEEN');
      expect(result.counterAxisAlignItems).toBe('CENTER');
    });
    it('explicit counterAxisAlignItems overrides align shorthand', () => {
      const result = expandShorthands({ align: 'center', counterAxisAlignItems: 'MIN' });
      expect(result.counterAxisAlignItems).toBe('MIN');
    });
    it('single-value "start" applies to both axes', () => {
      const result = expandShorthands({ align: 'start' });
      expect(result.primaryAxisAlignItems).toBe('MIN');
      expect(result.counterAxisAlignItems).toBe('MIN');
    });
  });

  describe('justifyContent / alignItems', () => {
    it('justifyContent → primaryAxisAlignItems', () => {
      expect(expandShorthands({ justifyContent: 'space-between' }))
        .toMatchObject({ primaryAxisAlignItems: 'SPACE_BETWEEN' });
    });
    it('alignItems → counterAxisAlignItems', () => {
      expect(expandShorthands({ alignItems: 'baseline' }))
        .toMatchObject({ counterAxisAlignItems: 'BASELINE' });
    });
  });

  // ── Spacing ────────────────────────────────────────────────────────────

  describe('padding', () => {
    it('number → all 4 sides', () => {
      const result = expandShorthands({ padding: 16 });
      expect(result.paddingTop).toBe(16);
      expect(result.paddingRight).toBe(16);
      expect(result.paddingBottom).toBe(16);
      expect(result.paddingLeft).toBe(16);
    });
    it('[v, h] → vertical/horizontal', () => {
      const result = expandShorthands({ padding: [12, 16] });
      expect(result.paddingTop).toBe(12);
      expect(result.paddingRight).toBe(16);
      expect(result.paddingBottom).toBe(12);
      expect(result.paddingLeft).toBe(16);
    });
    it('[t, r, b, l] → individual', () => {
      const result = expandShorthands({ padding: [10, 20, 30, 40] });
      expect(result.paddingTop).toBe(10);
      expect(result.paddingRight).toBe(20);
      expect(result.paddingBottom).toBe(30);
      expect(result.paddingLeft).toBe(40);
    });
    it('string "12 16" → vertical/horizontal', () => {
      const result = expandShorthands({ padding: '12 16' });
      expect(result.paddingTop).toBe(12);
      expect(result.paddingRight).toBe(16);
    });
    it('explicit paddingLeft overrides padding shorthand', () => {
      const result = expandShorthands({ padding: 16, paddingLeft: 24 });
      expect(result.paddingLeft).toBe(24);
      expect(result.paddingTop).toBe(16);
    });
    it('object {top, right, bottom, left} → individual sides', () => {
      const result = expandShorthands({ padding: { top: 12, right: 16, bottom: 12, left: 16 } });
      expect(result.paddingTop).toBe(12);
      expect(result.paddingRight).toBe(16);
      expect(result.paddingBottom).toBe(12);
      expect(result.paddingLeft).toBe(16);
    });
    it('object short keys {t, r, b, l} → individual sides', () => {
      const result = expandShorthands({ p: { t: 8, b: 8, l: 20, r: 20 } });
      expect(result.paddingTop).toBe(8);
      expect(result.paddingRight).toBe(20);
      expect(result.paddingBottom).toBe(8);
      expect(result.paddingLeft).toBe(20);
    });
    it('partial object only sets specified sides', () => {
      const result = expandShorthands({ p: { top: 12, bottom: 12 } });
      expect(result.paddingTop).toBe(12);
      expect(result.paddingBottom).toBe(12);
      expect(result.paddingRight).toBeUndefined();
      expect(result.paddingLeft).toBeUndefined();
    });
  });

  describe('gap / crossGap', () => {
    it('gap → itemSpacing', () => {
      expect(expandShorthands({ gap: 8 })).toMatchObject({ itemSpacing: 8 });
    });
    it('crossGap → counterAxisSpacing', () => {
      expect(expandShorthands({ crossGap: 12 })).toMatchObject({ counterAxisSpacing: 12 });
    });
  });

  // ── Sizing ─────────────────────────────────────────────────────────────

  describe('width / height sizing', () => {
    it('width: "fill" → layoutSizingHorizontal, no width', () => {
      const result = expandShorthands({ width: 'fill' });
      expect(result.layoutSizingHorizontal).toBe('FILL');
      expect(result.width).toBeUndefined();
    });
    it('width: 360 → stays as width', () => {
      expect(expandShorthands({ width: 360 })).toMatchObject({ width: 360 });
    });
    it('height: "hug" → layoutSizingVertical', () => {
      expect(expandShorthands({ height: 'hug' })).toMatchObject({ layoutSizingVertical: 'HUG' });
    });
  });

  describe('sizing', () => {
    it('"fill" → both axes', () => {
      const result = expandShorthands({ sizing: 'fill' });
      expect(result.layoutSizingHorizontal).toBe('FILL');
      expect(result.layoutSizingVertical).toBe('FILL');
    });
    it('["fill", "hug"] → individual', () => {
      const result = expandShorthands({ sizing: ['fill', 'hug'] });
      expect(result.layoutSizingHorizontal).toBe('FILL');
      expect(result.layoutSizingVertical).toBe('HUG');
    });
  });

  // ── Paint ──────────────────────────────────────────────────────────────

  describe('fill', () => {
    it('"#FFFFFF" → fills array', () => {
      expect(expandShorthands({ fill: '#FFFFFF' })).toMatchObject({ fills: ['#FFFFFF'] });
    });
    it('"transparent" → empty fills', () => {
      expect(expandShorthands({ fill: 'transparent' })).toMatchObject({ fills: [] });
    });
    it('array → fills array', () => {
      expect(expandShorthands({ fill: ['#FF0000', '#0000FF'] }))
        .toMatchObject({ fills: ['#FF0000', '#0000FF'] });
    });
    it('explicit fills overrides fill shorthand', () => {
      const result = expandShorthands({ fill: '#FFF', fills: [{ type: 'SOLID' }] });
      expect(result.fills).toEqual([{ type: 'SOLID' }]);
    });
  });

  describe('background / bg', () => {
    it('background → fills', () => {
      expect(expandShorthands({ background: '#FFF' })).toMatchObject({ fills: ['#FFF'] });
    });
    it('bg → fills', () => {
      expect(expandShorthands({ bg: '#FFF' })).toMatchObject({ fills: ['#FFF'] });
    });
  });

  describe('stroke', () => {
    it('"1 #E5E7EB" → strokes + strokeWeight', () => {
      const result = expandShorthands({ stroke: '1 #E5E7EB' });
      expect(result.strokes).toEqual(['#E5E7EB']);
      expect(result.strokeWeight).toBe(1);
    });
    it('"2 #000 outside" → includes strokeAlign', () => {
      const result = expandShorthands({ stroke: '2 #000 outside' });
      expect(result.strokeAlign).toBe('OUTSIDE');
    });
  });

  // ── Effects ────────────────────────────────────────────────────────────

  describe('shadow', () => {
    it('parses shadow string to effects', () => {
      const result = expandShorthands({ shadow: '0,4,24,0,#0000001A' });
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].kind).toBe('drop-shadow');
    });
    it('inner shadow', () => {
      const result = expandShorthands({ shadow: 'inset,0,2,4,0,#00000020' });
      expect(result.effects[0].kind).toBe('inner-shadow');
    });
  });

  describe('blur / bgblur', () => {
    it('blur → layer blur effect', () => {
      const result = expandShorthands({ blur: 8 });
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0]).toMatchObject({ kind: 'blur', type: 'layer', radius: 8 });
    });
    it('bgblur → background blur', () => {
      const result = expandShorthands({ bgblur: 4 });
      expect(result.effects[0]).toMatchObject({ kind: 'blur', type: 'background', radius: 4 });
    });
  });

  describe('effect merging', () => {
    it('shadow + blur → merged effects array', () => {
      const result = expandShorthands({ shadow: '0,4,24,0,#0000001A', blur: 8 });
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].kind).toBe('drop-shadow');
      expect(result.effects[1].kind).toBe('blur');
    });
    it('explicit effects overrides shorthands', () => {
      const result = expandShorthands({ shadow: '0,4,24,0,#000', effects: [{ type: 'LAYER_BLUR' }] });
      expect(result.effects).toEqual([{ type: 'LAYER_BLUR' }]);
    });
  });

  // ── Shape ──────────────────────────────────────────────────────────────

  describe('radius', () => {
    it('number → cornerRadius', () => {
      expect(expandShorthands({ radius: 12 })).toMatchObject({ cornerRadius: 12 });
    });
    it('[tl, tr, bl, br] → individual corners', () => {
      const result = expandShorthands({ radius: [12, 12, 0, 0] });
      expect(result.topLeftRadius).toBe(12);
      expect(result.topRightRadius).toBe(12);
      expect(result.bottomLeftRadius).toBe(0);
      expect(result.bottomRightRadius).toBe(0);
    });
    it('"full" → 9999 (circle shorthand)', () => {
      expect(expandShorthands({ radius: 'full' })).toMatchObject({ cornerRadius: 9999 });
    });
    it('corner is alias for radius', () => {
      expect(expandShorthands({ corner: 8 })).toMatchObject({ cornerRadius: 8 });
    });
    it('corner:full also works', () => {
      expect(expandShorthands({ corner: 'full' })).toMatchObject({ cornerRadius: 9999 });
    });
  });

  // ── Layout details ─────────────────────────────────────────────────────

  describe('overflow / wrap', () => {
    it('overflow: "hidden" → clipsContent: true', () => {
      expect(expandShorthands({ overflow: 'hidden' })).toMatchObject({ clipsContent: true });
    });
    it('wrap: "wrap" → layoutWrap: WRAP', () => {
      expect(expandShorthands({ wrap: 'wrap' })).toMatchObject({ layoutWrap: 'WRAP' });
    });
    it('wrap: "no-wrap" → layoutWrap: NO_WRAP', () => {
      expect(expandShorthands({ wrap: 'no-wrap' })).toMatchObject({ layoutWrap: 'NO_WRAP' });
    });
  });

  // ── Passthrough ────────────────────────────────────────────────────────

  describe('passthrough', () => {
    it('native Figma props pass through unchanged', () => {
      const props = { layoutMode: 'HORIZONTAL', itemSpacing: 8, cornerRadius: 12 };
      expect(expandShorthands(props)).toEqual(props);
    });
    it('unknown props pass through', () => {
      const props = { customProp: 'value' };
      expect(expandShorthands(props)).toEqual(props);
    });
  });

  // ── Text content normalization ───────────────────────────────────────

  describe('text-transform detection', () => {
    it('"uppercase FREE" → characters "FREE" + textCase UPPER', () => {
      const result = expandShorthands({ characters: 'uppercase FREE' });
      expect(result.characters).toBe('FREE');
      expect(result.textCase).toBe('UPPER');
    });
    it('"Uppercase PRO" → case-insensitive match', () => {
      const result = expandShorthands({ characters: 'Uppercase PRO' });
      expect(result.characters).toBe('PRO');
      expect(result.textCase).toBe('UPPER');
    });
    it('"lowercase Hello" → characters "Hello" + textCase LOWER', () => {
      const result = expandShorthands({ characters: 'lowercase Hello' });
      expect(result.characters).toBe('Hello');
      expect(result.textCase).toBe('LOWER');
    });
    it('no prefix → unchanged', () => {
      const result = expandShorthands({ characters: 'Normal text' });
      expect(result.characters).toBe('Normal text');
      expect(result.textCase).toBeUndefined();
    });
    it('explicit textCase wins over detected prefix', () => {
      const result = expandShorthands({ characters: 'uppercase FREE', textCase: 'ORIGINAL' });
      expect(result.characters).toBe('FREE');
      expect(result.textCase).toBe('ORIGINAL');
    });
  });

  // ── Integration: user's example ────────────────────────────────────────

  it('user example: full shorthand expansion', () => {
    const result = expandShorthands({
      layout: 'row',
      padding: [12, 16],
      gap: 8,
      align: 'center',
      radius: 12,
      fill: '#FFFFFF',
    });
    expect(result).toMatchObject({
      layoutMode: 'HORIZONTAL',
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      itemSpacing: 8,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      cornerRadius: 12,
      fills: ['#FFFFFF'],
    });
    // No shorthand keys remain
    expect(result.layout).toBeUndefined();
    expect(result.padding).toBeUndefined();
    expect(result.gap).toBeUndefined();
    expect(result.align).toBeUndefined();
    expect(result.radius).toBeUndefined();
    expect(result.fill).toBeUndefined();
  });

  // ── Arc (ellipse) ─────────────────────────────────────────────────────

  describe('arc', () => {
    it('arc="0 270" → arcData in radians, solid', () => {
      const result = expandShorthands({ arc: '0 270' });
      expect(result.arcData.startingAngle).toBeCloseTo(0);
      expect(result.arcData.endingAngle).toBeCloseTo(4.712, 2);
      expect(result.arcData.innerRadius).toBe(0);
    });

    it('arc="0 270 0.5" → donut ring', () => {
      const result = expandShorthands({ arc: '0 270 0.5' });
      expect(result.arcData.innerRadius).toBe(0.5);
    });

    it('raw arcData object passthrough', () => {
      const raw = { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.3 };
      const result = expandShorthands({ arc: raw });
      expect(result.arcData).toEqual(raw);
    });

    it('arc="ring 0.4" → full circle donut', () => {
      const result = expandShorthands({ arc: 'ring 0.4' });
      expect(result.arcData.startingAngle).toBe(0);
      expect(result.arcData.endingAngle).toBeCloseTo(2 * Math.PI);
      expect(result.arcData.innerRadius).toBe(0.4);
    });

    it('bare innerRadius passes through (STAR acuteness, not ellipse)', () => {
      // innerRadius must NOT expand into arcData — it's a native STAR property
      const result = expandShorthands({ innerRadius: 0.5 });
      expect(result.innerRadius).toBe(0.5);
      expect(result.arcData).toBeUndefined();
    });
  });

  // ── Text decoration (advanced) ────────────────────────────────────────

  describe('decorationStyle / Thickness / Offset / Color', () => {
    it('decorationStyle: "wavy" → textDecorationStyle: WAVY', () => {
      expect(expandShorthands({ decorationStyle: 'wavy' }))
        .toMatchObject({ textDecorationStyle: 'WAVY' });
    });

    it('decorationThickness: 2 → {value:2, unit:PIXELS}', () => {
      expect(expandShorthands({ decorationThickness: 2 }))
        .toMatchObject({ textDecorationThickness: { value: 2, unit: 'PIXELS' } });
    });

    it('decorationThickness: "auto" → {unit:AUTO}', () => {
      expect(expandShorthands({ decorationThickness: 'auto' }))
        .toMatchObject({ textDecorationThickness: { unit: 'AUTO' } });
    });

    it('decorationOffset: 4 → {value:4, unit:PIXELS}', () => {
      expect(expandShorthands({ decorationOffset: 4 }))
        .toMatchObject({ textDecorationOffset: { value: 4, unit: 'PIXELS' } });
    });

    it('decorationColor: "#FF0000" → wrapped SolidPaint', () => {
      const result = expandShorthands({ decorationColor: '#FF0000' });
      expect(result.textDecorationColor.value.type).toBe('SOLID');
      expect(result.textDecorationColor.value.color.r).toBeCloseTo(1);
      expect(result.textDecorationColor.value.color.g).toBe(0);
    });

    it('decorationColor: "auto" → {value:AUTO}', () => {
      expect(expandShorthands({ decorationColor: 'auto' }))
        .toMatchObject({ textDecorationColor: { value: 'AUTO' } });
    });

    it('raw object passthrough for decorationThickness', () => {
      const raw = { value: 3, unit: 'PERCENT' };
      expect(expandShorthands({ decorationThickness: raw }))
        .toMatchObject({ textDecorationThickness: raw });
    });
  });
});
