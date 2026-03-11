import { describe, it, expect } from 'vitest';
import { parseXml, XmlParseError } from '../xmlDesignParser';

// ==========================================
// parseXml (pure syntax parser)
// ==========================================

describe('parseXml', () => {
  it('parses a self-closing tag', () => {
    const nodes = parseXml('<rect/>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('rect');
    expect(nodes[0].children).toHaveLength(0);
  });

  it('parses a self-closing tag with attributes', () => {
    const nodes = parseXml("<rect w='100' h='50' fill='#FFF'/>");
    expect(nodes[0].attrs).toEqual({ w: '100', h: '50', fill: '#FFF' });
  });

  it('parses nested elements', () => {
    const nodes = parseXml("<frame><text>Hello</text></frame>");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('frame');
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].tag).toBe('text');
    expect(nodes[0].children[0].textContent).toBe('Hello');
  });

  it('parses single-quoted attributes', () => {
    const nodes = parseXml("<frame name='Card' layout='column'/>");
    expect(nodes[0].attrs.name).toBe('Card');
    expect(nodes[0].attrs.layout).toBe('column');
  });

  it('parses double-quoted attributes', () => {
    const nodes = parseXml('<frame name="Card"/>');
    expect(nodes[0].attrs.name).toBe('Card');
  });

  it('handles XML entities', () => {
    const nodes = parseXml("<text>A &amp; B &lt; C &gt; D</text>");
    expect(nodes[0].textContent).toBe('A & B < C > D');
  });

  it('handles entity in attribute value', () => {
    const nodes = parseXml("<text name='Tom &amp; Jerry'/>");
    expect(nodes[0].attrs.name).toBe('Tom & Jerry');
  });

  it('parses multiple root nodes', () => {
    const nodes = parseXml("<rect/><text>Hi</text>");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].tag).toBe('rect');
    expect(nodes[1].tag).toBe('text');
  });

  it('skips XML comments', () => {
    const nodes = parseXml("<!-- comment --><frame/><!-- another -->");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('frame');
  });

  it('skips comments inside elements', () => {
    const nodes = parseXml("<frame><!-- skip me --><text>Hi</text></frame>");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].tag).toBe('text');
  });

  it('throws on empty XML', () => {
    expect(() => parseXml('')).toThrow(XmlParseError);
    expect(() => parseXml('   ')).toThrow(XmlParseError);
  });

  it('throws on mismatched tags', () => {
    expect(() => parseXml('<frame></text>')).toThrow(/Mismatched tags/);
  });

  it('throws on unterminated tag', () => {
    expect(() => parseXml('<frame')).toThrow(XmlParseError);
  });

  it('throws on unterminated attribute value', () => {
    expect(() => parseXml("<frame name='Card")).toThrow(XmlParseError);
  });

  it('throws on unterminated comment', () => {
    expect(() => parseXml('<!-- no end')).toThrow(XmlParseError);
  });

  it('handles deeply nested structures', () => {
    const nodes = parseXml("<frame><frame><frame><text>Deep</text></frame></frame></frame>");
    let current = nodes[0];
    for (let i = 0; i < 2; i++) {
      expect(current.children).toHaveLength(1);
      current = current.children[0];
    }
    expect(current.children[0].textContent).toBe('Deep');
  });

  it('handles whitespace between elements', () => {
    const nodes = parseXml(`
      <frame>
        <text>A</text>
        <text>B</text>
      </frame>
    `);
    expect(nodes[0].children).toHaveLength(2);
  });

  it('converts <br> inside text parent to newline in textContent', () => {
    const nodes = parseXml("<text>Line 1<br/>Line 2</text>");
    expect(nodes[0].textContent).toBe('Line 1\nLine 2');
  });
});
