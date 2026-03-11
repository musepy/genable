/**
 * @file flatOpsParser.ts
 * Parses flat ops format into OperationIR[] for the design pipeline.
 *
 * Format:
 *   symbol = type(parent, {props}, 'textContent')  — create
 *   update('nodeId', {props})                        — update
 *   delete('nodeId')                                 — delete
 *   symbol = ref('Component', parent, {props})       — instance
 *
 * Reuses semantic helpers from xml-interpreter (abbreviation expansion,
 * value coercion, padding expansion) and PropertySpecs for paint/effect.
 */

import type { OperationIR } from '../../domain/design-ir';
import { paintSpec, effectSpec } from '../../domain/property-specs';
import { normalizeProps } from '../../domain/node-normalizers';
import {
  TAG_TO_TYPE, ABBREV_EXPANSION, coerceValue, expandPadding,
  toCamelCase, computeDependsOn,
} from '../utils/prop-dsl';

export interface ParseError { line: number; raw: string; error: string }

export function parseFlatOps(input: string): { lines: OperationIR[]; errors: ParseError[] } {
  const lines: OperationIR[] = [];
  const errors: ParseError[] = [];
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
      lines.push(parseLine(t, lineNum, uniq));
    } catch (e: any) {
      errors.push({ line: lineNum, raw: t, error: e.message });
    }
  }

  return { lines, errors };
}

// ── Line parser ──

function parseLine(line: string, num: number, uniq: (s: string) => string): OperationIR {
  // delete('nodeId')
  const del = line.match(/^delete\(\s*'([^']+)'\s*\)\s*$/);
  if (del) return { command: 'delete', targetRef: del[1], dependsOn: [], props: {}, lineNumber: num, raw: line };

  // update('nodeId', {props})
  if (line.startsWith('update(')) {
    const args = extractArgs(line, 6);
    const nodeId = unquote(args[0]);
    const props = buildProps(parsePropsBlock(args[1] || ''), '', false);
    return { command: 'update', targetRef: nodeId, props: normalizeProps(props), dependsOn: [], lineNumber: num, raw: line };
  }

  // symbol = type(parent, {props}, 'text')  or  symbol = ref(...)
  const m = line.match(/^(\w+)\s*=\s*(\w+)\(/);
  if (!m) throw new Error('Unrecognized format');

  const [, sym, rawType] = m;
  const tag = rawType.toLowerCase();
  const args = extractArgs(line, m[0].length - 1);

  if (tag === 'ref') return parseRef(num, line, sym, args, uniq);

  const figmaType = TAG_TO_TYPE[tag];
  if (!figmaType || figmaType === 'DELETE' || figmaType === 'REF') throw new Error(`Unknown type: ${tag}`);

  const parent = unquote(args[0] || 'root');
  const rawProps = parsePropsBlock(args[1] || '');
  const textContent = args[2] ? unquote(args[2]) : undefined;

  const isIcon = tag === 'icon';
  const isImage = tag === 'image';
  const isReusable = rawProps.reusable === 'true';
  const command = isIcon ? 'icon' : isImage ? 'image' : 'create';

  const props = buildProps(rawProps, tag, isIcon);
  if (textContent && figmaType === 'TEXT') props.characters = textContent;

  const parentRef = parent === 'root' ? undefined : parent;
  return {
    command, lineNumber: num, raw: line, symbol: uniq(sym),
    ...(command === 'create' ? { nodeType: figmaType } : {}),
    parentRef, props: normalizeProps(props, { nodeType: figmaType, isCreate: true }),
    dependsOn: computeDependsOn(parentRef),
    ...(isReusable ? { reusable: true } : {}),
  };
}

function parseRef(
  num: number, raw: string, sym: string,
  args: string[], uniq: (s: string) => string,
): OperationIR {
  const componentName = unquote(args[0] || '');
  const parent = unquote(args[1] || 'root');
  const rawProps = parsePropsBlock(args[2] || '');

  const props: Record<string, any> = {};
  const overrides: Record<string, Record<string, any>> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    if (k === 'name') { props.name = v; continue; }
    if (k.startsWith('set:')) { overrides[k.substring(4)] = { characters: v }; continue; }
    const exp = ABBREV_EXPANSION[k] ?? k;
    if (exp === 'padding' || k === 'p') { Object.assign(props, expandPadding(v)); continue; }
    props[exp] = coerceValue(exp, v);
  }

  const compSym = toCamelCase(componentName);
  const parentRef = parent === 'root' ? undefined : parent;
  const deps = [...computeDependsOn(parentRef)];
  if (compSym && !compSym.includes(':')) deps.push(compSym);

  return {
    command: 'instance', lineNumber: num, raw, symbol: uniq(sym),
    parentRef, props: normalizeProps(props), dependsOn: deps,
    componentRef: compSym,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  };
}

// ── Build canonical props (mirrors xml-interpreter buildProps) ──

function buildProps(rawProps: Record<string, string>, tag: string, isIcon: boolean): Record<string, any> {
  const props: Record<string, any> = {};

  for (const [rawKey, rawValue] of Object.entries(rawProps)) {
    if (rawKey === 'reusable') continue;

    if (rawKey === 'name') { props.name = rawValue; continue; }

    // Icon-specific
    if (rawKey === 'icon' && isIcon) { props.iconName = rawValue; continue; }
    if (rawKey === 'size' && isIcon) {
      const s = coerceValue('width', rawValue);
      props.width = s; props.height = s; continue;
    }

    const expandedKey = ABBREV_EXPANSION[rawKey] ?? rawKey;

    if (expandedKey === 'padding' || rawKey === 'p') { Object.assign(props, expandPadding(rawValue)); continue; }
    if (expandedKey === 'shadow' || rawKey === 'shadow') { props.effects = effectSpec.parseXml(rawValue); continue; }
    if (expandedKey === 'fill' || (rawKey === 'fill' && tag !== 'text') || rawKey === 'fills') { props.fills = paintSpec.parseXml(rawValue); continue; }
    if (rawKey === 'stroke' || rawKey === 'strokes') { props.strokes = paintSpec.parseXml(rawValue); continue; }
    if (expandedKey === 'clipsContent') {
      const v = rawValue.toLowerCase();
      props.clipsContent = (v === 'hidden' || v === 'clip' || v === 'true');
      continue;
    }

    props[expandedKey] = coerceValue(expandedKey, rawValue);
  }

  // Text fill from fill attribute
  if (tag === 'text' && rawProps.fill) {
    props.fills = paintSpec.parseXml(rawProps.fill);
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
    if (/^(true|false|fill|hug|row|column|none|center|left|right|wrap|visible|hidden|transparent|auto)/i.test(rest)) return i;
  }
  return -1;
}

function unquote(s: string): string {
  s = s.trim();
  if (s.length >= 2 && ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"')))
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
  return s;
}
