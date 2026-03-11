import { describe, it, expect } from 'vitest';
import { parseXml, XmlParseError } from '../xmlDesignParser';
import { interpretXmlNodes } from '../../xml/xml-interpreter';

/**
 * Edit mode tests — now go through the unified pipeline:
 *   parseXml() → interpretXmlNodes(nodes, { mode: 'edit' })
 */
function editParsedLines(xml: string) {
  const nodes = parseXml(xml);
  return interpretXmlNodes(nodes, { mode: 'edit' });
}

describe('edit mode (unified pipeline)', () => {
  it('parses update operations from tags with id attributes', () => {
    const ops = editParsedLines(`<frame id="100:5" bg="#FFF" corner="16"/>`);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('update');
    expect(ops[0].targetRef).toBe('100:5');
    expect(ops[0].props).toBeDefined();
    expect(ops[0].props.cornerRadius).toBe(16);
  });

  it('parses delete operations from <delete> tags', () => {
    const ops = editParsedLines(`<delete id="100:12"/>`);
    expect(ops).toHaveLength(1);
    expect(ops[0].command).toBe('delete');
    expect(ops[0].targetRef).toBe('100:12');
  });

  it('parses mixed update and delete operations', () => {
    const ops = editParsedLines(`<frame id="100:5" bg="#F3F4F6"/><text id="100:8" fill="#EF4444" size="18">Updated Title</text><delete id="100:12"/>`);
    expect(ops).toHaveLength(3);
    expect(ops[0].command).toBe('update');
    expect(ops[0].targetRef).toBe('100:5');
    expect(ops[1].command).toBe('update');
    expect(ops[1].targetRef).toBe('100:8');
    expect(ops[1].props.characters).toBe('Updated Title');
    expect(ops[2].command).toBe('delete');
    expect(ops[2].targetRef).toBe('100:12');
  });

  it('throws when a non-delete tag has no id in edit mode', () => {
    expect(() => editParsedLines(`<frame bg="#F3F4F6"/>`)).toThrow(/id/);
  });

  it('throws when <delete> tag has no id', () => {
    expect(() => editParsedLines(`<delete/>`)).toThrow(/id/);
  });

  it('handles abbreviation expansion in edit mode', () => {
    const ops = editParsedLines(`<frame id="100:1" w="400" h="200" p="16 24" gap="12"/>`);
    expect(ops[0].props.width).toBe(400);
    expect(ops[0].props.height).toBe(200);
    expect(ops[0].props.paddingTop).toBe(16);
    expect(ops[0].props.paddingRight).toBe(24);
    expect(ops[0].props.itemSpacing).toBe(12);
  });

  it('handles text content in edit mode', () => {
    const ops = editParsedLines(`<text id="100:3" size="20" fill="#111827">New Title</text>`);
    expect(ops[0].command).toBe('update');
    expect(ops[0].props.characters).toBe('New Title');
    expect(ops[0].props.fontSize).toBe(20);
  });

  it('processes nested children in edit mode (each needs id)', () => {
    const ops = editParsedLines(`<frame id="100:1" bg="#FFF"><text id="100:2" fill="#000">Hello</text></frame>`);
    expect(ops).toHaveLength(2);
    expect(ops[0].command).toBe('update');
    expect(ops[0].targetRef).toBe('100:1');
    expect(ops[1].command).toBe('update');
    expect(ops[1].targetRef).toBe('100:2');
  });
});
