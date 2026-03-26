import { describe, it, expect } from 'vitest';
import { jsxToIR } from '../jsxToIR';
import type { JsxNode } from '../jsxParser';

function node(
  tag: string,
  attrs: Record<string, any> = {},
  children: JsxNode[] = [],
  textContent?: string,
): JsxNode {
  return { tag, attrs, children, line: 1, ...(textContent !== undefined ? { textContent } : {}) };
}

describe('jsxToIR', () => {
  it('generates single frame with correct OperationIR', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Card', w: 400, layout: 'column' }),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('create');
    expect(ops[0].nodeType).toBe('FRAME');
    expect(ops[0].symbol).toBe('n1');
    expect(ops[0].parentRef).toBe('root');
    expect(ops[0].props.name).toBe('Card');
    expect(ops[0].props.width).toBe(400);
    expect(ops[0].props.layoutMode).toBe('VERTICAL');
    // Only h:hug injected (w:400 is explicit), so only vertical gets HUG
    expect(ops[0].props.layoutSizingVertical).toBe('HUG');
    // w:400 → width:400, no layoutSizingHorizontal override
    expect(ops[0].props.layoutSizingHorizontal).toBeUndefined();
  });

  it('generates parent-child with correct symbol references', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Card' }, [
        node('text', { name: 'Title', size: 24 }, [], 'Hello'),
      ]),
    ]);
    expect(ops).toHaveLength(2);
    // Parent
    expect(ops[0].symbol).toBe('n1');
    expect(ops[0].parentRef).toBe('root');
    // Child references parent
    expect(ops[1].symbol).toBe('n2');
    expect(ops[1].parentRef).toBe('n1');
    expect(ops[1].dependsOn).toEqual(['n1']);
    expect(ops[1].props.characters).toBe('Hello');
  });

  it('generates text node with characters', () => {
    const { ops } = jsxToIR([
      node('text', { name: 'Label', size: 16 }, [], 'Click me'),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('create');
    expect(ops[0].nodeType).toBe('TEXT');
    expect(ops[0].props.characters).toBe('Click me');
    expect(ops[0].props.fontSize).toBe(16);
  });

  it('generates instance with ref and variant', () => {
    const { ops } = jsxToIR([
      node('instance', { ref: 'Button', variant: 'Size=Large', name: 'CTA' }),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('instance');
    expect(ops[0].componentRef).toBe('Button');
    expect(ops[0].variantSelector).toBe('Size=Large');
    expect(ops[0].props.name).toBe('CTA');
  });

  it('injects layout defaults for frames with layout', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Row', layout: 'row', gap: 12 }),
    ]);
    // Should inject hug sizing since layout is present but no explicit sizing
    expect(ops[0].props.layoutSizingHorizontal).toBe('HUG');
    expect(ops[0].props.layoutSizingVertical).toBe('HUG');
  });

  it('does not inject layout defaults when explicit sizing is present', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Full', layout: 'column', w: 'fill', h: 'fill' }),
    ]);
    expect(ops[0].props.layoutSizingHorizontal).toBe('FILL');
    expect(ops[0].props.layoutSizingVertical).toBe('FILL');
  });

  it('handles multiple roots', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'A' }),
      node('frame', { name: 'B' }),
    ]);
    expect(ops).toHaveLength(2);
    expect(ops[0].parentRef).toBe('root');
    expect(ops[1].parentRef).toBe('root');
    expect(ops[0].symbol).toBe('n1');
    expect(ops[1].symbol).toBe('n2');
  });

  it('generates deep nesting with correct parent refs', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'L1' }, [
        node('frame', { name: 'L2' }, [
          node('text', { name: 'L3' }, [], 'Deep'),
        ]),
      ]),
    ]);
    expect(ops).toHaveLength(3);
    expect(ops[0].symbol).toBe('n1');
    expect(ops[0].parentRef).toBe('root');
    expect(ops[1].symbol).toBe('n2');
    expect(ops[1].parentRef).toBe('n1');
    expect(ops[2].symbol).toBe('n3');
    expect(ops[2].parentRef).toBe('n2');
    expect(ops[2].props.characters).toBe('Deep');
  });

  it('uses tag as default name when no name attr', () => {
    const { ops } = jsxToIR([
      node('rect', { w: 100, h: 1 }),
    ]);
    expect(ops[0].props.name).toBe('rect');
  });

  it('handles empty roots array', () => {
    const { ops } = jsxToIR([]);
    expect(ops).toHaveLength(0);
  });

  it('converts children mt to parent gap', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Card', layout: 'column', p: 32 }, [
        node('text', { name: 'Title' }, [], 'Title'),
        node('text', { name: 'Subtitle', mt: 8 }, [], 'Sub'),
        node('frame', { name: 'Input1', mt: 24 }),
        node('frame', { name: 'Input2', mt: 16 }),
        node('frame', { name: 'Button', mt: 24 }),
      ]),
    ]);
    // Parent should get gap → itemSpacing (via normalizeProps)
    expect(ops[0].props.itemSpacing).toBe(24);
    // Children should NOT have mt in their props
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i].props.mt).toBeUndefined();
      expect(ops[i].props.marginTop).toBeUndefined();
    }
  });

  it('does not override explicit gap with mt conversion', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Card', layout: 'column', gap: 12 }, [
        node('text', { name: 'A', mt: 24 }, [], 'A'),
        node('text', { name: 'B', mt: 24 }, [], 'B'),
      ]),
    ]);
    // Explicit gap preserved
    expect(ops[0].props.itemSpacing).toBe(12);
  });

  it('expands object-valued padding', () => {
    const { ops } = jsxToIR([
      node('frame', { name: 'Card', p: { top: 12, right: 16, bottom: 12, left: 16 } }),
    ]);
    expect(ops[0].props.paddingTop).toBe(12);
    expect(ops[0].props.paddingRight).toBe(16);
    expect(ops[0].props.paddingBottom).toBe(12);
    expect(ops[0].props.paddingLeft).toBe(16);
  });

  it('produces icon command with iconName', () => {
    const { ops } = jsxToIR([
      node('icon', { name: 'Search', size: 24 }, [], 'lucide:search'),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('icon');
    // Icon name comes from textContent
    expect(ops[0].props.iconName).toBe('lucide:search');
    // size → width + height for icons
    expect(ops[0].props.width).toBe(24);
    expect(ops[0].props.height).toBe(24);
  });

  it('handles component tag as reusable frame', () => {
    const { ops } = jsxToIR([
      node('component', { name: 'Card', layout: 'column' }, [
        node('text', { name: 'Title' }, [], 'Card Title'),
      ]),
    ]);
    expect(ops[0].command).toBe('create');
    expect(ops[0].reusable).toBe(true);
    expect(ops[0].nodeType).toBe('FRAME');
  });

  it('handles image tag', () => {
    const { ops } = jsxToIR([
      node('image', { name: 'Hero', w: 400, h: 200 }),
    ]);
    expect(ops[0].command).toBe('image');
  });

  it('handles instance set: overrides', () => {
    const { ops } = jsxToIR([
      node('instance', { ref: 'Card', 'set:Title': 'New Title', 'set:Body': 'New body' }),
    ]);
    expect(ops[0].command).toBe('instance');
    expect(ops[0].overrides).toEqual({
      Title: { characters: 'New Title' },
      Body: { characters: 'New body' },
    });
  });

  // ── Equivalence with old path ──

  it('produces same symbol count as old jsxToFlatOps path', () => {
    const tree = [
      node('frame', { name: 'Card', layout: 'column' }, [
        node('text', { name: 'Title' }, [], 'Hello'),
        node('frame', { name: 'Body' }, [
          node('rect', { name: 'Divider', w: 'fill', h: 1 }),
          node('text', { name: 'Content' }, [], 'World'),
        ]),
      ]),
    ];
    const { ops } = jsxToIR(tree);
    // DFS order: Card(n1) → Title(n2) → Body(n3) → Divider(n4) → Content(n5)
    expect(ops).toHaveLength(5);
    expect(ops.map(o => o.symbol)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(ops.map(o => o.parentRef)).toEqual(['root', 'n1', 'n1', 'n3', 'n3']);
  });
});
