import { describe, it, expect } from 'vitest';
import { compileDesignOps } from '../../flat/flatOpsParser';

describe('compileDesignOps — text compilation', () => {
  it('compiles text with explicit intrinsic sizing', () => {
    const input = `title = text(card, {name: 'Title', characters: 'Settings', fontSize: 20, fill: '#111827', textAutoResize: 'WIDTH_AND_HEIGHT'})`;
    const { ops, errors } = compileDesignOps(input);

    expect(errors).toEqual([]);
    expect(ops).toHaveLength(1);
    expect(ops[0].action.action).toBe('createText');
  });

  it('compiles text without textAutoResize', () => {
    const input = `title = text(card, {name: 'Title', characters: 'Settings', fontSize: 20, fill: '#111827'})`;
    const { ops, errors } = compileDesignOps(input);

    expect(errors).toEqual([]);
    expect(ops).toHaveLength(1);
    expect(ops[0].action.action).toBe('createText');
  });
});
