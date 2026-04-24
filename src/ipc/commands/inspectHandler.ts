/**
 * @file inspectHandler.ts
 * @description First-class inspect tool — facet-based reads for design nodes.
 *
 * Facet model:
 *   - no facets (default) → skeleton tree (structure, role, summary)
 *   - facets:[...]        → detail output filtered to the union of requested facets
 *
 * Pure read — no quality scoring, no screenshot (use `get_screenshot`).
 * Use `describe` for lint/validation.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import type { NodeLayer } from '../../schema/layerSchema';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { resolvePathToNode } from './pathResolver';
import { PipelineTracer } from './pipelineTracer';

/**
 * Walk the serialized NodeLayer tree and attach boundVariables + explicitVariableModes
 * from each layer.props onto the matching detail entry (by id).
 * JsonNodeSerializer drops object-valued props in its catch-all emit path, so without
 * this post-hop the `variables` facet would silently lose all bindings.
 */
function attachVariableBindings(detail: any, layer: NodeLayer | undefined): void {
  if (!detail || !layer) return;
  const props = (layer as any).props || {};
  const bv = props.boundVariables;
  const evm = props.explicitVariableModes;
  if (bv && typeof bv === 'object' && Object.keys(bv).length > 0) {
    detail.boundVariables = bv;
  }
  if (evm && typeof evm === 'object' && Object.keys(evm).length > 0) {
    detail.explicitVariableModes = evm;
  }

  const detailChildren = Array.isArray(detail.children) ? detail.children : undefined;
  const layerChildren = layer.children;
  if (!detailChildren || !layerChildren) return;

  // Build id→layer map so we pair correctly even when JsonNodeSerializer truncated
  // or reordered children (skeleton markers, '...' placeholders).
  const byId = new Map<string, NodeLayer>();
  for (const c of layerChildren) {
    if (c && c.id) byId.set(c.id, c);
  }
  for (const d of detailChildren) {
    if (d && typeof d === 'object' && d.id) {
      attachVariableBindings(d, byId.get(d.id));
    }
  }
}

/**
 * Resolve user-supplied `facets` to a normalized facet set.
 *
 * Returns undefined when the caller wants the skeleton (no facets, or empty array).
 * Returns a Set of requested facets otherwise.
 */
function resolveFacets(parameters: any): Set<string> | undefined {
  const raw = parameters.facets;
  if (Array.isArray(raw) && raw.length > 0) {
    return new Set(raw.map((s: any) => String(s)));
  }
  return undefined;
}

export async function handleInspect(parameters: any): Promise<ToolResponse> {
  const ref = parameters.node || parameters.path;
  const depth = Math.min(parameters.depth || 5, 10);
  const facets = resolveFacets(parameters);

  if (!ref) {
    return {
      error: 'Missing required "node" parameter. Use inspect({node: "/"}) for page root.',
    };
  }

  const tracer = new PipelineTracer();

  tracer.enter('handleInspect()', 'inspectHandler.ts');
  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;
  tracer.exit({ facets: facets ? Array.from(facets) : undefined });

  let result: ToolResponse;

  if (facets) {
    tracer.enter('readHandler()', 'readHandlers.ts');
    result = buildDetailResult(resolved, depth, facets);
    tracer.exit();
  } else {
    // no facets → today's skeleton path (byte-identical)
    tracer.enter('readHandler()', 'readHandlers.ts');
    result = buildTreeResult(resolved, depth);
    tracer.exit();
  }

  result._stages = tracer.collect();
  return result;
}

// ── Tree (skeleton) — default when no facets are requested ──

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

// ── Detail — facet-filtered full properties ──

function buildDetailResult(
  resolved: Extract<Awaited<ReturnType<typeof resolvePathToNode>>, { ok: true }>,
  depth: number,
  facets: Set<string>,
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
    facets,
  });
  const detail = JsonNodeSerializer.serialize(serialized, { maxDepth: depth });

  // Variables facet: JsonNodeSerializer drops object-valued props (including boundVariables
  // + explicitVariableModes) in its catch-all `emit`. Pull them back from the NodeLayer
  // here so the agent actually sees the bindings it came to read.
  if (facets.has('variables') || facets.has('all')) {
    attachVariableBindings(detail, serialized);
  }

  // Structural overrides — complex shapes whose geometry lives on separate computed props
  // that the serializer skips. Only emit for 'all' (detail parity with prior behaviour).
  const all = facets.has('all');
  if (all) {
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
  }

  return { data: detail };
}
