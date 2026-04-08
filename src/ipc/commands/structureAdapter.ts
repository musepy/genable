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
  let destPath = params.dest;
  if (!destPath && params.name) {
    destPath = params.name;
  }
  if (!destPath && params.index == null) {
    return { error: 'move_node requires "dest", "name", or "index".' };
  }
  return handleMv({
    sourcePath: params.node,
    destPath: destPath || params.node,
    at: params.index,
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

  // Resolve parent (dest)
  let parentId: string | undefined;
  const dest: string = params.dest ?? '/';
  if (dest && dest !== '/' && dest !== '') {
    const destResolved = await resolvePathToNode(dest);
    if (!destResolved.ok) return destResolved.response;
    if (!destResolved.isPage) parentId = destResolved.node.id;
    // else: dest resolved to page root → parentId remains undefined
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
