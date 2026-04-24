/**
 * @file writeHandlers.ts
 * @description Structural write operations: rm, mv, cp.
 * All handlers take structured Figma IDs — no path strings, no shell semantics.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolveSceneNode, isSessionNode } from './pathResolver';
import { normalizeProps } from '../../domain/node-normalizers';
import { cloneNode, deleteNode, tagAsAgentCreated } from '../../engine/actions/nodeFactory';

// ── Shared helpers ──

/** Wrap a sub-command result with pipeline tracing stages. */
function wrapRunStages(subCmd: string, result: ToolResponse, startTime: number): ToolResponse {
  const handlerStage = { label: `handle${subCmd}()`, file: 'writeHandlers.ts', durationMs: Date.now() - startTime };
  const existing = (result as any)._stages || [];
  (result as any)._stages = [
    { label: 'unwrapRunCmd()', file: 'toolDispatcher.ts', durationMs: 0 },
    handlerStage,
    ...existing,
  ];
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// rm — delete a node by ID
// ═══════════════════════════════════════════════════════════════════════════

export async function handleRm(parameters: { sourceId: string }): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourceId } = parameters;

  if (!sourceId) {
    return { error: 'delete_node requires "node".' };
  }

  const resolved = await resolveSceneNode(sourceId);
  if (!resolved.ok) return resolved.response;

  const node = resolved.node;
  const nodeName = node.name;
  const nodeId = node.id;
  const isSession = isSessionNode(nodeId) || node.getPluginData('_agent') === 'created';

  deleteNode(node);

  const response: ToolResponse = {
    data: { deleted: nodeName, id: nodeId },
  };
  if (!isSession) {
    response.data = { ...response.data, warning: `⚠ "${nodeName}" was not created by you in this session.` };
  }
  return wrapRunStages('Rm', response, _t0);
}

// ═══════════════════════════════════════════════════════════════════════════
// mv — move, rename, or reorder a node
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMv(parameters: {
  sourceId: string;
  parentId?: string;
  newName?: string;
  atIndex?: number;
}): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourceId, parentId, newName, atIndex } = parameters;

  if (!sourceId) {
    return { error: 'move_node requires "node".' };
  }

  const resolved = await resolveSceneNode(sourceId);
  if (!resolved.ok) return resolved.response;
  const node = resolved.node;
  const oldName = node.name;
  const oldParentId = node.parent?.id;

  // Resolve target parent (undefined → keep current parent)
  let newParent: (BaseNode & ChildrenMixin) | null = null;
  if (parentId != null) {
    if (parentId === figma.currentPage.id) {
      newParent = figma.currentPage;
    } else {
      const p = await figma.getNodeByIdAsync(parentId);
      if (!p) return { error: `Parent node "${parentId}" not found.` };
      if (!('children' in p)) return { error: `"${parentId}" is a ${p.type}, cannot contain children.` };
      newParent = p as BaseNode & ChildrenMixin;
    }
  }

  // Rename
  let renamed = false;
  if (typeof newName === 'string' && newName.length > 0 && newName !== oldName) {
    node.name = newName;
    renamed = true;
  }

  // Move / reorder
  let moved = false;
  let reordered = false;

  const crossParent = newParent != null && newParent.id !== oldParentId;
  if (crossParent) {
    if (atIndex != null) {
      const idx = atIndex < 0 ? (newParent as any).children.length : atIndex;
      (newParent as any).insertChild(idx, node);
    } else {
      (newParent as any).appendChild(node);
    }
    moved = true;
  } else if (atIndex != null) {
    // Same-parent reorder (either newParent explicitly matches current, or absent)
    const parent = (newParent ?? (node.parent as any));
    if (parent && 'children' in parent) {
      const childCount = parent.children.length;
      const idx = atIndex < 0 ? childCount - 1 : Math.min(atIndex, childCount - 1);
      parent.insertChild(idx, node);
      reordered = true;
    }
  }

  return wrapRunStages('Mv', {
    data: {
      id: node.id,
      oldName,
      newName: node.name,
      renamed,
      moved,
      reordered,
      newParent: moved ? (newParent as any).name : undefined,
      index: (moved || reordered) ? atIndex : undefined,
    },
  }, _t0);
}

// ═══════════════════════════════════════════════════════════════════════════
// cp — clone a node with optional property overrides
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCp(parameters: {
  sourceId: string;
  parentId?: string;
  cloneName: string;
  overrides?: Record<string, any>;
}): Promise<ToolResponse> {
  const _t0 = Date.now();
  const { sourceId, parentId, cloneName, overrides } = parameters;

  if (!sourceId) {
    return { error: 'clone_node requires "node".' };
  }
  if (!cloneName) {
    return { error: 'clone_node requires a clone name.' };
  }

  // Resolve parent (undefined/page-id → page root)
  let parentNode: SceneNode | null = null;
  if (parentId != null && parentId !== figma.currentPage.id) {
    const p = await figma.getNodeByIdAsync(parentId);
    if (!p) return { error: `Parent node "${parentId}" not found.` };
    if (!('children' in p)) return { error: `"${parentId}" is a ${p.type}, cannot contain children.` };
    parentNode = p as SceneNode;
  }

  // Separate flat overrides into root props and child-keyed overrides
  // ("Child.prop": value → nested {Child: {prop: value}}; plain keys → root props)
  const rootProps: Record<string, any> = { name: cloneName };
  const childOverrides: Record<string, Record<string, any>> = {};
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      const dotIdx = k.indexOf('.');
      if (dotIdx > 0) {
        const childName = k.slice(0, dotIdx);
        const childProp = k.slice(dotIdx + 1);
        if (!childOverrides[childName]) childOverrides[childName] = {};
        childOverrides[childName][childProp] = v;
      } else {
        rootProps[k] = v;
      }
    }
  }

  // Normalize
  const normalizedOverrides: Record<string, Record<string, any>> = {};
  for (const [name, childProps] of Object.entries(childOverrides)) {
    normalizedOverrides[name] = normalizeProps(childProps, {}, () => {});
  }
  const normalizedRoot = normalizeProps(rootProps, { nodeType: 'FRAME', isCreate: true }, () => {});

  const result = await cloneNode(
    sourceId,
    parentNode,
    normalizedRoot,
    Object.keys(normalizedOverrides).length > 0 ? normalizedOverrides : undefined,
  );

  if (!result.nodeId) {
    return { error: result.warnings[0]?.message || 'Clone failed' };
  }

  try {
    const n = await figma.getNodeByIdAsync(result.nodeId) as SceneNode;
    if (n) tagAsAgentCreated(n);
  } catch { /* best-effort */ }

  return wrapRunStages('Cp', {
    data: {
      idMap: { [cloneName]: result.nodeId },
      createdIds: result.createdIds ?? [result.nodeId],
    },
  }, _t0);
}
