/**
 * @file inspectHandler.ts
 * @description Handler for the `inspect` tool — routes to ls/tree/cat based on mode.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleLs, handleTree, handleCat } from './readHandlers';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';
import { resolvePathToNode } from './pathResolver';

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

  let result: ToolResponse;
  switch (mode) {
    case 'tree':
      result = await handleTree({ path, depth });
      break;
    case 'detail':
      result = await handleCat({ path, screenshot, depth });
      break;
    default:
      result = await handleLs({ path });
      break;
  }

  // ── Quality scoring on detail inspect ──
  // When agent inspects with detail mode, append quality scores so it can
  // verify its fixes are working. Agent loops until ✅ 100%.
  if (mode === 'detail' && result.success) {
    try {
      const resolved = await resolvePathToNode(path);
      if (resolved.ok && !('isPage' in resolved && resolved.isPage)) {
        const nodeId = (resolved as { ok: true; isPage: false; node: SceneNode }).node.id;
        const report = await scoreCreatedNodes([nodeId]);
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
