/**
 * @file toolCallHandler.ts
 * @description IPC handler for TOOL_CALL events.
 *
 * [RESPONSIBILITY]: Route tool calls to appropriate services.
 * [PATTERN]: Command Handler - thin layer that delegates to services.
 */

import { ToolResultHandler } from '../../types';
import { ToolResponse, ToolContext } from '../../engine/agent/tools/types';
import { emit } from '@create-figma-plugin/utilities';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { FlatOpsSerializer } from '../../engine/flat/flatOpsSerializer';

import { ActionExecutor } from '../../engine/actions/executor';
import { collectTreeViolations } from '../../engine/validation/postOpValidator';
import { compileDesignOps } from '../../engine/flat/flatOpsParser';
import { logger } from '../../utils/logger';
import { CONTEXT_CONSTANTS } from '../../engine/agent/context/constants';
import { fontBus } from '../../engine/figma-adapter/resources/FontBus';
import { buildCreateReceipt } from './receiptBuilder';
import type { ValidationViolation } from '../../engine/validation/postOpValidator';
import { findClosestCommand } from '../../engine/agent/tools/unified/commandRegistry';
import { memoryList, memoryGet, memoryGetAll, memorySet, memoryDelete } from './memoryStore';

export interface ToolCallData {
  toolName: string;
  parameters: any;
  context?: ToolContext;
  requestId: string;
}

// ── Shared node resolution (single source for getNodeByIdAsync + type guard) ──

type NodeResolved = { ok: true; node: SceneNode } | { ok: false; response: ToolResponse };

async function resolveSceneNode(nodeId: string): Promise<NodeResolved> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    return { ok: false, response: { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node "${nodeId}" not found. Use ls("/") to discover available nodes.` } } };
  }
  // SceneNode always has 'visible'; PageNode / DocumentNode don't
  if (!('visible' in node)) {
    return { ok: false, response: { success: false, error: { code: 'INVALID_NODE_TYPE', message: `"${nodeId}" is a ${node.type}, not a design node. Use ls("/") to find design nodes.` } } };
  }
  return { ok: true, node: node as SceneNode };
}

// ── VFS path resolution ──
// Resolves filesystem-style paths to Figma nodes.
// "/" = current page, "/NodeName/" = named child, "/Parent/Child/" = nested path.
// Segments containing ":" are treated as Figma node IDs.

type PathResolved =
  | { ok: true; isPage: true; page: PageNode }
  | { ok: true; isPage: false; node: SceneNode }
  | { ok: false; response: ToolResponse };

async function resolvePathToNode(path: string): Promise<PathResolved> {
  const segments = path.split('/').filter(s => s.length > 0);

  // "/" → current page
  if (segments.length === 0) {
    return { ok: true, isPage: true, page: figma.currentPage };
  }

  let current: BaseNode = figma.currentPage;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // If segment looks like a Figma node ID (contains ':'), resolve directly
    if (segment.includes(':')) {
      const node = await figma.getNodeByIdAsync(segment);
      if (!node) {
        return {
          ok: false,
          response: {
            success: false,
            error: {
              code: 'PATH_NOT_FOUND',
              message: `Node ID "${segment}" not found in path "${path}". Use ls("/") to discover available nodes.`,
            },
          },
        };
      }
      current = node;
      continue;
    }

    // Otherwise, find child by name
    if (!('children' in current)) {
      return {
        ok: false,
        response: {
          success: false,
          error: {
            code: 'NOT_A_CONTAINER',
            message: `"${current.name}" (${current.type.toLowerCase()}) has no children — cannot navigate to "${segment}". Use cat to read its properties instead.`,
          },
        },
      };
    }

    const children = (current as any).children as readonly BaseNode[];
    const match = children.find(c => c.name === segment);
    if (!match) {
      // Actionable error: show available children (Unix-style)
      const available = children.slice(0, 15).map(c => c.name);
      const suffix = children.length > 15 ? `, ... (${children.length} total)` : '';
      return {
        ok: false,
        response: {
          success: false,
          error: {
            code: 'PATH_NOT_FOUND',
            message: `"${segment}" not found in "${current.name}". Available: ${available.join(', ')}${suffix}`,
          },
        },
      };
    }
    current = match;
  }

  // Check if it's a scene node
  if (!('visible' in current)) {
    return {
      ok: false,
      response: {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `"${current.name}" (${current.type}) is not a design node. Use ls on parent path to find valid design nodes.`,
        },
      },
    };
  }

  return { ok: true, isPage: false, node: current as SceneNode };
}

/** Build the path string for a node (for ls/tree output). */
function buildNodePath(node: BaseNode): string {
  const parts: string[] = [];
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    parts.unshift(current.name);
    current = current.parent;
  }
  return '/' + parts.join('/');
}

/** Build tree lines recursively (for page-root tree). */
function buildTreeLines(
  node: SceneNode,
  lines: string[],
  prefix: string,
  childPrefix: string,
  remainingDepth: number,
  suggestedReads: string[],
): void {
  const hasChildren = 'children' in node && (node as any).children.length > 0;
  const type = node.type.toLowerCase();
  const w = Math.round(node.width);
  const h = Math.round(node.height);

  let info = `${type} ${w}×${h}`;
  if ('layoutMode' in node && (node as any).layoutMode !== 'NONE') {
    info += `, layout:${(node as any).layoutMode === 'HORIZONTAL' ? 'row' : 'column'}`;
  }
  if (node.type === 'TEXT') {
    const text = (node as any).characters as string;
    const preview = text.length > 20 ? text.slice(0, 17) + '...' : text;
    info += ` "${preview}"`;
  }

  const dirSlash = hasChildren ? '/' : '';
  lines.push(`${prefix}${node.name}${dirSlash} (${info})`);

  if (hasChildren && remainingDepth > 0) {
    const children = (node as any).children as SceneNode[];
    if (children.length > 3) {
      suggestedReads.push(node.id);
    }
    for (let i = 0; i < children.length; i++) {
      const isLast = i === children.length - 1;
      buildTreeLines(
        children[i],
        lines,
        childPrefix + (isLast ? '└── ' : '├── '),
        childPrefix + (isLast ? '    ' : '│   '),
        remainingDepth - 1,
        suggestedReads,
      );
    }
  } else if (hasChildren) {
    const count = (node as any).children.length;
    lines.push(`${childPrefix}... (${count} children, use tree with more depth)`);
  }
}

/** Format a single ls entry: "Name/    type  WxH  [key props]" */
function formatLsEntry(node: SceneNode): string {
  const hasChildren = 'children' in node && (node as any).children.length > 0;
  const name = hasChildren ? `${node.name}/` : node.name;
  const type = node.type.toLowerCase();

  // Dimensions
  const w = Math.round(node.width);
  const h = Math.round(node.height);
  let dims = `${w}×${h}`;

  // Key properties for quick scanning
  const props: string[] = [];
  if ('layoutMode' in node && (node as any).layoutMode !== 'NONE') {
    props.push(`layout:${(node as any).layoutMode === 'HORIZONTAL' ? 'row' : 'column'}`);
  }
  if ('itemSpacing' in node && typeof (node as any).itemSpacing === 'number' && (node as any).itemSpacing > 0) {
    props.push(`gap:${(node as any).itemSpacing}`);
  }
  if (node.type === 'TEXT') {
    const text = (node as any).characters as string;
    const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
    props.push(`"${preview}"`);
  }

  const propsStr = props.length > 0 ? `  ${props.join('  ')}` : '';
  return `${name.padEnd(24)} ${type.padEnd(8)} ${dims}${propsStr}`;
}

// ── FS command helpers ──

/** Normalize a path: strip trailing slash (except root "/"). */
function normalizePath(path: string): string {
  if (path === '/' || path === '') return '/';
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Split a path into parent path and node name. */
function splitPath(path: string): { parentPath: string; nodeName: string } {
  const segments = path.split('/').filter(s => s.length > 0);
  const nodeName = segments.pop() || '';
  const parentPath = segments.length > 0 ? '/' + segments.join('/') : '/';
  return { parentPath, nodeName };
}

/** Strip outer {} from a props raw string. */
function stripBraces(propsRaw: string): string {
  let s = propsRaw.trim();
  if (s.startsWith('{')) s = s.slice(1);
  if (s.endsWith('}')) s = s.slice(0, -1);
  return s.trim();
}

/** Escape single quotes for flat ops string embedding. */
function escapeFlatOpsStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Inject name prop into props inner string if not already present. */
function injectNameProp(propsInner: string, name: string): string {
  if (/\bname\s*:/.test(propsInner)) return propsInner;
  const escaped = escapeFlatOpsStr(name);
  return propsInner
    ? `name:'${escaped}', ${propsInner}`
    : `name:'${escaped}'`;
}

// ── Layout defaults ──
// Figma UI defaults layout frames to hug on both axes.
// The API defaults to fixed 100px. Bridge this gap for mk.

/**
 * Inject sensible sizing defaults for layout frames.
 * If a frame has `layout` but no explicit w/h, default to `hug`.
 */
function injectLayoutDefaults(type: string | undefined, propTokens: string[]): string[] {
  const effectiveType = type || 'frame';
  if (effectiveType !== 'frame' && effectiveType !== 'section') return propTokens;

  const hasLayout = propTokens.some(t => t.startsWith('layout:') || t.startsWith('layoutMode:'));
  if (!hasLayout) return propTokens;

  const hasExplicitH = propTokens.some(t =>
    t.startsWith('h:') || t.startsWith('height:') || t.startsWith('sizingV:')
  );
  const hasExplicitW = propTokens.some(t =>
    t.startsWith('w:') || t.startsWith('width:') || t.startsWith('sizingH:')
  );

  const result = [...propTokens];
  if (!hasExplicitH) result.push('h:hug');
  if (!hasExplicitW) result.push('w:hug');
  return result;
}

// ── Glob support ──
// Enables wildcard patterns in paths: rm /Card/Placeholder*, cat /Card/Btn*

/** Check if a path contains a glob pattern. */
function hasGlob(path: string): boolean {
  return path.includes('*');
}

/** Match a node name against a simple glob pattern (supports *, prefix*, *suffix, pre*suf). */
function matchGlob(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return name === pattern;
  const parts = pattern.split('*');
  if (parts.length === 2) {
    return (parts[0] === '' || name.startsWith(parts[0])) &&
           (parts[1] === '' || name.endsWith(parts[1]));
  }
  // Multiple wildcards: convert to regex
  const regex = new RegExp('^' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return regex.test(name);
}

/**
 * Resolve a glob path to matching SceneNodes.
 * Only supports glob in the LAST segment: /Card/Placeholder* → children of Card matching "Placeholder*".
 */
async function resolveGlobPaths(path: string): Promise<SceneNode[]> {
  const segments = path.split('/').filter(s => s.length > 0);
  if (segments.length === 0) return [];

  const lastSegment = segments[segments.length - 1];
  if (!lastSegment.includes('*')) return [];

  // Resolve parent (all segments except last)
  const parentPath = segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : '/';
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return [];

  const parent = parentResolved.isPage ? figma.currentPage : parentResolved.node;
  if (!('children' in parent)) return [];

  return (parent as any).children.filter((child: SceneNode) => matchGlob(child.name, lastSegment));
}

/**
 * Shared flat ops execution pipeline.
 * Parses ops string → compiles → executes → returns receipt.
 * Used by `design` and all FS write commands.
 */
async function executeFlatOps(
  opsStr: string,
  parentId?: string,
): Promise<ToolResponse> {
  let compiled;
  try {
    compiled = compileDesignOps(opsStr, parentId, ActionExecutor.getRegisteredSymbols());
    if (compiled.ops.length === 0 && compiled.errors.length > 0) {
      return { success: false, error: { code: 'PARSE_ERROR', message: compiled.errors.map(e => `L${e.lineNumber}: ${e.error}`).join('; ') } };
    }
    if (compiled.diagnostics.length > 0) {
      logger.info('Design diagnostics', { diagnostics: compiled.diagnostics });
    }
  } catch (e: any) {
    return { success: false, error: { code: 'PARSE_ERROR', message: e.message } };
  }

  try {
    const SOFT_CREATE_LIMIT = 20;
    const executor = new ActionExecutor();
    const result = await executor.executeDesignOps(compiled.ops, compiled.errors, {
      onError: 'continue', rollbackMode: 'none', parentId,
    });

    const rootId = parentId || Object.values(result.idMap)[0];
    const violations = await collectViolationsForNodeIds([rootId], 5);

    const receipt = buildCreateReceipt({
      result,
      violations,
      softCreateLimit: SOFT_CREATE_LIMIT,
      createLineCount: compiled.ops.length,
    });

    if (compiled.diagnostics.length > 0) {
      receipt.diagnostics = compiled.diagnostics.slice(0, 10).map(d => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
      }));
    }

    // Auto-pan viewport to newly created root node
    if (!parentId && Object.keys(result.idMap).length > 0) {
      const newRootId = Object.values(result.idMap)[0] as string;
      const newRootNode = await figma.getNodeByIdAsync(newRootId);
      if (newRootNode) figma.viewport.scrollAndZoomIntoView([newRootNode as SceneNode]);
    }

    if (result.hasErrors) {
      const parts: string[] = [];
      if (result.stats.created) parts.push(`${result.stats.created} created`);
      if (result.stats.edited) parts.push(`${result.stats.edited} edited`);
      if (result.stats.deleted) parts.push(`${result.stats.deleted} deleted`);
      if (result.stats.failed) parts.push(`${result.stats.failed} failed`);
      if (result.stats.skipped) parts.push(`${result.stats.skipped} skipped`);
      return { success: false, data: receipt, error: { code: 'PARTIAL_FAILURE', message: `${parts.join(', ')}. Use idMap for references.` } };
    }

    return { success: true, data: receipt };
  } catch (e: any) {
    return { success: false, error: { code: 'EXECUTION_ERROR', message: `${e?.message ?? 'Unexpected error'}. Verify node references with ls or tree, then retry.` } };
  }
}

async function collectViolationsForNodeIds(
  nodeIds: Array<string | undefined>,
  maxDepth: number,
  maxViolations: number = 10
): Promise<ValidationViolation[] | undefined> {
  const uniqueNodeIds = [...new Set(nodeIds.filter((nodeId): nodeId is string => Boolean(nodeId)))];
  if (uniqueNodeIds.length === 0) return undefined;

  const violations: ValidationViolation[] = [];
  const seen = new Set<string>();

  for (const nodeId of uniqueNodeIds) {
    if (violations.length >= maxViolations) break;
    const resolved = await resolveSceneNode(nodeId);
    if (!resolved.ok) continue;

    const found = collectTreeViolations(resolved.node, maxDepth, maxViolations - violations.length);
    for (const violation of found) {
      const key = `${violation.nodeId}:${violation.code}:${violation.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation);
      if (violations.length >= maxViolations) break;
    }
  }

  return violations.length > 0 ? violations : undefined;
}


// ── Shared screenshot helper (used by read) ──

interface ScreenshotResult {
  success: true;
  __image: { mimeType: string; data: string };
  width: number;
  height: number;
}

async function exportNodeToBase64(
  node: SceneNode,
  scale: number = 1,
  format: 'png' | 'jpg' = 'png'
): Promise<ScreenshotResult> {
  const exportFormat = (format === 'png' ? 'PNG' : 'JPG') as 'PNG' | 'JPG';
  const exportScale = Math.min(Math.max(scale, 0.5), 2);
  const bytes = await node.exportAsync({
    format: exportFormat,
    constraint: { type: 'SCALE', value: exportScale }
  });

  // Uint8Array → base64 (Figma main thread has no Buffer or btoa)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    base64 += CHARS[b0 >> 2] + CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    base64 += (i + 1 < bytes.length) ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    base64 += (i + 2 < bytes.length) ? CHARS[b2 & 63] : '=';
  }
  const mimeType = exportFormat === 'PNG' ? 'image/png' : 'image/jpeg';

  return {
    success: true,
    __image: { mimeType, data: base64 },
    width: Math.round(node.width * exportScale),
    height: Math.round(node.height * exportScale),
  };
}

// ── mk command helpers ──

/**
 * Convert a key:value prop token to flat ops format.
 * Quotes non-numeric values with single quotes for the flat ops parser.
 */
function mkPropToFlatOps(token: string): string {
  const colonIdx = token.indexOf(':');
  if (colonIdx < 0) return token;
  const key = token.slice(0, colonIdx);
  const val = token.slice(colonIdx + 1);
  // set:ChildName:text → split on second colon: key="set:ChildName", val="text"
  if (key === 'set') {
    const secondColon = val.indexOf(':');
    if (secondColon >= 0) {
      const childName = val.slice(0, secondColon);
      const text = val.slice(secondColon + 1);
      return `set:${childName}:'${escapeFlatOpsStr(text)}'`;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(val)) return `${key}:${val}`;
  return `${key}:'${val.replace(/'/g, "\\'")}'`;
}

/**
 * Execute a single mk command by converting to flat ops.
 * - Path exists → update
 * - Path doesn't exist → create
 */
async function executeSingleMk(
  path: string,
  type?: string,
  refComponent?: string,
  propTokens: string[] = [],
  textContent?: string,
): Promise<ToolResponse> {
  const { parentPath, nodeName } = splitPath(path);
  if (!nodeName) {
    return { success: false, error: { code: 'INVALID_PATH', message: 'mk requires a target name in path, e.g. mk /Card/ or mk /Card/Title' } };
  }

  // Try to resolve the full path to check if node exists (for upsert)
  const existing = await resolvePathToNode(path);
  if (existing.ok && !existing.isPage) {
    // Node exists → update mode (ignore type)
    const nodeId = existing.node.id;
    const propsBlock = propTokens.map(mkPropToFlatOps).join(', ');
    if (!propsBlock && !textContent) {
      return { success: true, data: { message: `Node "${nodeName}" already exists (${nodeId}). No properties to update.`, idMap: { [nodeName]: nodeId } } };
    }
    let ops = `update('${nodeId}', {${propsBlock}})`;
    // If textContent is provided for an existing text node, update characters too
    if (textContent) {
      const escaped = escapeFlatOpsStr(textContent);
      ops = `update('${nodeId}', {${propsBlock ? propsBlock + ', ' : ''}characters:'${escaped}'})`;
    }
    return await executeFlatOps(ops);
  }

  // Node doesn't exist → create mode
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return parentResolved.response;

  const parentId = parentResolved.isPage ? undefined : parentResolved.node.id;
  const adjustedTokens = injectLayoutDefaults(type, propTokens);
  const propsInner = adjustedTokens.map(mkPropToFlatOps).join(', ');
  const propsWithName = injectNameProp(propsInner, nodeName);

  let ops: string;
  if (type === 'variantset') {
    // variantSet: mk /ButtonSet/ variantset from:id1,id2,id3
    ops = `n1 = variantSet(root, {${propsWithName}})`;
  } else if (refComponent) {
    const escapedComp = escapeFlatOpsStr(refComponent);
    ops = `n1 = ref('${escapedComp}', root, {${propsWithName}})`;
  } else if (type === 'text' || textContent) {
    const nodeType = type || 'text';
    const textArg = textContent ? `, '${escapeFlatOpsStr(textContent)}'` : '';
    ops = `n1 = ${nodeType}(root, {${propsWithName}}${textArg})`;
  } else {
    const nodeType = type || 'frame';
    ops = `n1 = ${nodeType}(root, {${propsWithName}})`;
  }

  return await executeFlatOps(ops, parentId);
}

/**
 * Execute a batch of mk commands.
 * Parses each line → resolves parents → builds flat ops with cross-references.
 */
async function executeMkBatch(batchInput: string): Promise<ToolResponse> {
  const lines = batchInput.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//'));

  if (lines.length === 0) {
    return { success: false, error: { code: 'EMPTY_BATCH', message: 'No mk commands in batch input.' } };
  }

  const MK_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector', 'variantset']);

  // Phase 1: Parse all lines with inline parser
  interface MkLine {
    path: string;
    parentPath: string;
    nodeName: string;
    type?: string;
    refComponent?: string;
    propTokens: string[];
    textContent?: string;
  }

  const parsed: MkLine[] = [];
  for (const line of lines) {
    // Strip leading "mk " if present
    const stripped = line.startsWith('mk ') ? line.slice(3).trim() : line;

    // Simple tokenizer: split by spaces, respecting single-quoted strings
    const tokens: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < stripped.length; i++) {
      const ch = stripped[i];
      if (inQ) {
        if (ch === "'") { inQ = false; } else { cur += ch; }
      } else if (ch === "'") {
        inQ = true;
      } else if (ch === ' ' || ch === '\t') {
        if (cur) { tokens.push(cur); cur = ''; }
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);

    if (tokens.length === 0) continue;

    const path = tokens[0];
    let type: string | undefined;
    let refComponent: string | undefined;
    let propsStart = 1;

    if (tokens[1]) {
      if (MK_TYPES.has(tokens[1])) { type = tokens[1]; propsStart = 2; }
      else if (tokens[1].startsWith('ref:')) { refComponent = tokens[1].slice(4); propsStart = 2; }
    }

    const propTokens: string[] = [];
    const textParts: string[] = [];
    let hitSep = false;
    for (let i = propsStart; i < tokens.length; i++) {
      if (tokens[i] === '--') { hitSep = true; continue; }
      if (hitSep) { textParts.push(tokens[i]); }
      else if (tokens[i].includes(':')) { propTokens.push(tokens[i]); }
      else { textParts.push(tokens[i]); }
    }

    const { parentPath, nodeName } = splitPath(path);
    if (!nodeName) continue;

    parsed.push({
      path: normalizePath(path), parentPath: normalizePath(parentPath), nodeName, type, refComponent, propTokens,
      textContent: textParts.length > 0 ? textParts.join(' ') : undefined,
    });
  }

  if (parsed.length === 0) {
    return { success: false, error: { code: 'PARSE_ERROR', message: 'No valid mk commands parsed from batch input.' } };
  }

  // Phase 2: Pre-resolve all unique parent paths
  // Build a symbol table: path → symbol name (for cross-referencing within batch)
  const pathToSymbol = new Map<string, string>();
  const pathToNodeId = new Map<string, string>();
  let symbolCounter = 0;

  function getSymbol(path: string): string {
    if (pathToSymbol.has(path)) return pathToSymbol.get(path)!;
    const sym = `n${++symbolCounter}`;
    pathToSymbol.set(path, sym);
    return sym;
  }

  // Resolve existing paths
  const uniquePaths = new Set<string>();
  for (const line of parsed) {
    uniquePaths.add(line.path);
    uniquePaths.add(line.parentPath);
  }

  for (const p of uniquePaths) {
    const resolved = await resolvePathToNode(p);
    if (resolved.ok) {
      pathToNodeId.set(p, resolved.isPage ? 'PAGE_ROOT' : resolved.node.id);
    }
  }

  // Phase 3: Generate flat ops
  const opsLines: string[] = [];
  let defaultParentId: string | undefined;

  for (const line of parsed) {
    const adjustedTokens = injectLayoutDefaults(line.type, line.propTokens);
    const propsInner = adjustedTokens.map(mkPropToFlatOps).join(', ');
    const propsWithName = injectNameProp(propsInner, line.nodeName);

    // Check if target exists → update (use propsInner, not propsWithName — don't rename on update)
    const existingId = pathToNodeId.get(line.path);
    if (existingId && existingId !== 'PAGE_ROOT') {
      if (line.textContent) {
        const escaped = escapeFlatOpsStr(line.textContent);
        opsLines.push(`update('${existingId}', {${propsInner ? propsInner + ', ' : ''}characters:'${escaped}'})`);
      } else if (propsInner) {
        opsLines.push(`update('${existingId}', {${propsInner}})`);
      }
      continue;
    }

    // Determine parent reference
    let parentRef: string;
    const parentId = pathToNodeId.get(line.parentPath);
    if (parentId === 'PAGE_ROOT') {
      parentRef = 'root';
      // Don't set defaultParentId — root means page root
    } else if (parentId) {
      parentRef = `'${parentId}'`;
    } else if (pathToSymbol.has(line.parentPath)) {
      // Parent was created earlier in this batch
      parentRef = pathToSymbol.get(line.parentPath)!;
    } else {
      parentRef = 'root';
    }

    const sym = getSymbol(line.path);

    if (line.type === 'variantset') {
      // variantSet: resolve from: paths/IDs to symbols
      // The from: prop in propsWithName already contains the IDs/symbols
      opsLines.push(`${sym} = variantSet(${parentRef}, {${propsWithName}})`);
    } else if (line.refComponent) {
      const escaped = escapeFlatOpsStr(line.refComponent);
      opsLines.push(`${sym} = ref('${escaped}', ${parentRef}, {${propsWithName}})`);
    } else if (line.type === 'text' || line.textContent) {
      const nodeType = line.type || 'text';
      const textArg = line.textContent ? `, '${escapeFlatOpsStr(line.textContent)}'` : '';
      opsLines.push(`${sym} = ${nodeType}(${parentRef}, {${propsWithName}}${textArg})`);
    } else {
      const nodeType = line.type || 'frame';
      opsLines.push(`${sym} = ${nodeType}(${parentRef}, {${propsWithName}})`);
    }
  }

  if (opsLines.length === 0) {
    return { success: true, data: { message: 'All nodes already exist. No changes needed.' } };
  }

  return await executeFlatOps(opsLines.join('\n'), defaultParentId);
}

// ── Virtual path: /.agent/memory/ → persistent memory store ──

const MEMORY_PREFIX = '/.agent/memory';

function isMemoryPath(path: string | undefined): boolean {
  if (!path) return false;
  return path === MEMORY_PREFIX || path === MEMORY_PREFIX + '/' || path.startsWith(MEMORY_PREFIX + '/');
}

function extractMemoryKey(path: string): string {
  // "/.agent/memory/foo" → "foo", "/.agent/memory/" → "", "/.agent/memory" → ""
  const after = path.slice(MEMORY_PREFIX.length);
  return after.replace(/^\//, '').replace(/\/$/, '');
}

async function handleMemoryCommand(toolName: string, parameters: any): Promise<ToolResponse | null> {
  const path: string | undefined = parameters.path;
  if (!isMemoryPath(path)) return null;

  const key = extractMemoryKey(path!);

  switch (toolName) {
    case 'ls': {
      const keys = await memoryList();
      if (keys.length === 0) {
        return { success: true, data: { listing: '(empty)', path: MEMORY_PREFIX, count: 0, hint: 'Use mk to create memories: mk /.agent/memory/key text -- value' } };
      }
      const listing = keys.map(k => k).join('\n');
      return { success: true, data: { listing, path: MEMORY_PREFIX, count: keys.length } };
    }

    case 'tree': {
      const keys = await memoryList();
      const lines = ['.agent/memory/'];
      for (let i = 0; i < keys.length; i++) {
        const prefix = i === keys.length - 1 ? '└── ' : '├── ';
        lines.push(prefix + keys[i]);
      }
      return { success: true, data: { tree: lines.join('\n'), count: keys.length } };
    }

    case 'cat': {
      if (!key) {
        // cat /.agent/memory/ → dump all memories
        const all = await memoryGetAll();
        if (Object.keys(all).length === 0) {
          return { success: true, data: { memories: {}, hint: 'No memories stored. Use mk /.agent/memory/key text -- value' } };
        }
        return { success: true, data: { memories: all } };
      }
      const value = await memoryGet(key);
      if (value === undefined) {
        const keys = await memoryList();
        return { success: false, error: { code: 'NOT_FOUND', message: `Memory "${key}" not found. Available: ${keys.join(', ') || '(none)'}` } };
      }
      return { success: true, data: { key, value } };
    }

    case 'mk': {
      if (!key) {
        return { success: false, error: { code: 'MISSING_KEY', message: 'Memory key required. Usage: mk /.agent/memory/my-key text -- value to store' } };
      }
      const textContent = parameters.textContent;
      if (!textContent) {
        return { success: false, error: { code: 'MISSING_VALUE', message: `No value provided. Usage: mk /.agent/memory/${key} text -- value to store` } };
      }
      await memorySet(key, textContent);
      return { success: true, data: { key, stored: textContent, hint: 'Memory saved. Persists across sessions.' } };
    }

    case 'rm': {
      if (!key) {
        return { success: false, error: { code: 'MISSING_KEY', message: 'Specify which memory to delete. Usage: rm /.agent/memory/key' } };
      }
      const existed = await memoryDelete(key);
      if (!existed) {
        return { success: false, error: { code: 'NOT_FOUND', message: `Memory "${key}" not found.` } };
      }
      return { success: true, data: { key, deleted: true } };
    }

    default:
      return { success: false, error: { code: 'UNSUPPORTED', message: `Command "${toolName}" is not supported on memory paths. Use ls, cat, mk, rm.` } };
  }
}

/**
 * Handle TOOL_CALL IPC events.
 * Routes to the unified tool implementations.
 */
export async function handleToolCall(data: ToolCallData): Promise<void> {
  let { toolName, parameters, context, requestId } = data;

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    // ── Virtual path interception: /.agent/memory/ ──
    const memoryResponse = await handleMemoryCommand(toolName, parameters);
    if (memoryResponse) {
      response = memoryResponse;
    } else {

    switch (toolName) {
      // ==========================================
      // VFS READ COMMANDS — filesystem metaphor
      // ==========================================

      case 'ls': {
        // List children at a path — like Unix ls
        const lsPath = parameters.path || '/';

        // Glob support: ls /Card/Btn*
        if (hasGlob(lsPath)) {
          const globNodes = await resolveGlobPaths(lsPath);
          if (globNodes.length === 0) {
            response = { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${lsPath}".` } };
            break;
          }
          const lines = globNodes.map(n => formatLsEntry(n));
          response = {
            success: true,
            data: {
              listing: lines.join('\n'),
              path: lsPath,
              container: `glob(${lsPath})`,
              count: globNodes.length,
              footer: `[${globNodes.length} matches]`,
            },
          };
          break;
        }

        const resolved = await resolvePathToNode(lsPath);
        if (!resolved.ok) { response = resolved.response; break; }

        // Get the container (page or scene node)
        let children: readonly SceneNode[];
        let containerName: string;

        if (resolved.isPage) {
          children = resolved.page.children;
          containerName = resolved.page.name;
        } else {
          const node = resolved.node;
          if (!('children' in node)) {
            response = {
              success: false,
              error: {
                code: 'NOT_A_CONTAINER',
                message: `"${node.name}" (${node.type.toLowerCase()}) has no children. Use cat("${lsPath}") to see its properties.`,
              },
            };
            break;
          }
          children = (node as any).children as SceneNode[];
          containerName = node.name;
        }

        // Format ls output
        const lines: string[] = [];
        for (const child of children) {
          lines.push(formatLsEntry(child));
        }

        // Page metadata footer
        const page = figma.currentPage;
        const footer = `[${children.length} items | page: "${page.name}"]`;

        // Selection info if on page root
        let selectionInfo = '';
        if (resolved.isPage && page.selection.length > 0) {
          const sel = page.selection.slice(0, 5).map(n => n.name).join(', ');
          const more = page.selection.length > 5 ? ` (+${page.selection.length - 5} more)` : '';
          selectionInfo = `\nSelection: ${sel}${more}`;
        }

        response = {
          success: true,
          data: {
            listing: lines.join('\n'),
            path: lsPath,
            container: containerName,
            count: children.length,
            footer: footer + selectionInfo,
          },
        };
        break;
      }

      case 'tree': {
        // Structural tree at a path — like Unix tree
        const treePath = parameters.path || '/';
        const treeDepth = Math.min(parameters.depth || 5, 10);

        const resolved = await resolvePathToNode(treePath);
        if (!resolved.ok) { response = resolved.response; break; }

        // For page root, we need to handle differently
        if (resolved.isPage) {
          const page = resolved.page;
          const lines: string[] = [`${page.name}/ (page, ${page.children.length} children)`];

          // Build tree for each top-level child
          const suggestedReads: string[] = [];
          for (let i = 0; i < page.children.length; i++) {
            const child = page.children[i];
            const isLast = i === page.children.length - 1;
            buildTreeLines(child, lines, isLast ? '└── ' : '├── ', isLast ? '    ' : '│   ', treeDepth - 1, suggestedReads);
          }

          const treeData: any = {
            tree: lines.join('\n'),
            path: treePath,
          };
          if (suggestedReads.length > 0) {
            treeData.suggestedReads = suggestedReads.map(id => {
              const n = page.findOne(node => node.id === id);
              return n ? `${buildNodePath(n)} (${id})` : id;
            });
          }

          response = { success: true, data: treeData };
          break;
        }

        // Scene node — use existing serialization for consistency
        const treeNode = resolved.node;
        const treeSerialized = NodeSerializer.serializeWithCompression(treeNode, {
          maxDepth: treeDepth,
          pruneDefaults: true,
        });
        const treeXml = FlatOpsSerializer.serialize(treeSerialized, {
          maxDepth: treeDepth,
          structural: true,
        });

        // Compute suggestedReads: children with 3+ own children (as paths)
        const suggestedReads: string[] = [];
        if ('children' in treeNode) {
          for (const child of (treeNode as any).children) {
            if ('children' in child && child.children.length > 3) {
              suggestedReads.push(`${treePath.replace(/\/$/, '')}/${child.name}/ (${child.id})`);
            }
          }
        }

        const treeData: any = { tree: treeXml, path: treePath };
        if (suggestedReads.length > 0) treeData.suggestedReads = suggestedReads;

        response = { success: true, data: treeData };
        break;
      }

      case 'cat': {
        // Full properties at a path — like Unix cat
        const catPath = parameters.path || '/';
        const catDepth = Math.min(parameters.depth || 5, 10);
        const wantScreenshot = parameters.screenshot;

        // Glob support: cat /Card/Btn*
        if (hasGlob(catPath)) {
          const globNodes = await resolveGlobPaths(catPath);
          if (globNodes.length === 0) {
            response = { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${catPath}".` } };
            break;
          }
          // Serialize each matched node compactly
          const entries: any[] = [];
          for (const gNode of globNodes.slice(0, 10)) {
            const serialized = NodeSerializer.serializeWithCompression(gNode, { maxDepth: catDepth, pruneDefaults: true });
            const xml = FlatOpsSerializer.serialize(serialized, { maxDepth: catDepth });
            entries.push({ name: gNode.name, id: gNode.id, type: gNode.type.toLowerCase(), xml });
          }
          response = {
            success: true,
            data: {
              pattern: catPath,
              matches: entries.length,
              total: globNodes.length,
              nodes: entries,
              truncated: globNodes.length > 10,
            },
          };
          break;
        }

        const resolved = await resolvePathToNode(catPath);
        if (!resolved.ok) { response = resolved.response; break; }

        if (resolved.isPage) {
          // For page root, return page-level info
          const page = resolved.page;
          const topLevel = page.children.map(n => ({
            name: n.name,
            id: n.id,
            type: n.type.toLowerCase(),
            w: Math.round(n.width),
            h: Math.round(n.height),
          }));
          response = {
            success: true,
            data: {
              path: '/',
              page: { name: page.name, childCount: page.children.length },
              children: topLevel,
              hint: 'Use ls("/") or tree("/") to navigate, cat("/NodeName/") for full details.',
            },
          };
          break;
        }

        const catNode = resolved.node;
        const catSerialized = NodeSerializer.serializeWithCompression(catNode, {
          maxDepth: catDepth,
          pruneDefaults: true,
        });

        // Full mode with auto-degradation
        const catFullXml = FlatOpsSerializer.serialize(catSerialized, {
          maxDepth: catDepth,
        });

        const catData: any = { path: catPath };
        const AUTO_DEGRADE_CHARS = CONTEXT_CONSTANTS.READ_AUTO_DEGRADE_CHARS;

        if (catFullXml.length > AUTO_DEGRADE_CHARS) {
          const catStructuralXml = FlatOpsSerializer.serialize(catSerialized, {
            maxDepth: catDepth,
            structural: true,
          });
          catData.tree = catStructuralXml;
          const childCount = 'children' in catNode ? (catNode as any).children.length : 0;
          catData.hint = `Large node (${childCount} children, ${catFullXml.length} chars). Use tree("${catPath}") to discover structure, then cat specific children.`;
        } else {
          catData.tree = catFullXml;
        }

        // Bundle screenshot if requested
        if (wantScreenshot && catNode.visible && catNode.width > 0 && catNode.height > 0) {
          try {
            const ssResult = await exportNodeToBase64(catNode);
            catData.__image = ssResult.__image;
          } catch (e: any) {
            logger.info(`Screenshot bundling failed for ${catPath}: ${e?.message}`);
          }
        }

        response = { success: true, data: catData };
        break;
      }

      // ==========================================
      // NEW UNIX CLI COMMANDS — mk, grep, sed, man
      // ==========================================

      case 'mk': {
        const { batch, path: mkPath, type: mkType, refComponent, propTokens, textContent } = parameters;

        if (batch) {
          // Batch mode: parse multiple mk lines → flat ops
          response = await executeMkBatch(batch);
          break;
        }

        if (!mkPath) {
          response = { success: false, error: { code: 'INVALID_PATH', message: 'mk requires a path. Usage: mk /Card/ frame w:400 layout:column' } };
          break;
        }

        // Guard: detect embedded batch commands in propTokens (LLM sometimes crams multiple mk lines into one call)
        if (propTokens && Array.isArray(propTokens) && propTokens.some((t: string) => /\nmk\s|^mk\s/.test(t))) {
          const reconstructed = `${mkPath}${mkType ? ' ' + mkType : ''} ${(propTokens || []).join(' ')}${textContent ? ' -- ' + textContent : ''}`;
          response = await executeMkBatch(reconstructed);
          break;
        }

        response = await executeSingleMk(mkPath, mkType, refComponent, propTokens || [], textContent);
        break;
      }

      case 'grep': {
        const { mode: grepMode, query: grepQuery, path: grepPath, properties: grepProps } = parameters;

        if (grepMode === 'properties') {
          // Property discovery mode — reuse replace search logic
          if (!grepPath) {
            response = { success: false, error: { code: 'MISSING_PATH', message: 'Property discovery requires a path. Usage: grep /Card/ fillColor,fontSize' } };
            break;
          }
          if (!grepProps || !Array.isArray(grepProps) || grepProps.length === 0) {
            response = { success: false, error: { code: 'MISSING_PROPERTIES', message: 'Specify properties to discover. Usage: grep /Card/ fillColor,fontSize' } };
            break;
          }

          const grepResolved = await resolvePathToNode(grepPath);
          if (!grepResolved.ok) { response = grepResolved.response; break; }

          const grepRoot = grepResolved.isPage
            ? figma.currentPage.children[0] as SceneNode
            : grepResolved.node;

          if (!grepRoot) {
            response = { success: false, error: { code: 'NO_RESULTS', message: 'No nodes found to search.' } };
            break;
          }

          const uniqueValues: Record<string, Set<string | number>> = {};
          for (const prop of grepProps) uniqueValues[prop] = new Set();

          function collectGrepValues(node: SceneNode): void {
            for (const prop of grepProps!) {
              for (const val of extractAllReplacePropertyValues(node, prop)) uniqueValues[prop].add(val);
            }
            if ('children' in node) {
              for (const child of (node as any).children) collectGrepValues(child);
            }
          }

          if (grepResolved.isPage) {
            for (const child of figma.currentPage.children) collectGrepValues(child);
          } else {
            collectGrepValues(grepRoot);
          }

          const grepResult: Record<string, (string | number)[]> = {};
          for (const [prop, valueSet] of Object.entries(uniqueValues)) grepResult[prop] = Array.from(valueSet);
          response = { success: true, data: grepResult };
        } else {
          // Node search mode
          const searchQuery = (grepQuery || '').toLowerCase();
          const MAX_RESULTS = 20;
          const matches: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number }> = [];

          const allNodes = figma.currentPage.findAll(node => {
            return node.name.toLowerCase().includes(searchQuery)
              || node.type.toLowerCase() === searchQuery;
          });

          for (const node of allNodes.slice(0, MAX_RESULTS)) {
            matches.push({
              id: node.id, name: node.name, type: node.type,
              x: Math.round(node.x), y: Math.round(node.y),
              width: Math.round(node.width), height: Math.round(node.height),
            });
          }

          response = { success: true, data: { results: matches, total: allNodes.length, truncated: allNodes.length > MAX_RESULTS } };
        }
        break;
      }

      case 'sed': {
        const { path: sedPath, replacements: sedReplacements } = parameters;

        if (!sedPath) {
          response = { success: false, error: { code: 'MISSING_PATH', message: 'sed requires a path. Usage: sed /Card/ fillColor:#FFF/#000' } };
          break;
        }
        if (!sedReplacements || typeof sedReplacements !== 'object' || Object.keys(sedReplacements).length === 0) {
          response = { success: false, error: { code: 'MISSING_REPLACEMENTS', message: 'sed requires replacement rules. Usage: sed /Card/ prop:from/to' } };
          break;
        }

        const sedResolved = await resolvePathToNode(sedPath);
        if (!sedResolved.ok) { response = sedResolved.response; break; }
        if (sedResolved.isPage) {
          response = { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot sed page root. Target a specific node.' } };
          break;
        }
        const sedRoot = sedResolved.node;

        try {
          // Phase 1: Preload fonts
          const fontsToPreload = new Set<string>();
          const hasFontRules = sedReplacements['fontFamily'] || sedReplacements['fontWeight'];
          if (hasFontRules) {
            function collectFontsForSed(node: SceneNode): void {
              if (node.type === 'TEXT') {
                const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
                if (Array.isArray(sedReplacements['fontFamily'])) {
                  for (const rule of sedReplacements['fontFamily']) {
                    if (matchesReplaceValue(cur.family, rule.from) && typeof rule.to === 'string') {
                      fontsToPreload.add(`${rule.to}\0${cur.style}`);
                    }
                  }
                }
                if (Array.isArray(sedReplacements['fontWeight'])) {
                  for (const rule of sedReplacements['fontWeight']) {
                    if (matchesReplaceValue(cur.style, rule.from) && typeof rule.to === 'string') {
                      fontsToPreload.add(`${cur.family}\0${rule.to}`);
                    }
                  }
                }
              }
              if ('children' in node) {
                for (const child of (node as any).children) collectFontsForSed(child);
              }
            }
            collectFontsForSed(sedRoot);
            if (fontsToPreload.size > 0) {
              await Promise.all([...fontsToPreload].map(key => {
                const [family, style] = key.split('\0');
                return fontBus.getOrLoad(family, style);
              }));
            }
          }

          // Phase 2: Apply replacements
          let totalReplaced = 0;
          const details: Record<string, number> = {};
          async function doSedReplace(node: SceneNode): Promise<void> {
            for (const [prop, rules] of Object.entries(sedReplacements)) {
              if (!Array.isArray(rules)) continue;
              for (const rule of rules) {
                const n = await applyReplacePropertyValue(node, prop, rule.from, rule.to);
                if (n > 0) { totalReplaced += n; details[prop] = (details[prop] || 0) + n; }
              }
            }
            if ('children' in node) {
              for (const child of (node as any).children) await doSedReplace(child);
            }
          }
          await doSedReplace(sedRoot);
          response = { success: true, data: { replaced: totalReplaced, details } };
        } catch (e: any) {
          response = { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error during sed' } };
        }
        break;
      }

      case 'man': {
        // man is handled locally in sandbox (query sources: guidelines, style-tags, style, help)
        // It should NOT arrive at the IPC handler. If it does, return helpful error.
        response = {
          success: false,
          error: {
            code: 'LOCAL_ONLY',
            message: 'man command is handled locally. This is an internal routing error.',
          },
        };
        break;
      }

      // ==========================================
      // LEGACY READ TOOLS — kept for backward compatibility
      // ==========================================

      case 'context': {
        // Focused context: page metadata + target node skeleton + selection
        const { nodeId: contextNodeId, depth: contextDepth } = parameters;
        const contextDepthClamped = Math.min(contextDepth || 2, 5);

        const contextResolved = await resolveSceneNode(contextNodeId);
        if (!contextResolved.ok) { response = contextResolved.response; break; }
        const contextNode = contextResolved.node;

        // Target node skeleton
        const contextSerialized = NodeSerializer.serializeWithCompression(contextNode, {
          maxDepth: contextDepthClamped,
          pruneDefaults: true
        });
        const contextTree = FlatOpsSerializer.serialize(contextSerialized, {
          maxDepth: contextDepthClamped,
          structural: true,
        });

        // Page metadata: name, childCount, top-level node names (lightweight)
        const page = figma.currentPage;
        const topLevelNodes = page.children.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));

        const contextSelection = page.selection.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));

        response = {
          success: true,
          data: {
            page: { name: page.name, childCount: page.children.length, topLevelNodes },
            tree: contextTree,
            ...(contextSelection.length > 0 && { selection: contextSelection }),
          }
        };
        break;
      }

      case 'outline': {
        const { nodeId: outlineNodeId, depth: outlineDepth } = parameters;
        const outlineDepthClamped = Math.min(outlineDepth || 5, 10);

        const outlineResolved = await resolveSceneNode(outlineNodeId);
        if (!outlineResolved.ok) { response = outlineResolved.response; break; }
        const outlineNode = outlineResolved.node;

        const outlineSerialized = NodeSerializer.serializeWithCompression(outlineNode, {
          maxDepth: outlineDepthClamped,
          pruneDefaults: true
        });
        const outlineXml = FlatOpsSerializer.serialize(outlineSerialized, {
          maxDepth: outlineDepthClamped,
          structural: true,
        });

        // Compute suggestedReads: children with 3+ own children
        const suggestedReads: string[] = [];
        if ('children' in outlineNode) {
          for (const child of (outlineNode as any).children) {
            if ('children' in child && child.children.length > 3) {
              suggestedReads.push(child.id);
            }
          }
        }

        const outlineData: any = { tree: outlineXml };
        if (suggestedReads.length > 0) outlineData.suggestedReads = suggestedReads;

        response = { success: true, data: outlineData };
        break;
      }

      case 'inspect': {
        const { nodeId: inspectNodeId, depth: inspectDepth, screenshot: wantScreenshot } = parameters;
        const inspectDepthClamped = Math.min(inspectDepth || 5, 10);

        const inspectResolved = await resolveSceneNode(inspectNodeId);
        if (!inspectResolved.ok) { response = inspectResolved.response; break; }
        const inspectNode = inspectResolved.node;

        const inspectSerialized = NodeSerializer.serializeWithCompression(inspectNode, {
          maxDepth: inspectDepthClamped,
          pruneDefaults: true
        });

        // Full mode with auto-degradation
        const inspectFullXml = FlatOpsSerializer.serialize(inspectSerialized, {
          maxDepth: inspectDepthClamped,
        });

        const inspectData: any = {};
        const AUTO_DEGRADE_CHARS = CONTEXT_CONSTANTS.READ_AUTO_DEGRADE_CHARS;

        if (inspectFullXml.length > AUTO_DEGRADE_CHARS) {
          const inspectStructuralXml = FlatOpsSerializer.serialize(inspectSerialized, {
            maxDepth: inspectDepthClamped,
            structural: true,
          });
          inspectData.tree = inspectStructuralXml;
          const childCount = inspectNode.type === 'FRAME' || inspectNode.type === 'GROUP' || inspectNode.type === 'SECTION'
            ? ('children' in inspectNode ? (inspectNode as any).children.length : 0)
            : 0;
          inspectData.hint = `Tree is large (${childCount} children, ${inspectFullXml.length} chars). Use outline() to discover structure, then inspect specific children.`;
        } else {
          inspectData.tree = inspectFullXml;
        }

        // Bundle screenshot if requested
        if (wantScreenshot && inspectNode.visible && inspectNode.width > 0 && inspectNode.height > 0) {
          try {
            const ssResult = await exportNodeToBase64(inspectNode);
            inspectData.__image = ssResult.__image;
          } catch (e: any) {
            logger.info(`Screenshot bundling failed for ${inspectNodeId}: ${e?.message}`);
          }
        }

        response = { success: true, data: inspectData };
        break;
      }

      case 'design': {
        const { ops: designOps, parentId: designParentId } = parameters;

        if (!designOps || typeof designOps !== 'string' || designOps.trim().length === 0) {
          response = { success: false, error: { code: 'EMPTY_OPS', message: 'No ops provided. Example: card = frame(root, {w:400, h:\'hug\', bg:\'#FFF\'})\ntitle = text(card, {}, \'Hello\')' } };
          break;
        }

        response = await executeFlatOps(designOps, designParentId);
        break;
      }

      case 'replace': {
        const { mode: replaceMode, rootId: replaceRootId, properties: replaceProps, replacements } = parameters;

        if (replaceMode !== 'search' && replaceMode !== 'replace') {
          response = { success: false, error: { code: 'INVALID_MODE', message: 'Mode must be "search" or "replace".' } };
          break;
        }

        const replaceRootResolved = await resolveSceneNode(replaceRootId);
        if (!replaceRootResolved.ok) { response = replaceRootResolved.response; break; }
        const replaceRoot = replaceRootResolved.node;

        try {
          if (replaceMode === 'search') {
            if (!replaceProps || !Array.isArray(replaceProps) || replaceProps.length === 0) {
              response = { success: false, error: { code: 'MISSING_PROPERTIES', message: 'Search mode requires a non-empty "properties" array.' } };
              break;
            }

            const uniqueValues: Record<string, Set<string | number>> = {};
            for (const prop of replaceProps) uniqueValues[prop] = new Set();

            function collectValues(node: SceneNode): void {
              for (const prop of replaceProps) {
                for (const val of extractAllReplacePropertyValues(node, prop)) uniqueValues[prop].add(val);
              }
              if ('children' in node) {
                for (const child of (node as any).children) collectValues(child);
              }
            }
            collectValues(replaceRoot);

            const result: Record<string, (string | number)[]> = {};
            for (const [prop, valueSet] of Object.entries(uniqueValues)) result[prop] = Array.from(valueSet);
            response = { success: true, data: result };
          } else {
            if (!replacements || typeof replacements !== 'object' || Object.keys(replacements).length === 0) {
              response = { success: false, error: { code: 'MISSING_REPLACEMENTS', message: 'Replace mode requires a non-empty "replacements" object.' } };
              break;
            }

            let totalReplaced = 0;
            const details: Record<string, number> = {};

            // Phase 1: Collect all needed fonts and preload in parallel
            const fontsToPreload = new Set<string>();
            const hasFontRules = replacements['fontFamily'] || replacements['fontWeight'];
            if (hasFontRules) {
              function collectFonts(node: SceneNode): void {
                if (node.type === 'TEXT') {
                  const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
                  const familyRules = replacements['fontFamily'];
                  if (Array.isArray(familyRules)) {
                    for (const rule of familyRules) {
                      if (matchesReplaceValue(cur.family, rule.from) && typeof rule.to === 'string') {
                        fontsToPreload.add(`${rule.to}\0${cur.style}`);
                      }
                    }
                  }
                  const weightRules = replacements['fontWeight'];
                  if (Array.isArray(weightRules)) {
                    for (const rule of weightRules) {
                      if (matchesReplaceValue(cur.style, rule.from) && typeof rule.to === 'string') {
                        fontsToPreload.add(`${cur.family}\0${rule.to}`);
                      }
                    }
                  }
                }
                if ('children' in node) {
                  for (const child of (node as any).children) collectFonts(child);
                }
              }
              collectFonts(replaceRoot);

              if (fontsToPreload.size > 0) {
                await Promise.all(
                  [...fontsToPreload].map(key => {
                    const [family, style] = key.split('\0');
                    return fontBus.getOrLoad(family, style);
                  })
                );
              }
            }

            // Phase 2: Apply replacements (font loads hit cache)
            async function doReplace(node: SceneNode): Promise<void> {
              for (const [prop, rules] of Object.entries(replacements)) {
                if (!Array.isArray(rules)) continue;
                for (const rule of rules) {
                  const n = await applyReplacePropertyValue(node, prop, rule.from, rule.to);
                  if (n > 0) { totalReplaced += n; details[prop] = (details[prop] || 0) + n; }
                }
              }
              if ('children' in node) {
                for (const child of (node as any).children) await doReplace(child);
              }
            }
            await doReplace(replaceRoot);
            response = { success: true, data: { replaced: totalReplaced, details } };
          }
        } catch (e: any) {
          response = { success: false, error: { code: 'EXECUTION_ERROR', message: e?.message ?? 'Unexpected error during replace' } };
        }
        break;
      }

      case 'query': {
        const { source: querySource, query: queryText } = parameters;

        if (querySource !== 'nodes') {
          // 'knowledge' is handled locally in sandbox — should not arrive here
          response = { success: false, error: { code: 'INVALID_SOURCE', message: `Source "${querySource}" not available via IPC. Use query({source: "nodes", query: "..."}) to search the canvas.` } };
          break;
        }

        // Search current page nodes by name or type
        const searchQuery = (queryText || '').toLowerCase();
        const MAX_RESULTS = 20;
        const matches: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number }> = [];

        const allNodes = figma.currentPage.findAll(node => {
          return node.name.toLowerCase().includes(searchQuery)
            || node.type.toLowerCase() === searchQuery;
        });

        for (const node of allNodes.slice(0, MAX_RESULTS)) {
          matches.push({
            id: node.id,
            name: node.name,
            type: node.type,
            x: Math.round(node.x),
            y: Math.round(node.y),
            width: Math.round(node.width),
            height: Math.round(node.height),
          });
        }

        response = {
          success: true,
          data: {
            results: matches,
            total: allNodes.length,
            truncated: allNodes.length > MAX_RESULTS,
          }
        };
        break;
      }

      // ==========================================
      // FS WRITE COMMANDS — path-based create/modify/delete
      // ==========================================

      case 'mkdir': {
        const mkdirPath = parameters.path || '/';
        const mkdirType = parameters.type || 'frame';
        const mkdirPropsRaw = parameters.propsRaw || '';

        const { parentPath: mkdirParentPath, nodeName: mkdirName } = splitPath(mkdirPath);
        if (!mkdirName) {
          response = { success: false, error: { code: 'INVALID_PATH', message: 'mkdir requires a target name in path, e.g. mkdir /Card/ or mkdir /Card/Header/' } };
          break;
        }

        const mkdirParentResolved = await resolvePathToNode(mkdirParentPath);
        if (!mkdirParentResolved.ok) { response = mkdirParentResolved.response; break; }

        const mkdirParentId = mkdirParentResolved.isPage ? undefined : mkdirParentResolved.node.id;
        const mkdirPropsInner = stripBraces(mkdirPropsRaw);
        const mkdirPropsWithName = injectNameProp(mkdirPropsInner, mkdirName);

        const mkdirOps = `n1 = ${mkdirType}(root, {${mkdirPropsWithName}})`;
        response = await executeFlatOps(mkdirOps, mkdirParentId);
        break;
      }

      case 'mktext': {
        const mktextPath = parameters.path || '/';
        const mktextPropsRaw = parameters.propsRaw || '';
        const mktextContent = parameters.textContent || '';

        const { parentPath: mktextParentPath, nodeName: mktextName } = splitPath(mktextPath);
        if (!mktextName) {
          response = { success: false, error: { code: 'INVALID_PATH', message: 'mktext requires a target name in path, e.g. mktext /Card/Title' } };
          break;
        }

        const mktextParentResolved = await resolvePathToNode(mktextParentPath);
        if (!mktextParentResolved.ok) { response = mktextParentResolved.response; break; }

        const mktextParentId = mktextParentResolved.isPage ? undefined : mktextParentResolved.node.id;
        const mktextPropsInner = stripBraces(mktextPropsRaw);
        const mktextPropsWithName = injectNameProp(mktextPropsInner, mktextName);

        const mktextEscaped = escapeFlatOpsStr(mktextContent);
        const mktextTextArg = mktextContent ? `, '${mktextEscaped}'` : '';
        const mktextOps = `n1 = text(root, {${mktextPropsWithName}}${mktextTextArg})`;
        response = await executeFlatOps(mktextOps, mktextParentId);
        break;
      }

      case 'write': {
        const writePath = parameters.path || '/';
        const writePropsRaw = parameters.propsRaw || '';

        if (!writePropsRaw || stripBraces(writePropsRaw) === '') {
          response = { success: false, error: { code: 'EMPTY_PROPS', message: 'write requires properties to update. Example: write /Card/ {bg:#000}' } };
          break;
        }

        const writeResolved = await resolvePathToNode(writePath);
        if (!writeResolved.ok) { response = writeResolved.response; break; }
        if (writeResolved.isPage) {
          response = { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot write to page root. Target a specific node, e.g. write /Card/ {bg:#000}' } };
          break;
        }

        const writeNodeId = writeResolved.node.id;
        const writePropsBlock = writePropsRaw.trim().startsWith('{') ? writePropsRaw : `{${writePropsRaw}}`;
        const writeOps = `update('${writeNodeId}', ${writePropsBlock})`;
        response = await executeFlatOps(writeOps);
        break;
      }

      case 'rm': {
        const rmPath = parameters.path || '/';

        // Glob support: rm /Card/Placeholder*
        if (hasGlob(rmPath)) {
          const globNodes = await resolveGlobPaths(rmPath);
          if (globNodes.length === 0) {
            response = { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${rmPath}". Use ls to check available children.` } };
            break;
          }
          const rmOps = globNodes.map(n => `delete('${n.id}')`).join('\n');
          response = await executeFlatOps(rmOps);
          break;
        }

        const rmResolved = await resolvePathToNode(rmPath);
        if (!rmResolved.ok) { response = rmResolved.response; break; }
        if (rmResolved.isPage) {
          response = { success: false, error: { code: 'INVALID_TARGET', message: 'Cannot delete page root. Target a specific node, e.g. rm /Card/' } };
          break;
        }

        const rmNodeId = rmResolved.node.id;
        const rmOps = `delete('${rmNodeId}')`;
        response = await executeFlatOps(rmOps);
        break;
      }

      case 'mv': {
        const { sourcePath: mvSourcePath, destPath: mvDestPath } = parameters;

        if (!mvSourcePath) {
          response = { success: false, error: { code: 'MISSING_SOURCE', message: 'mv requires a source path. Usage: mv /OldName /NewName' } };
          break;
        }
        if (!mvDestPath) {
          response = { success: false, error: { code: 'MISSING_DEST', message: 'mv requires a destination path. Usage: mv /OldName /NewName' } };
          break;
        }

        // Resolve source
        const mvSourceResolved = await resolvePathToNode(mvSourcePath);
        if (!mvSourceResolved.ok) { response = mvSourceResolved.response; break; }
        if (mvSourceResolved.isPage) {
          response = { success: false, error: { code: 'INVALID_SOURCE', message: 'Cannot move page root.' } };
          break;
        }
        const mvNode = mvSourceResolved.node;
        const mvOldName = mvNode.name;
        const mvOldParentId = mvNode.parent?.id;

        // Check if dest is an existing container → move INTO it (Unix "mv file dir/" semantics)
        let mvNewName: string = mvNode.name;
        let mvNewParent: (BaseNode & ChildrenMixin) | null = null;

        const mvDestResolved = await resolvePathToNode(mvDestPath);
        if (mvDestResolved.ok && !mvDestResolved.isPage && 'children' in mvDestResolved.node) {
          // Dest exists and is a container → move into it, keep original name
          mvNewParent = mvDestResolved.node as BaseNode & ChildrenMixin;
        } else if (mvDestResolved.ok && mvDestResolved.isPage) {
          // Dest is page root → move to page, keep original name
          mvNewParent = figma.currentPage;
        } else {
          // Dest doesn't exist → split into parent + name (rename + reparent)
          const { parentPath: mvParentPath, nodeName: mvTargetName } = splitPath(mvDestPath);
          if (!mvTargetName) {
            response = { success: false, error: { code: 'INVALID_DEST', message: 'Destination must include a name, e.g. mv /Card/OldTitle /Card/NewTitle' } };
            break;
          }
          mvNewName = mvTargetName;

          const mvParentResolved = await resolvePathToNode(mvParentPath);
          if (!mvParentResolved.ok) { response = mvParentResolved.response; break; }

          if (mvParentResolved.isPage) {
            mvNewParent = figma.currentPage;
          } else if ('children' in mvParentResolved.node) {
            mvNewParent = mvParentResolved.node as BaseNode & ChildrenMixin;
          } else {
            response = { success: false, error: { code: 'INVALID_DEST', message: `"${mvParentPath}" is not a container. Cannot move node there.` } };
            break;
          }
        }

        // Apply rename
        const mvRenamed = mvOldName !== mvNewName;
        if (mvRenamed) {
          mvNode.name = mvNewName;
        }

        // Apply reparent
        const mvMoved = mvNewParent != null && mvNewParent.id !== mvOldParentId;
        if (mvMoved) {
          (mvNewParent as any).appendChild(mvNode);
        }

        response = {
          success: true,
          data: {
            id: mvNode.id,
            oldName: mvOldName,
            newName: mvNewName,
            renamed: mvRenamed,
            moved: mvMoved,
            newParent: mvMoved ? mvNewParent!.name : undefined,
          },
        };
        break;
      }

      case 'cp': {
        const { sourcePath: cpSourcePath, destPath: cpDestPath, propsRaw: cpPropsRaw } = parameters;

        if (!cpSourcePath) {
          response = { success: false, error: { code: 'MISSING_SOURCE', message: 'cp requires a source path. Usage: cp /Source/ /Dest/ {overrides}' } };
          break;
        }
        if (!cpDestPath) {
          response = { success: false, error: { code: 'MISSING_DEST', message: 'cp requires a destination path. Usage: cp /Source/ /Dest/ {overrides}' } };
          break;
        }

        // Resolve source
        const cpSourceResolved = await resolvePathToNode(cpSourcePath);
        if (!cpSourceResolved.ok) { response = cpSourceResolved.response; break; }
        if (cpSourceResolved.isPage) {
          response = { success: false, error: { code: 'INVALID_SOURCE', message: 'Cannot clone page root.' } };
          break;
        }
        const cpSourceId = cpSourceResolved.node.id;

        // Resolve destination parent
        const { parentPath: cpParentPath, nodeName: cpCloneName } = splitPath(cpDestPath);
        if (!cpCloneName) {
          response = { success: false, error: { code: 'INVALID_PATH', message: 'Destination path must include a name, e.g. /Card/Hover/' } };
          break;
        }

        const cpParentResolved = await resolvePathToNode(cpParentPath);
        if (!cpParentResolved.ok) { response = cpParentResolved.response; break; }

        const cpParentId = cpParentResolved.isPage ? undefined : cpParentResolved.node.id;
        const cpPropsInner = stripBraces(cpPropsRaw || '');
        const cpPropsWithName = injectNameProp(cpPropsInner, cpCloneName);

        const cpOps = `n1 = clone('${cpSourceId}', root, {${cpPropsWithName}})`;
        response = await executeFlatOps(cpOps, cpParentId);
        break;
      }

      case 'ln': {
        const { path: lnPath, component: lnComponent, propsRaw: lnPropsRaw } = parameters;

        if (!lnPath) {
          response = { success: false, error: { code: 'MISSING_PATH', message: 'ln requires a path. Usage: ln /Card/BtnInst Button {overrides}' } };
          break;
        }
        if (!lnComponent) {
          response = { success: false, error: { code: 'MISSING_COMPONENT', message: 'ln requires a component name. Usage: ln /Card/BtnInst Button' } };
          break;
        }

        const { parentPath: lnParentPath, nodeName: lnInstName } = splitPath(lnPath);
        if (!lnInstName) {
          response = { success: false, error: { code: 'INVALID_PATH', message: 'Path must include an instance name, e.g. /Card/BtnInst' } };
          break;
        }

        const lnParentResolved = await resolvePathToNode(lnParentPath);
        if (!lnParentResolved.ok) { response = lnParentResolved.response; break; }

        const lnParentId = lnParentResolved.isPage ? undefined : lnParentResolved.node.id;
        const lnPropsInner = stripBraces(lnPropsRaw || '');
        const lnPropsWithName = injectNameProp(lnPropsInner, lnInstName);

        const lnEscapedComponent = escapeFlatOpsStr(lnComponent);
        const lnOps = `n1 = ref('${lnEscapedComponent}', root, {${lnPropsWithName}})`;
        response = await executeFlatOps(lnOps, lnParentId);
        break;
      }

      // ==========================================
      // DEFAULT — Unknown Tool
      // ==========================================
      default:
        response = {
          success: false,
          error: { code: 'UNKNOWN_TOOL', message: `Unknown command "${toolName}".${(() => { const s = findClosestCommand(toolName); return s ? ` Did you mean "${s}"?` : ''; })()} Available: ls, tree, cat, mk, mv, rm, cp, grep, sed, man` }
        };
        break;
    }
    } // end else (non-memory path)
  } catch (e: any) {
    console.error(`[Agent] Tool Execution Error (${toolName}):`, e);
    response = {
      success: false,
      error: { code: 'EXECUTION_ERROR', message: `${toolName}: ${e.message}. Try a simpler operation or check parameters.` }
    };
  }

  // Inject file metadata into every response so MCP consumers can verify connection target
  if (response && response.data && typeof response.data === 'object') {
    response.data._file = {
      name: figma.root?.name ?? 'Untitled',
      currentPage: figma.currentPage?.name ?? 'Unknown',
    };
  }

  emit<ToolResultHandler>('TOOL_RESULT', { requestId, response: response! });
}

// ── Replace tool helpers ──

function rgbaToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function hexToRgba(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

/** For search mode: returns ALL values for this prop on the node (multiple for multi-fill). */
function extractAllReplacePropertyValues(node: SceneNode, prop: string): (string | number)[] {
  switch (prop) {
    case 'fillColor': {
      if (node.type === 'TEXT') return [];
      const fills = (node as any).fills;
      if (!Array.isArray(fills)) return [];
      return fills.filter((f: any) => f.type === 'SOLID').map((f: any) => rgbaToHex(f.color));
    }
    case 'textColor': {
      if (node.type !== 'TEXT') return [];
      const fills = (node as any).fills;
      if (!Array.isArray(fills)) return [];
      return fills.filter((f: any) => f.type === 'SOLID').map((f: any) => rgbaToHex(f.color));
    }
    case 'strokeColor': {
      const strokes = (node as any).strokes;
      if (!Array.isArray(strokes)) return [];
      return strokes.filter((s: any) => s.type === 'SOLID').map((s: any) => rgbaToHex(s.color));
    }
    case 'cornerRadius': { const v = (node as any).cornerRadius; return typeof v === 'number' ? [v] : []; }
    case 'gap': { const v = (node as any).itemSpacing; return typeof v === 'number' ? [v] : []; }
    case 'fontSize': { if (node.type !== 'TEXT') return []; const v = (node as any).fontSize; return typeof v === 'number' ? [v] : []; }
    case 'fontFamily': { if (node.type !== 'TEXT') return []; const v = (node as any).fontName; return typeof v === 'object' ? [v.family] : []; }
    case 'fontWeight': { if (node.type !== 'TEXT') return []; const v = (node as any).fontName; return typeof v === 'object' ? [v.style] : []; }
    case 'strokeWeight': { const v = (node as any).strokeWeight; return typeof v === 'number' ? [v] : []; }
    case 'opacity': { const v = (node as any).opacity; return typeof v === 'number' ? [v] : []; }
    default: return [];
  }
}

function matchesReplaceValue(current: string | number, from: string | number): boolean {
  if (typeof current === 'number' && typeof from === 'number') return current === from;
  if (typeof current === 'string' && typeof from === 'string') return current.toUpperCase() === from.toUpperCase();
  return String(current) === String(from);
}

/** Apply replacement. Returns 1 if node was changed, 0 if no match. */
async function applyReplacePropertyValue(node: SceneNode, prop: string, from: string | number, to: string | number): Promise<number> {
  switch (prop) {
    case 'fillColor': {
      if (node.type === 'TEXT' || typeof to !== 'string') return 0;
      const fills = [...((node as any).fills || [])];
      let changed = false;
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(fills[i].color), from)) {
          fills[i] = { ...fills[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).fills = fills;
      return changed ? 1 : 0;
    }
    case 'textColor': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const fills = [...((node as any).fills || [])];
      let changed = false;
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(fills[i].color), from)) {
          fills[i] = { ...fills[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).fills = fills;
      return changed ? 1 : 0;
    }
    case 'strokeColor': {
      if (typeof to !== 'string') return 0;
      const strokes = [...((node as any).strokes || [])];
      let changed = false;
      for (let i = 0; i < strokes.length; i++) {
        if (strokes[i].type === 'SOLID' && matchesReplaceValue(rgbaToHex(strokes[i].color), from)) {
          strokes[i] = { ...strokes[i], color: hexToRgba(to) };
          changed = true;
        }
      }
      if (changed) (node as any).strokes = strokes;
      return changed ? 1 : 0;
    }
    case 'cornerRadius': {
      const cur = (node as any).cornerRadius;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).cornerRadius = to; return 1; }
      return 0;
    }
    case 'gap': {
      const cur = (node as any).itemSpacing;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).itemSpacing = to; return 1; }
      return 0;
    }
    case 'fontSize': {
      if (node.type !== 'TEXT') return 0;
      const cur = (node as any).fontSize;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).fontSize = to; return 1; }
      return 0;
    }
    case 'fontFamily': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
      if (!matchesReplaceValue(cur.family, from)) return 0;
      const { loadedStyle } = await fontBus.getOrLoad(to, cur.style);
      (node as any).fontName = { family: to, style: loadedStyle };
      return 1;
    }
    case 'fontWeight': {
      if (node.type !== 'TEXT' || typeof to !== 'string') return 0;
      const cur = (node as any).fontName || { family: 'Inter', style: 'Regular' };
      if (!matchesReplaceValue(cur.style, from)) return 0;
      const { loadedStyle } = await fontBus.getOrLoad(cur.family, to);
      (node as any).fontName = { family: cur.family, style: loadedStyle };
      return 1;
    }
    case 'strokeWeight': {
      const cur = (node as any).strokeWeight;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).strokeWeight = to; return 1; }
      return 0;
    }
    case 'opacity': {
      const cur = (node as any).opacity;
      if (typeof to === 'number' && typeof cur === 'number' && matchesReplaceValue(cur, from)) { (node as any).opacity = Math.max(0, Math.min(1, to)); return 1; }
      return 0;
    }
    default: return 0;
  }
}
