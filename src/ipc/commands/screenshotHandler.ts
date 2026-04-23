/**
 * @file screenshotHandler.ts
 * @description `get_screenshot` tool — capture a PNG of a node as base64.
 *
 * Extracted from inspect's old `screenshot:true` branch so visual verification
 * is a first-class affordance. Preserves the original export behavior bit-for-bit
 * (uses exportNodeToBase64, PNG format, scale clamped 0.5–2).
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode, buildNodeRef } from './pathResolver';
import { exportNodeToBase64 } from './shared';
import { PipelineTracer } from './pipelineTracer';
import { logger } from '../../utils/logger';

export async function handleGetScreenshot(parameters: any): Promise<ToolResponse> {
  const ref = parameters.node;
  const scale = typeof parameters.scale === 'number' ? parameters.scale : 1;

  if (!ref) {
    return {
      error: 'Missing required "node" parameter. Pass a node ID (e.g. "100:5").',
    };
  }

  const tracer = new PipelineTracer();
  tracer.enter('handleGetScreenshot()', 'screenshotHandler.ts');

  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;

  if (resolved.isPage) {
    return {
      error: 'get_screenshot does not support the page root ("/"). Pass a SceneNode id.',
    };
  }

  const node = resolved.node;
  if (!node.visible) {
    return { error: `Node ${buildNodeRef(node)} is not visible — cannot screenshot.` };
  }
  if (node.width <= 0 || node.height <= 0) {
    return { error: `Node ${buildNodeRef(node)} has zero size — cannot screenshot.` };
  }

  try {
    const ssResult = await exportNodeToBase64(node, scale, 'png');
    tracer.exit({ width: ssResult.width, height: ssResult.height });
    return {
      data: {
        id: node.id,
        name: node.name,
        width: ssResult.width,
        height: ssResult.height,
        __image: ssResult.__image,
      },
      _stages: tracer.collect(),
    };
  } catch (e: any) {
    logger.info(`get_screenshot failed for ${buildNodeRef(node)}: ${e?.message}`);
    return { error: `Screenshot export failed: ${e?.message || String(e)}` };
  }
}
