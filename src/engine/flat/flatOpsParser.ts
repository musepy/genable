/**
 * @file flatOpsParser.ts
 * Parses flat ops format and compiles to FigmaAction[] in a single pass.
 *
 * Format:
 *   symbol = type(parent, {props}, 'textContent')  — create
 *   update('nodeId', {props})                        — update
 *   delete('nodeId')                                 — delete
 *   symbol = ref('Component', parent, {props})       — instance
 *
 * Pipeline: parse → validate refs → compile to FigmaAction
 * Output goes directly to ActionExecutor — no intermediate layers.
 */

import type { OperationIR } from '../../domain/design-ir';
import { normalizeProps } from '../../domain/node-normalizers';
import {
  TAG_TO_TYPE, coerceValue,
  toCamelCase, computeDependsOn,
} from '../utils/prop-dsl';

export interface ParseError { line: number; raw: string; error: string }
export interface ParseWarning { line: number; message: string }

export function parseFlatOps(input: string): { lines: OperationIR[]; errors: ParseError[]; propWarnings: ParseWarning[] } {
  const lines: OperationIR[] = [];
  const errors: ParseError[] = [];
  const propWarnings: ParseWarning[] = [];
  const used = new Set<string>();
  let counter = 0;
  let lineNum = 0;

  function uniq(base: string): string {
    let s = base || ('n' + (++counter));
    if (used.has(s)) { let i = 2; while (used.has(s + i)) i++; s = s + i; }
    used.add(s);
    return s;
  }

  for (const raw of input.split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('//')) continue;
    lineNum++;
    try {
      const lineWarnings: string[] = [];
      lines.push(parseLine(t, lineNum, uniq, lineWarnings));
      for (const msg of lineWarnings) propWarnings.push({ line: lineNum, message: msg });
    } catch (e: any) {
      errors.push({ line: lineNum, raw: t, error: e.message });
    }
  }

  return { lines, errors, propWarnings };
}

// ── Line parser ──

function parseLine(line: string, num: number, uniq: (s: string) => string, warn: string[] = []): OperationIR {
  const pushWarn = (msg: string) => warn.push(msg);

  // delete('nodeId')
  const del = line.match(/^delete\(\s*'([^']+)'\s*\)\s*$/);
  if (del) return { command: 'delete', targetRef: del[1], dependsOn: [], props: {}, lineNumber: num, raw: line };

  // update('nodeId', {props})
  if (line.startsWith('update(')) {
    const args = extractArgs(line, 6);
    const nodeId = unquote(args[0]);
    const props = buildProps(parsePropsBlock(args[1] || ''), '', false, pushWarn);
    return { command: 'update', targetRef: nodeId, props: normalizeProps(props, {}, pushWarn), dependsOn: [], lineNumber: num, raw: line };
  }

  // setProperty(componentRef, {name:'Label', type:'text', target:nodeRef, default:'Button'})
  if (line.startsWith('setProperty(')) {
    return parseSetProperty(line, num, uniq);
  }

  // symbol = type(parent, {props}, 'text')  or  symbol = ref(...)
  const m = line.match(/^(\w+)\s*=\s*(\w+)\(/);
  if (!m) throw new Error('Unrecognized format');

  const [, sym, rawType] = m;
  const tag = rawType.toLowerCase();
  const args = extractArgs(line, m[0].length - 1);

  if (tag === 'ref') return parseRef(num, line, sym, args, uniq, pushWarn);
  if (tag === 'variantset') return parseVariantSet(num, line, sym, args, uniq, pushWarn);
  if (tag === 'clone') return parseClone(num, line, sym, args, uniq, pushWarn);

  const figmaType = TAG_TO_TYPE[tag];
  if (!figmaType || figmaType === 'DELETE' || figmaType === 'REF' || figmaType === 'VARIANT_SET' || figmaType === 'CLONE') throw new Error(`Unknown type: ${tag}`);

  const parent = unquote(args[0] || 'root');
  const rawProps = parsePropsBlock(args[1] || '');
  const textContent = args[2] ? unquote(args[2]) : undefined;

  const isIcon = tag === 'icon';
  const isImage = tag === 'image';
  // component() tag auto-sets reusable:true
  if (tag === 'component') rawProps.reusable = 'true';
  const isReusable = rawProps.reusable === 'true';
  const command = isIcon ? 'icon' : isImage ? 'image' : 'create';

  const props = buildProps(rawProps, tag, isIcon, pushWarn);
  if (textContent && figmaType === 'TEXT') props.characters = textContent;

  return {
    command, lineNumber: num, raw: line, symbol: uniq(sym),
    ...(command === 'create' ? { nodeType: figmaType } : {}),
    parentRef: parent, props: normalizeProps(props, { nodeType: figmaType, isCreate: true }, pushWarn),
    dependsOn: computeDependsOn(parent),
    ...(isReusable ? { reusable: true } : {}),
  };
}

function parseRef(
  num: number, raw: string, sym: string,
  args: string[], uniq: (s: string) => string,
  warn: (msg: string) => void = () => {},
): OperationIR {
  const componentName = unquote(args[0] || '');
  const parent = unquote(args[1] || 'root');
  const rawProps = parsePropsBlock(args[2] || '');

  const props: Record<string, any> = {};
  const overrides: Record<string, Record<string, any>> = {};
  let variantSelector: string | undefined;
  for (const [k, v] of Object.entries(rawProps)) {
    if (k === 'name') { props.name = v; continue; }
    if (k === 'variant') { variantSelector = v; continue; }
    if (k.startsWith('set:')) { overrides[k.substring(4)] = { characters: v }; continue; }
    // Pass raw key — expandShorthands (called by normalizeProps) handles translation
    props[k] = coerceValue(k, v);
  }

  // Only apply toCamelCase for display names with spaces (e.g. 'Button Primary' → 'buttonPrimary').
  // Symbol refs ('btnSet') and Figma IDs ('962:7367') must be kept as-is.
  const compSym = componentName.includes(' ') ? toCamelCase(componentName) : componentName;
  const deps = [...computeDependsOn(parent)];
  if (compSym && !compSym.includes(':')) deps.push(compSym);

  return {
    command: 'instance', lineNumber: num, raw, symbol: uniq(sym),
    parentRef: parent, props: normalizeProps(props, {}, warn), dependsOn: deps,
    componentRef: compSym,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    ...(variantSelector ? { variantSelector } : {}),
  };
}

function parseVariantSet(
  num: number, raw: string, sym: string,
  args: string[], uniq: (s: string) => string,
  warn: (msg: string) => void = () => {},
): OperationIR {
  const parent = unquote(args[0] || 'root');
  const rawProps = parsePropsBlock(args[1] || '');

  const { from: fromStr = '', ...restRawProps } = rawProps;
  const componentSymbols = fromStr.split(',').map(s => s.trim()).filter(Boolean);

  if (componentSymbols.length === 0) throw new Error('variantSet requires "from" with component symbols');

  const deps = [...computeDependsOn(parent), ...componentSymbols];
  // Forward all props (except 'from') through buildProps (abbreviation expansion)
  // then normalizeProps (CSS→Figma conversion: layout:'row'→layoutMode, etc.)
  const builtProps = buildProps(restRawProps, 'frame', false, warn);
  const normProps = normalizeProps(builtProps, { nodeType: 'FRAME', isCreate: true }, warn);

  return {
    command: 'variantSet', lineNumber: num, raw, symbol: uniq(sym),
    parentRef: parent, props: normProps, dependsOn: deps,
    variantComponents: componentSymbols,
  };
}

/**
 * clone(source, parent?, {overrideProps, 'ChildName.prop':value})
 * Deep-clones a node (preserving Component type). Dot-notation keys
 * are split into child overrides.
 */
function parseClone(
  num: number, raw: string, sym: string,
  args: string[], uniq: (s: string) => string,
  warn: (msg: string) => void = () => {},
): OperationIR {
  // clone(source, parent, {props})  or  clone(source, {props})
  let sourceRef: string;
  let parent: string;
  let rawProps: Record<string, string>;

  if (args.length >= 3) {
    sourceRef = unquote(args[0] || '');
    parent = unquote(args[1] || 'root');
    rawProps = parsePropsBlock(args[2] || '');
  } else if (args.length === 2) {
    sourceRef = unquote(args[0] || '');
    // If second arg looks like a props block (starts with { or contains ':'), treat as props
    const second = (args[1] || '').trim();
    if (second.startsWith('{') || second.includes(':')) {
      parent = 'root';
      rawProps = parsePropsBlock(second);
    } else {
      parent = unquote(second);
      rawProps = {};
    }
  } else {
    sourceRef = unquote(args[0] || '');
    parent = 'root';
    rawProps = {};
  }

  if (!sourceRef) throw new Error('clone requires a source symbol');

  // Separate dot-notation keys (child overrides) from root-level keys
  const rootRaw: Record<string, string> = {};
  const childRaw: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    if (k === 'reusable') continue; // clone inherits component status from source
    const dotIdx = k.indexOf('.');
    if (dotIdx > 0) {
      const childName = k.substring(0, dotIdx);
      const childProp = k.substring(dotIdx + 1);
      if (!childRaw[childName]) childRaw[childName] = {};
      childRaw[childName][childProp] = v;
    } else {
      rootRaw[k] = v;
    }
  }

  // Run root props through buildProps (coerces values; expansion handled by normalizeProps)
  const props = buildProps(rootRaw, 'frame', false);
  // Run each child's overrides through buildProps (tag='' for generic handling, then fill→fills)
  const normOverrides: Record<string, Record<string, any>> = {};
  for (const [childName, childProps] of Object.entries(childRaw)) {
    // Use 'text' tag hint so fill→fills conversion works for text children
    const built = buildProps(childProps, 'text', false);
    normOverrides[childName] = normalizeProps(built, {}, warn);
  }

  const deps = [...computeDependsOn(parent)];
  if (sourceRef && !sourceRef.includes(':')) deps.push(sourceRef);

  return {
    command: 'clone', lineNumber: num, raw, symbol: uniq(sym),
    parentRef: parent, sourceRef,
    props: normalizeProps(props, { nodeType: 'FRAME', isCreate: true }, warn),
    overrides: Object.keys(normOverrides).length > 0 ? normOverrides : undefined,
    dependsOn: deps,
  };
}

/**
 * setProperty(componentRef, {name:'Label', type:'text', target:nodeRef, default:'Button'})
 * Adds a Figma component property (TEXT, BOOLEAN, INSTANCE_SWAP) and links it to a child node.
 */
function parseSetProperty(
  line: string, num: number, uniq: (s: string) => string,
): OperationIR {
  const args = extractArgs(line, 11); // 'setProperty('.length - 1
  const componentRef = unquote(args[0] || '');
  const rawProps = parsePropsBlock(args[1] || '');

  const name = rawProps.name;
  const type = rawProps.type; // 'text', 'bool', 'swap'
  const target = rawProps.target;
  const defaultVal = rawProps.default;

  if (!name) throw new Error('setProperty requires "name"');
  if (!type) throw new Error('setProperty requires "type" (text|bool|swap)');
  if (!componentRef) throw new Error('setProperty requires a component reference');

  // Map shorthand types to Figma constants
  const typeMap: Record<string, string> = { text: 'TEXT', bool: 'BOOLEAN', swap: 'INSTANCE_SWAP' };
  const figmaType = typeMap[type] || type;

  const props: Record<string, any> = {
    propertyName: name,
    propertyType: figmaType,
    ...(target ? { targetNodeRef: target } : {}),
    ...(defaultVal !== undefined ? { defaultValue: defaultVal } : {}),
  };

  const deps = computeDependsOn(componentRef);
  if (target && !target.includes(':')) deps.push(target);

  return {
    command: 'componentProperty',
    targetRef: componentRef,
    props,
    dependsOn: deps,
    lineNumber: num,
    raw: line,
  };
}

// ── Build canonical props (mirrors xml-interpreter buildProps) ──

function buildProps(rawProps: Record<string, string>, tag: string, isIcon: boolean, warn: (msg: string) => void = () => {}): Record<string, any> {
  const props: Record<string, any> = {};

  for (const [rawKey, rawValue] of Object.entries(rawProps)) {
    if (rawKey === 'reusable') continue;
    if (rawKey === 'name') { props.name = rawValue; continue; }

    // Icon-specific: 'size' means width+height for icons, not fontSize
    if (rawKey === 'icon' && isIcon) { props.iconName = rawValue; continue; }
    if (rawKey === 'size' && isIcon) {
      const s = coerceValue('width', rawValue);
      props.width = s; props.height = s; continue;
    }

    // Pass raw key with coerced value — expandShorthands (called by normalizeProps)
    // handles all abbreviation expansion and property translation.
    props[rawKey] = coerceValue(rawKey, rawValue);
  }

  return props;
}

// ── Argument extraction ──

function extractArgs(line: string, openParen: number): string[] {
  const args: string[] = [];
  let cur = '';
  let depth = 0, braces = 0, inQ = false;

  for (let i = openParen + 1; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      cur += c;
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
      if (c === "'") inQ = false;
      continue;
    }
    if (c === "'") { inQ = true; cur += c; continue; }
    if (c === '(') { depth++; cur += c; continue; }
    if (c === '{') { braces++; cur += c; continue; }
    if (c === '}') { braces--; cur += c; continue; }
    if (c === ')') {
      if (depth === 0) { if (cur.trim()) args.push(cur.trim()); return args; }
      depth--; cur += c; continue;
    }
    if (c === ',' && depth === 0 && braces === 0) {
      args.push(cur.trim()); cur = ''; continue;
    }
    cur += c;
  }
  throw new Error('Unterminated call');
}

// ── Props block parser ──

function parsePropsBlock(block: string): Record<string, string> {
  let s = block.trim();
  if (s.startsWith('{')) s = s.slice(1);
  if (s.endsWith('}')) s = s.slice(0, -1);
  if (!s.trim()) return {};

  const props: Record<string, string> = {};
  for (const entry of splitTopLevel(s)) {
    const t = entry.trim();
    if (!t) continue;
    const sep = findKeySep(t);
    if (sep === -1) continue;
    props[t.substring(0, sep).trim()] = unquote(t.substring(sep + 1).trim());
  }
  return props;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let cur = '', inQ = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === "'") inQ = false;
      continue;
    }
    if (c === "'") { inQ = true; cur += c; continue; }
    if (c === '(' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

function findKeySep(entry: string): number {
  for (let i = 0; i < entry.length; i++) {
    if (entry[i] !== ':') continue;
    const rest = entry.substring(i + 1).trimStart();
    if (!rest) continue;
    const c = rest[0];
    if (c === "'" || c === '"' || /[\d\-+#.]/.test(c)) return i;
    if (/^(true|false|fill|hug|row|column|none|center|left|right|wrap|visible|hidden|transparent|auto|stack)/i.test(rest)) return i;
  }
  return -1;
}

function unquote(s: string): string {
  s = s.trim();
  if (s.length >= 2 && ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"')))
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
  return s;
}

