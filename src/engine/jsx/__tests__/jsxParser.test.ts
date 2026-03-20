import { describe, it, expect } from 'vitest';
import { parseJsx } from '../jsxParser';

describe('jsxParser', () => {
  describe('self-closing elements', () => {
    it('parses a self-closing frame', () => {
      const { roots, errors } = parseJsx('<frame w={100}/>');
      expect(errors).toHaveLength(0);
      expect(roots).toHaveLength(1);
      expect(roots[0].tag).toBe('frame');
      expect(roots[0].attrs).toEqual({ w: 100 });
      expect(roots[0].children).toHaveLength(0);
    });

    it('parses self-closing with space before />', () => {
      const { roots, errors } = parseJsx('<rect w={200} h={1} />');
      expect(errors).toHaveLength(0);
      expect(roots[0].tag).toBe('rect');
      expect(roots[0].attrs).toEqual({ w: 200, h: 1 });
    });

    it('parses self-closing with string attrs', () => {
      const { roots } = parseJsx('<rect w="fill" h={1} fill="#E5E7EB"/>');
      expect(roots[0].attrs).toEqual({ w: 'fill', h: 1, fill: '#E5E7EB' });
    });
  });

  describe('nested elements', () => {
    it('parses parent with child', () => {
      const { roots, errors } = parseJsx('<frame><text>Hello</text></frame>');
      expect(errors).toHaveLength(0);
      expect(roots).toHaveLength(1);
      expect(roots[0].tag).toBe('frame');
      expect(roots[0].children).toHaveLength(1);
      expect(roots[0].children[0].tag).toBe('text');
      expect(roots[0].children[0].textContent).toBe('Hello');
    });

    it('parses multi-level nesting', () => {
      const input = `<frame name="Card" w={400}>
  <frame name="Header" layout="row">
    <text name="Title" size={18}>John</text>
  </frame>
</frame>`;
      const { roots, errors } = parseJsx(input);
      expect(errors).toHaveLength(0);
      expect(roots).toHaveLength(1);
      const card = roots[0];
      expect(card.attrs.name).toBe('Card');
      expect(card.children).toHaveLength(1);
      const header = card.children[0];
      expect(header.attrs.name).toBe('Header');
      expect(header.children).toHaveLength(1);
      expect(header.children[0].textContent).toBe('John');
    });

    it('parses multiple children', () => {
      const input = `<frame>
  <text>First</text>
  <text>Second</text>
  <rect w={100}/>
</frame>`;
      const { roots, errors } = parseJsx(input);
      expect(errors).toHaveLength(0);
      expect(roots[0].children).toHaveLength(3);
      expect(roots[0].children[0].textContent).toBe('First');
      expect(roots[0].children[1].textContent).toBe('Second');
      expect(roots[0].children[2].tag).toBe('rect');
    });
  });

  describe('attribute formats', () => {
    it('parses curly brace numbers', () => {
      const { roots } = parseJsx('<frame w={400} h={300}/>');
      expect(roots[0].attrs.w).toBe(400);
      expect(roots[0].attrs.h).toBe(300);
    });

    it('parses double-quoted strings', () => {
      const { roots } = parseJsx('<frame name="My Card" layout="column"/>');
      expect(roots[0].attrs.name).toBe('My Card');
      expect(roots[0].attrs.layout).toBe('column');
    });

    it('parses single-quoted strings', () => {
      const { roots } = parseJsx("<frame name='Card' bg='#FFF'/>");
      expect(roots[0].attrs.name).toBe('Card');
      expect(roots[0].attrs.bg).toBe('#FFF');
    });

    it('parses curly brace strings', () => {
      const { roots } = parseJsx('<frame w={fill} layout={column}/>');
      expect(roots[0].attrs.w).toBe('fill');
      expect(roots[0].attrs.layout).toBe('column');
    });

    it('parses bare word values', () => {
      const { roots } = parseJsx('<frame layout=column w=fill/>');
      expect(roots[0].attrs.layout).toBe('column');
      expect(roots[0].attrs.w).toBe('fill');
    });

    it('parses mixed attribute formats', () => {
      const { roots } = parseJsx('<frame w={400} name="Card" layout=\'column\' p={24}/>');
      expect(roots[0].attrs).toEqual({ w: 400, name: 'Card', layout: 'column', p: 24 });
    });
  });

  describe('text content', () => {
    it('captures text between tags', () => {
      const { roots } = parseJsx('<text size={16}>Hello World</text>');
      expect(roots[0].textContent).toBe('Hello World');
      expect(roots[0].attrs.size).toBe(16);
    });

    it('trims whitespace from text content', () => {
      const { roots } = parseJsx('<text>  Hello  </text>');
      expect(roots[0].textContent).toBe('Hello');
    });

    it('preserves multiline text content trimmed', () => {
      const { roots } = parseJsx('<text>\n  Hello World\n</text>');
      expect(roots[0].textContent).toBe('Hello World');
    });

    it('handles empty text element', () => {
      const { roots } = parseJsx('<text size={14}></text>');
      expect(roots[0].textContent).toBeUndefined();
    });
  });

  describe('multiple roots', () => {
    it('parses multiple root elements', () => {
      const input = '<frame name="A"/>\n<frame name="B"/>';
      const { roots, errors } = parseJsx(input);
      expect(errors).toHaveLength(0);
      expect(roots).toHaveLength(2);
      expect(roots[0].attrs.name).toBe('A');
      expect(roots[1].attrs.name).toBe('B');
    });
  });

  describe('instance element', () => {
    it('parses instance with ref', () => {
      const { roots } = parseJsx('<instance ref="Button" variant="Size=Large"/>');
      expect(roots[0].tag).toBe('instance');
      expect(roots[0].attrs.ref).toBe('Button');
      expect(roots[0].attrs.variant).toBe('Size=Large');
    });
  });

  describe('error recovery', () => {
    it('reports unknown tags but still parses', () => {
      const { roots, errors } = parseJsx('<div w={100}/>');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Unknown tag "div"');
      expect(roots).toHaveLength(1);
      expect(roots[0].tag).toBe('div');
    });

    it('reports missing closing tag', () => {
      const { roots, errors } = parseJsx('<frame><text>Hello</text>');
      expect(errors.some(e => e.includes('Missing closing tag'))).toBe(true);
      expect(roots).toHaveLength(1);
      expect(roots[0].children).toHaveLength(1);
    });

    it('reports mismatched closing tag', () => {
      const { errors } = parseJsx('<frame></text>');
      expect(errors.some(e => e.includes('Mismatched closing tag'))).toBe(true);
    });

    it('handles empty input', () => {
      const { roots, errors } = parseJsx('');
      expect(roots).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('handles whitespace-only input', () => {
      const { roots, errors } = parseJsx('   \n\n  ');
      expect(roots).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe('special characters in attributes', () => {
    it('handles $ prefix in attribute values (variable binding)', () => {
      const { roots } = parseJsx('<frame fill="$colors/primary"/>');
      expect(roots[0].attrs.fill).toBe('$colors/primary');
    });

    it('handles escaped quotes in strings', () => {
      const { roots } = parseJsx("<text name=\"Card\\'s Title\">Hello</text>");
      expect(roots[0].attrs.name).toBe("Card's Title");
    });
  });

  describe('complex real-world example', () => {
    it('parses a card with header and body', () => {
      const input = `<frame name="Card" w={400} layout="column" p={24} bg="#FFFFFF" corner={12}>
  <frame name="Header" layout="row" gap={12} w="fill" alignCross="center">
    <frame name="Avatar" w={40} h={40} corner="full" bg="#E5E7EB"/>
    <text name="Name" size={18} weight="Bold" fill="#111111">John Doe</text>
  </frame>
  <text name="Bio" size={14} fill="#666666" w="fill">Software engineer building great products</text>
</frame>`;
      const { roots, errors } = parseJsx(input);
      expect(errors).toHaveLength(0);
      expect(roots).toHaveLength(1);
      const card = roots[0];
      expect(card.tag).toBe('frame');
      expect(card.attrs.w).toBe(400);
      expect(card.attrs.layout).toBe('column');
      expect(card.attrs.p).toBe(24);
      expect(card.children).toHaveLength(2);

      const header = card.children[0];
      expect(header.children).toHaveLength(2);
      expect(header.children[0].attrs.corner).toBe('full');
      expect(header.children[1].textContent).toBe('John Doe');

      const bio = card.children[1];
      expect(bio.textContent).toBe('Software engineer building great products');
    });
  });
});
