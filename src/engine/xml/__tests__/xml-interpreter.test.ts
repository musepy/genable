import { describe, it, expect } from 'vitest';
import { interpretXmlNodes } from '../xml-interpreter';
import { parseXml } from '../../actions/xmlDesignParser';

describe('xml-interpreter', () => {
  function interpret(xml: string, mode?: 'create' | 'edit' | 'design') {
    const nodes = parseXml(xml);
    return interpretXmlNodes(nodes, { mode });
  }

  describe('create mode', () => {
    it('creates a simple frame', () => {
      const ops = interpret('<frame name="Card" w="320" h="480"/>');
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('create');
      expect(ops[0].nodeType).toBe('FRAME');
      expect(ops[0].props.name).toBe('Card');
      expect(ops[0].props.width).toBe(320);
      expect(ops[0].props.height).toBe(480);
    });

    it('creates nested nodes with parent refs', () => {
      const ops = interpret('<frame name="Card"><text name="Title">Hello</text></frame>');
      expect(ops).toHaveLength(2);
      expect(ops[0].command).toBe('create');
      expect(ops[0].symbol).toBeTruthy();
      expect(ops[1].command).toBe('create');
      expect(ops[1].parentRef).toBe(ops[0].symbol);
      expect(ops[1].props.characters).toBe('Hello');
    });

    it('expands abbreviations', () => {
      const ops = interpret('<frame layout="row" alignMain="center" alignCross="center" p="16" bg="#FFF"/>');
      expect(ops[0].props.layoutMode).toBe('HORIZONTAL');
      expect(ops[0].props.primaryAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.counterAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.paddingTop).toBe(16);
      expect(ops[0].props.paddingRight).toBe(16);
    });

    it('parses fills using paintSpec', () => {
      const ops = interpret('<frame fill="#FF0000"/>');
      expect(ops[0].props.fills).toBeDefined();
      expect(Array.isArray(ops[0].props.fills)).toBe(true);
      expect(ops[0].props.fills[0]).toMatchObject({ kind: 'solid', color: '#FF0000' });
    });

    it('parses gradient fills', () => {
      const ops = interpret('<frame fill="GRADIENT_LINEAR(#FF0000@0,#0000FF@1)"/>');
      expect(ops[0].props.fills[0]).toMatchObject({ kind: 'gradient', type: 'GRADIENT_LINEAR' });
    });

    it('parses effects using effectSpec', () => {
      const ops = interpret('<frame shadow="0,4,8,0,#00000040"/>');
      expect(ops[0].props.effects).toBeDefined();
      expect(Array.isArray(ops[0].props.effects)).toBe(true);
      expect(ops[0].props.effects[0]).toMatchObject({ kind: 'drop-shadow' });
    });

    it('normalizes CSS props', () => {
      const ops = interpret('<frame layout="column" justifyContent="center" alignItems="center" gap="12"/>');
      expect(ops[0].props.layoutMode).toBe('VERTICAL');
      expect(ops[0].props.primaryAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.counterAxisAlignItems).toBe('CENTER');
      expect(ops[0].props.itemSpacing).toBe(12);
    });

    it('converts width="fill" to layoutSizing', () => {
      const ops = interpret('<frame w="fill"/>');
      expect(ops[0].props.layoutSizingHorizontal).toBe('FILL');
      expect(ops[0].props.width).toBeUndefined();
    });

    it('handles icon tags', () => {
      const ops = interpret('<icon icon="mdi:home" size="24"/>');
      expect(ops[0].command).toBe('icon');
      expect(ops[0].props.iconName).toBe('mdi:home');
      expect(ops[0].props.width).toBe(24);
      expect(ops[0].props.height).toBe(24);
    });

    it('handles image tags', () => {
      const ops = interpret('<image name="Hero" w="400" h="200"/>');
      expect(ops[0].command).toBe('image');
      expect(ops[0].props.name).toBe('Hero');
    });

    it('handles ref tags (instances)', () => {
      const ops = interpret('<ref component="Card" set:title="Hello"/>');
      expect(ops[0].command).toBe('instance');
      expect(ops[0].componentRef).toBe('card');
      expect(ops[0].overrides).toMatchObject({ title: { characters: 'Hello' } });
    });

    it('handles reusable attribute (component)', () => {
      const ops = interpret('<frame name="Card" reusable="true" layout="column"/>');
      expect(ops[0].reusable).toBe(true);
    });

    it('assigns unique symbols', () => {
      const ops = interpret('<frame name="Card"/><frame name="Card"/>');
      expect(ops[0].symbol).not.toBe(ops[1].symbol);
    });

    it('handles background="transparent"', () => {
      const ops = interpret('<frame bg="transparent"/>');
      expect(ops[0].props.fills).toEqual([]);
    });

    it('handles overflow="hidden"', () => {
      const ops = interpret('<frame overflow="hidden"/>');
      expect(ops[0].props.clipsContent).toBe(true);
    });
  });

  describe('edit mode', () => {
    it('creates update operations', () => {
      const ops = interpret('<frame id="1:1" bg="#FFF"/>', 'edit');
      expect(ops).toHaveLength(1);
      expect(ops[0].command).toBe('update');
      expect(ops[0].targetRef).toBe('1:1');
    });

    it('creates delete operations', () => {
      const ops = interpret('<delete id="1:1"/>', 'edit');
      expect(ops[0].command).toBe('delete');
      expect(ops[0].targetRef).toBe('1:1');
    });

    it('throws without id in edit mode', () => {
      expect(() => interpret('<frame bg="#FFF"/>', 'edit')).toThrow(/id/);
    });
  });

  describe('design mode', () => {
    it('detects edit vs create per tag', () => {
      const ops = interpret('<frame id="1:1" bg="#FFF"/><frame name="New" w="100"/>', 'design');
      expect(ops[0].command).toBe('update');
      expect(ops[1].command).toBe('create');
    });
  });
});
