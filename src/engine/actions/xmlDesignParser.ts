/**
 * @file xmlDesignParser.ts
 * @description Parses XML design markup into ParsedLine[] for the create/edit pipeline.
 *
 * Pipeline:  xml string → parseXml() → XmlNode[] → xmlToParsedLines() → ParsedLine[]
 * The output feeds directly into ActionCompiler → IncrementalExecutor.
 *
 * Two modes:
 * - 'create' (default): XML mirrors the read output. id attr skipped.
 * - 'edit': Tags must have id attr → 'update' command. <delete id="xxx"/> → 'delete' command.
 *
 * XML format: <frame>, <text>, <rect>, etc.
 * Attributes accept CSS-semantic, read-path abbreviation, and Figma-native property names.
 */

import { ParsedLine } from './buildDesignTypes';
import { compileCssProps } from './cssCompiler';

// ==========================================
// Parse Options
// ==========================================

export interface XmlParseOptions {
  /** 'create' (default) — new nodes, id attr skipped. 'edit' — update/delete existing nodes, id attr required. */
  mode?: 'create' | 'edit';
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
      while (pos < len && /[a-zA-Z0-9_-]/.test(xml[pos])) pos++;
      const attrName = xml.substring(attrNameStart, pos);
      if (!attrName) throw new XmlParseError('Empty attribute name', attrNameStart);

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
        children.push(parseElement());
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

// ==========================================
// Tag → Figma Type Mapping
// ==========================================

const TAG_TO_TYPE: Record<string, string> = {
  frame: 'FRAME',
  text: 'TEXT',
  rect: 'RECTANGLE',
  rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  line: 'LINE',
  icon: 'ICON',
  image: 'IMAGE',
  group: 'GROUP',
  section: 'SECTION',
  vector: 'VECTOR',
  delete: 'DELETE',
};

// ==========================================
// Abbreviation Expansion
// ==========================================

const ABBREV_EXPANSION: Record<string, string> = {
  w: 'width',
  h: 'height',
  size: 'fontSize',
  weight: 'fontWeight',
  font: 'fontFamily',
  corner: 'cornerRadius',
  strokeW: 'strokeWeight',
  pt: 'paddingTop',
  pr: 'paddingRight',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  alignMain: 'primaryAxisAlignItems',
  alignCross: 'counterAxisAlignItems',
  textAlign: 'textAlignHorizontal',
  positioning: 'layoutPositioning',
  tracking: 'letterSpacing',
  leading: 'lineHeight',
  strokeA: 'strokeAlign',
  bg: 'background',
  sizingH: 'layoutSizingHorizontal',
  sizingV: 'layoutSizingVertical',
};

/** Properties where string values should NOT be coerced to numbers */
const STRING_VALUE_PROPS = new Set([
  'fontWeight', 'fontFamily', 'name', 'characters',
  'layout', 'layoutMode', 'justifyContent', 'alignItems', 'background',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'textAlignHorizontal',
  'layoutPositioning', 'strokeAlign', 'iconName', 'layoutSizingHorizontal',
  'layoutSizingVertical', 'textAlignVertical', 'textAutoResize',
]);

/** Properties that are numeric when the value is a number, but can also be "fill"/"hug" */
const MIXED_VALUE_PROPS = new Set(['width', 'height']);

/** Properties that are always numeric */
const NUMERIC_PROPS = new Set([
  'fontSize', 'cornerRadius', 'strokeWeight', 'itemSpacing', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'letterSpacing', 'lineHeight', 'opacity',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
]);

/**
 * Try to coerce a string value to a number if appropriate.
 * - Known numeric props always coerce
 * - Known string props never coerce
 * - Unknown props: coerce if the value looks purely numeric
 */
function coerceValue(key: string, value: string): string | number {
  if (STRING_VALUE_PROPS.has(key)) return value;
  if (MIXED_VALUE_PROPS.has(key)) {
    // width/height: coerce "100" to 100, but keep "fill"/"hug" as strings
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  if (NUMERIC_PROPS.has(key)) {
    // Preserve percentage suffix for lineHeight (e.g. '160%' → keep as string for executor)
    if (key === 'lineHeight' && value.endsWith('%')) return value;
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  // Unknown prop: coerce if purely numeric
  const n = parseFloat(value);
  if (!isNaN(n) && String(n) === value) return n;
  return value;
}

// ==========================================
// Special Format Expansion
// ==========================================

/**
 * Expand padding shorthand: "16" → uniform, "16 24" → V H, "10 20 30 40" → T R B L
 */
function expandPadding(value: string): Record<string, number> {
  const parts = value.trim().split(/\s+/).map(Number);
  switch (parts.length) {
    case 1:
      return { paddingTop: parts[0], paddingRight: parts[0], paddingBottom: parts[0], paddingLeft: parts[0] };
    case 2:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[0], paddingLeft: parts[1] };
    case 4:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[3] };
    default:
      // 3 values: T, H, B
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[1] };
  }
}

/**
 * Parse shadow shorthand: "ox,oy,blur,spread,color" → effect object
 * Prefix "inset," → INNER_SHADOW. Multiple shadows separated by ";"
 */
function expandShadow(value: string): any[] {
  return value.split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const isInner = part.toLowerCase().startsWith('inset,');
    const params = isInner ? part.substring(6) : part;
    const [ox, oy, blur, spread, color] = params.split(',').map(s => s.trim());
    return {
      type: isInner ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: color || '#0000001A',
      offset: { x: parseFloat(ox) || 0, y: parseFloat(oy) || 0 },
      radius: parseFloat(blur) || 0,
      spread: parseFloat(spread) || 0,
      visible: true,
    };
  });
}

/**
 * Parse fill/stroke shorthand: "#FFF" → ["#FFF"], "#A,#B" → ["#A", "#B"]
 */
function expandColorList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ==========================================
// XML → ParsedLine[] Converter
// ==========================================

/** Generate a camelCase symbol from a name string */
function toCamelCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * Determine which symbols this parsed line depends on.
 * A reference is a symbol (dependency) if:
 *   - It is not undefined
 *   - It is not the literal string "root"
 *   - It does not look like a real Figma node ID (real IDs contain `:`)
 */
function computeDependsOn(parentRef?: string): string[] {
  if (!parentRef) return [];
  if (parentRef === 'root') return [];
  if (parentRef.includes(':')) return [];
  return [parentRef];
}

/**
 * Convert an XML string directly into a ParsedLine[] array for ActionCompiler.
 *
 * @param xml - XML string with design markup
 * @param options - Parse options (mode: 'create' | 'edit')
 * @returns ParsedLine[] ready for ActionCompiler
 * @throws XmlParseError on malformed XML
 */
export function xmlToParsedLines(xml: string, options?: XmlParseOptions): ParsedLine[] {
  const mode = options?.mode ?? 'create';
  const roots = parseXml(xml);
  const parsedLines: ParsedLine[] = [];
  const usedSymbols = new Set<string>();
  let autoCounter = 0;
  let lineCounter = 0;

  function uniqueSymbol(base: string): string {
    let sym = base;
    if (usedSymbols.has(sym)) {
      let i = 2;
      while (usedSymbols.has(sym + i)) i++;
      sym = sym + i;
    }
    usedSymbols.add(sym);
    return sym;
  }

  function processNode(node: XmlNode, parentSymbol?: string): void {
    const tag = node.tag;
    const figmaType = TAG_TO_TYPE[tag];
    if (!figmaType) {
      throw new XmlParseError(`Unknown tag <${tag}>. Valid: ${Object.keys(TAG_TO_TYPE).join(', ')}`, 0);
    }

    // ── Edit mode: all tags require id attr, <delete> maps to 'delete' command ──
    if (mode === 'edit') {
      const nodeId = node.attrs.id;

      if (tag === 'delete') {
        // <delete id="xxx"/> → delete command
        if (!nodeId) {
          throw new XmlParseError(`<delete> tag requires an 'id' attribute`, 0);
        }
        const lineNumber = ++lineCounter;
        const raw = JSON.stringify({ command: 'delete', targetRef: nodeId });
        parsedLines.push({
          lineNumber,
          raw,
          command: 'delete',
          targetRef: nodeId,
          dependsOn: [],
        });
        return;
      }

      // Non-delete tags in edit mode must have id
      if (!nodeId) {
        throw new XmlParseError(`In edit mode, <${tag}> must have an 'id' attribute referencing an existing node`, 0);
      }

      // Build props from attributes (skip 'id')
      const props: Record<string, any> = {};
      for (const [rawKey, rawValue] of Object.entries(node.attrs)) {
        if (rawKey === 'id') continue;
        if (rawKey === 'name') { props.name = rawValue; continue; }

        const expandedKey = ABBREV_EXPANSION[rawKey] ?? rawKey;
        if (expandedKey === 'padding' || rawKey === 'p') { Object.assign(props, expandPadding(rawValue)); continue; }
        if (expandedKey === 'shadow' || rawKey === 'shadow') { props.effects = expandShadow(rawValue); continue; }
        if (expandedKey === 'fill' || (rawKey === 'fill' && tag !== 'text')) { props.fills = expandColorList(rawValue); continue; }
        if (rawKey === 'fills') { props.fills = expandColorList(rawValue); continue; }
        if (rawKey === 'stroke' || rawKey === 'strokes') { props.strokes = expandColorList(rawValue); continue; }
        props[expandedKey] = coerceValue(expandedKey, rawValue);
      }

      // Text content → characters prop
      if (node.textContent && figmaType === 'TEXT') {
        props.characters = node.textContent;
      }
      if (tag === 'text' && node.attrs.fill) {
        props.fills = expandColorList(node.attrs.fill);
      }

      const lineNumber = ++lineCounter;
      const raw = JSON.stringify({ command: 'update', targetRef: nodeId, props });
      parsedLines.push({
        lineNumber,
        raw,
        command: 'update',
        targetRef: nodeId,
        props: compileCssProps(props),
        dependsOn: [],
      });

      // Process children recursively (edit mode children also need id)
      for (const child of node.children) {
        processNode(child);
      }
      return;
    }

    // ── Create mode (default): unchanged behavior ──

    // Determine command type
    const isIcon = tag === 'icon';
    const isImage = tag === 'image';
    const command = isIcon ? 'icon' : isImage ? 'image' : 'create';

    // Build props from attributes
    const props: Record<string, any> = {};
    let symbolBase: string | undefined;

    for (const [rawKey, rawValue] of Object.entries(node.attrs)) {
      // Skip 'id' attribute (read-path artifact)
      if (rawKey === 'id') continue;

      // Capture name for symbol generation
      if (rawKey === 'name') {
        symbolBase = rawValue;
        props.name = rawValue;
        continue;
      }

      // Handle iconName shorthand
      if (rawKey === 'icon' && isIcon) {
        props.iconName = rawValue;
        continue;
      }

      // Expand abbreviations
      const expandedKey = ABBREV_EXPANSION[rawKey] ?? rawKey;

      // Special format expansions
      if (expandedKey === 'padding' || rawKey === 'p') {
        Object.assign(props, expandPadding(rawValue));
        continue;
      }

      if (expandedKey === 'shadow' || rawKey === 'shadow') {
        props.effects = expandShadow(rawValue);
        continue;
      }

      if (expandedKey === 'fill' || (rawKey === 'fill' && tag !== 'text')) {
        props.fills = expandColorList(rawValue);
        continue;
      }

      if (rawKey === 'fills') {
        props.fills = expandColorList(rawValue);
        continue;
      }

      if (rawKey === 'stroke' || rawKey === 'strokes') {
        props.strokes = expandColorList(rawValue);
        continue;
      }

      // Type coercion
      props[expandedKey] = coerceValue(expandedKey, rawValue);
    }

    // Text content → characters prop
    if (node.textContent && figmaType === 'TEXT') {
      props.characters = node.textContent;
    }

    // For text nodes, 'fill' attribute sets text fill color
    if (tag === 'text' && node.attrs.fill) {
      props.fills = expandColorList(node.attrs.fill);
    }

    // For icon tags: if iconName not explicitly set, infer from name attribute
    if (isIcon && !props.iconName && symbolBase) {
      props.iconName = symbolBase;
    }

    // Generate symbol
    const base = symbolBase ? toCamelCase(symbolBase) : (tag + (++autoCounter));
    const symbol = uniqueSymbol(base || tag + (++autoCounter));

    // Build ParsedLine directly (with compileCssProps)
    const lineNumber = ++lineCounter;
    const raw = JSON.stringify({ command, symbol, type: figmaType, parent: parentSymbol, props });

    const parsedLine: ParsedLine = {
      lineNumber,
      raw,
      symbol,
      command,
      ...(command === 'create' ? { nodeType: figmaType } : {}),
      parentRef: parentSymbol,
      props: compileCssProps(props),
      dependsOn: computeDependsOn(parentSymbol),
    };

    parsedLines.push(parsedLine);

    // Process children recursively
    for (const child of node.children) {
      processNode(child, symbol);
    }
  }

  for (const root of roots) {
    processNode(root);
  }

  return parsedLines;
}
