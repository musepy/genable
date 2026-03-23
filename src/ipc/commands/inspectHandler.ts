/**
 * @file inspectHandler.ts
 * @description Handler for the `inspect` tool — routes to ls/tree/cat based on mode.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleLs, handleTree, handleCat } from './readHandlers';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';
import { resolvePathToNode } from './pathResolver';

export async function handleInspect(parameters: any): Promise<ToolResponse> {
  // Accept both "node" (new) and "path" (legacy) parameter names
  const ref = parameters.node || parameters.path;
  const { mode, screenshot, depth } = parameters;

  if (!ref) {
    return {
      success: true,
      data: {
        message: 'inspect — Read the design tree.',
        usage: 'inspect({node: "/", mode: "tree"})',
        modes: { list: 'ls — list children', tree: 'tree — structural skeleton', detail: 'cat — full properties' },
      },
    };
  }

  let result: ToolResponse;
  switch (mode) {
    case 'tree':
      result = await handleTree({ path: ref, depth });
      break;
    case 'detail':
      result = await handleCat({ path: ref, screenshot, depth });
      break;
    default:
      result = await handleLs({ path: ref });
      break;
  }

  // ── Quality scoring on every inspect ──
  if (result.success) {
    try {
      const resolved = await resolvePathToNode(ref);
      let scoreIds: string[] = [];
      if (resolved.ok) {
        if ('isPage' in resolved && resolved.isPage) {
          // Page-level: score the last top-level child (most recent design)
          const page = resolved.page;
          const topChildren = page.children.filter(c => c.visible);
          if (topChildren.length > 0) {
            scoreIds = [topChildren[topChildren.length - 1].id];
          }
        } else {
          scoreIds = [resolved.node.id];
        }
      }
      if (scoreIds.length > 0) {
        const report = await scoreCreatedNodes(scoreIds);
        const qualityStr = formatQualityReport(report);
        if (qualityStr) {
          result._stderr = result._stderr
            ? result._stderr + '\n' + qualityStr
            : qualityStr;
        }
      }
    } catch { /* best-effort */ }
  }

  return result;
}
