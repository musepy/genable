/**
 * @file readHandlers.ts
 * @description ls, tree, cat command handlers — read operations on the Figma scene graph.
 *
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { FlatOpsSerializer } from '../../engine/flat/flatOpsSerializer';
import { CONTEXT_CONSTANTS } from '../../engine/agent/context/constants';
import { logger } from '../../utils/logger';
import { resolvePathToNode, hasGlob, resolveGlobPaths, buildNodePath, isSessionNode } from './pathResolver';
import { exportNodeToBase64 } from './shared';

// ── ls ──

function formatLsEntry(node: SceneNode, showId = false): string {
  const hasChildren = 'children' in node && (node as any).children.length > 0;
  const baseName = hasChildren ? `${node.name}/` : node.name;
  // Show ID suffix for duplicate-named siblings (like `ls -i` in Unix)
  // Use # prefix so the ID is directly usable as a path: /#1058:12304/
  const name = showId ? `${baseName} (#${node.id})` : baseName;
  const type = node.type.toLowerCase();
  const w = Math.round(node.width);
  const h = Math.round(node.height);

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
  const isOwned = isSessionNode(node.id) || node.getPluginData('_agent') === 'created';
  const sessionTag = isOwned ? '  [yours]' : '';
  return `${name.padEnd(24)} ${type.padEnd(8)} ${w}×${h}${propsStr}${sessionTag}`;
}

export async function handleLs(parameters: any): Promise<ToolResponse> {
  const lsPath = parameters.path || '/';

  // Glob support
  if (hasGlob(lsPath)) {
    const globNodes = await resolveGlobPaths(lsPath);
    if (globNodes.length === 0) {
      return { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${lsPath}".` } };
    }
    const lines = globNodes.map(n => formatLsEntry(n));
    return {
      success: true,
      data: {
        listing: lines.join('\n'),
        path: lsPath,
        container: `glob(${lsPath})`,
        count: globNodes.length,
        footer: `[${globNodes.length} matches]`,
      },
    };
  }

  const resolved = await resolvePathToNode(lsPath);
  if (!resolved.ok) return resolved.response;

  let children: readonly SceneNode[];
  let containerName: string;

  if (resolved.isPage) {
    children = resolved.page.children;
    containerName = resolved.page.name;
  } else {
    const node = resolved.node;
    if (!('children' in node)) {
      return {
        success: false,
        error: {
          code: 'NOT_A_CONTAINER',
          message: `"${node.name}" (${node.type.toLowerCase()}) has no children. Use cat("${lsPath}") to see its properties.`,
        },
      };
    }
    children = (node as any).children as SceneNode[];
    containerName = node.name;
  }

  // Detect duplicate names — show ID for disambiguation (like `ls -i`)
  const nameCounts = new Map<string, number>();
  for (const child of children) {
    nameCounts.set(child.name, (nameCounts.get(child.name) || 0) + 1);
  }

  const lines: string[] = [];
  const nameSeenCount = new Map<string, number>();
  for (const child of children) {
    const isDuplicate = (nameCounts.get(child.name) || 0) > 1;
    const seenBefore = (nameSeenCount.get(child.name) || 0) > 0;
    // First occurrence: no ID (it's the default path target). Subsequent: show ID.
    lines.push(formatLsEntry(child, isDuplicate && seenBefore));
    nameSeenCount.set(child.name, (nameSeenCount.get(child.name) || 0) + 1);
  }

  const page = figma.currentPage;
  const footer = `[${children.length} items | page: "${page.name}"]`;

  let selectionInfo = '';
  if (resolved.isPage && page.selection.length > 0) {
    const sel = page.selection.slice(0, 5).map(n => n.name).join(', ');
    const more = page.selection.length > 5 ? ` (+${page.selection.length - 5} more)` : '';
    selectionInfo = `\nSelection: ${sel}${more}`;
  }

  return {
    success: true,
    data: {
      listing: lines.join('\n'),
      path: lsPath,
      container: containerName,
      count: children.length,
      footer: footer + selectionInfo,
    },
  };
}

// ── tree ──

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

export async function handleTree(parameters: any): Promise<ToolResponse> {
  const treePath = parameters.path || '/';
  const treeDepth = Math.min(parameters.depth || 5, 10);

  const resolved = await resolvePathToNode(treePath);
  if (!resolved.ok) return resolved.response;

  if (resolved.isPage) {
    const page = resolved.page;
    const lines: string[] = [`${page.name}/ (page, ${page.children.length} children)`];
    const suggestedReads: string[] = [];

    for (let i = 0; i < page.children.length; i++) {
      const child = page.children[i];
      const isLast = i === page.children.length - 1;
      buildTreeLines(child, lines, isLast ? '└── ' : '├── ', isLast ? '    ' : '│   ', treeDepth - 1, suggestedReads);
    }

    const treeData: any = { tree: lines.join('\n'), path: treePath };
    if (suggestedReads.length > 0) {
      treeData.suggestedReads = suggestedReads.map(id => {
        const n = page.findOne(node => node.id === id);
        return n ? `${buildNodePath(n)} (${id})` : id;
      });
    }

    return { success: true, data: treeData };
  }

  const treeNode = resolved.node;
  const treeSerialized = NodeSerializer.serializeWithCompression(treeNode, {
    maxDepth: treeDepth,
    pruneDefaults: true,
  });
  const treeXml = FlatOpsSerializer.serialize(treeSerialized, {
    maxDepth: treeDepth,
    structural: true,
  });

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

  return { success: true, data: treeData };
}

// ── cat ──

export async function handleCat(parameters: any): Promise<ToolResponse> {
  const catPath = parameters.path || '/';
  const catDepth = Math.min(parameters.depth || 5, 10);
  const wantScreenshot = parameters.screenshot;

  // Glob support
  if (hasGlob(catPath)) {
    const globNodes = await resolveGlobPaths(catPath);
    if (globNodes.length === 0) {
      return { success: false, error: { code: 'NO_MATCH', message: `No nodes matched pattern "${catPath}".` } };
    }
    const entries: any[] = [];
    for (const gNode of globNodes.slice(0, 10)) {
      const serialized = NodeSerializer.serializeWithCompression(gNode, { maxDepth: catDepth, pruneDefaults: true });
      const xml = FlatOpsSerializer.serialize(serialized, { maxDepth: catDepth });
      entries.push({ name: gNode.name, id: gNode.id, type: gNode.type.toLowerCase(), xml });
    }
    return {
      success: true,
      data: {
        pattern: catPath,
        matches: entries.length,
        total: globNodes.length,
        nodes: entries,
        truncated: globNodes.length > 10,
      },
    };
  }

  const resolved = await resolvePathToNode(catPath);
  if (!resolved.ok) return resolved.response;

  if (resolved.isPage) {
    const page = resolved.page;
    const topLevel = page.children.map(n => ({
      name: n.name, id: n.id, type: n.type.toLowerCase(),
      w: Math.round(n.width), h: Math.round(n.height),
    }));
    return {
      success: true,
      data: {
        path: '/',
        page: { name: page.name, childCount: page.children.length },
        children: topLevel,
        hint: 'Use ls("/") or tree("/") to navigate, cat("/NodeName/") for full details.',
      },
    };
  }

  const catNode = resolved.node;
  const catSerialized = NodeSerializer.serializeWithCompression(catNode, {
    maxDepth: catDepth,
    pruneDefaults: true,
  });

  const catFullXml = FlatOpsSerializer.serialize(catSerialized, { maxDepth: catDepth });
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

  if (wantScreenshot && catNode.visible && catNode.width > 0 && catNode.height > 0) {
    try {
      const ssResult = await exportNodeToBase64(catNode);
      catData.__image = ssResult.__image;
    } catch (e: any) {
      logger.info(`Screenshot bundling failed for ${catPath}: ${e?.message}`);
    }
  }

  return { success: true, data: catData };
}
