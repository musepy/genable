/**
 * @file richTextParser.ts
 * @description Parse markdown-like markup in text content into plain text + style ranges.
 *
 * Supported syntax:
 *   **text**              → bold (fontName style = 'Bold')
 *   *text*                → italic (fontName style = 'Italic')
 *   ***text***            → bold italic (fontName style = 'Bold Italic')
 *   ~~text~~              → strikethrough
 *   {color:#HEX|text}     → fill color
 *   {size:20|text}        → font size override
 *
 * Nesting is supported: **~~text~~** → bold + strikethrough on same range.
 */

export type RangeStyle =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'boldItalic' }
  | { type: 'strikethrough' }
  | { type: 'color'; value: string }
  | { type: 'size'; value: number };

export interface StyledRange {
  start: number;
  end: number;
  style: RangeStyle;
}

export interface RichTextResult {
  plainText: string;
  ranges: StyledRange[];
}

/**
 * Each pattern's first capture group is the "content" for simple markers,
 * or the value + content for parameterized markers (color, size).
 */
const PATTERNS: Array<{
  regex: RegExp;
  /** Index of the capture group holding the inner text content */
  contentGroup: number;
  toStyles: (match: RegExpExecArray) => RangeStyle[];
}> = [
  // ***text*** → bold italic (must precede ** and *)
  {
    regex: /\*\*\*(.+?)\*\*\*/g,
    contentGroup: 1,
    toStyles: () => [{ type: 'boldItalic' }],
  },
  // **text** → bold
  {
    regex: /\*\*(.+?)\*\*/g,
    contentGroup: 1,
    toStyles: () => [{ type: 'bold' }],
  },
  // *text* → italic (only match if not preceded/followed by *)
  {
    regex: /(?<!\*)\*([^*]+?)\*(?!\*)/g,
    contentGroup: 1,
    toStyles: () => [{ type: 'italic' }],
  },
  // ~~text~~ → strikethrough
  {
    regex: /~~(.+?)~~/g,
    contentGroup: 1,
    toStyles: () => [{ type: 'strikethrough' }],
  },
  // {color:#HEX|text} → color
  {
    regex: /\{color:(#[0-9a-fA-F]{3,8})\|(.+?)\}/g,
    contentGroup: 2,
    toStyles: (m) => [{ type: 'color', value: m[1] }],
  },
  // {size:N|text} → font size
  {
    regex: /\{size:(\d+(?:\.\d+)?)\|(.+?)\}/g,
    contentGroup: 2,
    toStyles: (m) => [{ type: 'size', value: parseFloat(m[1]) }],
  },
];

/**
 * Parse a markdown-like string into plain text + styled ranges.
 *
 * Algorithm: find the leftmost match across all patterns, append preceding
 * plain text, recursively parse the inner content (to resolve nesting),
 * record the range, and continue.
 */
export function parseRichText(input: string): RichTextResult {
  if (!input || !hasMarkup(input)) {
    return { plainText: input || '', ranges: [] };
  }

  // Shared accumulator — recursive calls append to the same string.
  let plainText = '';
  const ranges: StyledRange[] = [];

  processSegment(input);

  return { plainText, ranges };

  function processSegment(text: string): void {
    let cursor = 0;

    while (cursor < text.length) {
      // Scan all patterns for the leftmost match from `cursor`
      let best: { patternIdx: number; match: RegExpExecArray } | null = null;

      for (let i = 0; i < PATTERNS.length; i++) {
        const re = new RegExp(PATTERNS[i].regex.source, PATTERNS[i].regex.flags);
        re.lastIndex = cursor;
        const m = re.exec(text);
        if (m && (!best || m.index < best.match.index)) {
          best = { patternIdx: i, match: m };
        }
      }

      if (!best) {
        // No more matches — flush the rest as plain text
        plainText += text.slice(cursor);
        break;
      }

      // Flush plain text before the match
      plainText += text.slice(cursor, best.match.index);

      const startPos = plainText.length;

      // Recursively parse inner content (handles nested markup)
      const innerContent = best.match[PATTERNS[best.patternIdx].contentGroup];
      processSegment(innerContent);

      const endPos = plainText.length;

      // Record style ranges
      const styles = PATTERNS[best.patternIdx].toStyles(best.match);
      for (const style of styles) {
        ranges.push({ start: startPos, end: endPos, style });
      }

      // Advance past the full match
      cursor = best.match.index + best.match[0].length;
    }
  }
}

/** Quick check to skip parsing for plain strings. */
function hasMarkup(text: string): boolean {
  return text.includes('*') || text.includes('~') || text.includes('{');
}
