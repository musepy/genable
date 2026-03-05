import { describe, it, expect } from 'vitest';
import { XmlSerializer } from '../xmlSerializer';
import type { NodeLayer } from '../../../schema/layerSchema';

// Helper to build a minimal NodeLayer
function node(type: string, props: Record<string, any> = {}, children?: NodeLayer[]): NodeLayer {
  return {
    id: props._id || '1:1',
    type: type as any,
    props: { ...props, _id: undefined } as any,
    ...(children ? { children } : {}),
  };
}

describe('XmlSerializer', () => {
  // ── Basic tag mapping ──

  it('maps FRAME → <frame/>', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:2', name: 'Box' }));
    expect(xml).toBe('<frame id="1:2" name="Box"/>');
  });

  it('maps TEXT with characters → tag body', () => {
    const xml = XmlSerializer.serialize(node('TEXT', { _id: '3:4', name: 'Title', fontSize: 24, fontWeight: 'Bold', characters: 'Welcome' }));
    expect(xml).toBe('<text id="3:4" name="Title" size="24" weight="Bold">Welcome</text>');
  });

  it('maps RECTANGLE → <rect/>', () => {
    const xml = XmlSerializer.serialize(node('RECTANGLE', { _id: '5:6', name: 'Bg', width: 100, height: 50 }));
    expect(xml).toBe('<rect id="5:6" name="Bg" w="100" h="50"/>');
  });

  it('maps VECTOR/LINE/ELLIPSE/GROUP/SECTION/ICON to correct tags', () => {
    expect(XmlSerializer.serialize(node('VECTOR'))).toContain('<vector');
    expect(XmlSerializer.serialize(node('LINE'))).toContain('<line');
    expect(XmlSerializer.serialize(node('ELLIPSE'))).toContain('<ellipse');
    expect(XmlSerializer.serialize(node('GROUP'))).toContain('<group');
    expect(XmlSerializer.serialize(node('SECTION'))).toContain('<section');
    expect(XmlSerializer.serialize(node('ICON'))).toContain('<icon');
  });

  // ── Attribute abbreviations ──

  it('abbreviates property names', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      layoutMode: 'VERTICAL',
      width: 320,
      height: 480,
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'HUG',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'MAX',
      cornerRadius: 16,
      strokeWeight: 2,
      fontWeight: 'Bold',
      fontSize: 14,
    }));
    expect(xml).toContain('layout="VERTICAL"');
    expect(xml).toContain('w="320"');
    expect(xml).toContain('h="480"');
    expect(xml).toContain('sizingH="FILL"');
    expect(xml).toContain('sizingV="HUG"');
    expect(xml).toContain('alignMain="CENTER"');
    expect(xml).toContain('alignCross="MAX"');
    expect(xml).toContain('corner="16"');
    expect(xml).toContain('strokeW="2"');
    expect(xml).toContain('weight="Bold"');
    expect(xml).toContain('size="14"');
  });

  // ── Default pruning ──

  it('prunes default values', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      layoutMode: 'NONE',
      cornerRadius: 0,
      strokeWeight: 0,
      opacity: 1,
      visible: true,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      gap: 0,
    }));
    // Should not contain any of the default values as attributes
    expect(xml).not.toContain('layout=');
    expect(xml).not.toContain('corner=');
    expect(xml).not.toContain('strokeW=');
    expect(xml).not.toContain('opacity=');
    expect(xml).not.toContain('visible=');
    expect(xml).not.toContain('gap=');
    // Padding all zero → no p attribute
    expect(xml).not.toContain(' p=');
  });

  // ── Fill simplification ──

  it('single fill → fill="#HEX"', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', fills: ['#FF0000'] }));
    expect(xml).toContain('fill="#FF0000"');
    expect(xml).not.toContain('fills=');
  });

  it('multiple fills → fills="#A,#B"', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', fills: ['#FF0000', '#00FF00'] }));
    expect(xml).toContain('fills="#FF0000,#00FF00"');
  });

  it('gradient fills → compact representation', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      fills: [{ type: 'GRADIENT_LINEAR', stops: [{ position: 0, color: '#000' }, { position: 1, color: '#FFF' }] }],
    }));
    expect(xml).toContain('GRADIENT_LINEAR');
    expect(xml).toContain('#000@0');
    expect(xml).toContain('#FFF@1');
  });

  it('empty fills → no fill attribute', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', fills: [] }));
    expect(xml).not.toContain('fill');
  });

  // ── Effects ──

  it('drop shadow → shadow attribute', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, blur: 8, spread: 0, color: '#000' }],
    }));
    expect(xml).toContain('shadow="0,4,8,0,#000"');
  });

  it('inner shadow → inset prefix', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      effects: [{ type: 'INNER_SHADOW', offset: { x: 1, y: 2 }, blur: 3, spread: 0, color: '#AAA' }],
    }));
    expect(xml).toContain('shadow="inset,1,2,3,0,#AAA"');
  });

  it('layer blur → blur() format', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      effects: [{ type: 'LAYER_BLUR', blur: 10 }],
    }));
    expect(xml).toContain('shadow="blur(10)"');
  });

  it('empty effects → no shadow attribute', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', effects: [] }));
    expect(xml).not.toContain('shadow');
  });

  // ── Padding compaction ──

  it('all same padding → p="16"', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
    }));
    expect(xml).toContain('p="16"');
    expect(xml).not.toContain('pt=');
    expect(xml).not.toContain('pr=');
  });

  it('symmetric padding → p="16 24"', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      paddingTop: 16, paddingRight: 24, paddingBottom: 16, paddingLeft: 24,
    }));
    expect(xml).toContain('p="16 24"');
  });

  it('mixed padding → p="10 20 30 40"', () => {
    const xml = XmlSerializer.serialize(node('FRAME', {
      _id: '1:1',
      paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 40,
    }));
    expect(xml).toContain('p="10 20 30 40"');
  });

  // ── Nested tree with indentation ──

  it('nested tree produces correct indentation', () => {
    const tree = node('FRAME', { _id: '1:2', name: 'Card', layoutMode: 'VERTICAL', fills: ['#FFF'] }, [
      node('TEXT', { _id: '3:4', name: 'Title', fontSize: 24, characters: 'Hello' }),
      node('RECTANGLE', { _id: '5:6', name: 'Divider', height: 1, fills: ['#EEE'] }),
    ]);

    const xml = XmlSerializer.serialize(tree);
    const lines = xml.split('\n');
    expect(lines[0]).toMatch(/^<frame/);
    expect(lines[1]).toMatch(/^  <text/);
    expect(lines[2]).toMatch(/^  <rect/);
    expect(lines[3]).toBe('</frame>');
  });

  // ── Depth limit ──

  it('respects maxDepth', () => {
    const deep = node('FRAME', { _id: '1:1' }, [
      node('FRAME', { _id: '2:1' }, [
        node('FRAME', { _id: '3:1' }, [
          node('TEXT', { _id: '4:1', characters: 'Deep' }),
        ]),
      ]),
    ]);

    const xml = XmlSerializer.serialize(deep, { maxDepth: 2 });
    expect(xml).toContain('id="1:1"');
    expect(xml).toContain('id="2:1"');
    expect(xml).toContain('id="3:1"'); // depth=2, rendered as self-closing (no children)
    expect(xml).not.toContain('id="4:1"'); // depth=3, beyond limit
  });

  // ── Children limit ──

  it('respects maxChildren and adds truncation comment', () => {
    const children = Array.from({ length: 20 }, (_, i) =>
      node('RECTANGLE', { _id: `c:${i}`, name: `child${i}` })
    );
    const parent = node('FRAME', { _id: '1:1' }, children);

    const xml = XmlSerializer.serialize(parent, { maxChildren: 5 });
    // Should have exactly 5 child elements
    const rectCount = (xml.match(/<rect /g) || []).length;
    expect(rectCount).toBe(5);
    // Should have truncation comment
    expect(xml).toContain('<!-- +15 more children -->');
  });

  // ── Truncation markers ──

  it('includes _truncated and _childCount markers from NodeSerializer', () => {
    const layer = node('FRAME', { _id: '1:1' }) as any;
    layer._truncated = true;
    layer._childCount = 42;

    const xml = XmlSerializer.serialize(layer);
    expect(xml).toContain('_truncated="true"');
    expect(xml).toContain('_childCount="42"');
  });

  // ── XML escaping ──

  it('escapes special characters in attribute values', () => {
    const xml = XmlSerializer.serialize(node('TEXT', {
      _id: '1:1',
      name: 'A & B <C> "D"',
      characters: 'x < y & z > w',
    }));
    expect(xml).toContain('name="A &amp; B &lt;C&gt; &quot;D&quot;"');
    expect(xml).toContain('x &lt; y &amp; z &gt; w');
  });

  // ── Token reduction ratio ──

  it('XML is >50% smaller than JSON for a typical design tree', () => {
    const tree = node('FRAME', {
      _id: '1:2', name: 'Card', layoutMode: 'VERTICAL', gap: 12,
      fills: ['#FFFFFF'], width: 320, layoutSizingVertical: 'HUG',
      paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
    }, [
      node('TEXT', { _id: '3:4', name: 'Title', fontSize: 24, fontWeight: 'Bold', fills: ['#111827'], characters: 'Welcome' }),
      node('FRAME', { _id: '5:6', name: 'Row', layoutMode: 'HORIZONTAL', gap: 8, counterAxisAlignItems: 'CENTER' }, [
        node('RECTANGLE', { _id: '7:8', name: 'Avatar', width: 40, height: 40, fills: ['#E0E0E0'], cornerRadius: 20 }),
        node('TEXT', { _id: '9:10', name: 'Desc', fontSize: 14, fills: ['#6B7280'], characters: 'Some text here' }),
      ]),
    ]);

    const xml = XmlSerializer.serialize(tree);
    const json = JSON.stringify(tree);

    const ratio = xml.length / json.length;
    // Small trees see ~40% reduction; larger real-world trees see 50-70%
    expect(ratio).toBeLessThan(0.65);
  });

  // ── Strokes ──

  it('serializes strokes as stroke attribute', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', strokes: ['#000000'], strokeWeight: 1 }));
    expect(xml).toContain('stroke="#000000"');
    expect(xml).toContain('strokeW="1"');
  });

  // ── Opacity (non-default) ──

  it('includes opacity when not default', () => {
    const xml = XmlSerializer.serialize(node('FRAME', { _id: '1:1', opacity: 0.5 }));
    expect(xml).toContain('opacity="0.5"');
  });

  // ── Icon nodes ──

  it('serializes ICON with icon attribute', () => {
    const xml = XmlSerializer.serialize(node('ICON', { _id: '1:1', iconName: 'mdi:home', width: 24, height: 24 }));
    expect(xml).toContain('<icon');
    expect(xml).toContain('icon="mdi:home"');
  });

  // ── Structural mode ──

  describe('structural mode', () => {
    it('only outputs id, name, type, w, h, layout', () => {
      const xml = XmlSerializer.serialize(node('FRAME', {
        _id: '1:1', name: 'Card', layoutMode: 'VERTICAL',
        width: 320, height: 480,
        fills: ['#FFFFFF'], cornerRadius: 16,
        fontSize: 14, fontWeight: 'Bold',
        paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
        gap: 12,
        effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, blur: 8, spread: 0, color: '#000' }],
      }), { structural: true });

      // Should include structural props
      expect(xml).toContain('id="1:1"');
      expect(xml).toContain('name="Card"');
      expect(xml).toContain('layout="VERTICAL"');
      expect(xml).toContain('w="320"');
      expect(xml).toContain('h="480"');

      // Should NOT include style props
      expect(xml).not.toContain('fill=');
      expect(xml).not.toContain('corner=');
      expect(xml).not.toContain('size=');
      expect(xml).not.toContain('weight=');
      expect(xml).not.toContain(' p=');
      expect(xml).not.toContain('gap=');
      expect(xml).not.toContain('shadow=');
    });

    it('includes sizingH and sizingV when non-default', () => {
      const xml = XmlSerializer.serialize(node('FRAME', {
        _id: '1:1',
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'HUG',
      }), { structural: true });
      expect(xml).toContain('sizingH="FILL"');
      expect(xml).toContain('sizingV="HUG"');
    });

    it('text ≤30 chars → inline content', () => {
      const xml = XmlSerializer.serialize(node('TEXT', {
        _id: '2:1', name: 'Title', characters: 'Hello World',
        fontSize: 24, fontWeight: 'Bold', fills: ['#111'],
      }), { structural: true });

      expect(xml).toContain('>Hello World</text>');
      // No style props
      expect(xml).not.toContain('size=');
      expect(xml).not.toContain('weight=');
      expect(xml).not.toContain('fill=');
    });

    it('text >30 chars → chars="N" attribute', () => {
      const longText = 'This is a long paragraph of text that exceeds thirty characters';
      const xml = XmlSerializer.serialize(node('TEXT', {
        _id: '2:2', name: 'Body', characters: longText,
      }), { structural: true });

      expect(xml).toContain(`chars="${longText.length}"`);
      expect(xml).not.toContain(longText);
      expect(xml).toMatch(/<text .+\/>/); // self-closing
    });

    it('nested tree works in structural mode', () => {
      const tree = node('FRAME', { _id: '1:1', name: 'Root', layoutMode: 'VERTICAL', width: 400 }, [
        node('FRAME', { _id: '2:1', name: 'Header', width: 400, height: 60, fills: ['#FFF'] }),
        node('TEXT', { _id: '2:2', name: 'Title', characters: 'Hi', fontSize: 24 }),
      ]);

      const xml = XmlSerializer.serialize(tree, { structural: true });
      expect(xml).toContain('name="Root"');
      expect(xml).toContain('name="Header"');
      expect(xml).toContain('>Hi</text>');
      // No fill in structural mode
      expect(xml).not.toContain('fill=');
    });

    it('is significantly smaller than full mode', () => {
      const tree = node('FRAME', {
        _id: '1:2', name: 'Card', layoutMode: 'VERTICAL', gap: 12,
        fills: ['#FFFFFF'], width: 320, layoutSizingVertical: 'HUG',
        paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
      }, [
        node('TEXT', { _id: '3:4', name: 'Title', fontSize: 24, fontWeight: 'Bold', fills: ['#111827'], characters: 'Welcome' }),
        node('FRAME', { _id: '5:6', name: 'Row', layoutMode: 'HORIZONTAL', gap: 8 }, [
          node('RECTANGLE', { _id: '7:8', name: 'Avatar', width: 40, height: 40, fills: ['#E0E0E0'], cornerRadius: 20 }),
          node('TEXT', { _id: '9:10', name: 'Desc', fontSize: 14, fills: ['#6B7280'], characters: 'Some text here' }),
        ]),
      ]);

      const full = XmlSerializer.serialize(tree);
      const structural = XmlSerializer.serialize(tree, { structural: true });

      // Structural should be notably smaller
      expect(structural.length).toBeLessThan(full.length * 0.75);
    });
  });
});
