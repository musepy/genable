/**
 * @file inspectHandler.ts
 * @description First-class inspect tool — reads design nodes via skeleton (tree) or full (detail) mode.
 *
 * Two modes:
 *   - tree (default): skeleton JSON with role, summary, children
 *   - detail: full properties, optional screenshot
 *
 * Quality scoring only runs when `score: true` is passed.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { scoreCreatedNodes, formatQualityReport } from './qualityScorer';
import { resolvePathToNode, buildNodeRef } from './pathResolver';
import { exportNodeToBase64 } from './shared';
import { logger } from '../../utils/logger';

export async function handleInspect(parameters: any): Promise<ToolResponse> {
  const ref = parameters.node || parameters.path;
  const mode = parameters.mode || 'tree';
  const depth = Math.min(parameters.depth || 5, 10);
  const wantScreenshot = parameters.screenshot && mode === 'detail';
  const wantScore = parameters.score === true;

  if (!ref) {
    return {
      error: { code: 'MISSING_PARAM', message: 'Missing required "node" parameter. Use inspect({node: "/"}) for page root.' },
    };
  }

  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;

  let result: ToolResponse;

  if (mode === 'detail') {
    result = buildDetailResult(resolved, depth, wantScreenshot);
    if (wantScreenshot && !resolved.isPage) {
      await attachScreenshot(result, resolved.node);
    }
  } else {
    // tree mode (default) — skeleton JSON
    result = buildTreeResult(resolved, depth);
  }

  // Quality scoring — only when explicitly requested
  if (wantScore && !result.error) {
    await attachQualityScore(result, resolved);
  }

  return result;
}

// ── Tree mode: skeleton JSON ──

function buildTreeResult(
  resolved: Extract<Awaited<ReturnType<typeof resolvePathToNode>>, { ok: true }>,
  depth: number,
): ToolResponse {
  if (resolved.isPage) {
    const page = resolved.page;
    const children = page.children.map((child: SceneNode) => {
      const serialized = NodeSerializer.serializeWithCompression(child, {
        maxDepth: depth,
        pruneDefaults: true,
      });
      return JsonNodeSerializer.serialize(serialized, { maxDepth: depth, skeleton: true });
    });

    return {
      data: {
        page: page.name,
        count: page.children.length,
        children,
      },
    };
  }

  const node = resolved.node;
  const serialized = NodeSerializer.serializeWithCompression(node, {
    maxDepth: depth,
    pruneDefaults: true,
  });
  const tree = JsonNodeSerializer.serialize(serialized, { maxDepth: depth, skeleton: true });

  return { data: tree };
}

// ── Detail mode: full properties ──

function buildDetailResult(
  resolved: Extract<Awaited<ReturnType<typeof resolvePathToNode>>, { ok: true }>,
  depth: number,
  _wantScreenshot: boolean,
): ToolResponse {
  if (resolved.isPage) {
    const page = resolved.page;
    const topLevel = page.children.map((n: SceneNode) => ({
      type: n.type.toLowerCase(), id: n.id, name: n.name,
      width: Math.round(n.width), height: Math.round(n.height),
    }));
    return {
      data: {
        page: page.name,
        childCount: page.children.length,
        children: topLevel,
      },
    };
  }

  const node = resolved.node;
  const serialized = NodeSerializer.serializeWithCompression(node, {
    maxDepth: depth,
    pruneDefaults: true,
  });
  const detail = JsonNodeSerializer.serialize(serialized, { maxDepth: depth });

  return { data: detail };
}

// ── Screenshot attachment ──

async function attachScreenshot(result: ToolResponse, node: SceneNode): Promise<void> {
  if (!node.visible || node.width <= 0 || node.height <= 0) return;
  try {
    const ssResult = await exportNodeToBase64(node);
    if (result.data && ssResult.__image) {
      result.data.__image = ssResult.__image;
    }
  } catch (e: any) {
    logger.info(`Screenshot failed for ${buildNodeRef(node)}: ${e?.message}`);
  }
}

// ── Quality scoring ──

async function attachQualityScore(
  result: ToolResponse,
  resolved: Extract<Awaited<ReturnType<typeof resolvePathToNode>>, { ok: true }>,
): Promise<void> {
  try {
    let scoreIds: string[] = [];
    if (resolved.isPage) {
      const topChildren = resolved.page.children.filter((c: SceneNode) => c.visible);
      if (topChildren.length > 0) {
        scoreIds = [topChildren[topChildren.length - 1].id];
      }
    } else {
      scoreIds = [resolved.node.id];
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
