/**
 * @file lineTokenizer.ts
 * @description Splits multi-line instruction text into individual TokenizedLine objects,
 * correctly handling quoted strings, nested braces, nested parentheses, comments,
 * and empty lines.
 *
 * Rules:
 *  - Lines are delimited by `\n`
 *  - Newlines inside single- or double-quoted strings do NOT split lines
 *  - Newlines inside `{...}` or `(...)` blocks do NOT split lines (depth-tracked)
 *  - Lines whose trimmed content starts with `//` or `#` are treated as comments and skipped
 *  - Completely empty/whitespace-only lines are skipped
 *  - Each output line is trimmed
 */

export interface TokenizedLine {
  /** 1-based line number in the original text where this logical line starts */
  lineNumber: number;
  /** Original text of this logical line (trimmed) */
  raw: string;
}

/**
 * Split `instructions` into an array of TokenizedLine objects.
 *
 * @param instructions - The raw multi-line string from the LLM
 * @returns An array of logical lines, each with its starting line number
 */
export function tokenizeLines(instructions: string): TokenizedLine[] {
  const result: TokenizedLine[] = [];

  if (!instructions || instructions.trim() === '') {
    return result;
  }

  let currentLine = '';
  let currentLineStart = 1; // 1-based
  let lineNumber = 1;

  // Nesting depth counters
  let parenDepth = 0;
  let braceDepth = 0;

  // Current quote state: null | '"' | "'"
  let inQuote: '"' | "'" | null = null;

  const len = instructions.length;

  for (let i = 0; i < len; i++) {
    const ch = instructions[i];

    // ------------------------------------------------------------------
    // Newline handling — only split when we're not inside a structural context
    // ------------------------------------------------------------------
    if (ch === '\n') {
      lineNumber++;

      if (inQuote !== null || parenDepth > 0 || braceDepth > 0) {
        // We're inside a string / parens / braces — fold newline into current line
        // Replace with a space to keep the text readable and avoid breaking string values
        currentLine += ' ';
        continue;
      }

      // We have a complete logical line — emit it
      const trimmed = currentLine.trim();
      if (trimmed && !isCommentLine(trimmed)) {
        result.push({ lineNumber: currentLineStart, raw: trimmed });
      }

      // Reset for next line
      currentLine = '';
      currentLineStart = lineNumber;
      continue;
    }

    // ------------------------------------------------------------------
    // Carriage return — just skip (Windows \r\n is handled by \n above)
    // ------------------------------------------------------------------
    if (ch === '\r') {
      continue;
    }

    // ------------------------------------------------------------------
    // String quote handling
    // ------------------------------------------------------------------
    if (inQuote !== null) {
      currentLine += ch;

      if (ch === '\\') {
        // Escape sequence: consume the next character raw, don't interpret it
        i++;
        if (i < len) {
          currentLine += instructions[i];
          // If we just consumed a newline-as-escape, increment line counter
          if (instructions[i] === '\n') lineNumber++;
        }
        continue;
      }

      if (ch === inQuote) {
        // Closing quote
        inQuote = null;
      }

      continue;
    }

    // Not in a string — check for quote open
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      currentLine += ch;
      continue;
    }

    // ------------------------------------------------------------------
    // Comment detection: `//` and `#` at the start of a new expression
    // (only when not nested — depth checks already handled by inQuote above)
    // ------------------------------------------------------------------
    if (ch === '/' && i + 1 < len && instructions[i + 1] === '/') {
      // Rest of line is a comment — skip to end of line
      while (i < len && instructions[i] !== '\n') {
        i++;
      }
      // Back up one so the \n is processed in the next iteration
      i--;
      continue;
    }

    if (ch === '#' && parenDepth === 0 && braceDepth === 0) {
      // Treat # as line comment — skip rest of line
      while (i < len && instructions[i] !== '\n') {
        i++;
      }
      i--;
      continue;
    }

    // ------------------------------------------------------------------
    // Nesting depth tracking
    // ------------------------------------------------------------------
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

    currentLine += ch;
  }

  // Flush any remaining content (file that doesn't end with newline)
  const trimmed = currentLine.trim();
  if (trimmed && !isCommentLine(trimmed)) {
    result.push({ lineNumber: currentLineStart, raw: trimmed });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a trimmed line is a comment.
 * Supports both `//` and `#` style comments.
 */
function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('#');
}
