/**
 * @file xml-interpreter.ts
 * @description Interprets XmlNode[] (syntax layer) into OperationIR[] (semantic layer).
 *
 * This is the semantic bridge between the XML parser and the compiler.
 * It applies:
 *   - Abbreviation expansion (w → width, bg → background, etc.)
 *   - PropertySpec parsing for complex types (paint, effect, unitValue)
 *   - NodeNormalizer rules (CSS → Figma cross-property rewrites)
 *   - Value coercion (string → number for known numeric props)
 *
 * Replaces the semantic portion of xmlToParsedLines() in xmlDesignParser.ts.
 */

import type { XmlNode } from '../actions/xmlDesignParser';
import type { OperationIR, CanonicalProps } from '../../domain/design-ir';
import { paintSpec, effectSpec, unitValueSpec } from '../../domain/property-specs';
import { normalizeProps } from '../../domain/node-normalizers';

// ═══════════════════════════════════════════════
// Tag → Figma Type Mapping
// ═══════════════════════════════════════════════

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
  ref: 'REF',
};

// ═══════════════════════════════════════════════
// Abbreviation Expansion (same as xmlDesignParser)
// ═══════════════════════════════════════════════

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
  overflow: 'clipsContent',
  wrap: 'layoutWrap',
  minW: 'minWidth',
  maxW: 'maxWidth',
  minH: 'minHeight',
  maxH: 'maxHeight',
};

// ═══════════════════════════════════════════════
// Value classification
// ═══════════════════════════════════════════════

const STRING_VALUE_PROPS = new Set([
  'fontWeight', 'fontFamily', 'name', 'characters',
  'layout', 'layoutMode', 'justifyContent', 'alignItems', 'background',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'textAlignHorizontal',
  'layoutPositioning', 'strokeAlign', 'iconName', 'layoutSizingHorizontal',
  'layoutSizingVertical', 'textAlignVertical', 'textAutoResize',
  'layoutWrap', 'component',
]);

const MIXED_VALUE_PROPS = new Set(['width', 'height']);

const NUMERIC_PROPS = new Set([
  'fontSize', 'cornerRadius', 'strokeWeight', 'itemSpacing', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'letterSpacing', 'lineHeight', 'opacity',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
]);

/** Properties that use the unitValue spec (lineHeight, letterSpacing) */
const UNIT_VALUE_PROPS = new Set(['lineHeight', 'letterSpacing']);

function coerceValue(key: string, value: string): string | number {
  if (STRING_VALUE_PROPS.has(key)) return value;
  if (MIXED_VALUE_PROPS.has(key)) {
    if (value.endsWith('%')) return value;
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  if (NUMERIC_PROPS.has(key)) {
    if (key === 'lineHeight' && value.endsWith('%')) return value;
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  const n = parseFloat(value);
  if (!isNaN(n) && String(n) === value) return n;
  return value;
}

// ═══════════════════════════════════════════════
// Special format parsers
// ═══════════════════════════════════════════════

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
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[1] };
  }
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function toCamelCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function computeDependsOn(parentRef?: string): string[] {
  if (!parentRef) return [];
  if (parentRef === 'root') return [];
  if (parentRef.includes(':')) return [];
  return [parentRef];
}

// ═══════════════════════════════════════════════
// Main interpreter
// ═══════════════════════════════════════════════

export interface InterpretOptions {
  mode?: 'create' | 'edit' | 'design';
}

/**
 * Interpret XmlNode[] into OperationIR[].
 *
 * Applies:
 *   - Abbreviation expansion
 *   - PropertySpec parsing (paint, effect, unitValue)
 *   - NodeNormalizer rules (CSS → Figma)
 *   - Value coercion
 */
export function interpretXmlNodes(nodes: XmlNode[], options?: InterpretOptions): OperationIR[] {
  const mode = options?.mode ?? 'create';
  const operations: OperationIR[] = [];
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
      // Unknown tag — skip, process children
      if (tag === 'br') return;
      if (node.textContent && parentSymbol) {
        processNode({ tag: 'text', attrs: {}, children: [], textContent: node.textContent }, parentSymbol);
      }
      for (const child of node.children) {
        processNode(child, parentSymbol);
      }
      return;
    }

    const isEditTag = mode === 'edit' || (mode === 'design' && (tag === 'delete' || !!node.attrs.id));

    if (isEditTag) {
      const nodeId = node.attrs.id;

      if (tag === 'delete') {
        if (!nodeId) throw new Error(`<delete> tag requires an 'id' attribute`);
        const ln = ++lineCounter;
        operations.push({
          command: 'delete',
          targetRef: nodeId,
          dependsOn: [],
          props: {},
          lineNumber: ln,
          raw: JSON.stringify({ command: 'delete', targetRef: nodeId }),
        });
        return;
      }

      if (!nodeId) {
        throw new Error(`In edit mode, <${tag}> must have an 'id' attribute`);
      }

      const props = buildProps(node, tag, false);
      const ln = ++lineCounter;
      operations.push({
        command: 'update',
        targetRef: nodeId,
        dependsOn: [],
        props: normalizeProps(props, { nodeType: figmaType }),
        lineNumber: ln,
        raw: JSON.stringify({ command: 'update', targetRef: nodeId }),
      });

      for (const child of node.children) {
        processNode(child);
      }
      return;
    }

    // ── Create path ──

    // <ref> → instance
    if (figmaType === 'REF') {
      const componentRef = node.attrs.component;
      if (!componentRef) throw new Error(`<ref> tag requires a 'component' attribute`);

      const props: Record<string, any> = {};
      const overrides: Record<string, Record<string, any>> = {};
      let symbolBase: string | undefined;

      for (const [rawKey, rawValue] of Object.entries(node.attrs)) {
        if (rawKey === 'id' || rawKey === 'component') continue;
        if (rawKey === 'name') { symbolBase = rawValue; props.name = rawValue; continue; }
        if (rawKey.startsWith('set:')) {
          overrides[rawKey.substring(4)] = { characters: rawValue };
          continue;
        }
        const expandedKey = ABBREV_EXPANSION[rawKey] ?? rawKey;
        if (expandedKey === 'padding' || rawKey === 'p') { Object.assign(props, expandPadding(rawValue)); continue; }
        props[expandedKey] = coerceValue(expandedKey, rawValue);
      }

      const componentSymbol = toCamelCase(componentRef);
      const base = symbolBase ? toCamelCase(symbolBase) : ('ref' + (++autoCounter));
      const symbol = uniqueSymbol(base || 'ref' + (++autoCounter));

      const depList = [...computeDependsOn(parentSymbol)];
      if (componentSymbol && !componentSymbol.includes(':')) {
        depList.push(componentSymbol);
      }

      const ln = ++lineCounter;
      operations.push({
        command: 'instance',
        symbol,
        parentRef: parentSymbol,
        props: normalizeProps(props),
        dependsOn: depList,
        componentRef: componentSymbol,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        lineNumber: ln,
        raw: JSON.stringify({ command: 'instance', symbol, componentRef: componentSymbol }),
      });
      return;
    }

    const isIcon = tag === 'icon';
    const isImage = tag === 'image';
    const command = isIcon ? 'icon' : isImage ? 'image' : 'create';
    const isReusable = node.attrs.reusable === 'true';

    const props = buildProps(node, tag, isIcon);

    // Icon-specific handling
    if (isIcon && !props.iconName && props.name) {
      props.iconName = props.name;
    }
    if (isIcon && props._iconFamily && props.iconName && !String(props.iconName).includes(':')) {
      props.iconName = `${props._iconFamily}:${props.iconName}`;
    }
    delete props._iconFamily;

    const symbolBase = props.name ? toCamelCase(String(props.name)) : (tag + (++autoCounter));
    const symbol = uniqueSymbol(symbolBase || tag + (++autoCounter));

    const normalized = normalizeProps(props, { nodeType: figmaType });

    // Apply sizing defaults for create ops (canonicalize phase)
    if (command === 'create') {
      canonicalizeSizing(normalized, !!parentSymbol, figmaType);
    }

    const ln = ++lineCounter;
    operations.push({
      command,
      symbol,
      ...(command === 'create' ? { nodeType: figmaType } : {}),
      parentRef: parentSymbol,
      props: normalized,
      dependsOn: computeDependsOn(parentSymbol),
      ...(isReusable ? { reusable: true } : {}),
      lineNumber: ln,
      raw: JSON.stringify({ command, symbol, type: figmaType, parent: parentSymbol }),
    });

    for (const child of node.children) {
      processNode(child, symbol);
    }
  }

  /**
   * Build canonical props from XML attributes.
   * Uses PropertySpecs for complex types.
   */
  function buildProps(node: XmlNode, tag: string, isIcon: boolean): Record<string, any> {
    const props: Record<string, any> = {};

    for (const [rawKey, rawValue] of Object.entries(node.attrs)) {
      if (rawKey === 'id' || rawKey === 'reusable') continue;

      if (rawKey === 'name') { props.name = rawValue; continue; }

      // Icon-specific
      if (rawKey === 'icon' && isIcon) { props.iconName = rawValue; continue; }
      if (rawKey === 'size' && isIcon) {
        const s = coerceValue('width', rawValue);
        props.width = s;
        props.height = s;
        continue;
      }
      if (rawKey === 'family' && isIcon) { props._iconFamily = rawValue; continue; }

      const expandedKey = ABBREV_EXPANSION[rawKey] ?? rawKey;

      // ── Special format expansions ──
      if (expandedKey === 'padding' || rawKey === 'p') {
        Object.assign(props, expandPadding(rawValue));
        continue;
      }

      // Shadow → use effectSpec.parseXml
      if (expandedKey === 'shadow' || rawKey === 'shadow') {
        props.effects = effectSpec.parseXml(rawValue);
        continue;
      }

      // Fill/fills → use paintSpec.parseXml
      if (expandedKey === 'fill' || (rawKey === 'fill' && tag !== 'text') || rawKey === 'fills') {
        props.fills = paintSpec.parseXml(rawValue);
        continue;
      }

      // Stroke/strokes → use paintSpec.parseXml
      if (rawKey === 'stroke' || rawKey === 'strokes') {
        props.strokes = paintSpec.parseXml(rawValue);
        continue;
      }

      // overflow → clipsContent
      if (expandedKey === 'clipsContent') {
        const v = rawValue.toLowerCase();
        props.clipsContent = (v === 'hidden' || v === 'clip' || v === 'true');
        continue;
      }

      // UnitValue properties (lineHeight, letterSpacing) → use unitValueSpec
      if (UNIT_VALUE_PROPS.has(expandedKey)) {
        // Keep as string/number for now — the executor will convert to {value, unit}
        // This preserves backward compatibility with the existing pipeline
        props[expandedKey] = coerceValue(expandedKey, rawValue);
        continue;
      }

      props[expandedKey] = coerceValue(expandedKey, rawValue);
    }

    // Text content → characters
    if (node.textContent && TAG_TO_TYPE[tag] === 'TEXT') {
      props.characters = node.textContent;
    }

    // Text fill from fill attribute
    if (tag === 'text' && node.attrs.fill) {
      props.fills = paintSpec.parseXml(node.attrs.fill);
    }

    return props;
  }

  /**
   * Inject sensible sizing defaults for create ops to prevent Figma's 100×100px fallback.
   * Called during canonicalization (Pass 2) so the compiler doesn't need to.
   */
  function canonicalizeSizing(props: Record<string, any>, hasParent: boolean, nodeType: string): void {
    const isFrame = nodeType === 'FRAME' || nodeType === 'SECTION' || nodeType === 'GROUP';
    const isShape = !isFrame && nodeType !== 'TEXT';

    if (isFrame) {
      // Root frame: ensure reasonable width (avoid 100px default)
      if (!hasParent && props.width === undefined && props.layoutSizingHorizontal !== 'FILL') {
        props.width = 360;
      }

      // Frame with layoutMode: default to HUG height so it wraps content
      if (props.layoutMode && props.height === undefined && props.layoutSizingVertical === undefined) {
        props.layoutSizingVertical = 'HUG';
      }

      // Auto-layout frames: default clipsContent to false so child shadows/effects aren't clipped
      if (props.layoutMode && props.clipsContent === undefined) {
        props.clipsContent = false;
      }

      // Child frame: default to FILL width (stretch to parent)
      if (hasParent && props.width === undefined && props.layoutSizingHorizontal === undefined) {
        props.layoutSizingHorizontal = 'FILL';
      }
    }

    // Child shapes (RECTANGLE, etc.): default to FILL width
    if (isShape && hasParent && props.width === undefined && props.layoutSizingHorizontal === undefined) {
      props.layoutSizingHorizontal = 'FILL';
    }
  }

  for (const root of nodes) {
    processNode(root);
  }

  return operations;
}
