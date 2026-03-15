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

/** Split a path into parent path and node name. */
function splitPath(path: string): { parentPath: string; nodeName: string } {
  const segments = path.split('/').filter(s => s.length > 0);
  const nodeName = segments.pop() || '';
  const parentPath = '/' + segments.join('/') + (segments.length > 0 ? '/' : '');
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

/**
 * Handle TOOL_CALL IPC events.
 * Routes to the unified tool implementations.
 */
export async function handleToolCall(data: ToolCallData): Promise<void> {
  let { toolName, parameters, context, requestId } = data;

  logger.info(`Tool Call: ${toolName}`, { parameters, requestId });

  let response: ToolResponse;

  try {
    switch (toolName) {
      // ==========================================
      // VFS READ COMMANDS — filesystem metaphor
      // ==========================================

      case 'ls': {
        // List children at a path — like Unix ls
        const lsPath = parameters.path || '/';
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
          error: { code: 'UNKNOWN_TOOL', message: `Unknown command "${toolName}". Available: ls, tree, cat, design, replace, query, mkdir, mktext, write, rm, cp, ln` }
        };
        break;
    }
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
