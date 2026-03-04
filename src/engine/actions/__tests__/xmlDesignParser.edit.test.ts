import { describe, it, expect } from 'vitest';
import { xmlToParsedLines, XmlParseError } from '../xmlDesignParser';

describe('xmlDesignParser edit mode', () => {
  it('parses update operations from tags with id attributes', () => {
    const xml = `<frame id="100:5" bg="#F3F4F6" corner="16"/>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('100:5');
    expect(lines[0].props).toBeDefined();
    expect(lines[0].props!.fills).toEqual(['#F3F4F6']);
    expect(lines[0].props!.cornerRadius).toBe(16);
  });

  it('parses delete operations from <delete> tags', () => {
    const xml = `<delete id="100:12"/>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('delete');
    expect(lines[0].targetRef).toBe('100:12');
  });

  it('parses mixed update and delete operations', () => {
    const xml = `<frame id="100:5" bg="#F3F4F6"/><text id="100:8" fill="#EF4444" size="18">Updated Title</text><delete id="100:12"/>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines).toHaveLength(3);
    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('100:5');
    expect(lines[1].command).toBe('update');
    expect(lines[1].targetRef).toBe('100:8');
    expect(lines[1].props!.characters).toBe('Updated Title');
    expect(lines[2].command).toBe('delete');
    expect(lines[2].targetRef).toBe('100:12');
  });

  it('throws when a non-delete tag has no id in edit mode', () => {
    const xml = `<frame bg="#F3F4F6"/>`;
    expect(() => xmlToParsedLines(xml, { mode: 'edit' })).toThrow(XmlParseError);
    expect(() => xmlToParsedLines(xml, { mode: 'edit' })).toThrow("must have an 'id' attribute");
  });

  it('throws when <delete> tag has no id', () => {
    const xml = `<delete/>`;
    expect(() => xmlToParsedLines(xml, { mode: 'edit' })).toThrow(XmlParseError);
    expect(() => xmlToParsedLines(xml, { mode: 'edit' })).toThrow("requires an 'id' attribute");
  });

  it('handles abbreviation expansion in edit mode', () => {
    const xml = `<frame id="100:1" w="400" h="200" p="16 24" gap="12"/>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines[0].props!.width).toBe(400);
    expect(lines[0].props!.height).toBe(200);
    expect(lines[0].props!.paddingTop).toBe(16);
    expect(lines[0].props!.paddingRight).toBe(24);
    expect(lines[0].props!.itemSpacing).toBe(12);
  });

  it('handles text content in edit mode', () => {
    const xml = `<text id="100:3" size="20" fill="#111827">New Title</text>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines[0].command).toBe('update');
    expect(lines[0].props!.characters).toBe('New Title');
    expect(lines[0].props!.fontSize).toBe(20);
  });

  it('default mode (create) skips id attribute as before', () => {
    const xml = `<frame id="100:1" name="Card" layout="column" bg="#FFF" w="360" height="hug"/>`;
    const lines = xmlToParsedLines(xml);

    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('create');
    expect(lines[0].targetRef).toBeUndefined();
    // id should be skipped, not treated as a prop
    expect(lines[0].props!.id).toBeUndefined();
  });

  it('processes nested children in edit mode (each needs id)', () => {
    const xml = `<frame id="100:1" bg="#FFF"><text id="100:2" fill="#000">Hello</text></frame>`;
    const lines = xmlToParsedLines(xml, { mode: 'edit' });

    expect(lines).toHaveLength(2);
    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('100:1');
    expect(lines[1].command).toBe('update');
    expect(lines[1].targetRef).toBe('100:2');
  });
});
