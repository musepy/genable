/**
 * @file pathResolver.ts
 * @description Node resolution — maps Figma IDs to nodes.
 *
 * Addressing: bare Figma ID (e.g. "1:2"), or "/" for the current page root.
 * Legacy path strings ("/Parent/Child"), "name#id" shorthand, and glob patterns
 * are no longer supported — all callers pass IDs now.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

// ── Session-scoped node preference ──

const sessionNodeIds = new Set<string>();

export function registerSessionNodes(ids: string[]) {
  for (const id of ids) sessionNodeIds.add(id);
}

export function clearSessionNodes() {
  sessionNodeIds.clear();
}

export function isSessionNode(id: string): boolean {
  return sessionNodeIds.has(id);
}

// ── Types ──

export type NodeResolved =
  | { ok: true; node: SceneNode }
  | { ok: false; response: ToolResponse };

export type PathResolved =
  | { ok: true; isPage: true; page: PageNode }
  | { ok: true; isPage: false; node: SceneNode }
  | { ok: false; response: ToolResponse };

// ── Resolution ──

/** Resolve a scene node by ID. Fails for pages (not a design node). */
export async function resolveSceneNode(nodeId: string): Promise<NodeResolved> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    return { ok: false, response: { error: `Node "${nodeId}" not found. Use inspect({node: "/"}) to discover available nodes.` } };
  }
  if (!('visible' in node)) {
    return { ok: false, response: { error: `"${nodeId}" is a ${node.type}, not a design node.` } };
  }
  return { ok: true, node: node as SceneNode };
}

/** Resolve a ref to either a page ("/" or page id) or a scene node (bare ID). */
export async function resolvePathToNode(ref: string): Promise<PathResolved> {
  if (ref === '/' || ref === '') {
    return { ok: true, isPage: true, page: figma.currentPage };
  }

  const node = await figma.getNodeByIdAsync(ref);
  if (!node) {
    return {
      ok: false,
      response: { error: `Node "${ref}" not found. Use inspect({node: "/"}) to discover available nodes.` },
    };
  }
  if (node.type === 'PAGE') {
    return { ok: true, isPage: true, page: node as PageNode };
  }
  if (!('visible' in node)) {
    return { ok: false, response: { error: `"${node.name}" (${node.type}) is not a design node.` } };
  }
  return { ok: true, isPage: false, node: node as SceneNode };
}

// ── Ref helpers ──

/** Returns bare Figma ID. Use this for all tool output. */
export function buildNodeRef(node: BaseNode): string {
  return node.id;
}

export function parseRef(ref: string): { id: string } {
  if (ref.startsWith('#')) return { id: ref.slice(1) };
  return { id: ref };
}

// ── Name deduplication ──

export function deduplicateName(siblings: readonly BaseNode[], name: string): string {
  const existing = new Set(siblings.map(c => c.name));
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}
