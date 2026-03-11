import { describe, it, expect } from 'vitest';
import { parseFlatOps } from '../flatOpsParser';

describe('flatOpsParser', () => {
  function parse(input: string) {
    return parseFlatOps(input);
  }

  function lines(input: string) {
    return parse(input).lines;
  }

  describe('create operations', () => {
    it('creates a simple frame', () => {
      const ops = lines("card = frame(root, {name:'Card', w:320, h:480})");
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('create');
      expect(ops[0].nodeType).toBe('FRAME');
      expect(ops[0].props.name).toBe('Card');
      expect(ops[0].props.width).toBe(320);
      expect(ops[0].props.height).toBe(480);
    });

    it('handles text nodes with content', () => {
      const ops = lines("title = text(card, {size:20, weight:'Bold', fill:'#111827'}, 'Hello World')");
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('create');
      expect(ops[0].props.characters).toBe('Hello World');
      expect(ops[0].props.fontSize).toBe(20);
      expect(ops[0].parentRef).toBe('card');
      expect(ops[0].dependsOn).toEqual(['card']);
    });

    it('expands abbreviations', () => {
      const ops = lines("f = frame(root, {layout:'row', alignMain:'center', alignCross:'center', p:16, bg:'#FFF'})");
      expect(ops[0].props.layoutMode).toBe('HORIZONTAL');
      expect(ops[0].props.primaryAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.counterAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.paddingTop).toBe(16);
      expect(ops[0].props.paddingRight).toBe(16);
    });

    it('handles padding shorthand', () => {
      const ops = lines("f = frame(root, {p:'16 24'})");
      expect(ops[0].props.paddingTop).toBe(16);
      expect(ops[0].props.paddingRight).toBe(24);
      expect(ops[0].props.paddingBottom).toBe(16);
      expect(ops[0].props.paddingLeft).toBe(24);
    });

    it('handles fill color', () => {
      const ops = lines("r = rect(root, {fill:'#FF0000'})");
      expect(ops[0].props.fills).toBeDefined();
      expect(Array.isArray(ops[0].props.fills)).toBe(true);
    });

    it('handles shadow shorthand', () => {
      const ops = lines("f = frame(root, {shadow:'0,4,8,0,#00000040'})");
      expect(ops[0].props.effects).toBeDefined();
      expect(Array.isArray(ops[0].props.effects)).toBe(true);
    });

    it('normalizes CSS props', () => {
      const ops = lines("f = frame(root, {layout:'column', justifyContent:'center', alignItems:'center', gap:12})");
      expect(ops[0].props.layoutMode).toBe('VERTICAL');
      expect(ops[0].props.primaryAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.counterAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.itemSpacing).toBe(12);
    });

    it('converts width fill to layoutSizing', () => {
      const ops = lines("f = frame(root, {w:'fill'})");
      expect(ops[0].props.layoutSizingHorizontal).toBe('FILL');
      expect(ops[0].props.width).toBeUndefined();
    });

    it('handles parent as root', () => {
      const ops = lines("card = frame(root, {w:320})");
      expect(ops[0].parentRef).toBeUndefined();
      expect(ops[0].dependsOn).toEqual([]);
    });

    it('handles parent as symbol', () => {
      const ops = lines("card = frame(root, {w:320})\ntitle = text(card, {size:14}, 'Hi')");
      expect(ops[1].parentRef).toBe('card');
      expect(ops[1].dependsOn).toEqual(['card']);
    });

    it('handles parent as Figma node ID', () => {
      const ops = lines("title = text('200:3', {size:14}, 'Hi')");
      expect(ops[0].parentRef).toBe('200:3');
      expect(ops[0].dependsOn).toEqual([]);
    });

    it('handles icon tags', () => {
      const ops = lines("ico = icon(root, {icon:'mdi:home', size:24})");
      expect(ops[0].command).toBe('icon');
      expect(ops[0].props.iconName).toBe('mdi:home');
      expect(ops[0].props.width).toBe(24);
      expect(ops[0].props.height).toBe(24);
    });

    it('handles image tags', () => {
      const ops = lines("hero = image(root, {name:'Hero', w:400, h:200})");
      expect(ops[0].command).toBe('image');
      expect(ops[0].props.name).toBe('Hero');
    });

    it('handles reusable flag', () => {
      const ops = lines("sc = frame(root, {name:'StatCard', reusable:true, layout:'column'})");
      expect(ops[0].reusable).toBe(true);
    });

    it('assigns unique symbols', () => {
      const ops = lines("a = frame(root, {})\na = frame(root, {})");
      expect(ops[0].symbol).not.toBe(ops[1].symbol);
    });

    it('handles overflow hidden', () => {
      const ops = lines("f = frame(root, {overflow:'hidden'})");
      expect(ops[0].props.clipsContent).toBe(true);
    });

    it('handles rect type', () => {
      const ops = lines("d = rect(root, {w:'fill', h:1, fill:'#E5E7EB'})");
      expect(ops[0].nodeType).toBe('RECTANGLE');
    });

    it('handles ellipse type', () => {
      const ops = lines("c = ellipse(root, {w:32, h:32, fill:'#4F46E5'})");
      expect(ops[0].nodeType).toBe('ELLIPSE');
    });
  });

  describe('update operations', () => {
    it('creates update operations', () => {
      const ops = lines("update('1:1', {bg:'#FFF'})");
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('update');
      expect(ops[0].targetRef).toBe('1:1');
    });

    it('handles multiple properties', () => {
      const ops = lines("update('1:1', {fill:'#EF4444', size:16, weight:'Bold'})");
      expect(ops[0].command).toBe('update');
      expect(ops[0].targetRef).toBe('1:1');
    });
  });

  describe('delete operations', () => {
    it('creates delete operations', () => {
      const ops = lines("delete('1:1')");
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('delete');
      expect(ops[0].targetRef).toBe('1:1');
    });
  });

  describe('ref operations', () => {
    it('creates instance operations', () => {
      const ops = lines("c1 = ref('StatCard', row, {w:'fill', set:label:'Revenue'})");
      expect(ops[0].command).toBe('instance');
      expect(ops[0].componentRef).toBe('statcard');
      expect(ops[0].overrides).toMatchObject({ label: { characters: 'Revenue' } });
    });

    it('handles multiple set overrides', () => {
      const ops = lines("c1 = ref('Card', root, {set:title:'Hello', set:body:'World'})");
      expect(ops[0].overrides).toMatchObject({
        title: { characters: 'Hello' },
        body: { characters: 'World' },
      });
    });
  });

  describe('mixed operations', () => {
    it('handles create + update + delete in one input', () => {
      const input = [
        "card = frame(root, {name:'Card', w:320, h:480})",
        "update('100:8', {fill:'#EF4444'})",
        "delete('100:12')",
      ].join('\n');
      const ops = lines(input);
      expect(ops).toHaveLength(3);
      expect(ops[0].command).toBe('create');
      expect(ops[1].command).toBe('update');
      expect(ops[2].command).toBe('delete');
    });
  });

  describe('comments and empty lines', () => {
    it('skips comment lines', () => {
      const ops = lines("// This is a comment\ncard = frame(root, {w:320})");
      expect(ops).toHaveLength(1);
    });

    it('skips empty lines', () => {
      const ops = lines("\n\ncard = frame(root, {w:320})\n\n");
      expect(ops).toHaveLength(1);
    });
  });

  describe('error recovery', () => {
    it('skips bad lines and continues parsing', () => {
      const input = "card = frame(root, {w:320})\nthis is garbage\ntitle = text(card, {size:14}, 'Hi')";
      const result = parse(input);
      expect(result.lines).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].line).toBe(2);
    });

    it('returns all errors for fully bad input', () => {
      const result = parse("bad line 1\nbad line 2");
      expect(result.lines).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('props parsing edge cases', () => {
    it('handles unquoted keyword values', () => {
      const ops = lines("f = frame(root, {layout:column, w:fill, height:hug})");
      expect(ops[0].props.layoutMode).toBe('VERTICAL');
      expect(ops[0].props.layoutSizingHorizontal).toBe('FILL');
    });

    it('handles values with special characters in quotes', () => {
      const ops = lines("t = text(root, {size:14, fill:'#111827'}, 'Don\\'t stop')");
      expect(ops[0].props.characters).toBe("Don't stop");
    });

    it('converts \\n to real newline in text content', () => {
      const ops = lines("t = text(root, {size:14}, 'Line one\\nLine two')");
      expect(ops[0].props.characters).toBe("Line one\nLine two");
    });

    it('converts \\t to real tab in text content', () => {
      const ops = lines("t = text(root, {size:14}, 'Col1\\tCol2')");
      expect(ops[0].props.characters).toBe("Col1\tCol2");
    });

    it('handles stroke properties', () => {
      const ops = lines("f = frame(root, {stroke:'#D1D5DB', strokeW:1})");
      expect(ops[0].props.strokes).toBeDefined();
      expect(ops[0].props.strokeWeight).toBe(1);
    });
  });
});
