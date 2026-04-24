/**
 * @file structureAdapter.ts
 * @description Adapters for structure tools — maps tool params to writeHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleRm, handleMv, handleCp } from './writeHandlers';
import { resolveSceneNode } from './pathResolver';

export async function handleDeleteNode(params: any): Promise<ToolResponse> {
  return handleRm({ sourceId: params.node });
}

export async function handleMoveNode(params: any): Promise<ToolResponse> {
  const hasParent = typeof params.parent === 'string' && params.parent.length > 0;
  const hasName = typeof params.name === 'string' && params.name.length > 0;
  const hasIndex = params.index != null;

  if (!hasParent && !hasName && !hasIndex) {
    return { error: 'move_node requires "parent", "name", or "index".' };
  }

  // "/" → page root id; bare id → pass through; undefined → keep current parent
  let parentId: string | undefined;
  if (hasParent) {
    parentId = (params.parent === '/' || params.parent === '')
      ? figma.currentPage.id
      : params.parent;
  }

  return handleMv({
    sourceId: params.node,
    parentId,
    newName: hasName ? params.name : undefined,
    atIndex: params.index,
  });
}

export async function handleCloneNode(params: any): Promise<ToolResponse> {
  if (!params.node) {
    return { error: 'clone_node requires "node".' };
  }

  // Fallback clone name = source's name
  let cloneName: string | undefined = typeof params.name === 'string' && params.name.length > 0
    ? params.name
    : undefined;
  if (!cloneName) {
    const resolved = await resolveSceneNode(params.node);
    if (!resolved.ok) return resolved.response;
    cloneName = resolved.node.name;
  }

  // Parent: "/" or missing → undefined (page root); bare id → pass through
  const parentId: string | undefined =
    typeof params.parent === 'string' && params.parent.length > 0 && params.parent !== '/'
      ? params.parent
      : undefined;

  const overrides = (params.overrides && typeof params.overrides === 'object')
    ? params.overrides as Record<string, any>
    : undefined;

  const result = await handleCp({ sourceId: params.node, parentId, cloneName, overrides });

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
    if (!node.parent || node.parent.type !== 'COMPONENT_SET') return warnings;

    if (node.type !== 'COMPONENT') {
      warnings.push(`Node type is ${node.type} — expected COMPONENT inside a component set. Use create_component to convert.`);
    }

    const variantProps = (node as ComponentNode).variantProperties;
    const breakpoint = variantProps?.['Breakpoint'];
    if (!breakpoint) {
      warnings.push(`variantProperties.Breakpoint is not set. Set it to "Desktop", "Tablet", or "Mobile".`);
    } else {
      const expectedWidth = BREAKPOINT_WIDTHS[breakpoint];
      const actualWidth = Math.round((node as FrameNode).width);
      if (expectedWidth && actualWidth !== expectedWidth) {
        warnings.push(`Width is ${actualWidth}px but Breakpoint="${breakpoint}" expects ${expectedWidth}px.`);
      }
    }
  } catch { /* best-effort */ }
  return warnings;
}
