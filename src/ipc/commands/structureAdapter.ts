/**
 * @file structureAdapter.ts
 * @description Adapters for structure tools — maps structured params to writeHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleRm, handleMv, handleCp } from './writeHandlers';
import { resolvePathToNode } from './pathResolver';

export async function handleDeleteNode(params: any): Promise<ToolResponse> {
  return handleRm({ path: params.node });
}

export async function handleMoveNode(params: any): Promise<ToolResponse> {
  const hasParent = typeof params.parent === 'string' && params.parent.length > 0;
  const hasName = typeof params.name === 'string' && params.name.length > 0;
  const hasIndex = params.index != null;

  if (!hasParent && !hasName && !hasIndex) {
    return { error: 'move_node requires "parent", "name", or "index".' };
  }

  let destPath: string;
  if (hasParent) {
    destPath = params.parent;
  } else {
    const sourceResolved = await resolvePathToNode(params.node);
    if (!sourceResolved.ok) return sourceResolved.response;
    if (sourceResolved.isPage) return { error: 'Cannot move page root.' };
    const parentId = sourceResolved.node.parent?.id;
    if (!parentId) return { error: 'Source node has no parent; provide "parent".' };
    destPath = parentId;
  }

  return handleMv({
    sourcePath: params.node,
    destPath,
    at: params.index,
    newName: hasName ? params.name : undefined,
  });
}

export async function handleCloneNode(params: any): Promise<ToolResponse> {
  // Serialize overrides object to the string format handleCp expects
  let propsRaw: string | undefined;
  if (params.overrides && typeof params.overrides === 'object') {
    propsRaw = '{' + Object.entries(params.overrides)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ') + '}';
  } else if (typeof params.overrides === 'string') {
    propsRaw = params.overrides;
  }

  // Resolve source node
  const sourceResolved = await resolvePathToNode(params.node);
  if (!sourceResolved.ok) return sourceResolved.response;
  if (sourceResolved.isPage) return { error: 'Cannot clone page root.' };

  const cloneName = params.name || sourceResolved.node.name;

  // Resolve target parent
  let parentId: string | undefined;
  const parentPath: string = params.parent ?? '/';
  if (parentPath && parentPath !== '/' && parentPath !== '') {
    const parentResolved = await resolvePathToNode(parentPath);
    if (!parentResolved.ok) return parentResolved.response;
    if (!parentResolved.isPage) parentId = parentResolved.node.id;
    // else: resolved to page root → parentId remains undefined
  }
  // parentId undefined = page root

  const result = await handleCp({
    sourceId: sourceResolved.node.id,
    parentId,
    cloneName,
    propsRaw,
  });

  // Post-clone structural warnings for component set variants
  if (result.data?.idMap) {
    const nodeId = Object.values(result.data.idMap as Record<string, string>)[0];
    if (nodeId) {
      const warnings = await checkVariantStructure(nodeId);
      if (warnings.length > 0) {
        result.data.warnings = warnings;
      }
    }
  }

  return result;
}

const BREAKPOINT_WIDTHS: Record<string, number> = { Desktop: 1440, Tablet: 768, Mobile: 375 };

async function checkVariantStructure(nodeId: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
    if (!node) return warnings;

    // Only check when parent is a component set
    if (!node.parent || node.parent.type !== 'COMPONENT_SET') return warnings;

    // Check 1: node should be a COMPONENT (not a plain frame)
    if (node.type !== 'COMPONENT') {
      warnings.push(`Node type is ${node.type} — expected COMPONENT inside a component set. Use create_component to convert.`);
    }

    // Check 2: variantProperties.Breakpoint should be set
    const variantProps = (node as ComponentNode).variantProperties;
    const breakpoint = variantProps?.['Breakpoint'];
    if (!breakpoint) {
      warnings.push(`variantProperties.Breakpoint is not set. Set it to "Desktop", "Tablet", or "Mobile".`);
    } else {
      // Check 3: width should match the declared breakpoint
      const expectedWidth = BREAKPOINT_WIDTHS[breakpoint];
      const actualWidth = Math.round((node as FrameNode).width);
      if (expectedWidth && actualWidth !== expectedWidth) {
        warnings.push(`Width is ${actualWidth}px but Breakpoint="${breakpoint}" expects ${expectedWidth}px.`);
      }
    }
  } catch { /* best-effort */ }
  return warnings;
}
