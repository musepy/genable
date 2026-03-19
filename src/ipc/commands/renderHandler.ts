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

// ── Types ──

interface RenderNode {
  token: string;
  type: 'text' | 'container';
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
  // Text pattern: token: "content" or token: content
  const textMatch = line.match(/^([\w-]+)\s*:\s*(.+)$/);
  if (textMatch) {
    const [, token, rawContent] = textMatch;
    let content = rawContent.trim();
    if ((content.startsWith('"') && content.endsWith('"')) ||
        (content.startsWith("'") && content.endsWith("'"))) {
      content = content.slice(1, -1);
    }

    if (!isTextToken(token)) {
      const { text } = listTokens();
      errors.push(`L${lineNum}: Unknown text token "${token}". Available: ${text.join(', ')}`);
      return null;
    }

    return { token, type: 'text', content, children: [], indent };
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

    if (node.type === 'text') {
      const style = getTextStyle(node.token) || {};
      const content = node.content || '';
      lines.push(
        `${sym} = text(${parentSym}, {name:'${escapeFlatOpsStr(node.token)}', ${propsToStr(style)}}, '${escapeFlatOpsStr(content)}')`,
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
      success: true,
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
      success: false,
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
