/**
 * @file pathResolver.ts
 * @description VFS path resolution — maps filesystem-style paths to Figma nodes.
 *
 * "/" = current page, "/NodeName/" = named child, "/Parent/Child/" = nested path.
 * Segments containing ":" are treated as Figma node IDs.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

// ── Session-scoped node preference ──
// Tracks node IDs created/referenced by the agent in the current session.
// When multiple siblings share the same name, the resolver prefers session nodes.

const sessionNodeIds = new Set<string>();

export function registerSessionNodes(ids: string[]) {
  for (const rawId of ids) {
    // Strip name# prefix if present (e.g. "Card#1:2" → "1:2")
    const m = rawId.match(/^.+#(\d+:\d+)$/);
    sessionNodeIds.add(m ? m[1] : rawId);
  }
}

export function clearSessionNodes() {
  sessionNodeIds.clear();
}

export function isSessionNode(id: string): boolean {
  return sessionNodeIds.has(id);
}

// ── Types ──

export type NodeResolved = { ok: true; node: SceneNode } | { ok: false; response: ToolResponse };

export type PathResolved =
  | { ok: true; isPage: true; page: PageNode }
  | { ok: true; isPage: false; node: SceneNode }
  | { ok: false; response: ToolResponse };

// ── Node resolution ──

export async function resolveSceneNode(nodeId: string): Promise<NodeResolved> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    return { ok: false, response: { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node "${nodeId}" not found. Use ls("/") to discover available nodes.` } } };
  }
  if (!('visible' in node)) {
    return { ok: false, response: { success: false, error: { code: 'INVALID_NODE_TYPE', message: `"${nodeId}" is a ${node.type}, not a design node. Use ls("/") to find design nodes.` } } };
  }
  return { ok: true, node: node as SceneNode };
}

// ── VFS path resolution ──

export async function resolvePathToNode(path: string): Promise<PathResolved> {
  // "/" → current page
  if (path === '/' || path === '') {
    return { ok: true, isPage: true, page: figma.currentPage };
  }

  // name#id format: "Card#1:2" → resolve by Figma ID
  const nameIdMatch = path.match(/^(.+)#(\d+:\d+)$/);
  if (nameIdMatch) {
    const nodeId = nameIdMatch[2];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      return {
        ok: false,
        response: {
          success: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Node "${path}" not found. Use inspect({node: "/"}) to discover available nodes.`,
          },
        },
      };
    }
    if (!('visible' in node)) {
      return {
        ok: false,
        response: {
          success: false,
          error: {
            code: 'INVALID_NODE_TYPE',
            message: `"${node.name}" (${node.type}) is not a design node.`,
          },
        },
      };
    }
    return { ok: true, isPage: false, node: node as SceneNode };
  }

  // Legacy path format — delegate to legacy resolver for backward compatibility (writeHandlers etc.)
  return resolvePathToNodeLegacy(path);
}

/** Legacy path resolution for writeHandlers/compHandlers that still use path segments. */
async function resolvePathToNodeLegacy(path: string): Promise<PathResolved> {
  const segments = path.split('/').filter(s => s.length > 0);
  if (segments.length === 0) {
    return { ok: true, isPage: true, page: figma.currentPage };
  }

  let current: BaseNode = figma.currentPage;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '..') {
      if (current.parent && current.parent.type !== 'DOCUMENT') current = current.parent;
      continue;
    }
    if (segment === '.') continue;

    const segNameId = segment.match(/^(.+)#(\d+:\d+)$/);
    if (segNameId) {
      const node = await figma.getNodeByIdAsync(segNameId[2]);
      if (!node) {
        return { ok: false, response: { success: false, error: { code: 'PATH_NOT_FOUND', message: `Node ID "${segNameId[2]}" not found.` } } };
      }
      current = node;
      continue;
    }

    if (!('children' in current)) {
      return { ok: false, response: { success: false, error: { code: 'NOT_A_CONTAINER', message: `"${current.name}" has no children.` } } };
    }
    const children = (current as any).children as readonly BaseNode[];
    const candidates = children.filter(c => c.name === segment);
    const match = candidates.length > 1
      ? (candidates.find(c => sessionNodeIds.has(c.id)) ?? candidates[0])
      : candidates[0];
    if (!match) {
      const available = children.slice(0, 15).map(c => c.name);
      return { ok: false, response: { success: false, error: { code: 'PATH_NOT_FOUND', message: `"${segment}" not found in "${current.name}". Available: ${available.join(', ')}` } } };
    }
    current = match;
  }

  if (!('visible' in current)) {
    return { ok: false, response: { success: false, error: { code: 'INVALID_NODE_TYPE', message: `"${current.name}" (${current.type}) is not a design node.` } } };
  }
  return { ok: true, isPage: false, node: current as SceneNode };
}

// ── Name deduplication ──

/**
 * Returns a unique name among siblings. If `name` already exists,
 * appends " 2", " 3", etc. until unique.
 */
export function deduplicateName(siblings: readonly BaseNode[], name: string): string {
  const existing = new Set(siblings.map(c => c.name));
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}

// ── Path helpers ──

export function buildNodePath(node: BaseNode): string {
  const parts: string[] = [];
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    parts.unshift(current.name);
    current = current.parent;
  }
  return '/' + parts.join('/');
}

export function buildNodeRef(node: BaseNode): string {
  return `${node.name}#${node.id}`;
}

export function parseRef(ref: string): { name?: string; id: string } {
  const m = ref.match(/^(.+)#(\d+:\d+)$/);
  if (m) return { name: m[1], id: m[2] };
  if (ref.startsWith('#')) return { id: ref.slice(1) };
  return { id: ref };
}

export function normalizePath(path: string): string {
  if (path === '/' || path === '') return '/';
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function splitPath(path: string): { parentPath: string; nodeName: string } {
  const segments = path.split('/').filter(s => s.length > 0);
  const nodeName = segments.pop() || '';
  const parentPath = segments.length > 0 ? '/' + segments.join('/') : '/';
  return { parentPath, nodeName };
}

// ── Glob support ──

export function hasGlob(path: string): boolean {
  return path.includes('*');
}

export function matchGlob(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return name === pattern;
  const parts = pattern.split('*');
  if (parts.length === 2) {
    return (parts[0] === '' || name.startsWith(parts[0])) &&
           (parts[1] === '' || name.endsWith(parts[1]));
  }
  const regex = new RegExp('^' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return regex.test(name);
}

export async function resolveGlobPaths(path: string): Promise<SceneNode[]> {
  const segments = path.split('/').filter(s => s.length > 0);
  if (segments.length === 0) return [];

  const lastSegment = segments[segments.length - 1];
  if (!lastSegment.includes('*')) return [];

  const parentPath = segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : '/';
  const parentResolved = await resolvePathToNode(parentPath);
  if (!parentResolved.ok) return [];

  const parent = parentResolved.isPage ? figma.currentPage : parentResolved.node;
  if (!('children' in parent)) return [];

  return (parent as any).children.filter((child: SceneNode) => matchGlob(child.name, lastSegment));
}
