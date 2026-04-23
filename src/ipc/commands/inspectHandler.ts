/**
 * @file inspectHandler.ts
 * @description First-class inspect tool — reads design nodes via skeleton (tree) or full (detail) mode.
 *
 * Two modes:
 *   - tree (default): skeleton JSON with role, summary, children
 *   - detail: full properties
 *
 * Pure read — no quality scoring, no screenshot (use `get_screenshot`).
 * Use `describe` for lint/validation.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { resolvePathToNode } from './pathResolver';
import { PipelineTracer } from './pipelineTracer';

export async function handleInspect(parameters: any): Promise<ToolResponse> {
  const ref = parameters.node || parameters.path;
  const mode = parameters.mode || 'tree';
  const depth = Math.min(parameters.depth || 5, 10);

  if (!ref) {
    return {
      error: 'Missing required "node" parameter. Use inspect({node: "/"}) for page root.',
    };
  }

  const tracer = new PipelineTracer();

  tracer.enter('handleInspect()', 'inspectHandler.ts');
  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;
  tracer.exit({ mode });

  let result: ToolResponse;

  if (mode === 'detail') {
    tracer.enter('readHandler()', 'readHandlers.ts');
    result = buildDetailResult(resolved, depth);
    tracer.exit();
  } else {
    // tree mode (default) — skeleton JSON
    tracer.enter('readHandler()', 'readHandlers.ts');
    result = buildTreeResult(resolved, depth);
    tracer.exit();
  }

  result._stages = tracer.collect();
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
): ToolResponse {
  if (resolved.isPage) {
    const page = resolved.page;
    const topLevel = page.children.map((n: SceneNode) => {
      const minimal = NodeSerializer.serializeMinimal(n, false);
      return JsonNodeSerializer.serialize(minimal, { minimal: true });
    });
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

  // Attach geometry properties the serializer skips (complex objects / computed role)
  if (node.type === 'ELLIPSE') {
    const arc = (node as EllipseNode).arcData;
    const fullCircle = arc.startingAngle === 0 && Math.abs(arc.endingAngle - Math.PI * 2) < 0.01 && arc.innerRadius === 0;
    if (!fullCircle) detail.arcData = arc;
  }
  if (node.type === 'STAR') {
    detail.pointCount = (node as StarNode).pointCount;
    detail.innerRadius = (node as StarNode).innerRadius;
  }
  if (node.type === 'POLYGON') {
    detail.pointCount = (node as PolygonNode).pointCount;
  }
  if ('vectorPaths' in node) {
    const vp = (node as VectorNode).vectorPaths;
    if (vp?.length > 0) {
      detail.vectorPaths = vp.map((p: any) => ({ windingRule: p.windingRule, data: p.data }));
    }
  }

  return { data: detail };
}
