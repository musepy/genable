import { describe, it, expect } from 'vitest';
import { parseFlatOps } from '../../flat/flatOpsParser';

describe('parseFlatOps — text compilation', () => {
  it('parses text with explicit intrinsic sizing', () => {
    const input = `title = text(card, {name: 'Title', characters: 'Settings', fontSize: 20, fill: '#111827', textAutoResize: 'WIDTH_AND_HEIGHT'})`;
    const { lines, errors } = parseFlatOps(input);

    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('create');
    expect(lines[0].nodeType).toBe('TEXT');
  });

  it('parses text without textAutoResize', () => {
    const input = `title = text(card, {name: 'Title', characters: 'Settings', fontSize: 20, fill: '#111827'})`;
    const { lines, errors } = parseFlatOps(input);

    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].command).toBe('create');
    expect(lines[0].nodeType).toBe('TEXT');
  });
});
