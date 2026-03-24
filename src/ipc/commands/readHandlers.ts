/**
 * @file readHandlers.ts
 * @description ls, tree, cat command handlers — read operations on the Figma scene graph.
 *
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { logger } from '../../utils/logger';
import { resolvePathToNode, buildNodeRef } from './pathResolver';
import { exportNodeToBase64 } from './shared';

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

    const treeData: any = { tree: lines.join('\n') };
    if (suggestedReads.length > 0) {
      treeData.suggestedReads = suggestedReads.map(id => {
        const n = page.findOne(node => node.id === id);
        return n ? buildNodeRef(n) : id;
      });
    }

    return { data: treeData };
  }

  const treeNode = resolved.node;
  const treeSerialized = NodeSerializer.serializeWithCompression(treeNode, {
    maxDepth: treeDepth,
    pruneDefaults: true,
  });
  const treeJson = JsonNodeSerializer.serialize(treeSerialized, {
    maxDepth: treeDepth,
    skeleton: true,
  });

  const suggestedReads: string[] = [];
  if ('children' in treeNode) {
    for (const child of (treeNode as any).children) {
      if ('children' in child && child.children.length > 3) {
        suggestedReads.push(buildNodeRef(child));
      }
    }
  }

  const treeData: any = { tree: treeJson };
  if (suggestedReads.length > 0) treeData.suggestedReads = suggestedReads;

  return { data: treeData };
}

// ── cat ──

export async function handleCat(parameters: any): Promise<ToolResponse> {
  const catPath = parameters.path || '/';
  const catDepth = Math.min(parameters.depth || 5, 10);
  const wantScreenshot = parameters.screenshot;

  const resolved = await resolvePathToNode(catPath);
  if (!resolved.ok) return resolved.response;

  if (resolved.isPage) {
    const page = resolved.page;
    const topLevel = page.children.map(n => ({
      type: n.type.toLowerCase(), id: n.id, name: n.name,
      width: Math.round(n.width), height: Math.round(n.height),
    }));
    return {
      data: {
        page: { name: page.name, childCount: page.children.length },
        children: topLevel,
        hint: 'Use inspect({node: "/"}) to see structure.',
      },
    };
  }

  const catNode = resolved.node;
  const catSerialized = NodeSerializer.serializeWithCompression(catNode, {
    maxDepth: catDepth,
    pruneDefaults: true,
  });

  const catJson = JsonNodeSerializer.serialize(catSerialized, { maxDepth: catDepth });
  const catData: any = {};
  Object.assign(catData, catJson);

  if (wantScreenshot && catNode.visible && catNode.width > 0 && catNode.height > 0) {
    try {
      const ssResult = await exportNodeToBase64(catNode);
      catData.__image = ssResult.__image;
    } catch (e: any) {
      logger.info(`Screenshot bundling failed for ${catPath}: ${e?.message}`);
    }
  }

  return { data: catData };
}
