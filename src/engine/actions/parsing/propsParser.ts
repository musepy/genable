/**
 * @file propsParser.ts
 * @description Tolerant parser for the props block `{ key: value, ... }` used in
 * build_design instruction lines. Handles JSON-like syntax with common LLM output
 * quirks: unquoted keys, single-quoted strings, trailing commas, nested structures.
 */

/**
 * Parse a props string (the `{ ... }` block from an instruction line) into a
 * plain JavaScript object.  The parser is intentionally tolerant — it handles
 * the full JSON spec as a strict subset, plus:
 *   - Unquoted keys: `{ key: "value" }`
 *   - Single-quoted strings: `{ key: 'value' }`
 *   - Trailing commas: `{ a: 1, b: 2, }`
 *   - Nested objects and arrays
 *   - Numbers, booleans, null
 *   - Escape sequences in strings (\n, \t, \\, \", \', \uXXXX, etc.)
 *
 * If the input cannot be parsed, an empty object is returned.
 */
export function parseProps(propsStr: string): Record<string, any> {
  const trimmed = propsStr.trim();
  if (!trimmed) return {};

  // Fast path: try standard JSON first (handles well-formed output efficiently)
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to tolerant parser
    }
  }

  // Tolerant parse via our hand-rolled recursive descent
  try {
    const parser = new ToleranceParser(trimmed);
    const value = parser.parseValue();
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    // If the top-level is not an object, wrap it
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Internal recursive-descent parser
// ---------------------------------------------------------------------------

class ToleranceParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  // ---- Entry ----

  parseValue(): unknown {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === undefined) return null;

    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === 't') return this.parseLiteral('true', true);
    if (ch === 'f') return this.parseLiteral('false', false);
    if (ch === 'n') return this.parseLiteral('null', null);
    if (ch === '-' || this.isDigit(ch)) return this.parseNumber();

    // Unknown — treat rest as a bareword string
    return this.parseBareword();
  }

  // ---- Object ----

  private parseObject(): Record<string, unknown> {
    this.consume('{');
    const obj: Record<string, unknown> = {};

    this.skipWhitespace();
    while (this.peek() !== '}' && this.pos < this.src.length) {
      this.skipWhitespace();

      // Trailing comma + closing brace
      if (this.peek() === '}') break;

      const key = this.parseKey();
      this.skipWhitespace();

      if (this.peek() === ':') {
        this.consume(':');
      }
      // Tolerate missing colon (key=value style)
      else if (this.peek() === '=') {
        this.consume('=');
      }

      this.skipWhitespace();
      const value = this.parseValue();
      obj[key] = value;

      this.skipWhitespace();

      // Separator: comma, semicolon, or newline — all tolerated
      if (this.peek() === ',' || this.peek() === ';') {
        this.advance();
      }
      // Newlines act as implicit separators
      this.skipWhitespace();
    }

    if (this.peek() === '}') this.advance();
    return obj;
  }

  // ---- Array ----

  private parseArray(): unknown[] {
    this.consume('[');
    const arr: unknown[] = [];

    this.skipWhitespace();
    while (this.peek() !== ']' && this.pos < this.src.length) {
      this.skipWhitespace();
      if (this.peek() === ']') break;

      arr.push(this.parseValue());

      this.skipWhitespace();
      if (this.peek() === ',' || this.peek() === ';') {
        this.advance();
      }
      this.skipWhitespace();
    }

    if (this.peek() === ']') this.advance();
    return arr;
  }

  // ---- Key ----

  /**
   * Parse an object key. Accepts:
   *   - Quoted keys: "key" or 'key'
   *   - Unquoted identifier keys: key
   */
  private parseKey(): string {
    const ch = this.peek();
    if (ch === '"' || ch === "'") {
      return this.parseString();
    }
    // Unquoted identifier
    return this.parseIdentifier();
  }

  // ---- String ----

  private parseString(): string {
    const quote = this.advance(); // consume opening quote
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected quote at pos ${this.pos}`);
    }
    let result = '';

    while (this.pos < this.src.length) {
      const ch = this.advance();
      if (ch === quote) break; // closing quote

      if (ch === '\\') {
        result += this.parseEscape(quote);
      } else {
        result += ch;
      }
    }

    return result;
  }

  private parseEscape(quoteChar: string): string {
    const ch = this.advance();
    switch (ch) {
      case '"': return '"';
      case "'": return "'";
      case '\\': return '\\';
      case '/': return '/';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '0': return '\0';
      case 'u': return this.parseUnicode4();
      default: return ch; // Treat unknown escapes as literal char
    }
  }

  private parseUnicode4(): string {
    const hex = this.src.slice(this.pos, this.pos + 4);
    this.pos += 4;
    const code = parseInt(hex, 16);
    if (isNaN(code)) return '';
    return String.fromCharCode(code);
  }

  // ---- Number ----

  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === '-') this.advance();

    // Integer part
    while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
      this.advance();
    }
    // Fractional part
    if (this.peek() === '.') {
      this.advance();
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        this.advance();
      }
    }
    // Exponent part
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        this.advance();
      }
    }

    return Number(this.src.slice(start, this.pos));
  }

  // ---- Literals ----

  private parseLiteral(word: string, value: unknown): unknown {
    if (this.src.startsWith(word, this.pos)) {
      this.pos += word.length;
      return value;
    }
    // Could be a bareword like "true123" — fall through to bareword
    return this.parseBareword();
  }

  // ---- Identifier / Bareword ----

  private parseIdentifier(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      // Identifier chars: letters, digits, underscore, hyphen, dollar
      if (/[\w\-$]/.test(ch)) {
        this.pos++;
      } else {
        break;
      }
    }
    return this.src.slice(start, this.pos);
  }

  /**
   * Consume characters until a structural delimiter is reached.
   * Used as a fallback for unexpected token types.
   */
  private parseBareword(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ',' || ch === '}' || ch === ']' || ch === '\n' || ch === ';') break;
      this.pos++;
    }
    return this.src.slice(start, this.pos).trim();
  }

  // ---- Helpers ----

  private peek(): string | undefined {
    return this.pos < this.src.length ? this.src[this.pos] : undefined;
  }

  private advance(): string {
    return this.src[this.pos++];
  }

  private consume(expected: string): void {
    if (this.src[this.pos] !== expected) {
      throw new Error(`Expected '${expected}' at pos ${this.pos}, got '${this.src[this.pos]}'`);
    }
    this.pos++;
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.pos++;
      } else if (ch === '/' && this.src[this.pos + 1] === '/') {
        // Skip line comments inside objects/arrays
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }
}
