/**
 * @file jsxHandler.ts
 * @description Handler for the `jsx` command.
 *
 * Pipeline:
 *   1. compileAndExecute()  — sucrase JSX → JS → VNode tree
 *   2. normalizeTree()      — shorthand + enum + layout defaults + margin→gap
 *   3. prefetchIcons()      — batch icon prefetch in parallel
 *   4. walkTree()           — VNode → Figma nodes via nodeFactory (atomic rollback)
 *
 * Separation of concerns: normalize is pure CPU on VNode props; walkTree only
 * touches the Figma API. Template functions (solid, col, pad, etc.) replace
 * string parsing. No intermediate IR — VNode tree walks directly into Figma API.
 */

import type { ToolResponse, ToolWarning } from '../../engine/agent/tools/types';
import {
  compileAndExecute,
  walkTree,
  collectIconNames,
  type WalkContext,
  type WalkResult,
  type WalkWarning,
} from '../../engine/jsx/templateCompiler';
import { normalizeTree, type NormalizeWarning } from '../../engine/jsx/normalizeTree';
import {
  centerNodeInViewport,
  prefetchIcons,
} from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { collectTreeViolations } from '../../engine/validation/postOpValidator';
import { PipelineTracer } from './pipelineTracer';

// ═══════════════════════════════════════════════════════════════════════════
// Public Handler
// ═══════════════════════════════════════════════════════════════════════════

export async function handleJsx(parameters: any): Promise<ToolResponse> {
  const { markup, parent, replaceId, insertIndex } = parameters;

  // Param validation: replaceId is mutually exclusive with parent
  if (replaceId && parent) {
    return { error: 'jsx: replaceId and parent are mutually exclusive — replaceId already determines the parent.' };
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

  // Step 2a: Normalize VNode tree (shorthand, layout defaults, margin→gap,
  // enum validation, ICON size→w/h, IMAGE placeholder→name, TEXT characters).
  // walkTree now only touches Figma API — all prop preparation lives here.
  tracer.enter('normalizeTree()', 'normalizeTree.ts');
  const normalizeWarnings: NormalizeWarning[] = [];
  normalizeTree(vnodes, normalizeWarnings);
  tracer.exit({ warnings: normalizeWarnings.length });

  // Step 2b: Prefetch all icons in parallel
  const iconNames = collectIconNames(vnodes);
  if (iconNames.length > 0) await prefetchIcons(iconNames);

  // Step 3: Resolve target parent + final index
  // Three modes:
  //   - replaceId: inherit oldNode's parent + index, delete oldNode on success
  //   - parent + insertIndex: append then move to index
  //   - parent only: append (current behavior)
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
  } else if (parent) {
    parentNode = await figma.getNodeByIdAsync(parent) as SceneNode | null;
    if (typeof insertIndex === 'number' && Number.isFinite(insertIndex)) {
      targetIndex = Math.max(0, Math.floor(insertIndex));
    }
  }

  // Step 4: Walk tree — create Figma nodes
  tracer.enter('walkTree()', 'templateCompiler.ts');
  const ctx: WalkContext = {
    symbolMap: new Map(),
    rollbackStack: [],
    // NormalizeWarning is the lossy shape (code+message only) — promote to
    // WalkWarning by tagging severity. Variable-binding warnings produced
    // inside walkTree itself carry full payload (preserved verbatim).
    warnings: normalizeWarnings.map(w => ({
      code: w.code,
      severity: 'warning' as const,
      message: w.message,
    })),
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
      } else if (replaceId && oldNode) {
        // replaceId is in-place semantics — preserve canvas position of the
        // node being replaced unless the new markup explicitly overrides.
        // No-op inside auto-layout parents (Figma recomputes x/y).
        if (vnode.props.x === undefined && typeof (oldNode as any).x === 'number') {
          vnode.props.x = (oldNode as any).x;
        }
        if (vnode.props.y === undefined && typeof (oldNode as any).y === 'number') {
          vnode.props.y = (oldNode as any).y;
        }
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
    ctx.warnings.push({ code: 'EXECUTION_ERROR', severity: 'warning', message: e?.message || 'Unexpected error' });
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
      ctx.warnings.push({ code: 'INSERT_INDEX', severity: 'warning', message: `Failed to move node to index ${targetIndex}: ${e?.message}` });
    }
  }

  // Step 5b: Remove oldNode on successful replace
  if (replaceId && oldNode && !oldNode.removed) {
    try {
      oldNode.remove();
    } catch (e: any) {
      ctx.warnings.push({ code: 'REPLACE_REMOVE', severity: 'warning', message: `Failed to remove replaced node: ${e?.message}` });
    }
  }

  // Step 5c: Post-op design-quality validation. After the subtree exists
  // in Figma with real geometry, walk it and surface design issues
  // (HUG/FILL cycles, shadow clipping, contrast, tap targets, etc.) as
  // walk warnings. Same channel as PAINT_INVALID — flows through
  // aggregateBindingWarnings → presentForLLM so the LLM gets a structured
  // hint after each jsx call. The validator was orphaned by the IR-removal
  // refactor (commit 3a440cf, 2026-03-26); this re-anchors it.
  for (const r of rootResults) {
    try {
      const node = await figma.getNodeByIdAsync(r.nodeId) as SceneNode | null;
      if (!node) continue;
      const violations = collectTreeViolations(node, /*maxDepth*/ 6, /*maxViolations*/ 12);
      for (const v of violations) {
        ctx.warnings.push({
          code: v.code,
          severity: 'warning',
          message: v.message,
          node_id: v.nodeId,
          ...(v.hints.length > 0 ? { hints: v.hints } : {}),
        });
      }
    } catch { /* validator is advisory — never fail a successful walk */ }
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
  if (!parent && rootResults.length > 0) {
    try {
      const newRootNode = await figma.getNodeByIdAsync(rootResults[0].nodeId);
      if (newRootNode) figma.viewport.scrollAndZoomIntoView([newRootNode as SceneNode]);
    } catch { /* best-effort */ }
  }

  data.created = ctx.rollbackStack.length;
  data.createdIds = ctx.rollbackStack;

  // Aggregate per-node warnings from the walk into `response.warnings` so
  // the runtime can enrich them (RyowStore source / suggested_id), emit
  // typed events (e.g. `ambiguous_autopick`), and surface them to the LLM
  // via `presentForLLM`. Without this, jsx — the dominant write path for
  // whole-design generation — silently drops the warnings even though
  // every handler emits them.
  //
  // Three categories forwarded:
  //   (a) variable-resolution diagnostics (AMBIGUOUS_NAME_AUTOPICK,
  //       MISSING_MODE_VALUES, FALLBACK_BINDING) — load-bearing for the
  //       LLM's recovery loop.
  //   (b) per-property apply failures (PAINT_INVALID, EFFECT_INVALID,
  //       RESIZE_FAILED, DASH_INVALID, CONSTRAINTS_INVALID, etc.) — these
  //       fire when an individual prop application throws inside the
  //       handler (e.g. paintHandler → lowerPaints rejecting an object
  //       literal). The node was created but the prop didn't apply, so
  //       the error never reaches `failed`/rollback — without forwarding,
  //       the LLM sees jsx success while the canvas has black fills /
  //       missing effects / wrong size. This is exactly the silent-black
  //       failure mode that produced 36 broken fills in the May 2026
  //       weather widget run before SYSTEM.md was realigned.
  //   (c) dependency violations (DEPENDENCY_VIOLATION) — fired by
  //       validateDependencies when a property's required gate is missing
  //       AND can't be auto-injected (parent-scope rules: e.g. layoutAlign
  //       needs parent layoutMode != NONE; layoutSizing*=FILL needs parent
  //       auto-layout) or when self-scope intent conflicts with no auto-fix
  //       (absolute + FILL). Figma silently reverts these instead of
  //       erroring (FILL → HUG/FIXED, layoutAlign → ignored), so without
  //       this channel the agent has no signal that its intent didn't
  //       land. Dropped by allowlist regression May 2026-05-03 → 2026-05-06
  //       — restore here and DO NOT prune without re-checking nodeFactory.
  //
  // NORMALIZE / CREATE_FAILED / INSTANCE_FAILED stay internal — those are
  // either advisory dev-bridge noise (NORMALIZE) or already surfaced via
  // the response `error` (CREATE_FAILED short-circuits the walk).
  //
  // Dedup key: code + (picked_variable_id || variable_id) + node_id. The
  // same warning on the same node from multiple bindings (e.g. fill +
  // stroke both binding $Brand) is informative once; repeats add noise
  // without new signal.
  const aggregated = aggregateBindingWarnings(ctx.warnings);
  if (aggregated.length > 0) {
    return { data, warnings: aggregated, _stages };
  }

  return { data, _stages };
}

/**
 * Filter walk warnings to the subset that the LLM needs to see, dedupe by
 * (code, picked_variable_id || variable_id, node_id), and strip handler
 * internals (severity) to land on the `ToolWarning` wire shape.
 *
 * Forwarded codes (see jsxHandler aggregator block above for rationale):
 *  - Variable-resolution diagnostics:
 *      AMBIGUOUS_NAME_AUTOPICK (Phase 1 strict resolver, spec §5.1)
 *      MISSING_MODE_VALUES     (Phase 2 step 4 mode coverage, spec §6 / §4.1.d)
 *      FALLBACK_BINDING        (opt-in-fallback variant of mode coverage, §6.2)
 *  - Per-property apply failures (the silent-black story, May 2026):
 *      PAINT_INVALID           (paintHandler — fills/strokes failed to apply)
 *      EFFECT_INVALID          (effectHandler — shadows/blurs failed)
 *      RESIZE_FAILED           (resizeHandler — w/h failed to apply)
 *      DASH_INVALID / DASH_FAILED       (dashPatternHandler)
 *      CONSTRAINTS_INVALID / CONSTRAINTS_FAILED (constraintsHandler)
 *      PROP_NORMALIZE_FAILED   (unitValueHandler — bad unit value)
 *      VARIABLE_BIND_FAILED    (variableBindingHandler — bind threw post-resolve)
 *      VARIABLE_NOT_FOUND      (bare-name lookup with no match)
 *      UNSUPPORTED_PROP        (defaultHandler — unknown prop key)
 *  - Dependency violations (figma constraint diagnostics):
 *      DEPENDENCY_VIOLATION    (propertyDependencies — gate missing/incompatible,
 *                               no auto-inject possible)
 *  - Sizing rewrites (visibility for normalizeSizingInProps demotes):
 *      SIZING_NORMALIZED       (FILL→HUG/FIXED, HUG→FIXED — runtime had to
 *                               demote the agent's requested sizing to satisfy
 *                               Figma constraints; LLM should know the demote
 *                               happened and why)
 */
function aggregateBindingWarnings(walkWarnings: WalkWarning[]): ToolWarning[] {
  const RELEVANT_CODES = new Set([
    // Variable-resolution diagnostics
    'AMBIGUOUS_NAME_AUTOPICK',
    'MISSING_MODE_VALUES',
    'FALLBACK_BINDING',
    // Per-property apply failures
    'PAINT_INVALID',
    'EFFECT_INVALID',
    'RESIZE_FAILED',
    'DASH_INVALID',
    'DASH_FAILED',
    'CONSTRAINTS_INVALID',
    'CONSTRAINTS_FAILED',
    'PROP_NORMALIZE_FAILED',
    'VARIABLE_BIND_FAILED',
    'VARIABLE_NOT_FOUND',
    'UNSUPPORTED_PROP',
    // Dependency violations — surface figma constraint violations (grid child
    // without grid parent, absolute+FILL conflict, etc.) so the LLM knows its
    // intent didn't land.
    'DEPENDENCY_VIOLATION',
    // Sizing rewrites — normalizeSizingInProps demotes FILL/HUG to comply with
    // Figma's API constraints (FILL needs parent auto-layout, HUG needs node
    // layoutMode). Without surfacing, the agent's `w="fill"` on a top-level
    // frame silently becomes HUG and the page collapses to its widest natural
    // child. Message includes the demote reason.
    'SIZING_NORMALIZED',
    // Post-op design-quality violations — emitted by collectTreeViolations
    // after the walk completes, surfacing geometry- and layout-derived issues
    // that can only be detected once the node exists in Figma. Re-anchored
    // 2026-05 after the IR-removal refactor orphaned postOpValidator.
    'ZERO_DIM',
    'LOW_OPACITY',
    'TEXT_OVERFLOW',
    'TEXT_WIDTH_COLLAPSED',
    'CHILDREN_OVERFLOW',
    'SIBLING_INCONSISTENCY',
    'MISSING_AUTOLAYOUT',
    'HUG_FILL_CYCLE',
    'EMPTY_FRAME',
    'CORNER_RADIUS_MISMATCH',
    'SHADOW_CLIPPED',
    'SMALL_TAP_TARGET',
    'BANNED_NAME',
    'WHITE_ON_WHITE',
    'SIZING_REVERTED',
    'LOW_CONTRAST',
    'TEXT_MISSING_STYLE',
  ]);
  const out: ToolWarning[] = [];
  const seen = new Set<string>();
  for (const w of walkWarnings) {
    if (!RELEVANT_CODES.has(w.code)) continue;
    // Dedup discriminator — picked_variable_id (autopick) or variable_id
    // (mode coverage) — combined with node_id and the warning message
    // (apply failures use message as the discriminator since they don't
    // carry a variable_id). The same warning on the same node across
    // multiple props is informative once; repeats add noise.
    const idForDedup = (w as any).picked_variable_id
      ?? (w as any).variable_id
      ?? w.message;
    const key = `${w.code}|${idForDedup}|${w.node_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Drop `severity` (encoded by virtue of warnings[] being non-fatal) but
    // preserve every other extension field — picked_variable_id, candidates,
    // node_id, missing_modes, fallback_reason are all load-bearing for the
    // LLM and the runtime enrichment.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { severity, ...rest } = w;
    out.push(rest as ToolWarning);
  }
  return out;
}
