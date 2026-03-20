import { describe, it, expect } from 'vitest';
import { nodesToFlatOps, type CreateNode } from '../nodesToFlatOps';

function n(tag: string, name: string, extra: Record<string, any> = {}): CreateNode {
  return { tag, name, ...extra };
}

describe('nodesToFlatOps', () => {
  it('single root frame', () => {
    const result = nodesToFlatOps([n('frame', 'Card', { w: 400, layout: 'column' })]);
    expect(result).toContain("n1 = frame(root,");
    expect(result).toContain("name:'Card'");
    expect(result).toContain("w:400");
    expect(result).toContain("layout:'column'");
  });

  it('parent-child by name reference', () => {
    const result = nodesToFlatOps([
      n('frame', 'Card', { w: 400 }),
      n('text', 'Title', { parent: 'Card', size: 24, content: 'Hello' }),
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^n1 = frame\(root,/);
    expect(lines[1]).toMatch(/^n2 = text\(n1,/);
    expect(lines[1]).toContain("'Hello'");
  });

  it('multi-level nesting', () => {
    const result = nodesToFlatOps([
      n('frame', 'Card'),
      n('frame', 'Header', { parent: 'Card', layout: 'row' }),
      n('text', 'Title', { parent: 'Header', size: 18, content: 'Name' }),
    ]);
    const lines = result.split('\n');
    expect(lines[0]).toMatch(/frame\(root,/);
    expect(lines[1]).toMatch(/frame\(n1,/);
    expect(lines[2]).toMatch(/text\(n2,/);
  });

  it('unresolved parent falls back to root', () => {
    const result = nodesToFlatOps([
      n('text', 'Orphan', { parent: 'NonExistent', size: 14, content: 'Lost' }),
    ]);
    expect(result).toContain("text(root,");
  });

  it('multiple roots (no parent)', () => {
    const result = nodesToFlatOps([
      n('frame', 'A', { w: 100 }),
      n('frame', 'B', { w: 200 }),
    ]);
    const lines = result.split('\n');
    expect(lines[0]).toContain("frame(root,");
    expect(lines[1]).toContain("frame(root,");
  });

  it('instance with ref', () => {
    const result = nodesToFlatOps([
      n('instance', 'CTA', { ref: 'Button', variant: 'Size=Large' }),
    ]);
    expect(result).toContain("ref('Button', root,");
    expect(result).toContain("variant:'Size=Large'");
  });

  it('icon with content', () => {
    const result = nodesToFlatOps([
      n('icon', 'ArrowIcon', { content: 'lucide:arrow-right', size: 24 }),
    ]);
    expect(result).toContain("icon(root,");
    expect(result).toContain("'lucide:arrow-right'");
  });

  it('injects layout defaults', () => {
    const result = nodesToFlatOps([
      n('frame', 'Row', { layout: 'row', gap: 12 }),
    ]);
    expect(result).toContain("h:'hug'");
    expect(result).toContain("w:'hug'");
  });

  it('does not inject defaults when explicit sizing', () => {
    const result = nodesToFlatOps([
      n('frame', 'Full', { layout: 'column', w: 'fill', h: 'fill' }),
    ]);
    const hugMatches = result.match(/hug/g);
    expect(hugMatches).toBeNull();
  });

  it('escapes quotes in content', () => {
    const result = nodesToFlatOps([
      n('text', 'Quote', { content: "It's a test" }),
    ]);
    expect(result).toContain("It\\'s a test");
  });

  it('last-write-wins for duplicate names', () => {
    const result = nodesToFlatOps([
      n('frame', 'Section', { w: 100 }),
      n('frame', 'Section', { w: 200 }),
      n('text', 'Child', { parent: 'Section', content: 'Hi' }),
    ]);
    // Child should reference the SECOND Section (n2), not the first
    const lines = result.split('\n');
    expect(lines[2]).toMatch(/text\(n2,/);
  });

  it('empty array returns empty string', () => {
    expect(nodesToFlatOps([])).toBe('');
  });

  it('reserved keys not passed as props', () => {
    const result = nodesToFlatOps([
      n('frame', 'Card', { parent: 'root', content: 'ignored', ref: 'ignored', variant: 'ignored', w: 400 }),
    ]);
    expect(result).not.toContain("parent:");
    expect(result).not.toContain("content:");
    expect(result).not.toContain("ref:'ignored'");
    expect(result).toContain("w:400");
  });
});
