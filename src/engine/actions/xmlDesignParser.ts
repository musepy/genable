/**
 * @file xmlDesignParser.ts
 * @description Pure XML syntax parser for design markup.
 *
 * Pipeline:  xml string → parseXml() → XmlNode[]
 *
 * This file contains ONLY the syntax layer — no semantic interpretation,
 * no abbreviation expansion, no CSS compilation.
 * Semantic interpretation is handled by xml-interpreter.ts.
 *
 * XML format: <frame>, <text>, <rect>, etc.
 */

// ==========================================
// Parse Options
// ==========================================

export interface XmlParseOptions {
  /** 'create' (default) — new nodes, id attr skipped. 'edit' — update/delete existing nodes, id attr required. 'design' — per-tag: id present → edit, absent → create. */
  mode?: 'create' | 'edit' | 'design';
}

// ==========================================
// XmlNode (internal parse tree)
// ==========================================

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text content between open and close tags (for <text>Hello</text>) */
  textContent: string;
}

// ==========================================
// Lightweight XML Parser
// ==========================================

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

/**
 * Parse an XML string into an array of XmlNode trees.
 * Supports: self-closing tags, single/double quote attributes, XML entities, comments, multiple roots.
 * Does NOT need DOMParser (unavailable in Figma main thread).
 */
export function parseXml(xml: string): XmlNode[] {
  let pos = 0;
  const len = xml.length;

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(xml[pos])) pos++;
  }

  function parseNodes(): XmlNode[] {
    const nodes: XmlNode[] = [];
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;

      // Check for closing tag — signals end of parent context
      if (xml[pos] === '<' && xml[pos + 1] === '/') break;

      // Check for comment
      if (xml.startsWith('<!--', pos)) {
        const endComment = xml.indexOf('-->', pos + 4);
        if (endComment === -1) throw new XmlParseError('Unterminated comment', pos);
        pos = endComment + 3;
        continue;
      }

      // Opening tag
      if (xml[pos] === '<') {
        nodes.push(parseElement());
      } else {
        // Bare text outside any tag — skip it (shouldn't happen in well-formed input)
        break;
      }
    }
    return nodes;
  }

  function parseElement(): XmlNode {
    if (xml[pos] !== '<') throw new XmlParseError(`Expected '<', got '${xml[pos]}'`, pos);
    pos++; // skip '<'

    // Parse tag name
    const tagStart = pos;
    while (pos < len && /[a-zA-Z0-9_-]/.test(xml[pos])) pos++;
    const tag = xml.substring(tagStart, pos).toLowerCase();
    if (!tag) throw new XmlParseError('Empty tag name', tagStart);

    // Parse attributes
    const attrs: Record<string, string> = {};
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) throw new XmlParseError('Unterminated tag', pos);

      // Self-closing
      if (xml[pos] === '/' && xml[pos + 1] === '>') {
        pos += 2;
        return { tag, attrs, children: [], textContent: '' };
      }

      // End of opening tag
      if (xml[pos] === '>') {
        pos++; // skip '>'
        break;
      }

      // Parse attribute name
      const attrNameStart = pos;
      while (pos < len && /[a-zA-Z0-9_:-]/.test(xml[pos])) pos++;
      const attrName = xml.substring(attrNameStart, pos);
      if (!attrName) {
        // Detect LLM truncation patterns: '…' (U+2026) or '...'
        const rest = xml.substring(attrNameStart, Math.min(attrNameStart + 10, len));
        if (rest.includes('…') || rest.startsWith('...')) {
          throw new XmlParseError(
            'Your XML is truncated (contains "…"). Write the COMPLETE xml without abbreviating or omitting tags.',
            attrNameStart
          );
        }
        throw new XmlParseError('Empty attribute name', attrNameStart);
      }

      skipWhitespace();
      if (xml[pos] !== '=') {
        // Boolean attribute (no value) — treat as "true"
        attrs[attrName] = 'true';
        continue;
      }
      pos++; // skip '='
      skipWhitespace();

      // Parse attribute value
      const quote = xml[pos];
      if (quote !== '"' && quote !== "'") {
        throw new XmlParseError(`Expected quote for attribute '${attrName}', got '${quote}'`, pos);
      }
      pos++; // skip opening quote
      const valStart = pos;
      while (pos < len && xml[pos] !== quote) pos++;
      if (pos >= len) throw new XmlParseError(`Unterminated attribute value for '${attrName}'`, valStart);
      attrs[attrName] = decodeEntities(xml.substring(valStart, pos));
      pos++; // skip closing quote
    }

    // Parse children and text content
    const children: XmlNode[] = [];
    let textContent = '';
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) throw new XmlParseError(`Unterminated element <${tag}>`, pos);

      // Closing tag
      if (xml[pos] === '<' && xml[pos + 1] === '/') {
        pos += 2; // skip '</'
        const closeTagStart = pos;
        while (pos < len && /[a-zA-Z0-9_-]/.test(xml[pos])) pos++;
        const closeTag = xml.substring(closeTagStart, pos).toLowerCase();
        if (closeTag !== tag) {
          throw new XmlParseError(`Mismatched tags: <${tag}> closed by </${closeTag}>`, closeTagStart);
        }
        skipWhitespace();
        if (xml[pos] !== '>') throw new XmlParseError(`Expected '>' in closing tag </${tag}>`, pos);
        pos++; // skip '>'
        return { tag, attrs, children, textContent: textContent.trim() };
      }

      // Comment inside element
      if (xml.startsWith('<!--', pos)) {
        const endComment = xml.indexOf('-->', pos + 4);
        if (endComment === -1) throw new XmlParseError('Unterminated comment', pos);
        pos = endComment + 3;
        continue;
      }

      // Child element
      if (xml[pos] === '<') {
        const child = parseElement();
        // <br> inside a text-like parent → inject newline into textContent instead of adding as child
        if (child.tag === 'br') {
          textContent += '\n';
        } else {
          children.push(child);
        }
        continue;
      }

      // Text content
      const textStart = pos;
      while (pos < len && xml[pos] !== '<') pos++;
      textContent += decodeEntities(xml.substring(textStart, pos));
    }

    throw new XmlParseError(`Unterminated element <${tag}>`, pos);
  }

  skipWhitespace();
  const roots = parseNodes();
  if (roots.length === 0) {
    throw new XmlParseError('Empty XML: no elements found', 0);
  }
  return roots;
}

/** Custom error class for XML parse failures. */
export class XmlParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`XML parse error at position ${position}: ${message}`);
    this.name = 'XmlParseError';
  }
}
