/**
 * @file templateCompiler.ts
 * @description Compiles JSX markup via sucrase and executes as template functions.
 *
 * Pipeline:
 *   1. preprocessJsx() — sanitize for sucrase (set: → __set_, markdown fences)
 *   2. compileJsx() — sucrase JSX → JS with __h() calls
 *   3. createExecutor() — wrap in async Function with template bindings
 *   4. execute → VNode tree
 *   5. walkTree() — traverse VNodes → create Figma nodes via nodeFactory
 *
 * Error handling: all-or-nothing with 10s timeout.
 */

import { transform } from 'sucrase';
import { getFnCtor } from '../../utils/sandboxEval';
import {
  TEMPLATE_BINDING_NAMES,
  TEMPLATE_BINDING_VALUES,
} from './templateFunctions';
import { normalizeProps } from '../../domain/node-normalizers';
import {
  createFrame, createText, createShape, createIcon,
  createComponent, createInstance,
  normalizeSizingInProps, tagAsAgentCreated,
  type NodeResult,
} from '../actions/nodeFactory';

// ═══════════════════════════════════════════════════════════════════════════
// VNode Types
// ═══════════════════════════════════════════════════════════════════════════

export interface VNode {
  type: string;
  props: Record<string, any>;
  children: (VNode | string)[];
}

// ═══════════════════════════════════════════════════════════════════════════
// h() — JSX createElement producing VNodes
// ═══════════════════════════════════════════════════════════════════════════

const FRAGMENT_TYPE = '__Fragment';

/** createElement function injected as JSX pragma. */
export function h(
  type: any,
  props: Record<string, any> | null,
  ...children: any[]
): VNode {
  const flatChildren = children
    .flat(Infinity)
    .filter(c => c != null && c !== true && c !== false);

  // Fragment: wrap children in a transparent VNode (unwrapped in post-processing)
  if (type === FRAGMENT_TYPE) {
    return { type: FRAGMENT_TYPE, props: {}, children: flatChildren };
  }

  return {
    type: type as string,
    props: props || {},
    children: flatChildren,
  };
}

/** Unwrap fragment VNodes, lifting their children. */
function unwrapFragments(nodes: (VNode | string)[]): (VNode | string)[] {
  return nodes.flatMap(n => {
    if (typeof n === 'object' && n.type === FRAGMENT_TYPE) {
      return unwrapFragments(n.children);
    }
    return [n];
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// JSX Preprocessing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lowercase tag → PascalCase mapping.
 * The LLM writes `<frame>`, `<text>` etc. but sucrase treats lowercase as
 * string literals. We convert to PascalCase so sucrase emits variable references
 * that resolve to node type constants (Frame='FRAME', Text='TEXT', etc.).
 */
const TAG_CAPITALIZE: Record<string, string> = {
  frame: 'Frame', text: 'Text', rect: 'Rect', rectangle: 'Rectangle',
  ellipse: 'Ellipse', line: 'Line', icon: 'Icon', image: 'Image',
  group: 'Group', section: 'Section', vector: 'Vector',
  component: 'Component', instance: 'Instance',
  star: 'Star', polygon: 'Polygon',
};

/**
 * Sanitize JSX string for sucrase:
 * - Strip markdown code fences
 * - Convert lowercase element tags to PascalCase (frame → Frame, text → Text)
 * - Convert `set:foo` attributes to `__set_foo` (namespace syntax unsupported)
 */
export function preprocessJsx(jsx: string): string {
  let processed = jsx.trim();
  // Strip markdown code fences
  processed = processed.replace(/^```(?:jsx|tsx|xml)?\s*\n?/i, '');
  processed = processed.replace(/\n?```\s*$/i, '');
  // Convert lowercase element tags to PascalCase for sucrase
  // Matches opening <tag and closing </tag — preserves attributes/whitespace after
  const tagPattern = new RegExp(
    `<(/?)\\b(${Object.keys(TAG_CAPITALIZE).join('|')})\\b`, 'g',
  );
  processed = processed.replace(tagPattern, (_, slash, tag) => {
    return `<${slash}${TAG_CAPITALIZE[tag] || tag}`;
  });
  // Strip HTML comments (LLM copies from guidelines that use <!-- --> annotations)
  processed = processed.replace(/<!--[\s\S]*?-->/g, '');
  // Convert set:attrName to __set_attrName for sucrase compatibility
  processed = processed.replace(/\bset:(\w+)/g, '__set_$1');
  return processed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Compilation
// ═══════════════════════════════════════════════════════════════════════════

export interface CompileResult {
  code: string;
  error?: { message: string; line?: number };
}

/**
 * Compile JSX string to JavaScript using sucrase.
 * Returns JS code with __h() calls.
 */
export function compileJsx(jsx: string): CompileResult {
  const processed = preprocessJsx(jsx);
  // Wrap in fragment for multi-root support (fragments don't need commas between children)
  const wrapped = `<${FRAGMENT_TYPE}>${processed}</${FRAGMENT_TYPE}>`;
  try {
    const result = transform(wrapped, {
      transforms: ['jsx'],
      jsxPragma: '__h',
      jsxFragmentPragma: FRAGMENT_TYPE,
      production: true,
    });
    return { code: result.code };
  } catch (e: any) {
    const lineMatch = e?.message?.match(/(\d+):(\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1]) : undefined;
    return {
      code: '',
      error: {
        message: e?.message || 'JSX compilation failed',
        line,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════════════════

const FnCtor = getFnCtor();

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Create an async executor function from compiled JS code.
 * Injects h(), Fragment, node type constants, and all template functions.
 */
function createExecutor(jsCode: string): (...args: any[]) => Promise<any> {
  const paramNames = ['__h', FRAGMENT_TYPE, ...TEMPLATE_BINDING_NAMES];
  const body = `"use strict"; return (async function() { return (${jsCode}); })()`;
  return FnCtor(...paramNames, body) as (...args: any[]) => Promise<any>;
}

/** Execute with timeout protection. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Compile and execute JSX markup into a VNode tree.
 * Returns VNodes (no Figma nodes created yet).
 */
export async function compileAndExecute(
  jsxString: string,
  options?: { timeoutMs?: number },
): Promise<{
  vnodes: VNode[];
  error?: { code: string; message: string; line?: number };
}> {
  // Step 1: Compile
  const { code, error: compileError } = compileJsx(jsxString);
  if (compileError) {
    return {
      vnodes: [],
      error: {
        code: 'COMPILE_ERROR',
        message: compileError.message,
        line: compileError.line,
      },
    };
  }

  // Step 2: Execute with timeout
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const executor = createExecutor(code);
    const result = await withTimeout(
      executor(h, FRAGMENT_TYPE, ...TEMPLATE_BINDING_VALUES),
      timeoutMs,
      'JSX template execution timed out (10s limit)',
    );

    // Normalize result to flat array of VNodes
    const raw = Array.isArray(result) ? result : [result];
    const flat = raw.flat(Infinity).filter(
      (v): v is VNode => v != null && typeof v === 'object' && 'type' in v,
    );
    const vnodes = unwrapFragments(flat).filter(
      (v): v is VNode => typeof v === 'object' && 'type' in v,
    );

    return { vnodes };
  } catch (e: any) {
    const lineMatch = e?.stack?.match(/<anonymous>:(\d+)/);
    return {
      vnodes: [],
      error: {
        code: e?.message?.includes('timed out') ? 'TIMEOUT' : 'RUNTIME_ERROR',
        message: e?.message || 'Template execution failed',
        line: lineMatch ? parseInt(lineMatch[1]) : undefined,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Walk Context
// ═══════════════════════════════════════════════════════════════════════════

export interface WalkContext {
  symbolMap: Map<string, string>;
  rollbackStack: string[];
  warnings: Array<{ code: string; message: string }>;
  counter: number;
}

export interface WalkResult {
  nodeId: string;
  name: string;
  type: string;
  childRefs: Array<{ name: string; id: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// walkTree — Complete Executor
// ═══════════════════════════════════════════════════════════════════════════

const SHAPE_TYPES = new Set([
  'RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR', 'STAR', 'POLYGON',
]);

/** Safety net: normalize any remaining lowercase types that slipped through preprocessing. */
export const LOWERCASE_TYPE_MAP: Record<string, string> = {
  frame: 'FRAME', text: 'TEXT', rect: 'RECTANGLE', rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE', line: 'LINE', icon: 'ICON', image: 'IMAGE',
  group: 'GROUP', section: 'SECTION', vector: 'VECTOR',
  component: 'COMPONENT', instance: 'INSTANCE',
  star: 'STAR', polygon: 'POLYGON',
};
const MARGIN_KEYS = new Set([
  'mt', 'mb', 'ml', 'mr',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
]);

/**
 * Recursively walk a VNode tree and create Figma nodes.
 *
 * This is the complete executor — handles normalization, sizing,
 * margin→gap heuristic, layout defaults, instance overrides, and rollback.
 */
export async function walkTree(
  vnode: VNode,
  parentNode: SceneNode | null,
  ctx: WalkContext,
): Promise<WalkResult | null> {
  const sym = `n${++ctx.counter}`;
  const nodeType = LOWERCASE_TYPE_MAP[vnode.type] || vnode.type;
  const props = { ...vnode.props };
  const name = (props.name as string) || nodeType.toLowerCase();
  const pushWarn = (msg: string) =>
    ctx.warnings.push({ code: 'NORMALIZE', message: msg });

  let result: NodeResult;

  try {
    // ── Instance ──
    if (nodeType === 'INSTANCE') {
      const compRef = (props.ref as string) || name;
      const variant = (props.variant as string) || undefined;
      const instanceProps: Record<string, any> = {};
      const overrides: Record<string, Record<string, any>> = {};

      for (const [key, value] of Object.entries(props)) {
        if (key === 'ref' || key === 'variant') continue;
        if (key.startsWith('__set_')) {
          overrides[key.substring(6)] = { characters: value };
          continue;
        }
        instanceProps[key] = value;
      }
      // Don't default instance name to "instance" — Figma's createInstance()
      // already names it after the component (e.g. "LP-v3/Button").
      // Only override if user explicitly wrote name="..." in jsx.

      const normalized = normalizeProps(instanceProps, {}, pushWarn);
      result = await createInstance(
        compRef, parentNode, normalized,
        Object.keys(overrides).length > 0 ? overrides : undefined,
        ctx.symbolMap, variant,
      );

      if (!result.nodeId) {
        const errMsg = result.warnings[0]?.message || 'Instance creation failed';
        ctx.warnings.push({ code: 'INSTANCE_FAILED', message: errMsg });
        return null;
      }

    // ── Text ──
    // Props (incl. characters from string children) already normalized by
    // normalizeTree; walkTree only handles Figma-context sizing + creation.
    } else if (nodeType === 'TEXT') {
      normalizeSizingInProps(props, null, parentNode, true);
      result = await createText(parentNode, props);

    // ── Icon ──
    // icon→iconName + size→w/h already handled by normalizeTree.
    } else if (nodeType === 'ICON') {
      result = await createIcon(parentNode, props);

    // ── Image (placeholder) ──
    // placeholder→name + default fills + layout defaults already handled
    // by normalizeTree.
    } else if (nodeType === 'IMAGE') {
      normalizeSizingInProps(props, null, parentNode, false);
      result = await createFrame(parentNode, props);

    // ── Component ──
    } else if (nodeType === 'COMPONENT') {
      normalizeSizingInProps(props, null, parentNode, false);
      result = await createComponent(parentNode, props, sym);

    // ── Shape or Frame ──
    } else {
      normalizeSizingInProps(props, null, parentNode, false);

      if (SHAPE_TYPES.has(nodeType)) {
        result = await createShape(nodeType, parentNode, props);
      } else {
        result = await createFrame(parentNode, props);
      }
    }
  } catch (e: any) {
    ctx.warnings.push({
      code: 'CREATE_FAILED',
      message: `Failed to create <${nodeType} name="${name}"/>: ${e?.message}`,
    });
    return null;
  }

  // Track for rollback + symbol resolution
  ctx.symbolMap.set(sym, result.nodeId);
  ctx.rollbackStack.push(result.nodeId);
  for (const w of result.warnings) {
    ctx.warnings.push({
      code: w.code || 'PROP_WARNING',
      message: w.message || String(w),
    });
  }

  // Tag as agent-created
  try {
    const createdNode = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
    if (createdNode) tagAsAgentCreated(createdNode);
  } catch { /* best-effort */ }

  // ── Recurse children (VNodes only, not strings) ──
  const childRefs: Array<{ name: string; id: string }> = [];
  const vnodeChildren = vnode.children.filter(
    (c): c is VNode => typeof c === 'object' && c !== null && 'type' in c,
  );
  if (vnodeChildren.length > 0) {
    const createdNode = await figma.getNodeByIdAsync(
      result.nodeId,
    ) as SceneNode | null;
    for (const child of vnodeChildren) {
      const childResult = await walkTree(child, createdNode, ctx);
      if (childResult) {
        childRefs.push({ name: childResult.name, id: childResult.nodeId });
      }
    }
  }

  return { nodeId: result.nodeId, name, type: nodeType, childRefs };
}

// ═══════════════════════════════════════════════════════════════════════════
// Post-processing helpers (ported from jsxHandler)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert children's CSS-style margins into parent gap (Figma has no margins).
 */
export function applyMarginToGap(
  vnode: VNode,
  parentProps: Record<string, any>,
): void {
  const hasGap =
    parentProps.gap !== undefined || parentProps.itemSpacing !== undefined;
  const vnodeChildren = vnode.children.filter(
    (c): c is VNode => typeof c === 'object' && 'type' in c,
  );

  if (!hasGap && vnodeChildren.length > 1) {
    const marginValues: number[] = [];
    for (let i = 0; i < vnodeChildren.length; i++) {
      const child = vnodeChildren[i];
      const mt = child.props.mt ?? child.props.marginTop;
      const mb = child.props.mb ?? child.props.marginBottom;
      if (i > 0 && mt != null) marginValues.push(Number(mt));
      if (mb != null) marginValues.push(Number(mb));
    }
    if (marginValues.length > 0) {
      const freq = new Map<number, number>();
      for (const v of marginValues) freq.set(v, (freq.get(v) || 0) + 1);
      parentProps.gap = [...freq.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0][0];
    }
    // Clean margin props from children
    for (const child of vnodeChildren) {
      for (const key of MARGIN_KEYS) delete child.props[key];
    }
  }
}

const LAYOUT_KEYWORD_TO_MODE: Record<string, string> = {
  row: 'HORIZONTAL', column: 'VERTICAL', horizontal: 'HORIZONTAL',
  vertical: 'VERTICAL', grid: 'GRID', none: 'NONE',
};

/**
 * Inject layout defaults: frames with layout default to hug sizing.
 * GRID containers can't HUG while any track is FLEX (the default), so
 * grid containers default to a fixed size instead of HUG.
 *
 * Runs BEFORE expandShorthands, so `props.layout` is still a raw DSL
 * string (e.g. 'row'/'grid'). Invalid layout values fail-fast in the
 * expander downstream — no tolerant toUpperCase() fallback needed here;
 * if the key is missing from LAYOUT_KEYWORD_TO_MODE, the defaults
 * simply don't run (the expander will throw next).
 */
export function applyLayoutDefaults(
  nodeType: string,
  props: Record<string, any>,
): void {
  const hasLayout =
    props.layoutMode !== undefined || props.layout !== undefined;
  const layoutTypes = new Set([
    'FRAME', 'SECTION', 'COMPONENT', 'IMAGE',
  ]);
  if (!hasLayout || !layoutTypes.has(nodeType)) return;

  const layoutMode: string | undefined =
    props.layoutMode ??
    (typeof props.layout === 'string'
      ? LAYOUT_KEYWORD_TO_MODE[props.layout.toLowerCase().replace(/[-_]/g, '')]
      : undefined);
  const isGrid = layoutMode === 'GRID';
  const defaultH: string | number = isGrid ? 400 : 'hug';
  const defaultV: string | number = isGrid ? 300 : 'hug';

  if (props.h === undefined && props.height === undefined) {
    props.h = defaultV;
  }
  if (props.w === undefined && props.width === undefined) {
    props.w = defaultH;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Icon Prefetch
// ═══════════════════════════════════════════════════════════════════════════

/** Collect all icon names from a VNode tree for batch prefetch. */
export function collectIconNames(vnodes: VNode[]): string[] {
  const names: string[] = [];
  function walk(node: VNode): void {
    if (node.type === 'ICON') {
      const n =
        (node.props.icon as string) ||
        (node.props.iconName as string) ||
        (node.props.name as string);
      if (n) names.push(n);
    }
    for (const child of node.children) {
      if (typeof child === 'object' && 'type' in child) walk(child);
    }
  }
  for (const v of vnodes) walk(v);
  return names;
}
