import { describe, it, expect } from 'vitest';
import { normalizeProps } from '../node-normalizers';

describe('normalizeProps', () => {
  it('converts layout → layoutMode', () => {
    expect(normalizeProps({ layout: 'row' })).toMatchObject({ layoutMode: 'HORIZONTAL' });
    expect(normalizeProps({ layout: 'column' })).toMatchObject({ layoutMode: 'VERTICAL' });
    expect(normalizeProps({ layout: 'none' })).toMatchObject({ layoutMode: 'NONE' });
    expect(normalizeProps({ layout: 'row' })).not.toHaveProperty('layout');
  });

  it('converts justifyContent → primaryAxisAlignItems', () => {
    expect(normalizeProps({ justifyContent: 'center' })).toMatchObject({ primaryAxisAlignItems: 'CENTER' });
    expect(normalizeProps({ justifyContent: 'flex-start' })).toMatchObject({ primaryAxisAlignItems: 'MIN' });
    expect(normalizeProps({ justifyContent: 'space-between' })).toMatchObject({ primaryAxisAlignItems: 'SPACE_BETWEEN' });
    expect(normalizeProps({ justifyContent: 'center' })).not.toHaveProperty('justifyContent');
  });

  it('converts alignItems → counterAxisAlignItems', () => {
    expect(normalizeProps({ alignItems: 'center' })).toMatchObject({ counterAxisAlignItems: 'CENTER' });
    expect(normalizeProps({ alignItems: 'flex-end' })).toMatchObject({ counterAxisAlignItems: 'MAX' });
    expect(normalizeProps({ alignItems: 'center' })).not.toHaveProperty('alignItems');
  });

  it('converts width: "fill" → layoutSizingHorizontal', () => {
    const result = normalizeProps({ width: 'fill' });
    expect(result.layoutSizingHorizontal).toBe('FILL');
    expect(result).not.toHaveProperty('width');
  });

  it('converts text width="fill" → layoutSizingHorizontal + auto-fills textAutoResize on create', () => {
    const result = normalizeProps({ width: 'fill' }, { nodeType: 'TEXT', isCreate: true });
    expect(result.layoutSizingHorizontal).toBe('FILL');
    expect(result.textAutoResize).toBe('HEIGHT');
    expect(result).not.toHaveProperty('width');
  });

  it('converts text width="fill" → layoutSizingHorizontal without auto-fill on update', () => {
    const result = normalizeProps({ width: 'fill' }, { nodeType: 'TEXT' });
    expect(result.layoutSizingHorizontal).toBe('FILL');
    expect(result.textAutoResize).toBeUndefined();
    expect(result).not.toHaveProperty('width');
  });

  it('converts height: "hug" → layoutSizingVertical', () => {
    const result = normalizeProps({ height: 'hug' });
    expect(result.layoutSizingVertical).toBe('HUG');
    expect(result).not.toHaveProperty('height');
  });

  it('converts text height="hug" → layoutSizingVertical + auto-fills textAutoResize on create', () => {
    const result = normalizeProps({ height: 'hug' }, { nodeType: 'TEXT', isCreate: true });
    expect(result.layoutSizingVertical).toBe('HUG');
    expect(result.textAutoResize).toBe('WIDTH_AND_HEIGHT');
    expect(result).not.toHaveProperty('height');
  });

  it('converts width: "100%" → layoutSizingHorizontal: FILL', () => {
    const result = normalizeProps({ width: '100%' });
    expect(result.layoutSizingHorizontal).toBe('FILL');
    expect(result).not.toHaveProperty('width');
  });

  it('keeps numeric width untouched', () => {
    const result = normalizeProps({ width: 320 });
    expect(result.width).toBe(320);
  });

  it('converts background → fills', () => {
    expect(normalizeProps({ background: '#FFF' })).toMatchObject({ fills: ['#FFF'] });
    expect(normalizeProps({ background: 'transparent' })).toMatchObject({ fills: [] });
    expect(normalizeProps({ background: '#FFF' })).not.toHaveProperty('background');
  });

  it('converts gap → itemSpacing', () => {
    const result = normalizeProps({ gap: 16 });
    expect(result.itemSpacing).toBe(16);
    expect(result).not.toHaveProperty('gap');
  });

  it('converts borderRadius → cornerRadius', () => {
    const result = normalizeProps({ borderRadius: 8 });
    expect(result.cornerRadius).toBe(8);
    expect(result).not.toHaveProperty('borderRadius');
  });

  it('converts clipsContent string → boolean', () => {
    expect(normalizeProps({ clipsContent: 'hidden' }).clipsContent).toBe(true);
    expect(normalizeProps({ clipsContent: 'visible' }).clipsContent).toBe(false);
  });

  it('converts layoutWrap values', () => {
    expect(normalizeProps({ layoutWrap: 'wrap' }).layoutWrap).toBe('WRAP');
    expect(normalizeProps({ layoutWrap: 'nowrap' }).layoutWrap).toBe('NO_WRAP');
  });

  it('passes through Figma-native properties unchanged', () => {
    const native = { layoutMode: 'VERTICAL', primaryAxisAlignItems: 'CENTER' };
    expect(normalizeProps(native)).toEqual(native);
  });

  it('does not mutate input', () => {
    const input = { layout: 'row', width: 'fill' };
    const copy = { ...input };
    normalizeProps(input);
    expect(input).toEqual(copy);
  });
});
