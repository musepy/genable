import { describe, it, expect } from 'vitest';
import { parseXml, xmlToParsedLines, XmlParseError } from '../xmlDesignParser';

// ==========================================
// parseXml
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
});

// ==========================================
// xmlToParsedLines
// ==========================================

describe('xmlToParsedLines', () => {
  it('converts a simple frame to a create ParsedLine', () => {
    const lines = xmlToParsedLines("<frame name='Card' layout='column'/>");
    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('create');
    expect(lines[0].nodeType).toBe('FRAME');
    expect(lines[0].symbol).toBe('card');
    expect(lines[0].lineNumber).toBe(1);
    // layout should be compiled to layoutMode by compileCssProps
    expect(lines[0].props?.layoutMode).toBe('VERTICAL');
    expect(lines[0].props?.layout).toBeUndefined();
  });

  it('builds correct parent chain and dependsOn for nested elements', () => {
    const lines = xmlToParsedLines(`
      <frame name='Card'>
        <text name='Title'>Hello</text>
      </frame>
    `);
    expect(lines).toHaveLength(2);
    expect(lines[0].parentRef).toBeUndefined();
    expect(lines[0].symbol).toBe('card');
    expect(lines[1].parentRef).toBe('card');
    expect(lines[1].dependsOn).toContain('card');
    expect(lines[1].props).toMatchObject({ characters: 'Hello', name: 'Title' });
  });

  it('expands abbreviations and compiles CSS props', () => {
    const lines = xmlToParsedLines("<frame w='100' h='50' corner='8' bg='#FFF'/>");
    expect(lines[0].props).toMatchObject({
      width: 100,
      height: 50,
      cornerRadius: 8,
      fills: ['#FFF'],  // bg → background → fills via compileCssProps
    });
    expect(lines[0].props?.background).toBeUndefined();
  });

  it('expands padding shorthand (uniform)', () => {
    const lines = xmlToParsedLines("<frame p='16'/>");
    expect(lines[0].props).toMatchObject({
      paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
    });
  });

  it('expands padding shorthand (V H)', () => {
    const lines = xmlToParsedLines("<frame p='16 24'/>");
    expect(lines[0].props).toMatchObject({
      paddingTop: 16, paddingRight: 24, paddingBottom: 16, paddingLeft: 24,
    });
  });

  it('expands padding shorthand (T R B L)', () => {
    const lines = xmlToParsedLines("<frame p='10 20 30 40'/>");
    expect(lines[0].props).toMatchObject({
      paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 40,
    });
  });

  it('expands shadow shorthand', () => {
    const lines = xmlToParsedLines("<frame shadow='0,4,16,0,#0000001A'/>");
    expect(lines[0].props!.effects).toEqual([{
      type: 'DROP_SHADOW',
      color: '#0000001A',
      offset: { x: 0, y: 4 },
      radius: 16,
      spread: 0,
      visible: true,
    }]);
  });

  it('expands inner shadow', () => {
    const lines = xmlToParsedLines("<frame shadow='inset,0,2,4,0,#00000033'/>");
    expect(lines[0].props!.effects[0].type).toBe('INNER_SHADOW');
  });

  it('expands multiple shadows (semicolon-separated)', () => {
    const lines = xmlToParsedLines("<frame shadow='0,4,16,0,#0000001A;0,1,3,0,#00000033'/>");
    expect(lines[0].props!.effects).toHaveLength(2);
  });

  it('expands fill shorthand', () => {
    const lines = xmlToParsedLines("<frame fill='#FFF'/>");
    expect(lines[0].props!.fills).toEqual(['#FFF']);
  });

  it('expands fills with multiple colors', () => {
    const lines = xmlToParsedLines("<frame fills='#AAA,#BBB'/>");
    expect(lines[0].props!.fills).toEqual(['#AAA', '#BBB']);
  });

  it('expands stroke shorthand', () => {
    const lines = xmlToParsedLines("<frame stroke='#D1D5DB'/>");
    expect(lines[0].props!.strokes).toEqual(['#D1D5DB']);
  });

  it('coerces numeric values', () => {
    const lines = xmlToParsedLines("<text fontSize='16' letterSpacing='1.5'>Hi</text>");
    expect(lines[0].props!.fontSize).toBe(16);
    expect(lines[0].props!.letterSpacing).toBe(1.5);
  });

  it('compiles width/height fill/hug to layoutSizing', () => {
    const lines = xmlToParsedLines("<frame width='fill' height='hug'/>");
    expect(lines[0].props!.layoutSizingHorizontal).toBe('FILL');
    expect(lines[0].props!.layoutSizingVertical).toBe('HUG');
    expect(lines[0].props!.width).toBeUndefined();
    expect(lines[0].props!.height).toBeUndefined();
  });

  it('maps icon tag to icon command with explicit icon attr', () => {
    const lines = xmlToParsedLines("<icon name='SearchIcon' icon='mdi:search'/>");
    expect(lines[0].command).toBe('icon');
    expect(lines[0].props!.iconName).toBe('mdi:search');
  });

  it('infers iconName from name when icon attr is missing', () => {
    const lines = xmlToParsedLines("<icon name='logos:google-icon' w='24' h='24'/>");
    expect(lines[0].command).toBe('icon');
    expect(lines[0].props!.iconName).toBe('logos:google-icon');
    expect(lines[0].props!.name).toBe('logos:google-icon');
  });

  it('maps image tag to image command', () => {
    const lines = xmlToParsedLines("<image name='Avatar' w='48' h='48'/>");
    expect(lines[0].command).toBe('image');
    expect(lines[0].props).toMatchObject({ width: 48, height: 48 });
  });

  it('skips id attribute', () => {
    const lines = xmlToParsedLines("<frame id='1:2' name='Card'/>");
    expect(lines[0].props!.id).toBeUndefined();
  });

  it('generates unique symbols for duplicate names', () => {
    const lines = xmlToParsedLines(`
      <frame name='Label'>
        <text name='Label'>A</text>
        <text name='Label'>B</text>
      </frame>
    `);
    const symbols = lines.map(l => l.symbol);
    expect(new Set(symbols).size).toBe(3);
    expect(symbols[0]).toBe('label');
    expect(symbols[1]).toBe('label2');
    expect(symbols[2]).toBe('label3');
  });

  it('auto-generates symbols when no name given', () => {
    const lines = xmlToParsedLines("<frame><rect/></frame>");
    expect(lines[0].symbol).toMatch(/^frame/);
    expect(lines[1].symbol).toMatch(/^rect/);
  });

  it('maps rect tag to RECTANGLE type', () => {
    const lines = xmlToParsedLines("<rect/>");
    expect(lines[0].nodeType).toBe('RECTANGLE');
  });

  it('maps rectangle tag to RECTANGLE type', () => {
    const lines = xmlToParsedLines("<rectangle/>");
    expect(lines[0].nodeType).toBe('RECTANGLE');
  });

  // ── Unknown/HTML tag tolerance (whitelist defense) ──

  it('silently strips unknown tags like <div> without crashing', () => {
    const lines = xmlToParsedLines("<frame><div/></frame>");
    // <div/> is stripped, only the frame remains
    expect(lines).toHaveLength(1);
    expect(lines[0].nodeType).toBe('FRAME');
  });

  it('strips unknown wrapper tags but preserves valid children', () => {
    const lines = xmlToParsedLines("<frame><div><text>Hello</text></div></frame>");
    expect(lines).toHaveLength(2);
    expect(lines[0].nodeType).toBe('FRAME');
    expect(lines[1].nodeType).toBe('TEXT');
    expect(lines[1].props!.characters).toBe('Hello');
    expect(lines[1].parentRef).toBe(lines[0].symbol);
  });

  it('converts <br> inside <text> to newline character', () => {
    const nodes = parseXml("<text>Line 1<br/>Line 2</text>");
    expect(nodes[0].textContent).toBe('Line 1\nLine 2');
  });

  it('handles <br> in text nodes end-to-end', () => {
    const lines = xmlToParsedLines("<text name='Address'>123 Main St<br/>Apt 4B<br/>New York</text>");
    expect(lines).toHaveLength(1);
    expect(lines[0].props!.characters).toBe('123 Main St\nApt 4B\nNew York');
  });

  it('strips <span> but keeps its text content as a text node', () => {
    const lines = xmlToParsedLines("<frame><span>Bold text</span></frame>");
    expect(lines).toHaveLength(2);
    expect(lines[1].nodeType).toBe('TEXT');
    expect(lines[1].props!.characters).toBe('Bold text');
  });

  it('handles deeply nested unknown HTML tags', () => {
    const lines = xmlToParsedLines("<frame><div><p><text>Deep</text></p></div></frame>");
    expect(lines).toHaveLength(2);
    expect(lines[1].props!.characters).toBe('Deep');
    expect(lines[1].parentRef).toBe(lines[0].symbol);
  });

  it('handles text with fill attribute for text color', () => {
    const lines = xmlToParsedLines("<text fill='#111827'>Hello</text>");
    expect(lines[0].props!.fills).toEqual(['#111827']);
    expect(lines[0].props!.characters).toBe('Hello');
  });

  it('assigns correct 1-based lineNumbers', () => {
    const lines = xmlToParsedLines(`
      <frame name='Card'>
        <text name='Title'>Card Title</text>
        <text name='Body'>Description</text>
      </frame>
    `);
    expect(lines.map(l => l.lineNumber)).toEqual([1, 2, 3]);
  });

  it('maps icon size to width+height (not fontSize)', () => {
    const lines = xmlToParsedLines("<icon name='Star' icon='mdi:star' size='20'/>");
    expect(lines[0].command).toBe('icon');
    expect(lines[0].props!.width).toBe(20);
    expect(lines[0].props!.height).toBe(20);
    expect(lines[0].props!.fontSize).toBeUndefined();
  });

  it('merges family + icon into prefix:name format', () => {
    const lines = xmlToParsedLines("<icon name='Google' family='logos' icon='google-icon' size='24'/>");
    expect(lines[0].command).toBe('icon');
    expect(lines[0].props!.iconName).toBe('logos:google-icon');
    expect(lines[0].props!.width).toBe(24);
    expect(lines[0].props!.height).toBe(24);
    expect(lines[0].props!._iconFamily).toBeUndefined();
  });

  it('does not merge family when icon already has prefix', () => {
    const lines = xmlToParsedLines("<icon name='Search' family='mdi' icon='lucide:search'/>");
    expect(lines[0].props!.iconName).toBe('lucide:search');
  });

  it('handles icon operations with parent dependency', () => {
    const lines = xmlToParsedLines("<frame name='Nav'><icon name='Search' icon='mdi:search'/></frame>");
    expect(lines[1].command).toBe('icon');
    expect(lines[1].props?.iconName).toBe('mdi:search');
    expect(lines[1].parentRef).toBe('nav');
    expect(lines[1].dependsOn).toContain('nav');
  });

  it('converts a complete login form', () => {
    const xml = `
      <frame name='Login Card' layout='column' gap='24' p='32' w='420' height='hug' bg='#FFFFFF' corner='16' shadow='0,8,24,0,#0000001A'>
        <text name='Heading' size='28' weight='Bold' fill='#111827'>Sign In</text>
        <frame name='Email Field' layout='column' gap='6' width='fill' height='hug'>
          <text name='Email Label' size='14' weight='Medium' fill='#374151'>Email</text>
          <frame name='Email Input' h='44' width='fill' layout='row' p='12' bg='#F9FAFB' corner='8' stroke='#D1D5DB' strokeW='1'>
            <text name='Placeholder' size='14' fill='#9CA3AF'>you@example.com</text>
          </frame>
        </frame>
        <frame name='Submit Button' h='48' width='fill' layout='row' justifyContent='center' alignItems='center' bg='#4F46E5' corner='10'>
          <text name='Button Label' size='16' weight='Bold' fill='#FFFFFF'>Sign In</text>
        </frame>
      </frame>
    `;
    const lines = xmlToParsedLines(xml);
    // Root + Heading + EmailField + EmailLabel + EmailInput + Placeholder + SubmitButton + ButtonLabel = 8
    expect(lines.length).toBe(8);
    expect(lines[0].command).toBe('create');
    expect(lines[0].nodeType).toBe('FRAME');
    expect(lines[0].parentRef).toBeUndefined();

    // Check parent chain
    expect(lines[1].parentRef).toBe(lines[0].symbol); // Heading → Login Card
    expect(lines[2].parentRef).toBe(lines[0].symbol); // Email Field → Login Card
    expect(lines[3].parentRef).toBe(lines[2].symbol); // Email Label → Email Field
    expect(lines[4].parentRef).toBe(lines[2].symbol); // Email Input → Email Field
    expect(lines[5].parentRef).toBe(lines[4].symbol); // Placeholder → Email Input
  });
});
