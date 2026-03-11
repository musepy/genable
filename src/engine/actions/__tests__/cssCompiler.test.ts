import { describe, it, expect } from 'vitest';
import { normalizeProps } from '../../../domain/node-normalizers';

/**
 * These tests verify normalizeProps (formerly compileCssProps).
 * cssCompiler.ts was a thin wrapper deleted during the 5-pass pipeline refactor.
 */
describe('normalizeProps (was compileCssProps)', () => {
  // ── layout ──
  it('layout: "row" → layoutMode: "HORIZONTAL"', () => {
    expect(normalizeProps({ layout: 'row' })).toEqual({ layoutMode: 'HORIZONTAL' });
  });

  it('layout: "column" → layoutMode: "VERTICAL"', () => {
    expect(normalizeProps({ layout: 'column' })).toEqual({ layoutMode: 'VERTICAL' });
  });

  it('layout: "none" → layoutMode: "NONE"', () => {
    expect(normalizeProps({ layout: 'none' })).toEqual({ layoutMode: 'NONE' });
  });

  // ── justifyContent ──
  it('justifyContent: "center" → primaryAxisAlignItems: "CENTER"', () => {
    expect(normalizeProps({ justifyContent: 'center' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
  });

  it('justifyContent: "flex-start" → primaryAxisAlignItems: "MIN"', () => {
    expect(normalizeProps({ justifyContent: 'flex-start' })).toEqual({ primaryAxisAlignItems: 'MIN' });
  });

  it('justifyContent: "start" → primaryAxisAlignItems: "MIN"', () => {
    expect(normalizeProps({ justifyContent: 'start' })).toEqual({ primaryAxisAlignItems: 'MIN' });
  });

  it('justifyContent: "flex-end" → primaryAxisAlignItems: "MAX"', () => {
    expect(normalizeProps({ justifyContent: 'flex-end' })).toEqual({ primaryAxisAlignItems: 'MAX' });
  });

  it('justifyContent: "end" → primaryAxisAlignItems: "MAX"', () => {
    expect(normalizeProps({ justifyContent: 'end' })).toEqual({ primaryAxisAlignItems: 'MAX' });
  });

  it('justifyContent: "space-between" → primaryAxisAlignItems: "SPACE_BETWEEN"', () => {
    expect(normalizeProps({ justifyContent: 'space-between' })).toEqual({ primaryAxisAlignItems: 'SPACE_BETWEEN' });
  });

  // ── alignItems ──
  it('alignItems: "center" → counterAxisAlignItems: "CENTER"', () => {
    expect(normalizeProps({ alignItems: 'center' })).toEqual({ counterAxisAlignItems: 'CENTER' });
  });

  it('alignItems: "flex-start" → counterAxisAlignItems: "MIN"', () => {
    expect(normalizeProps({ alignItems: 'flex-start' })).toEqual({ counterAxisAlignItems: 'MIN' });
  });

  it('alignItems: "flex-end" → counterAxisAlignItems: "MAX"', () => {
    expect(normalizeProps({ alignItems: 'flex-end' })).toEqual({ counterAxisAlignItems: 'MAX' });
  });

  it('alignItems: "baseline" → counterAxisAlignItems: "BASELINE"', () => {
    expect(normalizeProps({ alignItems: 'baseline' })).toEqual({ counterAxisAlignItems: 'BASELINE' });
  });

  // ── width/height sizing ──
  it('width: "fill" → layoutSizingHorizontal: "FILL", width deleted', () => {
    const result = normalizeProps({ width: 'fill' });
    expect(result).toEqual({ layoutSizingHorizontal: 'FILL' });
    expect(result).not.toHaveProperty('width');
  });

  it('TEXT width: "fill" stays as width for contract validation', () => {
    const result = normalizeProps({ width: 'fill' }, { nodeType: 'TEXT' });
    expect(result).toEqual({ width: 'fill' });
  });

  it('width: "hug" → layoutSizingHorizontal: "HUG", width deleted', () => {
    const result = normalizeProps({ width: 'hug' });
    expect(result).toEqual({ layoutSizingHorizontal: 'HUG' });
    expect(result).not.toHaveProperty('width');
  });

  it('width: 360 → width: 360 (number pass-through)', () => {
    expect(normalizeProps({ width: 360 })).toEqual({ width: 360 });
  });

  it('height: "fill" → layoutSizingVertical: "FILL", height deleted', () => {
    const result = normalizeProps({ height: 'fill' });
    expect(result).toEqual({ layoutSizingVertical: 'FILL' });
    expect(result).not.toHaveProperty('height');
  });

  it('height: "hug" → layoutSizingVertical: "HUG", height deleted', () => {
    const result = normalizeProps({ height: 'hug' });
    expect(result).toEqual({ layoutSizingVertical: 'HUG' });
    expect(result).not.toHaveProperty('height');
  });

  it('TEXT height: "hug" stays as height for contract validation', () => {
    const result = normalizeProps({ height: 'hug' }, { nodeType: 'TEXT' });
    expect(result).toEqual({ height: 'hug' });
  });

  it('height: 44 → height: 44 (number pass-through)', () => {
    expect(normalizeProps({ height: 44 })).toEqual({ height: 44 });
  });

  // ── background ──
  it('background: "#4F46E5" → fills: ["#4F46E5"]', () => {
    expect(normalizeProps({ background: '#4F46E5' })).toEqual({ fills: ['#4F46E5'] });
  });

  it('background: ["#A", "#B"] → fills: ["#A", "#B"]', () => {
    expect(normalizeProps({ background: ['#A', '#B'] })).toEqual({ fills: ['#A', '#B'] });
  });

  // ── simple aliases ──
  it('borderRadius: 10 → cornerRadius: 10', () => {
    expect(normalizeProps({ borderRadius: 10 })).toEqual({ cornerRadius: 10 });
  });

  it('gap: 16 → itemSpacing: 16', () => {
    expect(normalizeProps({ gap: 16 })).toEqual({ itemSpacing: 16 });
  });

  // ── Figma-native pass-through ──
  it('layoutMode: "HORIZONTAL" passes through unchanged', () => {
    expect(normalizeProps({ layoutMode: 'HORIZONTAL' })).toEqual({ layoutMode: 'HORIZONTAL' });
  });

  it('primaryAxisAlignItems: "CENTER" passes through unchanged', () => {
    expect(normalizeProps({ primaryAxisAlignItems: 'CENTER' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
  });

  it('itemSpacing: 12 passes through unchanged', () => {
    expect(normalizeProps({ itemSpacing: 12 })).toEqual({ itemSpacing: 12 });
  });

  // ── CSS name priority (conflict resolution) ──
  it('CSS name overrides Figma name when both present', () => {
    const result = normalizeProps({ layout: 'row', layoutMode: 'VERTICAL' });
    expect(result.layoutMode).toBe('HORIZONTAL');
  });

  it('gap overrides itemSpacing when both present', () => {
    const result = normalizeProps({ gap: 20, itemSpacing: 10 });
    expect(result.itemSpacing).toBe(20);
  });

  // ── Unknown properties pass-through ──
  it('unknown properties pass through unchanged', () => {
    expect(normalizeProps({ opacity: 0.5, name: 'Card' })).toEqual({ opacity: 0.5, name: 'Card' });
  });

  // ── Combined usage ──
  it('handles a realistic combined props object', () => {
    const result = normalizeProps({
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
    expect(normalizeProps({ layout: 'ROW' })).toEqual({ layoutMode: 'HORIZONTAL' });
    expect(normalizeProps({ justifyContent: 'CENTER' })).toEqual({ primaryAxisAlignItems: 'CENTER' });
    expect(normalizeProps({ width: 'FILL' })).toEqual({ layoutSizingHorizontal: 'FILL' });
  });
});
