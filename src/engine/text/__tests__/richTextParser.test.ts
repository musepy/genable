import { describe, it, expect } from 'vitest';
import { parseRichText } from '../richTextParser';

describe('richTextParser', () => {
  it('returns plain text unchanged when no markup', () => {
    const result = parseRichText('Hello world');
    expect(result.plainText).toBe('Hello world');
    expect(result.ranges).toEqual([]);
  });

  it('returns empty for empty/null input', () => {
    expect(parseRichText('')).toEqual({ plainText: '', ranges: [] });
    expect(parseRichText(null as any)).toEqual({ plainText: '', ranges: [] });
  });

  it('parses **bold**', () => {
    const result = parseRichText('Click **here** to continue');
    expect(result.plainText).toBe('Click here to continue');
    expect(result.ranges).toEqual([
      { start: 6, end: 10, style: { type: 'bold' } },
    ]);
  });

  it('parses *italic*', () => {
    const result = parseRichText('This is *important* text');
    expect(result.plainText).toBe('This is important text');
    expect(result.ranges).toEqual([
      { start: 8, end: 17, style: { type: 'italic' } },
    ]);
  });

  it('parses ***bold italic***', () => {
    const result = parseRichText('Go ***now***!');
    expect(result.plainText).toBe('Go now!');
    expect(result.ranges).toEqual([
      { start: 3, end: 6, style: { type: 'boldItalic' } },
    ]);
  });

  it('parses ~~strikethrough~~', () => {
    const result = parseRichText('Was ~~$19~~ now $9');
    expect(result.plainText).toBe('Was $19 now $9');
    expect(result.ranges).toEqual([
      { start: 4, end: 7, style: { type: 'strikethrough' } },
    ]);
  });

  it('parses {color:#HEX|text}', () => {
    const result = parseRichText('Price: {color:#EF4444|$9.99}');
    expect(result.plainText).toBe('Price: $9.99');
    expect(result.ranges).toEqual([
      { start: 7, end: 12, style: { type: 'color', value: '#EF4444' } },
    ]);
  });

  it('parses {size:N|text}', () => {
    const result = parseRichText('Normal {size:24|BIG} normal');
    expect(result.plainText).toBe('Normal BIG normal');
    expect(result.ranges).toEqual([
      { start: 7, end: 10, style: { type: 'size', value: 24 } },
    ]);
  });

  it('handles multiple markers in one string', () => {
    const result = parseRichText('**Bold** and *italic* and ~~strike~~');
    expect(result.plainText).toBe('Bold and italic and strike');
    expect(result.ranges).toHaveLength(3);
    expect(result.ranges[0]).toEqual({ start: 0, end: 4, style: { type: 'bold' } });
    expect(result.ranges[1]).toEqual({ start: 9, end: 15, style: { type: 'italic' } });
    expect(result.ranges[2]).toEqual({ start: 20, end: 26, style: { type: 'strikethrough' } });
  });

  it('handles nested bold + strikethrough', () => {
    const result = parseRichText('Was **~~$19~~** now');
    expect(result.plainText).toBe('Was $19 now');
    // Inner ~~$19~~ parsed first (strikethrough), then outer **...** (bold)
    expect(result.ranges).toContainEqual({ start: 4, end: 7, style: { type: 'strikethrough' } });
    expect(result.ranges).toContainEqual({ start: 4, end: 7, style: { type: 'bold' } });
  });

  it('handles nested color + bold', () => {
    const result = parseRichText('{color:#EF4444|**$9**}');
    expect(result.plainText).toBe('$9');
    expect(result.ranges).toContainEqual({ start: 0, end: 2, style: { type: 'bold' } });
    expect(result.ranges).toContainEqual({ start: 0, end: 2, style: { type: 'color', value: '#EF4444' } });
  });

  it('handles price tag pattern: strikethrough old + colored new', () => {
    const result = parseRichText('~~$19~~ {color:#EF4444|**$9**}');
    expect(result.plainText).toBe('$19 $9');
    expect(result.ranges).toContainEqual({ start: 0, end: 3, style: { type: 'strikethrough' } });
    expect(result.ranges).toContainEqual({ start: 4, end: 6, style: { type: 'bold' } });
    expect(result.ranges).toContainEqual({ start: 4, end: 6, style: { type: 'color', value: '#EF4444' } });
  });

  it('leaves literal asterisks alone when not paired', () => {
    const result = parseRichText('5 * 3 = 15');
    expect(result.plainText).toBe('5 * 3 = 15');
    expect(result.ranges).toEqual([]);
  });

  it('handles 3-char hex colors', () => {
    const result = parseRichText('{color:#F00|error}');
    expect(result.plainText).toBe('error');
    expect(result.ranges).toEqual([
      { start: 0, end: 5, style: { type: 'color', value: '#F00' } },
    ]);
  });

  it('handles Chinese text offsets correctly', () => {
    const result = parseRichText('点击 **这里** 继续');
    expect(result.plainText).toBe('点击 这里 继续');
    expect(result.ranges).toEqual([
      { start: 3, end: 5, style: { type: 'bold' } },
    ]);
  });
});
