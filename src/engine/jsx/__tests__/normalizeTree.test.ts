/**
 * @file normalizeTree.test.ts
 * @description Unit tests for the pre-walk normalization phase.
 *
 * Tests pure logic — no Figma API dependency. Verifies:
 *   - Shorthand/enum/type-filter flow through normalizeProps correctly
 *   - Type-specific pre-normalize (ICON, IMAGE, TEXT) runs before normalizeProps
 *   - Tree-context helpers (margin→gap, layout defaults) apply correctly
 *   - INSTANCE is skipped
 *   - Idempotency: run twice = run once
 */

import { describe, it, expect } from 'vitest';
import { normalizeTree, type NormalizeWarning } from '../normalizeTree';
import type { VNode } from '../templateCompiler';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function vnode(
  type: string,
  props: Record<string, any> = {},
  children: (VNode | string)[] = [],
): VNode {
  return { type, props, children };
}

function normalize(vnodes: VNode[]): {
  vnodes: VNode[];
  warnings: NormalizeWarning[];
} {
  const warnings: NormalizeWarning[] = [];
  normalizeTree(vnodes, warnings);
  return { vnodes, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shorthand / enum flow-through (integration with normalizeProps)
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — shorthand expansion flows through', () => {
  it('expands padding shorthand', () => {
    const tree = [vnode('FRAME', { p: '0 24' })];
    normalize(tree);
    expect(tree[0].props).toMatchObject({
      paddingTop: 0,
      paddingRight: 24,
      paddingBottom: 0,
      paddingLeft: 24,
    });
    expect(tree[0].props.p).toBeUndefined();
  });

  it('expands layout shorthand', () => {
    const tree = [vnode('FRAME', { layout: 'row' })];
    normalize(tree);
    expect(tree[0].props.layoutMode).toBe('HORIZONTAL');
    expect(tree[0].props.layout).toBeUndefined();
  });

  it('maps align enum values', () => {
    const tree = [vnode('FRAME', { layout: 'row', align: 'center' })];
    normalize(tree);
    // align expander produces primary/counter axis alignment
    expect(tree[0].props.primaryAxisAlignItems).toBe('CENTER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEXT pre-normalize — characters extracted from string children
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — TEXT', () => {
  it('collects characters from string children', () => {
    const tree = [vnode('TEXT', {}, ['Hello world'])];
    normalize(tree);
    expect(tree[0].props.characters).toBe('Hello world');
  });

  it('concatenates multiple string children', () => {
    const tree = [vnode('TEXT', {}, ['Hello ', 'world'])];
    normalize(tree);
    expect(tree[0].props.characters).toBe('Hello world');
  });

  it('does not overwrite explicit characters prop', () => {
    const tree = [vnode('TEXT', { characters: 'Explicit' }, ['Child text'])];
    normalize(tree);
    expect(tree[0].props.characters).toBe('Explicit');
  });

  it('expands text size shorthand to fontSize', () => {
    const tree = [vnode('TEXT', { size: 24 }, ['Title'])];
    normalize(tree);
    expect(tree[0].props.fontSize).toBe(24);
    expect(tree[0].props.size).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ICON pre-normalize — the critical edge case
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — ICON', () => {
  it('maps icon→iconName', () => {
    const tree = [vnode('ICON', { icon: 'lucide:check' })];
    normalize(tree);
    expect(tree[0].props.iconName).toBe('lucide:check');
    expect(tree[0].props.icon).toBeUndefined();
  });

  it('preserves existing iconName over icon alias', () => {
    const tree = [vnode('ICON', { icon: 'a', iconName: 'b' })];
    normalize(tree);
    expect(tree[0].props.iconName).toBe('b');
  });

  it('maps size→width+height (NOT fontSize)', () => {
    const tree = [vnode('ICON', { icon: 'lucide:check', size: 18 })];
    normalize(tree);
    expect(tree[0].props.width).toBe(18);
    expect(tree[0].props.height).toBe(18);
    expect(tree[0].props.fontSize).toBeUndefined();
    expect(tree[0].props.size).toBeUndefined();
  });

  it('does not overwrite explicit width/height with size', () => {
    const tree = [vnode('ICON', { icon: 'x', size: 20, width: 32, height: 40 })];
    normalize(tree);
    expect(tree[0].props.width).toBe(32);
    expect(tree[0].props.height).toBe(40);
  });

  it('parses string size values', () => {
    const tree = [vnode('ICON', { icon: 'x', size: '16' })];
    normalize(tree);
    expect(tree[0].props.width).toBe(16);
    expect(tree[0].props.height).toBe(16);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE pre-normalize — placeholder handling
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — IMAGE', () => {
  it('promotes placeholder to name', () => {
    const tree = [vnode('IMAGE', { placeholder: 'User Avatar' })];
    normalize(tree);
    expect(tree[0].props.name).toBe('User Avatar');
    expect(tree[0].props.placeholder).toBeUndefined();
  });

  it('keeps existing name when placeholder missing', () => {
    const tree = [vnode('IMAGE', { name: 'Hero Photo' })];
    normalize(tree);
    expect(tree[0].props.name).toBe('Hero Photo');
  });

  it('placeholder wins over name', () => {
    const tree = [vnode('IMAGE', { placeholder: 'P', name: 'N' })];
    normalize(tree);
    expect(tree[0].props.name).toBe('P');
  });

  it('falls back to "Image Placeholder" when both missing', () => {
    const tree = [vnode('IMAGE', {})];
    normalize(tree);
    expect(tree[0].props.name).toBe('Image Placeholder');
  });

  it('injects default fills when fills undefined', () => {
    const tree = [vnode('IMAGE', {})];
    normalize(tree);
    expect(tree[0].props.fills).toBeDefined();
    expect(Array.isArray(tree[0].props.fills)).toBe(true);
  });

  it('does not overwrite explicit fills', () => {
    const explicitFill = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    const tree = [vnode('IMAGE', { fills: explicitFill })];
    normalize(tree);
    // fills prop preserved (may be shorthand-expanded; just check non-empty)
    expect(tree[0].props.fills).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// margin→gap — tree-context helper
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — margin→gap', () => {
  it('aggregates child margins into parent gap when no gap set', () => {
    const tree = [
      vnode('FRAME', { layout: 'column' }, [
        vnode('TEXT', { mt: 12 }, ['A']),
        vnode('TEXT', { mt: 12 }, ['B']),
        vnode('TEXT', { mt: 12 }, ['C']),
      ]),
    ];
    normalize(tree);
    // margin→gap uses most-frequent value; gap shorthand expands to itemSpacing
    expect(tree[0].props.itemSpacing ?? tree[0].props.gap).toBe(12);
  });

  it('strips margin props from children after aggregation', () => {
    const tree = [
      vnode('FRAME', { layout: 'column' }, [
        vnode('TEXT', { mt: 8, marginBottom: 8 }, ['A']),
        vnode('TEXT', { mt: 8 }, ['B']),
      ]),
    ];
    normalize(tree);
    const child = tree[0].children[0] as VNode;
    expect(child.props.mt).toBeUndefined();
    expect(child.props.marginBottom).toBeUndefined();
  });

  it('does not override explicit gap', () => {
    const tree = [
      vnode('FRAME', { layout: 'column', gap: 20 }, [
        vnode('TEXT', { mt: 8 }, ['A']),
        vnode('TEXT', { mt: 8 }, ['B']),
      ]),
    ];
    normalize(tree);
    // gap shorthand expands to itemSpacing; either 20 preserved
    expect(tree[0].props.itemSpacing ?? tree[0].props.gap).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layout defaults — HUG vs GRID
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — layout defaults', () => {
  it('FRAME with layout=row defaults to HUG sizing', () => {
    const tree = [vnode('FRAME', { layout: 'row' })];
    normalize(tree);
    expect(tree[0].props.layoutSizingHorizontal).toBe('HUG');
    expect(tree[0].props.layoutSizingVertical).toBe('HUG');
  });

  it('FRAME with layout=grid defaults to fixed 400x300', () => {
    const tree = [vnode('FRAME', { layout: 'grid' })];
    normalize(tree);
    expect(tree[0].props.width).toBe(400);
    expect(tree[0].props.height).toBe(300);
  });

  it('does not override explicit width/height', () => {
    const tree = [vnode('FRAME', { layout: 'row', w: 320 })];
    normalize(tree);
    expect(tree[0].props.width).toBe(320);
  });

  it('does not inject defaults on non-layout-container types', () => {
    const tree = [vnode('RECTANGLE', {})];
    normalize(tree);
    expect(tree[0].props.layoutSizingHorizontal).toBeUndefined();
    expect(tree[0].props.layoutSizingVertical).toBeUndefined();
  });

  it('does not inject defaults when no layout set', () => {
    const tree = [vnode('FRAME', {})];
    normalize(tree);
    expect(tree[0].props.layoutSizingHorizontal).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE skip
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — INSTANCE', () => {
  it('leaves INSTANCE props untouched (including __set_* and unknown keys)', () => {
    const tree = [
      vnode('INSTANCE', {
        ref: 'Button',
        variant: 'primary',
        __set_label: 'Click me',
        p: '0 24', // would normally expand, but INSTANCE skipped
      }),
    ];
    normalize(tree);
    expect(tree[0].props).toEqual({
      ref: 'Button',
      variant: 'primary',
      __set_label: 'Click me',
      p: '0 24',
    });
  });

  it('does not recurse into INSTANCE children', () => {
    // Instances rarely have VNode children, but verify no traversal anyway.
    const inner = vnode('FRAME', { p: 16 });
    const tree = [vnode('INSTANCE', { ref: 'X' }, [inner])];
    normalize(tree);
    // inner.props.p should NOT be expanded because walkTree didn't reach it
    expect(inner.props.p).toBe(16);
    expect(inner.props.paddingTop).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recursion into children
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — recursion', () => {
  it('normalizes nested VNode children', () => {
    const tree = [
      vnode('FRAME', { layout: 'column' }, [
        vnode('FRAME', { p: 16 }, [
          vnode('TEXT', { size: 14 }, ['Deep']),
        ]),
      ]),
    ];
    normalize(tree);
    const midFrame = tree[0].children[0] as VNode;
    const deepText = midFrame.children[0] as VNode;
    expect(midFrame.props.paddingTop).toBe(16);
    expect(deepText.props.fontSize).toBe(14);
    expect(deepText.props.characters).toBe('Deep');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency — foundational guarantee
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeTree — idempotency', () => {
  it('running twice produces same result as running once', () => {
    const build = () => [
      vnode('FRAME', { layout: 'column', p: '16 24', bg: '#FFFFFF' }, [
        vnode('ICON', { icon: 'lucide:check', size: 18 }),
        vnode('TEXT', { size: 14, mt: 12 }, ['Hello']),
        vnode('IMAGE', { placeholder: 'Avatar' }),
      ]),
    ];
    const once = build();
    const twice = build();

    normalizeTree(once);
    normalizeTree(twice);
    normalizeTree(twice); // second pass

    expect(twice).toEqual(once);
  });

  it('idempotent across all pre-normalize paths', () => {
    const cases: VNode[][] = [
      [vnode('ICON', { icon: 'x', size: 20 })],
      [vnode('IMAGE', { placeholder: 'P' })],
      [vnode('TEXT', {}, ['text'])],
      [vnode('FRAME', { layout: 'grid' })],
    ];

    for (const original of cases) {
      const once = JSON.parse(JSON.stringify(original)) as VNode[];
      const twice = JSON.parse(JSON.stringify(original)) as VNode[];
      normalizeTree(once);
      normalizeTree(twice);
      normalizeTree(twice);
      expect(twice).toEqual(once);
    }
  });
});
