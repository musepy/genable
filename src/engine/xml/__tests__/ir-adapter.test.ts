import { describe, it, expect } from 'vitest';
import { operationsToParsedLines } from '../ir-adapter';
import type { OperationIR } from '../../../domain/design-ir';

describe('operationsToParsedLines', () => {
  it('converts OperationIR[] to ParsedLine[] preserving all fields', () => {
    const operations: OperationIR[] = [
      {
        command: 'create',
        symbol: 'card',
        nodeType: 'FRAME',
        parentRef: undefined,
        props: { name: 'Card', width: 320, layoutMode: 'VERTICAL' },
        dependsOn: [],
      },
      {
        command: 'create',
        symbol: 'title',
        nodeType: 'TEXT',
        parentRef: 'card',
        props: { name: 'Title', characters: 'Hello', fontSize: 24 },
        dependsOn: ['card'],
      },
    ];

    const lines = operationsToParsedLines(operations);

    expect(lines).toHaveLength(2);

    // First line
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[0].symbol).toBe('card');
    expect(lines[0].command).toBe('create');
    expect(lines[0].nodeType).toBe('FRAME');
    expect(lines[0].parentRef).toBeUndefined();
    expect(lines[0].props).toEqual({ name: 'Card', width: 320, layoutMode: 'VERTICAL' });
    expect(lines[0].dependsOn).toEqual([]);
    expect(lines[0].raw).toContain('create');

    // Second line
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[1].symbol).toBe('title');
    expect(lines[1].parentRef).toBe('card');
    expect(lines[1].dependsOn).toEqual(['card']);
  });

  it('preserves update/delete commands', () => {
    const operations: OperationIR[] = [
      { command: 'update', targetRef: '1:1', props: { fills: [] }, dependsOn: [] },
      { command: 'delete', targetRef: '2:2', props: {}, dependsOn: [] },
    ];

    const lines = operationsToParsedLines(operations);

    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('1:1');
    expect(lines[1].command).toBe('delete');
    expect(lines[1].targetRef).toBe('2:2');
  });

  it('preserves instance fields (componentRef, overrides, reusable)', () => {
    const operations: OperationIR[] = [
      {
        command: 'create',
        symbol: 'cardTemplate',
        nodeType: 'FRAME',
        props: { name: 'Card Template' },
        dependsOn: [],
        reusable: true,
      },
      {
        command: 'instance',
        symbol: 'cardInstance',
        props: {},
        dependsOn: ['cardTemplate'],
        componentRef: 'cardTemplate',
        overrides: { title: { characters: 'Hello' } },
      },
    ];

    const lines = operationsToParsedLines(operations);

    expect(lines[0].reusable).toBe(true);
    expect(lines[1].command).toBe('instance');
    expect(lines[1].componentRef).toBe('cardTemplate');
    expect(lines[1].overrides).toEqual({ title: { characters: 'Hello' } });
  });

  it('returns empty array for empty input', () => {
    expect(operationsToParsedLines([])).toEqual([]);
  });
});
