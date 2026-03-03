import { describe, expect, it } from 'vitest';
import { operationsToParsedLines } from '../operationAdapter';
import { Operation } from '../buildDesignTypes';

describe('operationsToParsedLines', () => {
  it('maps a create operation to a ParsedLine', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'card', type: 'FRAME', props: { name: 'Card', width: 360 } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines).toHaveLength(1);
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[0].command).toBe('create');
    expect(lines[0].symbol).toBe('card');
    expect(lines[0].nodeType).toBe('FRAME');
    expect(lines[0].props).toEqual({ name: 'Card', width: 360 });
    expect(lines[0].dependsOn).toEqual([]);
    expect(lines[0].parentRef).toBeUndefined();
  });

  it('maps a create with parent symbol dependency', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'card', type: 'FRAME', props: { name: 'Card' } },
      { op: 'create', symbol: 'title', type: 'TEXT', parent: 'card', props: { characters: 'Hello' } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[1].parentRef).toBe('card');
    expect(lines[1].dependsOn).toEqual(['card']);
  });

  it('maps a create with real Figma ID parent (no dependency)', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'btn', type: 'FRAME', parent: '100:42', props: {} },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].parentRef).toBe('100:42');
    expect(lines[0].dependsOn).toEqual([]); // real ID → not a symbol dep
  });

  it('defaults nodeType to FRAME when type is omitted', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'container', props: { name: 'Box' } },
    ];
    const lines = operationsToParsedLines(ops);
    expect(lines[0].nodeType).toBe('FRAME');
  });

  it('uppercases the nodeType', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'label', type: 'text', props: {} },
    ];
    const lines = operationsToParsedLines(ops);
    expect(lines[0].nodeType).toBe('TEXT');
  });

  it('maps an update operation', () => {
    const ops: Operation[] = [
      { op: 'update', target: 'card', props: { fills: ['#FF0000'] } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('card');
    expect(lines[0].props).toEqual({ fills: ['#FF0000'] });
    expect(lines[0].dependsOn).toEqual(['card']);
  });

  it('maps an update with real Figma ID target (no dependency)', () => {
    const ops: Operation[] = [
      { op: 'update', target: '200:5', props: { width: 500 } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].targetRef).toBe('200:5');
    expect(lines[0].dependsOn).toEqual([]);
  });

  it('maps a delete operation', () => {
    const ops: Operation[] = [
      { op: 'delete', target: 'oldNode' },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].command).toBe('delete');
    expect(lines[0].targetRef).toBe('oldNode');
    expect(lines[0].dependsOn).toEqual(['oldNode']);
  });

  it('maps an icon operation', () => {
    const ops: Operation[] = [
      { op: 'icon', symbol: 'homeIcon', parent: 'nav', props: { iconName: 'lucide:home', width: 24 } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].command).toBe('icon');
    expect(lines[0].symbol).toBe('homeIcon');
    expect(lines[0].parentRef).toBe('nav');
    expect(lines[0].props?.iconName).toBe('lucide:home');
    expect(lines[0].dependsOn).toEqual(['nav']);
  });

  it('maps an image operation', () => {
    const ops: Operation[] = [
      { op: 'image', symbol: 'hero', parent: 'card', props: { width: 400, height: 200 } },
    ];
    const lines = operationsToParsedLines(ops);

    expect(lines[0].command).toBe('image');
    expect(lines[0].symbol).toBe('hero');
    expect(lines[0].parentRef).toBe('card');
    expect(lines[0].dependsOn).toEqual(['card']);
  });

  it('handles "root" parent as non-dependency', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'page', type: 'FRAME', parent: 'root', props: {} },
    ];
    const lines = operationsToParsedLines(ops);
    expect(lines[0].dependsOn).toEqual([]);
  });

  it('assigns correct 1-based lineNumbers', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'a', props: {} },
      { op: 'create', symbol: 'b', props: {} },
      { op: 'create', symbol: 'c', props: {} },
    ];
    const lines = operationsToParsedLines(ops);
    expect(lines.map(l => l.lineNumber)).toEqual([1, 2, 3]);
  });

  it('produces JSON raw strings for diagnostics', () => {
    const ops: Operation[] = [
      { op: 'create', symbol: 'x', type: 'FRAME', props: { name: 'test' } },
    ];
    const lines = operationsToParsedLines(ops);
    const parsed = JSON.parse(lines[0].raw);
    expect(parsed.op).toBe('create');
    expect(parsed.symbol).toBe('x');
  });
});
