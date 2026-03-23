/**
 * @file jsxParser.ts
 * @description Parse JSX-like markup into an AST for design tree creation.
 *
 * Custom recursive descent parser (~250 lines, no deps).
 * The JSX subset is tiny: no expressions, no fragments, no JS interop.
 * Runs in Figma sandbox iframe where bundle size matters.
 *
 * Syntax:
 *   <frame name="Card" w={400} layout="column" p={24}>
 *     <text name="Title" size={24}>Card Title</text>
 *   </frame>
 */

// ── Types ──

export interface JsxNode {
  tag: string;
  attrs: Record<string, any>;
  children: JsxNode[];
  textContent?: string;
  line: number;
}

export interface ParseResult {
  roots: JsxNode[];
  errors: string[];
}

// ── Valid tags ──

const VALID_TAGS = new Set([
  'frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image',
  'group', 'section', 'vector', 'component', 'instance',
]);

// ── Parser state ──

class Parser {
  private pos = 0;
  private line = 1;
  private readonly input: string;
  readonly errors: string[] = [];

  constructor(input: string) {
    this.input = input;
  }

  parse(): JsxNode[] {
    const roots: JsxNode[] = [];

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      if (this.peek() === '<' && this.peekAt(1) !== '/') {
        const node = this.parseElement();
        if (node) roots.push(node);
      } else {
        // Skip unexpected characters until next '<'
        this.skipToNextTag();
      }
    }

    return roots;
  }

  private parseElement(): JsxNode | null {
    const startLine = this.line;

    // Expect '<'
    if (!this.expect('<')) return null;

    // Parse tag name
    const tag = this.parseIdentifier();
    if (!tag) {
      this.errors.push(`L${startLine}: Expected tag name after '<'`);
      this.skipToNextTag();
      return null;
    }

    if (!VALID_TAGS.has(tag)) {
      this.errors.push(`L${startLine}: Unknown tag "${tag}". Valid: ${[...VALID_TAGS].join(', ')}`);
      // Still parse it — error recovery
    }

    // Parse attributes
    const attrs = this.parseAttributes(startLine);

    this.skipWhitespace();

    // Self-closing: />
    if (this.peek() === '/' && this.peekAt(1) === '>') {
      this.advance(2);
      return { tag, attrs, children: [], line: startLine };
    }

    // Opening tag close: >
    if (!this.expect('>')) {
      this.errors.push(`L${startLine}: Expected '>' or '/>' for <${tag}>`);
      this.skipToNextTag();
      return { tag, attrs, children: [], line: startLine };
    }

    // For <text> elements, capture text content between tags
    if (tag === 'text') {
      return this.parseTextElement(tag, attrs, startLine);
    }

    // Parse children
    const children: JsxNode[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      // Check for closing tag
      if (this.peek() === '<' && this.peekAt(1) === '/') {
        break;
      }

      // Check for child element
      if (this.peek() === '<') {
        const child = this.parseElement();
        if (child) children.push(child);
      } else {
        // Skip unexpected content in non-text elements
        this.skipToNextTag();
      }
    }

    // Parse closing tag </tag>
    this.parseClosingTag(tag, startLine);

    return { tag, attrs, children, line: startLine };
  }

  private parseTextElement(
    tag: string,
    attrs: Record<string, string | number>,
    startLine: number,
  ): JsxNode {
    // Collect text content until </text>
    let textContent = '';
    const children: JsxNode[] = [];

    while (this.pos < this.input.length) {
      // Check for closing tag
      if (this.peek() === '<' && this.peekAt(1) === '/') {
        break;
      }

      // Check for child element inside text (e.g. nested elements)
      if (this.peek() === '<') {
        const child = this.parseElement();
        if (child) children.push(child);
        continue;
      }

      // Accumulate text content
      textContent += this.input[this.pos];
      if (this.input[this.pos] === '\n') this.line++;
      this.pos++;
    }

    this.parseClosingTag(tag, startLine);

    const trimmed = textContent.trim();
    return {
      tag, attrs, children,
      ...(trimmed ? { textContent: trimmed } : {}),
      line: startLine,
    };
  }

  private parseClosingTag(expectedTag: string, startLine: number): void {
    this.skipWhitespace();
    if (this.peek() !== '<' || this.peekAt(1) !== '/') {
      this.errors.push(`L${startLine}: Missing closing tag </${expectedTag}>`);
      return;
    }

    this.advance(2); // skip </
    const closingTag = this.parseIdentifier();
    if (closingTag && closingTag !== expectedTag) {
      this.errors.push(`L${this.line}: Mismatched closing tag: expected </${expectedTag}>, got </${closingTag}>`);
    }
    this.skipWhitespace();
    this.expect('>');
  }

  private parseAttributes(elementLine: number): Record<string, any> {
    const attrs: Record<string, any> = {};

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === '>' || ch === '/') break;
      if (ch === '<') break; // malformed

      const key = this.parseAttrName();
      if (!key) {
        // Skip unrecognized character
        this.advance(1);
        continue;
      }

      this.skipWhitespace();

      // Boolean attribute (no =)
      if (this.peek() !== '=') {
        attrs[key] = true as any;
        continue;
      }

      this.advance(1); // skip =
      this.skipWhitespace();

      const value = this.parseAttrValue(elementLine);
      if (value !== null) {
        attrs[key] = value;
      }
    }

    return attrs;
  }

  private parseAttrValue(elementLine: number): any {
    const ch = this.peek();

    // {400} or {value} or {{top:12, bottom:8}} — curly braces with nesting
    if (ch === '{') {
      this.advance(1);
      let val = '';
      let depth = 1;
      while (this.pos < this.input.length && depth > 0) {
        const c = this.input[this.pos];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
        val += c;
        if (c === '\n') this.line++;
        this.pos++;
      }
      if (this.peek() === '}') this.advance(1);
      val = val.trim();
      // Try parsing as JSON object (e.g. {top:12, bottom:8} → add quotes for JSON5)
      if (val.startsWith('{') && val.endsWith('}')) {
        try {
          // JSON5-like: {top:12, b:8} → add quotes around unquoted keys
          const jsonified = val.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
          return JSON.parse(jsonified) as any;
        } catch { /* fall through to string */ }
      }
      const num = Number(val);
      return !isNaN(num) && val !== '' ? num : val;
    }

    // "string" or 'string'
    if (ch === '"' || ch === "'") {
      return this.parseQuotedString();
    }

    // Bare word value (no quotes, no braces)
    let val = '';
    while (this.pos < this.input.length) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\n' || c === '>' || c === '/' || c === '<') break;
      val += c;
      this.pos++;
    }
    if (!val) return null;
    const num = Number(val);
    return !isNaN(num) && val !== '' ? num : val;
  }

  private parseQuotedString(): string {
    const quote = this.peek();
    this.advance(1);
    let val = '';
    while (this.pos < this.input.length && this.peek() !== quote) {
      if (this.peek() === '\\') {
        this.advance(1);
        if (this.pos < this.input.length) {
          val += this.input[this.pos];
          this.pos++;
        }
      } else {
        if (this.input[this.pos] === '\n') this.line++;
        val += this.input[this.pos];
        this.pos++;
      }
    }
    if (this.peek() === quote) this.advance(1);
    return val;
  }

  private parseIdentifier(): string {
    let name = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (/[a-zA-Z0-9_-]/.test(ch)) {
        name += ch;
        this.pos++;
      } else {
        break;
      }
    }
    return name;
  }

  private parseAttrName(): string {
    // Attribute names can include letters, digits, hyphens, underscores, dots (for child.prop), colons (for variant:Size)
    let name = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (/[a-zA-Z0-9_\-.:$]/.test(ch)) {
        name += ch;
        this.pos++;
      } else {
        break;
      }
    }
    return name;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '\n') {
        this.line++;
        this.pos++;
      } else if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private skipToNextTag(): void {
    while (this.pos < this.input.length && this.input[this.pos] !== '<') {
      if (this.input[this.pos] === '\n') this.line++;
      this.pos++;
    }
  }

  private peek(): string {
    return this.input[this.pos] || '';
  }

  private peekAt(offset: number): string {
    return this.input[this.pos + offset] || '';
  }

  private advance(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.pos < this.input.length) {
        if (this.input[this.pos] === '\n') this.line++;
        this.pos++;
      }
    }
  }

  private expect(ch: string): boolean {
    if (this.peek() === ch) {
      this.advance(1);
      return true;
    }
    return false;
  }
}

// ── Public API ──

export function parseJsx(input: string): ParseResult {
  const parser = new Parser(input);
  const roots = parser.parse();
  return { roots, errors: parser.errors };
}
