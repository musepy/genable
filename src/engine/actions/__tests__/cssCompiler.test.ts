import { describe, it, expect } from 'vitest';
import { compileCssProps } from '../cssCompiler';

describe('compileCssProps', () => {
  // ── layout ──
  it('layout: "row" → layoutMode: "HORIZONTAL"', () => {
    expect(compileCssProps({ layout: 'row' })).toEqual({ layoutMode: 'HORIZONTAL' });
  });

  it('layout: "column" → layoutMode: "VERTICAL"', () => {
    expect(compileCssProps({ layout: 'column' })).toEqual({ layoutMode: 'VERTICAL' });
  });

  it('layout: "none" → layoutMode: "NONE"', () => {
    expect(compileCssProps({ layout: 'none' })).toEqual({ layoutMode: 'NONE' });
  });

  // ── justifyContent ──
  it('justifyContent: "center" → primaryAxisAlignItems: "CENTER"', () => {
    expect(compileCssProps({ justifyContent: 'center' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
  });

  it('justifyContent: "flex-start" → primaryAxisAlignItems: "MIN"', () => {
    expect(compileCssProps({ justifyContent: 'flex-start' })).toEqual({ primaryAxisAlignItems: 'MIN' });
  });

  it('justifyContent: "start" → primaryAxisAlignItems: "MIN"', () => {
    expect(compileCssProps({ justifyContent: 'start' })).toEqual({ primaryAxisAlignItems: 'MIN' });
  });

  it('justifyContent: "flex-end" → primaryAxisAlignItems: "MAX"', () => {
    expect(compileCssProps({ justifyContent: 'flex-end' })).toEqual({ primaryAxisAlignItems: 'MAX' });
  });

  it('justifyContent: "end" → primaryAxisAlignItems: "MAX"', () => {
    expect(compileCssProps({ justifyContent: 'end' })).toEqual({ primaryAxisAlignItems: 'MAX' });
  });

  it('justifyContent: "space-between" → primaryAxisAlignItems: "SPACE_BETWEEN"', () => {
    expect(compileCssProps({ justifyContent: 'space-between' })).toEqual({ primaryAxisAlignItems: 'SPACE_BETWEEN' });
  });

  // ── alignItems ──
  it('alignItems: "center" → counterAxisAlignItems: "CENTER"', () => {
    expect(compileCssProps({ alignItems: 'center' })).toEqual({ counterAxisAlignItems: 'CENTER' });
  });

  it('alignItems: "flex-start" → counterAxisAlignItems: "MIN"', () => {
    expect(compileCssProps({ alignItems: 'flex-start' })).toEqual({ counterAxisAlignItems: 'MIN' });
  });

  it('alignItems: "flex-end" → counterAxisAlignItems: "MAX"', () => {
    expect(compileCssProps({ alignItems: 'flex-end' })).toEqual({ counterAxisAlignItems: 'MAX' });
  });

  it('alignItems: "baseline" → counterAxisAlignItems: "BASELINE"', () => {
    expect(compileCssProps({ alignItems: 'baseline' })).toEqual({ counterAxisAlignItems: 'BASELINE' });
  });

  // ── width/height sizing ──
  it('width: "fill" → layoutSizingHorizontal: "FILL", width deleted', () => {
    const result = compileCssProps({ width: 'fill' });
    expect(result).toEqual({ layoutSizingHorizontal: 'FILL' });
    expect(result).not.toHaveProperty('width');
  });

  it('width: "hug" → layoutSizingHorizontal: "HUG", width deleted', () => {
    const result = compileCssProps({ width: 'hug' });
    expect(result).toEqual({ layoutSizingHorizontal: 'HUG' });
    expect(result).not.toHaveProperty('width');
  });

  it('width: 360 → width: 360 (number pass-through)', () => {
    expect(compileCssProps({ width: 360 })).toEqual({ width: 360 });
  });

  it('height: "fill" → layoutSizingVertical: "FILL", height deleted', () => {
    const result = compileCssProps({ height: 'fill' });
    expect(result).toEqual({ layoutSizingVertical: 'FILL' });
    expect(result).not.toHaveProperty('height');
  });

  it('height: "hug" → layoutSizingVertical: "HUG", height deleted', () => {
    const result = compileCssProps({ height: 'hug' });
    expect(result).toEqual({ layoutSizingVertical: 'HUG' });
    expect(result).not.toHaveProperty('height');
  });

  it('height: 44 → height: 44 (number pass-through)', () => {
    expect(compileCssProps({ height: 44 })).toEqual({ height: 44 });
  });

  // ── background ──
  it('background: "#4F46E5" → fills: ["#4F46E5"]', () => {
    expect(compileCssProps({ background: '#4F46E5' })).toEqual({ fills: ['#4F46E5'] });
  });

  it('background: ["#A", "#B"] → fills: ["#A", "#B"]', () => {
    expect(compileCssProps({ background: ['#A', '#B'] })).toEqual({ fills: ['#A', '#B'] });
  });

  // ── simple aliases ──
  it('borderRadius: 10 → cornerRadius: 10', () => {
    expect(compileCssProps({ borderRadius: 10 })).toEqual({ cornerRadius: 10 });
  });

  it('gap: 16 → itemSpacing: 16', () => {
    expect(compileCssProps({ gap: 16 })).toEqual({ itemSpacing: 16 });
  });

  // ── Figma-native pass-through ──
  it('layoutMode: "HORIZONTAL" passes through unchanged', () => {
    expect(compileCssProps({ layoutMode: 'HORIZONTAL' })).toEqual({ layoutMode: 'HORIZONTAL' });
  });

  it('primaryAxisAlignItems: "CENTER" passes through unchanged', () => {
    expect(compileCssProps({ primaryAxisAlignItems: 'CENTER' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
  });

  it('itemSpacing: 12 passes through unchanged', () => {
    expect(compileCssProps({ itemSpacing: 12 })).toEqual({ itemSpacing: 12 });
  });

  // ── CSS name priority (conflict resolution) ──
  it('CSS name overrides Figma name when both present', () => {
    const result = compileCssProps({ layout: 'row', layoutMode: 'VERTICAL' });
    expect(result.layoutMode).toBe('HORIZONTAL');
  });

  it('gap overrides itemSpacing when both present', () => {
    const result = compileCssProps({ gap: 20, itemSpacing: 10 });
    expect(result.itemSpacing).toBe(20);
  });

  // ── Unknown properties pass-through ──
  it('unknown properties pass through unchanged', () => {
    expect(compileCssProps({ opacity: 0.5, name: 'Card' })).toEqual({ opacity: 0.5, name: 'Card' });
  });

  // ── Combined usage ──
  it('handles a realistic combined props object', () => {
    const result = compileCssProps({
      name: 'Card',
      layout: 'column',
      gap: 16,
      justifyContent: 'center',
      alignItems: 'center',
      width: 400,
      height: 'hug',
      background: '#FFFFFF',
      borderRadius: 16,
      padding: 24,
    });
    expect(result).toEqual({
      name: 'Card',
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      width: 400,
      layoutSizingVertical: 'HUG',
      fills: ['#FFFFFF'],
      cornerRadius: 16,
      padding: 24,
    });
  });

  // ── Case-insensitive value matching ──
  it('handles uppercase CSS values', () => {
    expect(compileCssProps({ layout: 'ROW' })).toEqual({ layoutMode: 'HORIZONTAL' });
    expect(compileCssProps({ justifyContent: 'CENTER' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
    expect(compileCssProps({ width: 'FILL' })).toEqual({ layoutSizingHorizontal: 'FILL' });
  });
});
