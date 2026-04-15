/**
 * @file templateFunctions.test.ts
 * @description P0 tests for all template functions — pure logic, no Figma deps.
 */

import { describe, it, expect } from 'vitest';
import {
  // Layer 1: Constants
  Frame, Text, Rectangle, Rect, Ellipse, Line, Star, Polygon,
  Vector, Group, Section, Component, Instance,
  BooleanOperation, ComponentSet, Icon, Image,
  // Layer 2: Compute
  hexToRgb, rgb, solid, gradient, shadow, blur, bgblur,
  cssAngleToGradientTransform,
  // Layer 3: Design shortcuts
  col, row, pad, sizeFill, sizeHug, fillH, fillV, hugH, hugV, align,
  // Export map
  TEMPLATE_BINDINGS, TEMPLATE_BINDING_NAMES, TEMPLATE_BINDING_VALUES,
} from '../templateFunctions';
import {
  cssAngleToGradientTransform as originalTransform,
} from '../../../domain/gradient-parser';

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Node Type Constants
// ═══════════════════════════════════════════════════════════════════════════

describe('Layer 1: Node Type Constants', () => {
  it('maps to correct Figma types', () => {
    expect(Frame).toBe('FRAME');
    expect(Text).toBe('TEXT');
    expect(Rectangle).toBe('RECTANGLE');
    expect(Rect).toBe('RECTANGLE');
    expect(Ellipse).toBe('ELLIPSE');
    expect(Line).toBe('LINE');
    expect(Star).toBe('STAR');
    expect(Polygon).toBe('POLYGON');
    expect(Vector).toBe('VECTOR');
    expect(Group).toBe('GROUP');
    expect(Section).toBe('SECTION');
    expect(Component).toBe('COMPONENT');
    expect(Instance).toBe('INSTANCE');
    expect(BooleanOperation).toBe('BOOLEAN_OPERATION');
    expect(ComponentSet).toBe('COMPONENT_SET');
    expect(Icon).toBe('ICON');
    expect(Image).toBe('IMAGE');
  });

  it('Rect is an alias for Rectangle', () => {
    expect(Rect).toBe(Rectangle);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Compute Functions
// ═══════════════════════════════════════════════════════════════════════════

describe('Layer 2: hexToRgb', () => {
  it('converts 6-digit hex to 0-1 RGB', () => {
    const c = hexToRgb('#FF0000');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });

  it('converts 3-digit hex', () => {
    const c = hexToRgb('#FFF');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
  });

  it('converts black', () => {
    const c = hexToRgb('#000000');
    expect(c.r).toBeCloseTo(0);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });
});

describe('Layer 2: rgb', () => {
  it('converts 0-255 to 0-1', () => {
    const c = rgb(255, 128, 0);
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(128 / 255);
    expect(c.b).toBeCloseTo(0);
    expect(c.a).toBe(1);
  });

  it('supports alpha', () => {
    const c = rgb(255, 0, 0, 0.5);
    expect(c.r).toBeCloseTo(1);
    expect(c.a).toBe(0.5);
  });
});

describe('Layer 2: solid', () => {
  it('creates a SOLID paint from hex', () => {
    const p = solid('#FF0000');
    expect(p.type).toBe('SOLID');
    expect(p.color.r).toBeCloseTo(1);
    expect(p.color.g).toBeCloseTo(0);
    expect(p.color.b).toBeCloseTo(0);
    expect(p.opacity).toBe(1);
  });

  it('extracts alpha from 8-digit hex', () => {
    const p = solid('#FF000080');
    expect(p.opacity).toBeCloseTo(128 / 255);
  });

  it('applies opacity option', () => {
    const p = solid('#FF0000', { opacity: 0.5 });
    expect(p.opacity).toBe(0.5);
  });

  it('applies blendMode option', () => {
    const p = solid('#FF0000', { blendMode: 'MULTIPLY' });
    expect(p.blendMode).toBe('MULTIPLY');
  });

  it('applies visible option', () => {
    const p = solid('#FF0000', { visible: false });
    expect(p.visible).toBe(false);
  });
});

describe('Layer 2: gradient', () => {
  it('creates a linear gradient with tuple stops', () => {
    const g = gradient(135, ['#667eea', 0], ['#764ba2', 1]);
    expect(g.type).toBe('GRADIENT_LINEAR');
    expect(g.gradientStops).toHaveLength(2);
    expect(g.gradientStops[0].position).toBe(0);
    expect(g.gradientStops[1].position).toBe(1);
  });

  it('auto-distributes positions for string stops', () => {
    const g = gradient(90, '#FF0000', '#00FF00', '#0000FF');
    expect(g.gradientStops).toHaveLength(3);
    expect(g.gradientStops[0].position).toBeCloseTo(0);
    expect(g.gradientStops[1].position).toBeCloseTo(0.5);
    expect(g.gradientStops[2].position).toBeCloseTo(1);
  });

  it('handles 2 auto-distributed stops', () => {
    const g = gradient(180, '#000', '#FFF');
    expect(g.gradientStops[0].position).toBeCloseTo(0);
    expect(g.gradientStops[1].position).toBeCloseTo(1);
  });

  it('returns empty stops for < 2 stops', () => {
    const g = gradient(0, '#FF0000');
    expect(g.gradientStops).toHaveLength(0);
  });

  it('includes gradientTransform matrix', () => {
    const g = gradient(135, '#000', '#FFF');
    expect(g.gradientTransform).toHaveLength(2);
    expect(g.gradientTransform[0]).toHaveLength(3);
    expect(g.gradientTransform[1]).toHaveLength(3);
  });
});

describe('Layer 2: gradient transform equivalence', () => {
  it('matches original gradient-parser at 0deg', () => {
    const ported = cssAngleToGradientTransform(0);
    const original = originalTransform(0);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });

  it('matches original at 90deg', () => {
    const ported = cssAngleToGradientTransform(90);
    const original = originalTransform(90);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });

  it('matches original at 135deg', () => {
    const ported = cssAngleToGradientTransform(135);
    const original = originalTransform(135);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });

  it('matches original at 180deg', () => {
    const ported = cssAngleToGradientTransform(180);
    const original = originalTransform(180);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });

  it('matches original at 270deg', () => {
    const ported = cssAngleToGradientTransform(270);
    const original = originalTransform(270);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });

  it('matches original at 45deg', () => {
    const ported = cssAngleToGradientTransform(45);
    const original = originalTransform(45);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++)
        expect(ported[i][j]).toBeCloseTo(original[i][j], 10);
  });
});

describe('Layer 2: shadow', () => {
  it('creates a DROP_SHADOW', () => {
    const s = shadow(0, 4, 24, 0, '#0000001A');
    expect(s.type).toBe('DROP_SHADOW');
    expect(s.offset).toEqual({ x: 0, y: 4 });
    expect(s.radius).toBe(24);
    expect(s.spread).toBe(0);
    expect(s.visible).toBe(true);
    expect(s.blendMode).toBe('NORMAL');
  });

  it('creates INNER_SHADOW with inset option', () => {
    const s = shadow(0, 2, 8, 0, '#000000', { type: 'inset' });
    expect(s.type).toBe('INNER_SHADOW');
  });

  it('applies blendMode option', () => {
    const s = shadow(0, 0, 10, 0, '#000', { blendMode: 'MULTIPLY' });
    expect(s.blendMode).toBe('MULTIPLY');
  });

  it('parses shadow color correctly', () => {
    const s = shadow(0, 4, 8, 0, '#FF0000');
    expect(s.color.r).toBeCloseTo(1);
    expect(s.color.g).toBeCloseTo(0);
  });
});

describe('Layer 2: blur / bgblur', () => {
  it('blur creates LAYER_BLUR', () => {
    const b = blur(10);
    expect(b).toEqual({ type: 'LAYER_BLUR', radius: 10, visible: true });
  });

  it('bgblur creates BACKGROUND_BLUR', () => {
    const b = bgblur(20);
    expect(b).toEqual({ type: 'BACKGROUND_BLUR', radius: 20, visible: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Design Shortcuts
// ═══════════════════════════════════════════════════════════════════════════

describe('Layer 3: col / row', () => {
  it('col() sets VERTICAL layout', () => {
    expect(col()).toEqual({ layoutMode: 'VERTICAL' });
  });

  it('col(16) sets gap', () => {
    expect(col(16)).toEqual({ layoutMode: 'VERTICAL', itemSpacing: 16 });
  });

  it('row() sets HORIZONTAL layout', () => {
    expect(row()).toEqual({ layoutMode: 'HORIZONTAL' });
  });

  it('row(8) sets gap', () => {
    expect(row(8)).toEqual({ layoutMode: 'HORIZONTAL', itemSpacing: 8 });
  });

  it('col(0) sets gap to 0', () => {
    expect(col(0)).toEqual({ layoutMode: 'VERTICAL', itemSpacing: 0 });
  });
});

describe('Layer 3: pad', () => {
  it('pad(16) → all sides equal', () => {
    expect(pad(16)).toEqual({
      paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
    });
  });

  it('pad(12, 16) → vertical, horizontal', () => {
    expect(pad(12, 16)).toEqual({
      paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16,
    });
  });

  it('pad(10, 20, 30) → CSS 3-value', () => {
    expect(pad(10, 20, 30)).toEqual({
      paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 20,
    });
  });

  it('pad(10, 20, 30, 40) → all 4 sides', () => {
    expect(pad(10, 20, 30, 40)).toEqual({
      paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 40,
    });
  });
});

describe('Layer 3: sizing', () => {
  it('sizeFill → both FILL', () => {
    expect(sizeFill()).toEqual({
      layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FILL',
    });
  });

  it('sizeHug → both HUG', () => {
    expect(sizeHug()).toEqual({
      layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG',
    });
  });

  it('fillH → horizontal FILL', () => {
    expect(fillH()).toEqual({ layoutSizingHorizontal: 'FILL' });
  });

  it('fillV → vertical FILL', () => {
    expect(fillV()).toEqual({ layoutSizingVertical: 'FILL' });
  });

  it('hugH → horizontal HUG', () => {
    expect(hugH()).toEqual({ layoutSizingHorizontal: 'HUG' });
  });

  it('hugV → vertical HUG', () => {
    expect(hugV()).toEqual({ layoutSizingVertical: 'HUG' });
  });
});

describe('Layer 3: align', () => {
  it('align("center") → cross-axis only', () => {
    expect(align('center')).toEqual({ counterAxisAlignItems: 'CENTER' });
  });

  it('align("start") → MIN', () => {
    expect(align('start')).toEqual({ counterAxisAlignItems: 'MIN' });
  });

  it('align("end") → MAX', () => {
    expect(align('end')).toEqual({ counterAxisAlignItems: 'MAX' });
  });

  it('align("center", "center") → both axes', () => {
    expect(align('center', 'center')).toEqual({
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    });
  });

  it('align("between", "center") → main + cross', () => {
    expect(align('between', 'center')).toEqual({
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
    });
  });

  it('align("baseline") → BASELINE', () => {
    expect(align('baseline')).toEqual({ counterAxisAlignItems: 'BASELINE' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: Spread usage patterns
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: spread patterns', () => {
  it('col + pad spread merges correctly', () => {
    const props = { ...col(16), ...pad(24) };
    expect(props.layoutMode).toBe('VERTICAL');
    expect(props.itemSpacing).toBe(16);
    expect(props.paddingTop).toBe(24);
    expect(props.paddingRight).toBe(24);
  });

  it('row + align spread', () => {
    const props = { ...row(8), ...align('center') };
    expect(props.layoutMode).toBe('HORIZONTAL');
    expect(props.counterAxisAlignItems).toBe('CENTER');
  });

  it('col + fillH + pad', () => {
    const props = { ...col(12), ...fillH(), ...pad(16, 24) };
    expect(props.layoutMode).toBe('VERTICAL');
    expect(props.layoutSizingHorizontal).toBe('FILL');
    expect(props.paddingTop).toBe(16);
    expect(props.paddingRight).toBe(24);
  });

  it('later spread overrides earlier', () => {
    const props = { ...sizeHug(), ...fillH() };
    expect(props.layoutSizingHorizontal).toBe('FILL');
    expect(props.layoutSizingVertical).toBe('HUG');
  });

  it('explicit prop overrides spread', () => {
    const props = { ...col(16), itemSpacing: 24 };
    expect(props.itemSpacing).toBe(24);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Export Map
// ═══════════════════════════════════════════════════════════════════════════

describe('TEMPLATE_BINDINGS', () => {
  it('names and values arrays have same length', () => {
    expect(TEMPLATE_BINDING_NAMES.length).toBe(TEMPLATE_BINDING_VALUES.length);
  });

  it('includes all node type constants', () => {
    expect(TEMPLATE_BINDINGS.Frame).toBe('FRAME');
    expect(TEMPLATE_BINDINGS.Text).toBe('TEXT');
    expect(TEMPLATE_BINDINGS.Rect).toBe('RECTANGLE');
  });

  it('includes all compute functions', () => {
    expect(typeof TEMPLATE_BINDINGS.solid).toBe('function');
    expect(typeof TEMPLATE_BINDINGS.gradient).toBe('function');
    expect(typeof TEMPLATE_BINDINGS.shadow).toBe('function');
  });

  it('includes all shortcuts', () => {
    expect(typeof TEMPLATE_BINDINGS.col).toBe('function');
    expect(typeof TEMPLATE_BINDINGS.row).toBe('function');
    expect(typeof TEMPLATE_BINDINGS.pad).toBe('function');
    expect(typeof TEMPLATE_BINDINGS.align).toBe('function');
  });
});
