import { describe, it, expect } from 'vitest';
import { lowerPaints, lowerEffects, lowerUnitValue } from '../figma-lowering';
import type { PaintValue, EffectValue, UnitValue } from '../../../domain/design-ir';

describe('lowerPaints', () => {
  it('converts canonical solid PaintValue to Figma format', () => {
    const ir: PaintValue[] = [{ kind: 'solid', color: '#FF0000' }];
    const result = lowerPaints(ir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('SOLID');
    expect(result[0].color.r).toBeCloseTo(1, 2);
    expect(result[0].color.g).toBeCloseTo(0, 2);
    expect(result[0].color.b).toBeCloseTo(0, 2);
  });

  it('converts canonical gradient PaintValue to Figma format', () => {
    const ir: PaintValue[] = [{
      kind: 'gradient',
      type: 'GRADIENT_LINEAR',
      stops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
    }];
    const result = lowerPaints(ir);
    expect(result[0].type).toBe('GRADIENT_LINEAR');
    expect(result[0].gradientStops).toHaveLength(2);
  });

  it('handles legacy hex string format', () => {
    const result = lowerPaints(['#FF0000']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('SOLID');
  });

  it('passes through raw Paint objects', () => {
    const rawPaint = { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 };
    const result = lowerPaints([rawPaint]);
    expect(result[0]).toBe(rawPaint);
  });

  it('handles mixed canonical and legacy formats', () => {
    const mixed = [
      { kind: 'solid', color: '#FF0000' } as PaintValue,
      '#00FF00',
    ];
    const result = lowerPaints(mixed);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('SOLID');
    expect(result[1].type).toBe('SOLID');
  });

  it('throws on invalid format', () => {
    expect(() => lowerPaints([42 as any])).toThrow(/Invalid paint/);
  });
});

describe('lowerEffects', () => {
  it('converts canonical drop-shadow to Figma format', () => {
    const ir: EffectValue[] = [{
      kind: 'drop-shadow',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
    }];
    const result = lowerEffects(ir);
    expect(result[0].type).toBe('DROP_SHADOW');
    expect(result[0].radius).toBe(8);
    expect(result[0].visible).toBe(true);
    expect(result[0].blendMode).toBe('NORMAL');
  });

  it('converts canonical blur to Figma format', () => {
    const ir: EffectValue[] = [{
      kind: 'blur',
      type: 'layer',
      radius: 10,
    }];
    const result = lowerEffects(ir);
    expect(result[0].type).toBe('LAYER_BLUR');
    expect(result[0].radius).toBe(10);
  });

  it('handles legacy format with blur field', () => {
    const legacy = [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, blur: 8, spread: 0, color: '#000000' }];
    const result = lowerEffects(legacy);
    expect(result[0].radius).toBe(8);
    expect(result[0].color).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('throws on invalid format', () => {
    expect(() => lowerEffects([null as any])).toThrow(/Invalid effect/);
  });
});

describe('lowerUnitValue', () => {
  it('converts canonical UnitValue PIXELS', () => {
    const ir: UnitValue = { value: 24, unit: 'PIXELS' };
    const result = lowerUnitValue(ir);
    expect(result).toEqual({ value: 24, unit: 'PIXELS' });
  });

  it('converts canonical UnitValue PERCENT', () => {
    const ir: UnitValue = { value: 160, unit: 'PERCENT' };
    const result = lowerUnitValue(ir);
    expect(result).toEqual({ value: 160, unit: 'PERCENT' });
  });

  it('handles legacy percentage string', () => {
    const result = lowerUnitValue('160%');
    expect(result).toEqual({ value: 160, unit: 'PERCENT' });
  });

  it('handles legacy number', () => {
    const result = lowerUnitValue(24);
    expect(result).toEqual({ value: 24, unit: 'PIXELS' });
  });

  it('handles legacy numeric string', () => {
    const result = lowerUnitValue('24');
    expect(result).toEqual({ value: 24, unit: 'PIXELS' });
  });
});
