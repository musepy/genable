import { describe, it, expect } from 'vitest';
import { lowerPaints, lowerEffects, lowerUnitValue } from '../figma-lowering';
import type { UnitValue } from '../../../domain/design-ir';

describe('lowerPaints', () => {
  it('converts hex string to Figma solid paint', () => {
    const result = lowerPaints(['#FF0000']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('SOLID');
    expect(result[0].color.r).toBeCloseTo(1, 2);
    expect(result[0].color.g).toBeCloseTo(0, 2);
    expect(result[0].color.b).toBeCloseTo(0, 2);
  });

  it('converts CSS gradient string to Figma gradient paint', () => {
    const result = lowerPaints(['linear-gradient(135deg, #667eea 0%, #764ba2 100%)']);
    expect(result[0].type).toBe('GRADIENT_LINEAR');
    expect(result[0].gradientStops).toHaveLength(2);
  });

  it('passes through raw Figma Paint objects', () => {
    const rawPaint = { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 };
    const result = lowerPaints([rawPaint]);
    expect(result[0]).toBe(rawPaint);
  });

  it('converts LLM object syntax {color, blendMode, opacity}', () => {
    const result = lowerPaints([{ color: '#FF0000', blendMode: 'MULTIPLY', opacity: 0.5 }]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('SOLID');
    expect(result[0].color.r).toBeCloseTo(1, 2);
    expect(result[0].blendMode).toBe('MULTIPLY');
    expect(result[0].opacity).toBe(0.5);
  });

  it('handles mixed string and object formats', () => {
    const result = lowerPaints(['#00FF00', { color: '#FF0000', blendMode: 'MULTIPLY' }]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('SOLID');
    expect(result[1].blendMode).toBe('MULTIPLY');
  });

  it('throws on invalid format', () => {
    expect(() => lowerPaints([42 as any])).toThrow(/Invalid paint/);
  });
});

describe('lowerEffects', () => {
  it('passes through Figma Effect with defaults filled', () => {
    const result = lowerEffects([{
      type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 }, radius: 8, spread: 0,
    }]);
    expect(result[0].type).toBe('DROP_SHADOW');
    expect(result[0].visible).toBe(true);
    expect(result[0].blendMode).toBe('NORMAL');
  });

  it('normalizes legacy blur field', () => {
    const result = lowerEffects([{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, blur: 8, spread: 0, color: '#000000' }]);
    expect(result[0].radius).toBe(8);
    expect(result[0].color).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('converts string to Figma Effect', () => {
    const result = lowerEffects(['blur(10)' as any]);
    expect(result[0].type).toBe('LAYER_BLUR');
    expect(result[0].radius).toBe(10);
  });

  it('throws on invalid format', () => {
    expect(() => lowerEffects([null as any])).toThrow(/Invalid effect/);
  });
});

describe('lowerUnitValue', () => {
  it('converts canonical UnitValue PIXELS', () => {
    expect(lowerUnitValue({ value: 24, unit: 'PIXELS' })).toEqual({ value: 24, unit: 'PIXELS' });
  });

  it('converts canonical UnitValue PERCENT', () => {
    expect(lowerUnitValue({ value: 160, unit: 'PERCENT' })).toEqual({ value: 160, unit: 'PERCENT' });
  });

  it('handles legacy percentage string', () => {
    expect(lowerUnitValue('160%')).toEqual({ value: 160, unit: 'PERCENT' });
  });

  it('handles legacy number', () => {
    expect(lowerUnitValue(24)).toEqual({ value: 24, unit: 'PIXELS' });
  });
});
