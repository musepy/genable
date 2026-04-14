/**
 * Pipeline integration test: raw DSL abbreviation keys → coerceValue → expandShorthands
 *
 * Tests the full property translation pipeline that runs in production
 * (DSL parser extracts raw keys → coerceValue coerces types → expandShorthands
 * translates to Figma-native properties). Covers every shorthand defined in
 * expandShorthands.ts to ensure no shorthand silently produces NaN/undefined.
 */
import { describe, it, expect } from 'vitest';
import { coerceValue } from '../../utils/prop-dsl';
import { expandShorthands } from '../expandShorthands';

/** Simulate the DSL pipeline: coerce string values, then expand shorthands */
function pipeline(rawProps: Record<string, string>): Record<string, any> {
  const coerced: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    coerced[k] = coerceValue(k, v);
  }
  return expandShorthands(coerced);
}

/** Assert no value in result is NaN (silent failure mode) */
function assertNoNaN(result: Record<string, any>) {
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'number') {
      expect(v, `${k} should not be NaN`).not.toBeNaN();
    }
  }
}

describe('shorthand pipeline (coerceValue → expandShorthands)', () => {

  // ── Layout ─────────────────────────────────────────────────────────────

  describe('layout shorthands', () => {
    it('layout:row', () => {
      const r = pipeline({ layout: 'row' });
      expect(r.layoutMode).toBe('HORIZONTAL');
      expect(r.layout).toBeUndefined();
    });

    it('layout:column', () => {
      expect(pipeline({ layout: 'column' }).layoutMode).toBe('VERTICAL');
    });

    it('pattern:row', () => {
      const r = pipeline({ pattern: 'row' });
      expect(r.layoutMode).toBe('HORIZONTAL');
      expect(r.layoutSizingHorizontal).toBe('HUG');
      expect(r.layoutSizingVertical).toBe('HUG');
      expect(r.fills).toEqual([]);
    });

    it('pattern:column-fill', () => {
      const r = pipeline({ pattern: 'column-fill' });
      expect(r.layoutMode).toBe('VERTICAL');
      expect(r.layoutSizingVertical).toBe('FILL');
    });
  });

  // ── Alignment ──────────────────────────────────────────────────────────

  describe('alignment shorthands', () => {
    it('align:center → both axes CENTER (LLM mental model)', () => {
      const r = pipeline({ align: 'center' });
      expect(r.primaryAxisAlignItems).toBe('CENTER');
      expect(r.counterAxisAlignItems).toBe('CENTER');
    });

    it('align:"center center" → both axes', () => {
      const r = pipeline({ align: 'center center' });
      expect(r.primaryAxisAlignItems).toBe('CENTER');
      expect(r.counterAxisAlignItems).toBe('CENTER');
    });

    it('alignMain:space-between', () => {
      const r = pipeline({ alignMain: 'space-between' });
      expect(r.primaryAxisAlignItems).toBe('SPACE_BETWEEN');
    });

    it('alignCross:baseline', () => {
      const r = pipeline({ alignCross: 'baseline' });
      expect(r.counterAxisAlignItems).toBe('BASELINE');
    });

    it('justifyContent:end', () => {
      expect(pipeline({ justifyContent: 'end' }).primaryAxisAlignItems).toBe('MAX');
    });

    it('alignItems:start', () => {
      expect(pipeline({ alignItems: 'start' }).counterAxisAlignItems).toBe('MIN');
    });

    it('textAlign:CENTER', () => {
      expect(pipeline({ textAlign: 'CENTER' }).textAlignHorizontal).toBe('CENTER');
    });
  });

  // ── Spacing ────────────────────────────────────────────────────────────

  describe('spacing shorthands', () => {
    it('gap:16', () => {
      const r = pipeline({ gap: '16' });
      expect(r.itemSpacing).toBe(16);
      assertNoNaN(r);
    });

    it('crossGap:8', () => {
      expect(pipeline({ crossGap: '8' }).counterAxisSpacing).toBe(8);
    });

    it('p:24 (single value)', () => {
      const r = pipeline({ p: '24' });
      expect(r.paddingTop).toBe(24);
      expect(r.paddingRight).toBe(24);
      expect(r.paddingBottom).toBe(24);
      expect(r.paddingLeft).toBe(24);
    });

    it("p:'16 24' (vertical horizontal)", () => {
      const r = pipeline({ p: '16 24' });
      expect(r.paddingTop).toBe(16);
      expect(r.paddingRight).toBe(24);
      expect(r.paddingBottom).toBe(16);
      expect(r.paddingLeft).toBe(24);
    });

    it('pt/pr/pb/pl individual', () => {
      const r = pipeline({ pt: '10', pr: '20', pb: '30', pl: '40' });
      expect(r.paddingTop).toBe(10);
      expect(r.paddingRight).toBe(20);
      expect(r.paddingBottom).toBe(30);
      expect(r.paddingLeft).toBe(40);
    });
  });

  // ── Sizing ─────────────────────────────────────────────────────────────

  describe('sizing shorthands', () => {
    it('w:360 (numeric)', () => {
      expect(pipeline({ w: '360' }).width).toBe(360);
    });

    it('w:fill → layoutSizingHorizontal', () => {
      const r = pipeline({ w: 'fill' });
      expect(r.layoutSizingHorizontal).toBe('FILL');
      expect(r.width).toBeUndefined();
    });

    it('h:hug → layoutSizingVertical', () => {
      const r = pipeline({ h: 'hug' });
      expect(r.layoutSizingVertical).toBe('HUG');
      expect(r.height).toBeUndefined();
    });

    it('sizingH:FILL / sizingV:HUG', () => {
      const r = pipeline({ sizingH: 'FILL', sizingV: 'HUG' });
      expect(r.layoutSizingHorizontal).toBe('FILL');
      expect(r.layoutSizingVertical).toBe('HUG');
    });
  });

  // ── Paint ──────────────────────────────────────────────────────────────

  describe('paint shorthands', () => {
    it('fill:#FF0000', () => {
      expect(pipeline({ fill: '#FF0000' }).fills).toEqual(['#FF0000']);
    });

    it('fill:transparent', () => {
      expect(pipeline({ fill: 'transparent' }).fills).toEqual([]);
    });

    it('bg:#FFFFFF', () => {
      expect(pipeline({ bg: '#FFFFFF' }).fills).toEqual(['#FFFFFF']);
    });

    it('stroke: compound "2 #E5E7EB outside"', () => {
      const r = pipeline({ stroke: '2 #E5E7EB outside' });
      expect(r.strokes).toEqual(['#E5E7EB']);
      expect(r.strokeWeight).toBe(2);
      expect(r.strokeAlign).toBe('OUTSIDE');
    });

    it('stroke: simple "#000000"', () => {
      const r = pipeline({ stroke: '#000000' });
      expect(r.strokes).toEqual(['#000000']);
    });
  });

  // ── Effects ────────────────────────────────────────────────────────────

  describe('effect shorthands', () => {
    it('shadow string', () => {
      const r = pipeline({ shadow: '0,4,24,0,#0000001A' });
      expect(r.effects).toHaveLength(1);
      expect(r.effects[0].kind).toBe('drop-shadow');
      expect(r.effects[0].radius).toBe(24);
    });

    it('shadow inset', () => {
      const r = pipeline({ shadow: 'inset,0,2,4,0,#000' });
      expect(r.effects[0].kind).toBe('inner-shadow');
    });

    it('blur:8', () => {
      const r = pipeline({ blur: '8' });
      expect(r.effects[0]).toMatchObject({ kind: 'blur', type: 'layer', radius: 8 });
    });

    it('bgblur:4', () => {
      const r = pipeline({ bgblur: '4' });
      expect(r.effects[0]).toMatchObject({ kind: 'blur', type: 'background', radius: 4 });
    });

    it('shadow + blur merge', () => {
      const r = pipeline({ shadow: '0,4,24,0,#000', blur: '8' });
      expect(r.effects).toHaveLength(2);
    });
  });

  // ── Shape ──────────────────────────────────────────────────────────────

  describe('shape shorthands', () => {
    it('corner:16', () => {
      const r = pipeline({ corner: '16' });
      expect(r.cornerRadius).toBe(16);
      assertNoNaN(r);
    });

    it('corner:full → 9999', () => {
      const r = pipeline({ corner: 'full' });
      expect(r.cornerRadius).toBe(9999);
    });

    it('radius:12', () => {
      expect(pipeline({ radius: '12' }).cornerRadius).toBe(12);
    });

    it('smooth:0.6', () => {
      expect(pipeline({ smooth: '0.6' }).cornerSmoothing).toBe(0.6);
    });
  });

  // ── Text ───────────────────────────────────────────────────────────────

  describe('text shorthands', () => {
    it('size:20', () => {
      expect(pipeline({ size: '20' }).fontSize).toBe(20);
    });

    it('weight:Bold stays string', () => {
      expect(pipeline({ weight: 'Bold' }).fontWeight).toBe('Bold');
    });

    it('weight:700 stays string', () => {
      expect(pipeline({ weight: '700' }).fontWeight).toBe('700');
    });

    it('font:Roboto', () => {
      expect(pipeline({ font: 'Roboto' }).fontFamily).toBe('Roboto');
    });

    it('tracking:1.5', () => {
      const r = pipeline({ tracking: '1.5' });
      expect(r.letterSpacing).toBe(1.5);
    });

    it('leading:24 → pixels (> 5 threshold)', () => {
      expect(pipeline({ leading: '24' }).lineHeight).toBe(24);
    });

    it('leading:1.5 → CSS multiplier → 150%', () => {
      expect(pipeline({ leading: '1.5' }).lineHeight).toBe('150%');
    });

    it('lineHeight:1.5 → CSS multiplier → 150%', () => {
      expect(pipeline({ lineHeight: '1.5' }).lineHeight).toBe('150%');
    });

    it('lineHeight:24 → stays as pixels (> 5)', () => {
      expect(pipeline({ lineHeight: '24' }).lineHeight).toBe(24);
    });

    it('lineHeight:160% → stays as percentage string', () => {
      expect(pipeline({ lineHeight: '160%' }).lineHeight).toBe('160%');
    });
  });

  // ── Stroke details ─────────────────────────────────────────────────────

  describe('stroke detail shorthands', () => {
    it('strokeW:2', () => {
      expect(pipeline({ strokeW: '2' }).strokeWeight).toBe(2);
    });

    it('strokeA:INSIDE', () => {
      expect(pipeline({ strokeA: 'INSIDE' }).strokeAlign).toBe('INSIDE');
    });

    it('strokeJ:ROUND', () => {
      expect(pipeline({ strokeJ: 'ROUND' }).strokeJoin).toBe('ROUND');
    });

    it('strokeC:SQUARE', () => {
      expect(pipeline({ strokeC: 'SQUARE' }).strokeCap).toBe('SQUARE');
    });

    it('dash:10,5', () => {
      // dash value stays as coerced — dashPatternHandler parses at apply time
      const r = pipeline({ dash: '10,5' });
      expect(r.dashPattern).toBe('10,5');
    });

    it('strokeT/R/B/L individual weights', () => {
      const r = pipeline({ strokeT: '1', strokeR: '2', strokeB: '3', strokeL: '4' });
      expect(r.strokeTopWeight).toBe(1);
      expect(r.strokeRightWeight).toBe(2);
      expect(r.strokeBottomWeight).toBe(3);
      expect(r.strokeLeftWeight).toBe(4);
    });
  });

  // ── Layout detail shorthands ───────────────────────────────────────────

  describe('layout detail shorthands', () => {
    it('overflow:hidden → clipsContent:true', () => {
      expect(pipeline({ overflow: 'hidden' }).clipsContent).toBe(true);
    });

    it('wrap:wrap → WRAP', () => {
      expect(pipeline({ wrap: 'wrap' }).layoutWrap).toBe('WRAP');
    });

    it('wrap:no-wrap → NO_WRAP', () => {
      expect(pipeline({ wrap: 'no-wrap' }).layoutWrap).toBe('NO_WRAP');
    });

    it('positioning:ABSOLUTE', () => {
      expect(pipeline({ positioning: 'ABSOLUTE' }).layoutPositioning).toBe('ABSOLUTE');
    });

    it('blend:MULTIPLY', () => {
      expect(pipeline({ blend: 'MULTIPLY' }).blendMode).toBe('MULTIPLY');
    });

    it('strokesInLayout:true', () => {
      expect(pipeline({ strokesInLayout: 'true' }).strokesIncludedInLayout).toBe(true);
    });

    it('reverseZ:true', () => {
      expect(pipeline({ reverseZ: 'true' }).itemReverseZIndex).toBe(true);
    });

    it('lockRatio:true', () => {
      expect(pipeline({ lockRatio: 'true' }).constrainProportions).toBe(true);
    });

    it('pin:MIN,CENTER', () => {
      expect(pipeline({ pin: 'MIN,CENTER' }).constraints).toBe('MIN,CENTER');
    });

    it('minW/maxW/minH/maxH', () => {
      const r = pipeline({ minW: '100', maxW: '500', minH: '50', maxH: '300' });
      expect(r.minWidth).toBe(100);
      expect(r.maxWidth).toBe(500);
      expect(r.minHeight).toBe(50);
      expect(r.maxHeight).toBe(300);
      assertNoNaN(r);
    });
  });

  // ── Realistic DSL batch (simulates what LLM actually writes) ───────────

  describe('realistic DSL combos', () => {
    it('card frame with all common shorthands', () => {
      const r = pipeline({
        w: '360', layout: 'column', gap: '16', p: '24',
        bg: '#FFFFFF', corner: '16', shadow: '0,4,20,0,#00000014',
        alignItems: 'center',
      });
      expect(r).toMatchObject({
        width: 360,
        layoutMode: 'VERTICAL',
        itemSpacing: 16,
        paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
        fills: ['#FFFFFF'],
        cornerRadius: 16,
        counterAxisAlignItems: 'CENTER',
      });
      expect(r.effects).toHaveLength(1);
      assertNoNaN(r);
    });

    it('avatar circle', () => {
      const r = pipeline({ w: '80', h: '80', bg: '#E5E7EB', corner: 'full', overflow: 'hidden' });
      expect(r).toMatchObject({
        width: 80, height: 80,
        fills: ['#E5E7EB'],
        cornerRadius: 9999,
        clipsContent: true,
      });
    });

    it('text node', () => {
      const r = pipeline({ size: '14', weight: 'Medium', fill: '#6B7280' });
      expect(r).toMatchObject({
        fontSize: 14,
        fontWeight: 'Medium',
        fills: ['#6B7280'],
      });
    });

    it('stats row', () => {
      const r = pipeline({ w: 'fill', layout: 'row', gap: '0', justifyContent: 'space-between' });
      expect(r).toMatchObject({
        layoutSizingHorizontal: 'FILL',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 0,
        primaryAxisAlignItems: 'SPACE_BETWEEN',
      });
    });

    it('no shorthand keys remain in output', () => {
      const r = pipeline({
        w: '100', h: '50', layout: 'row', gap: '8', p: '16',
        bg: '#FFF', corner: '8', align: 'center', overflow: 'hidden',
      });
      const shorthandKeys = ['w', 'h', 'layout', 'gap', 'p', 'bg', 'corner', 'align', 'overflow'];
      for (const k of shorthandKeys) {
        expect(r[k], `shorthand key '${k}' should not remain`).toBeUndefined();
      }
    });
  });
});
