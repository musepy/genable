import { describe, it, expect } from 'vitest';
import { ActionCompiler } from '../compiler';
import type { ParsedLine } from '../createTypes';

function makeCreateLine(props: Record<string, any>): ParsedLine {
  return {
    lineNumber: 1,
    raw: '{"command":"create"}',
    symbol: 'title',
    command: 'create',
    nodeType: 'TEXT',
    parentRef: 'card',
    props,
    dependsOn: ['card'],
  };
}

describe('ActionCompiler text sizing contract', () => {
  it('compiles text with explicit intrinsic sizing', () => {
    const compiler = new ActionCompiler();
    const result = compiler.compile([
      makeCreateLine({
        name: 'Title',
        characters: 'Settings',
        fontSize: 20,
        fills: ['#111827'],
        textAutoResize: 'WIDTH_AND_HEIGHT',
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action.action).toBe('createText');
    expect(result.actions[0].warnings).toBeUndefined();
  });

  it('passes through text without textAutoResize (validation moved to semanticValidator)', () => {
    const compiler = new ActionCompiler();
    const result = compiler.compile([
      makeCreateLine({
        name: 'Title',
        characters: 'Settings',
        fontSize: 20,
        fills: ['#111827'],
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action.action).toBe('createText');
  });
});
