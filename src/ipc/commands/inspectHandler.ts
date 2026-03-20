/**
 * @file inspectHandler.ts
 * @description Handler for the `inspect` tool — routes to ls/tree/cat based on mode.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleLs, handleTree, handleCat } from './readHandlers';

export async function handleInspect(parameters: any): Promise<ToolResponse> {
  const { path, mode, screenshot, depth } = parameters;

  if (!path) {
    return {
      success: true,
      data: {
        message: 'inspect — Read the design tree.',
        usage: 'inspect({path: "/", mode: "tree"})',
        modes: { list: 'ls — list children', tree: 'tree — structural skeleton', detail: 'cat — full properties' },
      },
    };
  }

  switch (mode) {
    case 'tree':
      return handleTree({ path, depth });
    case 'detail':
      return handleCat({ path, screenshot, depth });
    default:
      return handleLs({ path });
  }
}
