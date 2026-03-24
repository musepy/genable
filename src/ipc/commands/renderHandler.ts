/**
 * @file renderHandler.ts
 * @description Handler for the `render` command.
 *
 * Parses indentation-based style token markup → generates flat ops → executeFlatOps().
 * Reuses the entire existing pipeline (normalizer, executor, receipt builder).
 *
 * Syntax:
 *   container-token [override:value ...]
 *     text-token: "content"
 *
 * Indentation (2-space) determines parent-child nesting.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import {
  isTextToken, isContainerToken, listTokens,
  getTextStyle, getContainerStyle,
} from '../../engine/styleTokens';
import { executeFlatOps, escapeFlatOpsStr } from './shared';

// ── Compound tokens ──
// Compound tokens look like text (token: content) but expand to multi-node structures.

const COMPOUND_TOKENS = new Set(['swatch', 'type-sample', 'spacing-step']);

function isCompoundToken(token: string): boolean {
  return COMPOUND_TOKENS.has(token);
}

// ── Types ──

interface RenderNode {
  token: string;
  type: 'text' | 'container' | 'compound';
  content?: string;
  overrides?: Record<string, string>;
  children: RenderNode[];
  indent: number;
}

// ── Parser ──

function parseMarkup(input: string): { roots: RenderNode[]; errors: string[] } {
  const lines = input.split('\n');
  const roots: RenderNode[] = [];
  const stack: RenderNode[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, '  ');
    const trimmed = raw.trimStart();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const indent = raw.length - trimmed.length;
    const node = parseLine(trimmed, indent, errors, i + 1);
    if (!node) continue;

    // Pop stack to find correct parent
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    if (node.type === 'container') {
      stack.push(node);
    }
  }

  return { roots, errors };
}

function parseLine(
  line: string, indent: number, errors: string[], lineNum: number,
): RenderNode | null {
  // Text/compound pattern: token [overrides]: "content" or token: content
  const textMatch = line.match(/^([\w-]+)(?:\s+\[([^\]]*)\])?\s*:\s*(.+)$/);
  if (textMatch) {
    const [, token, overrideStr, rawContent] = textMatch;
    let content = rawContent.trim();
    if ((content.startsWith('"') && content.endsWith('"')) ||
        (content.startsWith("'") && content.endsWith("'"))) {
      content = content.slice(1, -1);
    }

    // Compound tokens expand to multi-node structures
    if (isCompoundToken(token)) {
      return { token, type: 'compound' as const, content, children: [], indent };
    }

    if (!isTextToken(token)) {
      const { text } = listTokens();
      errors.push(`L${lineNum}: Unknown text token "${token}". Available: ${text.join(', ')}, swatch, type-sample, spacing-step`);
      return null;
    }

    // Parse optional overrides: [key:value key2:value2]
    let overrides: Record<string, string> | undefined;
    if (overrideStr) {
      overrides = {};
      for (const pair of overrideStr.trim().split(/\s+/)) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx > 0) {
          overrides[pair.slice(0, colonIdx)] = pair.slice(colonIdx + 1);
        }
      }
      if (Object.keys(overrides).length === 0) overrides = undefined;
    }

    return { token, type: 'text', content, overrides, children: [], indent };
  }

  // Container pattern: token [prop:value ...]
  const parts = line.split(/\s+/);
  const token = parts[0];

  if (!isContainerToken(token)) {
    const { text, container } = listTokens();
    errors.push(`L${lineNum}: Unknown token "${token}". Text: ${text.join(', ')}. Container: ${container.join(', ')}`);
    return null;
  }

  const overrides: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const colonIdx = parts[i].indexOf(':');
    if (colonIdx > 0) {
      overrides[parts[i].slice(0, colonIdx)] = parts[i].slice(colonIdx + 1);
    }
  }

  return {
    token, type: 'container',
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    children: [], indent,
  };
}

// ── Flat ops generator ──

function propsToStr(props: Record<string, string | number>): string {
  return Object.entries(props)
    .map(([k, v]) => {
      if (typeof v === 'number') return `${k}:${v}`;
      return `${k}:'${escapeFlatOpsStr(String(v))}'`;
    })
    .join(', ');
}

function generateFlatOps(roots: RenderNode[]): string {
  const lines: string[] = [];
  let counter = 0;

  function emit(node: RenderNode, parentSym: string): string {
    const sym = `n${++counter}`;

    if (node.type === 'compound') {
      return emitCompound(node, parentSym);
    } else if (node.type === 'text') {
      const style = getTextStyle(node.token) || {};
      const merged: Record<string, string | number> = { ...style };
      if (node.overrides) {
        for (const [k, v] of Object.entries(node.overrides)) {
          const num = Number(v);
          merged[k] = !isNaN(num) && v !== '' ? num : v;
        }
      }
      const content = node.content || '';
      lines.push(
        `${sym} = text(${parentSym}, {name:'${escapeFlatOpsStr(node.token)}', ${propsToStr(merged)}}, '${escapeFlatOpsStr(content)}')`,
      );
    } else {
      const base = getContainerStyle(node.token) || {};
      const merged: Record<string, string | number> = { ...base };
      if (node.overrides) {
        for (const [k, v] of Object.entries(node.overrides)) {
          const num = Number(v);
          merged[k] = !isNaN(num) && v !== '' ? num : v;
        }
      }
      lines.push(
        `${sym} = frame(${parentSym}, {name:'${escapeFlatOpsStr(node.token)}', ${propsToStr(merged)}})`,
      );
      for (const child of node.children) {
        emit(child, sym);
      }
    }

    return sym;
  }

  /** Expand compound tokens into multi-node structures. */
  function emitCompound(node: RenderNode, parentSym: string): string {
    const content = node.content || '';

    if (node.token === 'swatch') {
      // swatch: Name #HEXVAL
      const match = content.match(/^(.+?)\s+(#[0-9A-Fa-f]{3,8})$/);
      const name = match ? match[1] : content;
      const color = match ? match[2] : '#CCCCCC';

      const row = `n${++counter}`;
      const rect = `n${++counter}`;
      const info = `n${++counter}`;
      const nameT = `n${++counter}`;
      const valueT = `n${++counter}`;

      lines.push(`${row} = frame(${parentSym}, {name:'${escapeFlatOpsStr(name)}', layout:'horizontal', gap:12, p:'12', corner:8, fill:'#FFFFFF', w:'fill', h:'hug', alignCross:'center'})`);
      lines.push(`${rect} = rect(${row}, {name:'color', w:40, h:40, corner:8, fill:'${color}'})`);
      lines.push(`${info} = frame(${row}, {name:'info', layout:'vertical', gap:2, w:'hug', h:'hug'})`);
      lines.push(`${nameT} = text(${info}, {name:'name', size:14, weight:'Medium', fill:'#1E293B'}, '${escapeFlatOpsStr(name)}')`);
      lines.push(`${valueT} = text(${info}, {name:'value', size:12, weight:'Regular', fill:'#94A3B8'}, '${color}')`);
      return row;
    }

    if (node.token === 'type-sample') {
      // type-sample: Label FontFamily Size Weight
      const parts = content.split(/\s+/);
      const label = parts[0] || 'Text';
      const font = parts[1] || 'Inter';
      const size = parseInt(parts[2]) || 16;
      const weight = parts[3] || 'Regular';

      const wrap = `n${++counter}`;
      const labelT = `n${++counter}`;
      const sampleT = `n${++counter}`;

      lines.push(`${wrap} = frame(${parentSym}, {name:'${escapeFlatOpsStr(label)}', layout:'vertical', gap:4, w:'hug', h:'hug'})`);
      lines.push(`${labelT} = text(${wrap}, {name:'label', size:11, weight:'Medium', fill:'#94A3B8', textCase:'UPPER'}, '${escapeFlatOpsStr(label)} · ${font} ${size}')`);
      lines.push(`${sampleT} = text(${wrap}, {name:'sample', size:${size}, weight:'${weight}', font:'${escapeFlatOpsStr(font)}', fill:'#0F172A'}, 'The quick brown fox jumps over the lazy dog')`);
      return wrap;
    }

    if (node.token === 'spacing-step') {
      // spacing-step: Name Value
      const parts = content.split(/\s+/);
      const name = parts[0] || 'md';
      const value = parseInt(parts[1]) || 16;

      const row = `n${++counter}`;
      const bar = `n${++counter}`;
      const labelT = `n${++counter}`;

      lines.push(`${row} = frame(${parentSym}, {name:'${escapeFlatOpsStr(name)}', layout:'horizontal', gap:12, w:'hug', h:'hug', alignCross:'center'})`);
      lines.push(`${labelT} = text(${row}, {name:'label', size:12, weight:'Medium', fill:'#64748B', w:32}, '${escapeFlatOpsStr(name)}')`);
      lines.push(`${bar} = rect(${row}, {name:'bar', w:${value}, h:12, corner:2, fill:'#6366F1'})`);
      return row;
    }

    // Fallback: treat as plain text
    const sym = `n${++counter}`;
    lines.push(`${sym} = text(${parentSym}, {name:'${escapeFlatOpsStr(node.token)}', size:14, fill:'#475569'}, '${escapeFlatOpsStr(content)}')`);
    return sym;
  }

  // Multiple roots → auto-wrap in column
  if (roots.length > 1) {
    const wrap = `n${++counter}`;
    lines.push(`${wrap} = frame(root, {name:'render', layout:'vertical', gap:16, w:'hug', h:'hug'})`);
    for (const root of roots) emit(root, wrap);
  } else if (roots.length === 1) {
    emit(roots[0], 'root');
  }

  return lines.join('\n');
}

// ── Handler ──

export async function handleRender(parameters: any): Promise<ToolResponse> {
  const { markup, parentId } = parameters;

  if (!markup || typeof markup !== 'string') {
    const tokens = listTokens();
    return {
      data: {
        message: 'render — Create designs using style tokens.',
        usage: 'run({command: "render", input: "card\\n  h1: \\"Title\\"\\n  body: \\"Text\\""})',
        textTokens: tokens.text,
        containerTokens: tokens.container,
      },
    };
  }

  const { roots, errors } = parseMarkup(markup);

  if (roots.length === 0) {
    return {
      error: {
        code: 'PARSE_ERROR',
        message: errors.length > 0
          ? `Parse errors: ${errors.join('; ')}`
          : 'No valid nodes found in markup.',
      },
    };
  }

  const flatOps = generateFlatOps(roots);
  const result = await executeFlatOps(flatOps, parentId);

  // Attach parse errors as stderr warnings
  if (errors.length > 0) {
    const parseWarnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? parseWarnings + '\n' + result._stderr
      : parseWarnings;
  }

  return result;
}
