/**
 * @file selectionAdapter.ts
 * @description Adapter for get_selection tool — reads figma.currentPage.selection.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

export async function handleGetSelection(): Promise<ToolResponse> {
  const selection = figma.currentPage.selection.map(node => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));

  if (selection.length === 0) {
    return { data: { selection: [], count: 0 } };
  }

  return { data: { selection, count: selection.length } };
}
