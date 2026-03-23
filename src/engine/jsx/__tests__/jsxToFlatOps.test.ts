import { describe, it, expect } from 'vitest';
import { jsxToFlatOps } from '../jsxToFlatOps';
import type { JsxNode } from '../jsxParser';

function node(
  tag: string,
  attrs: Record<string, string | number> = {},
  children: JsxNode[] = [],
  textContent?: string,
): JsxNode {
  return { tag, attrs, children, line: 1, ...(textContent !== undefined ? { textContent } : {}) };
}

describe('jsxToFlatOps', () => {
  it('generates single frame', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Card', w: 400, layout: 'column' }),
    ]);
    expect(result).toContain("name:'Card'");
    expect(result).toContain("w:400");
    expect(result).toContain("layout:'column'");
    // Should inject h:hug because layout is present
    expect(result).toContain("h:'hug'");
  });

  it('generates parent-child with correct symbol reference', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Card' }, [
        node('text', { name: 'Title', size: 24 }, [], 'Hello'),
      ]),
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    // Parent is n1, child references n1
    expect(lines[0]).toMatch(/^n1 = frame\(root,/);
    expect(lines[1]).toMatch(/^n2 = text\(n1,/);
    expect(lines[1]).toContain("'Hello'");
  });

  it('generates text content as third arg', () => {
    const result = jsxToFlatOps([
      node('text', { name: 'Label', size: 16 }, [], 'Click me'),
    ]);
    expect(result).toContain("text(root, {name:'Label', size:16}, 'Click me')");
  });

  it('generates instance with ref syntax', () => {
    const result = jsxToFlatOps([
      node('instance', { ref: 'Button', variant: 'Size=Large', name: 'CTA' }),
    ]);
    expect(result).toContain("ref('Button', root,");
    expect(result).toContain("variant:'Size=Large'");
    expect(result).toContain("name:'CTA'");
  });

  it('injects layout defaults for frames with layout', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Row', layout: 'row', gap: 12 }),
    ]);
    // Should inject w:hug and h:hug since layout is present but no explicit sizing
    expect(result).toContain("h:'hug'");
    expect(result).toContain("w:'hug'");
  });

  it('does not inject layout defaults when explicit sizing is present', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Full', layout: 'column', w: 'fill', h: 'fill' }),
    ]);
    // Count occurrences — should not have extra hug injected
    const hugMatches = result.match(/hug/g);
    expect(hugMatches).toBeNull();
  });

  it('handles multiple roots', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'A' }),
      node('frame', { name: 'B' }),
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("frame(root,");
    expect(lines[1]).toContain("frame(root,");
  });

  it('generates deep nesting with correct parent refs', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'L1' }, [
        node('frame', { name: 'L2' }, [
          node('text', { name: 'L3' }, [], 'Deep'),
        ]),
      ]),
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^n1 = frame\(root,/);
    expect(lines[1]).toMatch(/^n2 = frame\(n1,/);
    expect(lines[2]).toMatch(/^n3 = text\(n2,.*'Deep'/);
  });

  it('uses tag as default name when no name attr', () => {
    const result = jsxToFlatOps([
      node('rect', { w: 100, h: 1 }),
    ]);
    expect(result).toContain("name:'rect'");
  });

  it('escapes quotes in text content', () => {
    const result = jsxToFlatOps([
      node('text', { name: 'Quote' }, [], "It's a test"),
    ]);
    expect(result).toContain("It\\'s a test");
  });

  it('escapes quotes in name attribute', () => {
    const result = jsxToFlatOps([
      node('frame', { name: "Card's Header" }),
    ]);
    expect(result).toContain("name:'Card\\'s Header'");
  });

  it('handles empty roots array', () => {
    const result = jsxToFlatOps([]);
    expect(result).toBe('');
  });

  it('converts children mt to parent gap', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Card', layout: 'column', p: 32 }, [
        node('text', { name: 'Title' }, [], 'Title'),
        node('text', { name: 'Subtitle', mt: 8 }, [], 'Sub'),
        node('frame', { name: 'Input1', mt: 24 }),
        node('frame', { name: 'Input2', mt: 16 }),
        node('frame', { name: 'Button', mt: 24 }),
      ]),
    ]);
    // Parent should get gap:24 (mode of [8, 24, 16, 24])
    expect(result).toContain('gap:24');
    // Children should NOT have mt
    expect(result).not.toContain('mt:');
  });

  it('does not override explicit gap with mt conversion', () => {
    const result = jsxToFlatOps([
      node('frame', { name: 'Card', layout: 'column', gap: 12 }, [
        node('text', { name: 'A', mt: 24 }, [], 'A'),
        node('text', { name: 'B', mt: 24 }, [], 'B'),
      ]),
    ]);
    // Explicit gap preserved
    expect(result).toContain('gap:12');
    // mt NOT converted (gap already set)
    expect(result).toContain('mt:24');
  });
});
