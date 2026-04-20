/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Pipeline:
 *   1. compileAndExecute() — sucrase JSX → JS → VNode tree
 *   2. collectIconNames() + prefetchIcons() — batch icon prefetch
 *   3. walkTree() — VNode → Figma nodes via nodeFactory (atomic rollback)
 *
 * Template functions (solid, col, pad, etc.) replace string parsing.
 * No intermediate IR — VNode tree walks directly into Figma API.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import {
  compileAndExecute,
  walkTree,
  collectIconNames,
  type WalkContext,
  type WalkResult,
} from '../../engine/jsx/templateCompiler';
import {
  centerNodeInViewport,
  prefetchIcons,
} from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { PipelineTracer } from './pipelineTracer';

// ═══════════════════════════════════════════════════════════════════════════
// Public Handler
// ═══════════════════════════════════════════════════════════════════════════

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parentId, parent, replaceId, insertIndex } = parameters;
  const resolvedParentId = parentId || parent;  // accept both names

  // Param validation: replaceId is mutually exclusive with parentId
  if (replaceId && resolvedParentId) {
    return { error: 'jsx: replaceId and parentId are mutually exclusive — replaceId already determines the parent.' };
  }

  if (!markup || typeof markup !== 'string') {
    return {
      data: {
        message: 'jsx — Create design trees with JSX syntax and template functions.',
        usage: 'jsx({markup: "<Frame {...col(16)} {...pad(24)} fills={[solid(\'#FFF\')]}><Text fontSize={24}>Title</Text></Frame>"})',
        elements: ['Frame', 'Text', 'Rect', 'Ellipse', 'Line', 'Icon', 'Image', 'Instance', 'Component', 'Group', 'Section', 'Vector'],
        functions: {
          paint: 'solid(hex, opts?), gradient(angle, ...stops)',
          effect: 'shadow(x, y, blur, spread, color), blur(radius), bgblur(radius)',
          layout: 'col(gap?), row(gap?), pad(...args), align(...args)',
          sizing: 'fillH(), fillV(), hugH(), hugV(), sizeFill(), sizeHug()',
          color: 'hexToRgb(hex), rgb(r, g, b, a?)',
        },
      },
    };
  }

  const tracer = new PipelineTracer();

  // Step 1: Compile + Execute → VNode tree
  tracer.enter('compileAndExecute()', 'templateCompiler.ts');
  const { vnodes, error } = await compileAndExecute(markup);
  tracer.exit({ roots: vnodes.length, error: !!error });

  if (error || vnodes.length === 0) {
    return {
      error: error?.message || 'No valid elements found in JSX markup.',
      _stages: tracer.collect(),
    };
  }

  // replaceId requires exactly one root element
  if (replaceId && vnodes.length !== 1) {
    return {
      error: `jsx: replaceId requires exactly one root element in markup (got ${vnodes.length}).`,
      _stages: tracer.collect(),
    };
  }

  // Step 2: Prefetch all icons in parallel
  const iconNames = collectIconNames(vnodes);
  if (iconNames.length > 0) await prefetchIcons(iconNames);

  // Step 3: Resolve target parent + final index
  // Three modes:
  //   - replaceId: inherit oldNode's parent + index, delete oldNode on success
  //   - parentId + insertIndex: append then move to index
  //   - parentId only: append (current behavior)
  let parentNode: SceneNode | null = null;
  let oldNode: SceneNode | null = null;
  let targetIndex: number | undefined;

  if (replaceId) {
    oldNode = await figma.getNodeByIdAsync(replaceId) as SceneNode | null;
    if (!oldNode || oldNode.removed) {
      return { error: `jsx: replaceId "${replaceId}" not found or already removed.`, _stages: tracer.collect() };
    }
    const oldParent = oldNode.parent as (BaseNode & ChildrenMixin) | null;
    if (!oldParent || !('appendChild' in oldParent) || !('children' in oldParent)) {
      return { error: `jsx: replaceId "${replaceId}" has no valid parent (cannot replace page/document root).`, _stages: tracer.collect() };
    }
    parentNode = oldParent as SceneNode;
    targetIndex = oldParent.children.indexOf(oldNode as SceneNode);
  } else if (resolvedParentId) {
    parentNode = await figma.getNodeByIdAsync(resolvedParentId) as SceneNode | null;
    if (typeof insertIndex === 'number' && Number.isFinite(insertIndex)) {
      targetIndex = Math.max(0, Math.floor(insertIndex));
    }
  }

  // Step 4: Walk tree — create Figma nodes
  tracer.enter('walkTree()', 'templateCompiler.ts');
  const ctx: WalkContext = {
    symbolMap: new Map(),
    rollbackStack: [],
    warnings: [],
    counter: 0,
  };

  const rootResults: WalkResult[] = [];
  let failed = false;

  try {
    for (const vnode of vnodes) {
      // Center root-level nodes in viewport if no explicit parent
      if (!parentNode) {
        const isText = vnode.type === 'TEXT';
        const centered = centerNodeInViewport({ ...vnode.props }, isText);
        if (centered.x !== undefined) vnode.props.x = centered.x;
        if (centered.y !== undefined) vnode.props.y = centered.y;
      }

      const result = await walkTree(vnode, parentNode, ctx);
      if (result) {
        rootResults.push(result);
      } else {
        failed = true;
        break;
      }
    }
  } catch (e: any) {
    failed = true;
    ctx.warnings.push({ code: 'EXECUTION_ERROR', message: e?.message || 'Unexpected error' });
  }

  // Rollback on failure (atomic)
  if (failed) {
    for (const nodeId of [...ctx.rollbackStack].reverse()) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId) as SceneNode | null;
        if (node && !node.removed) node.remove();
      } catch { /* best-effort */ }
    }
  }

  tracer.exit({ created: ctx.rollbackStack.length, failed });

  // Step 5: Build response
  const _stages = tracer.collect();

  if (failed || rootResults.length === 0) {
    return {
      error: ctx.warnings[ctx.warnings.length - 1]?.message || 'Failed to create design tree.',
      _stages,
    };
  }

  // Step 5a: Apply targetIndex (move newly-appended root to desired position)
  // walkTree already appended newNode at end of parentNode.children.
  // insertChild moves an existing child to a new index.
  if (parentNode && targetIndex !== undefined && rootResults.length === 1) {
    try {
      const newNode = await figma.getNodeByIdAsync(rootResults[0].nodeId) as SceneNode | null;
      if (newNode) {
        const childrenLen = (parentNode as any).children?.length ?? 0;
        const clamped = Math.min(targetIndex, Math.max(0, childrenLen - 1));
        (parentNode as any).insertChild(clamped, newNode);
      }
    } catch (e: any) {
      ctx.warnings.push({ code: 'INSERT_INDEX', message: `Failed to move node to index ${targetIndex}: ${e?.message}` });
    }
  }

  // Step 5b: Remove oldNode on successful replace
  if (replaceId && oldNode && !oldNode.removed) {
    try {
      oldNode.remove();
    } catch (e: any) {
      ctx.warnings.push({ code: 'REPLACE_REMOVE', message: `Failed to remove replaced node: ${e?.message}` });
    }
  }

  // Build structured response via serializeMinimal pipeline
  const rootNodeId = rootResults[0].nodeId;
  const rootNode = await figma.getNodeByIdAsync(rootNodeId) as SceneNode | null;
  let data: Record<string, any>;
  if (rootNode) {
    const minimal = NodeSerializer.serializeMinimal(rootNode, true);
    data = JsonNodeSerializer.serialize(minimal, { minimal: true });
  } else {
    const rootData = rootResults[0];
    data = { id: rootData.nodeId, name: rootData.name, type: rootData.type };
    if (rootData.childRefs.length > 0) data.children = rootData.childRefs;
  }
  if (rootResults.length > 1) {
    const roots: any[] = [];
    for (const r of rootResults) {
      const n = await figma.getNodeByIdAsync(r.nodeId) as SceneNode | null;
      if (n) {
        const m = NodeSerializer.serializeMinimal(n, true);
        roots.push(JsonNodeSerializer.serialize(m, { minimal: true }));
      } else {
        const d: any = { id: r.nodeId, name: r.name, type: r.type };
        if (r.childRefs.length > 0) d.children = r.childRefs;
        roots.push(d);
      }
    }
    data.roots = roots;
  }

  // Auto-pan viewport to newly created root node
  if (!resolvedParentId && rootResults.length > 0) {
    try {
      const newRootNode = await figma.getNodeByIdAsync(rootResults[0].nodeId);
      if (newRootNode) figma.viewport.scrollAndZoomIntoView([newRootNode as SceneNode]);
    } catch { /* best-effort */ }
  }

  data.created = ctx.rollbackStack.length;
  data.createdIds = ctx.rollbackStack;

  return { data, _stages };
}
