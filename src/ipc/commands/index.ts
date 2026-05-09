/**
 * @file commands/index.ts
 * @description Command handler registry — maps tool/command names to handler functions.
 *
 * This is the single dispatch table for all IPC tool calls.
 * Each handler is self-contained: validates args, executes, formats output.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

// Command handler groups
import { registerSessionNodes } from './pathResolver';
import { handleTree } from './readHandlers';
import { handleJsx } from './jsxHandler';
import { handleInspect } from './inspectHandler';
import { handleGetScreenshot } from './screenshotHandler';
import { handleDescribe } from './describeHandler';
import { handleEdit } from './editHandler';
import { handleScanTokens } from './tokenScanner';
import {
  resolveStrictBinding,
  isByIdInput,
  isByTripleInput,
  isColorInput,
  type StrictRejectResult,
} from '../../engine/actions/handlers/strictResolver';
// verb_noun tool adapters
import { handleReplaceProps } from './searchAdapter';
import { handleGrep } from './searchHandlers';
import { handleFindReferences } from './findReferencesHandler';
import { handleCloneNode } from './structureAdapter';
import { handleRm, handleMv } from './writeHandlers';
import {
  handleListVariables,
  handleCreateCollection,
  handleCreateVariable,
  handleEnsureCollection,
  handleEnsureVariable,
  handleSetVariableValue,
  handleBindVariable,
  handleSetVariableMode,
} from './varHandlers';
import {
  handleCompCreate,
  handleCompCombine,
  handleCompProp,
  handleCompLs,
  handleCompInstance,
} from './componentHandlers';
import { handleReadPluginData, handleWritePluginData } from './pluginDataHandler';

// ── Setter schema wrappers (narrow LLM-facing params → handleEdit) ──────────

export async function handleSetText(parameters: any): Promise<ToolResponse> {
  // Batch mode: [{node, text}]
  if (Array.isArray(parameters.nodes)) {
    return handleEdit({
      nodes: parameters.nodes.map((n: any) => ({
        node: n.node,
        content: n.text,
      })),
    });
  }

  // Single mode: {node, text}
  if (!parameters.node) {
    return { error: 'set_text requires "node" parameter.' };
  }
  if (parameters.text === undefined || parameters.text === null) {
    return { error: 'set_text requires "text" parameter.' };
  }

  return handleEdit({
    node: parameters.node,
    content: String(parameters.text),
  });
}

/**
 * Translate object-form binding inputs (`{variable_id}` / `{collection_id,
 * name, type}` / `{color}`) for `fill` / `bg` into a downstream
 * `edit({props: {fill|bg: <legacy-token>}})` call. When the resolver returns
 * a Variable, we hand the existing variableBindingHandler a collection-
 * qualified `$Collection/Name` ref — that key is unique in the cache so the
 * handler binds to the exact resolved variable (never the orphan or wrong
 * same-name).
 *
 * String inputs (bare-name `$Coll/Name` or raw hex `#RRGGBB`) are passed
 * through unchanged — the legacy `variableBindingHandler` handles bare-name
 * lookup with the RYOW autopick tie-break (spec §5.1). The LLM is taught
 * the string form; object form is a parallel input shape supported here for
 * non-LLM callers (tests, scripts).
 *
 * Side effects: emits resolver rejection envelopes inline. Caller wraps the
 * envelope into a ToolResponse.
 */
async function resolveBindingArgForLegacyEdit(
  raw: unknown,
  context: { tool: 'set_fill' | 'set_stroke'; node_id: string; bind_field: 'fill' | 'stroke' },
): Promise<{ kind: 'pass'; legacyValue: any } | { kind: 'reject'; reject: StrictRejectResult }> {
  const isObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const looksStructured = isObject && (isByIdInput(raw) || isByTripleInput(raw) || isColorInput(raw));

  if (looksStructured) {
    const resolved = await resolveStrictBinding(raw, context);
    if (resolved.kind === 'reject') return { kind: 'reject', reject: resolved };
    if (resolved.kind === 'color') return { kind: 'pass', legacyValue: resolved.hex };
    if (resolved.kind === 'variable') {
      // Build collection-qualified bare-name so the existing
      // variableBindingHandler binds the EXACT resolved variable (qualified
      // keys disambiguate same-name entries across collections — see
      // variableBindingHandler.ts:50-56).
      const variable = resolved.variable;
      const collection = await figma.variables.getVariableCollectionByIdAsync(
        variable.variableCollectionId,
      );
      const collName = collection?.name ?? '';
      const qualified = collName ? `${collName}/${variable.name}` : variable.name;
      return { kind: 'pass', legacyValue: `$${qualified}` };
    }
  }

  // String inputs (bare-name `$Coll/Name`, raw hex, etc.) pass through
  // unchanged — the legacy variableBindingHandler runs bare-name lookup +
  // RYOW autopick tie-break downstream.
  return { kind: 'pass', legacyValue: raw };
}

/**
 * Convert a strict resolver rejection into a ToolResponse.error envelope.
 * Spec §4.1 — `recommended_next_action` rides in `data` so the LLM can
 * read it without parsing the error string. The runtime separately emits
 * the corresponding event in afterToolExec.
 */
function rejectionToResponse(reject: StrictRejectResult): ToolResponse {
  return {
    error: reject.message,
    data: {
      code: reject.code,
      ...(reject.recommended_next_action !== undefined
        ? { recommended_next_action: reject.recommended_next_action }
        : {}),
      ...(reject.candidates !== undefined ? { candidates: reject.candidates } : {}),
      ...(reject.actual_name !== undefined ? { actual_name: reject.actual_name } : {}),
      ...(reject.actual_fingerprint !== undefined ? { actual_fingerprint: reject.actual_fingerprint } : {}),
    },
  };
}

export async function handleSetFill(parameters: any): Promise<ToolResponse> {
  // Batch mode: nodes:[{node, fill?, bg?}]
  if (Array.isArray(parameters.nodes)) {
    const editNodes: Array<{ node: string; props: Record<string, any> }> = [];
    for (const n of parameters.nodes) {
      if (!n?.node) {
        return { error: 'set_fill batch: each item requires a "node" id.' };
      }
      const props: Record<string, any> = {};
      if (n.fill !== undefined) {
        const r = await resolveBindingArgForLegacyEdit(n.fill, {
          tool: 'set_fill', node_id: String(n.node), bind_field: 'fill',
        });
        if (r.kind === 'reject') return rejectionToResponse(r.reject);
        props.fill = r.legacyValue;
      }
      if (n.bg !== undefined) {
        const r = await resolveBindingArgForLegacyEdit(n.bg, {
          tool: 'set_fill', node_id: String(n.node), bind_field: 'fill',
        });
        if (r.kind === 'reject') return rejectionToResponse(r.reject);
        props.bg = r.legacyValue;
      }
      if (Object.keys(props).length === 0) {
        return { error: `set_fill batch: item for node "${n.node}" requires at least one of: fill, bg.` };
      }
      editNodes.push({ node: String(n.node), props });
    }
    return handleEdit({ nodes: editNodes });
  }

  if (!parameters.node) {
    return { error: 'set_fill requires "node" parameter (or "nodes" array for batch).' };
  }

  const props: Record<string, any> = {};

  if (parameters.fill !== undefined) {
    const r = await resolveBindingArgForLegacyEdit(parameters.fill, {
      tool: 'set_fill',
      node_id: String(parameters.node),
      bind_field: 'fill',
    });
    if (r.kind === 'reject') return rejectionToResponse(r.reject);
    props.fill = r.legacyValue;
  }
  if (parameters.bg !== undefined) {
    const r = await resolveBindingArgForLegacyEdit(parameters.bg, {
      tool: 'set_fill',
      node_id: String(parameters.node),
      bind_field: 'fill',
    });
    if (r.kind === 'reject') return rejectionToResponse(r.reject);
    props.bg = r.legacyValue;
  }

  if (Object.keys(props).length === 0) {
    return { error: 'set_fill requires at least one of: fill, bg.' };
  }

  return handleEdit({ node: parameters.node, props });
}

// Build a stroke shorthand string from explicit fields (color/weight/align)
// or pass through the literal `stroke:` shorthand. Resolves color binding
// (e.g. "$Brand/600") via the legacy resolver when needed.
async function composeStrokeProps(item: any, nodeId: string): Promise<{ ok: true; props: Record<string, any> } | { ok: false; response: ToolResponse }> {
  const props: Record<string, any> = {};

  if (item.stroke !== undefined) {
    if (typeof item.stroke !== 'string') {
      return { ok: false, response: { error: 'set_stroke "stroke" must be a string shorthand.' } };
    }
    props.stroke = item.stroke;
    return { ok: true, props };
  }

  let colorPart: string | undefined;
  if (item.color !== undefined) {
    const r = await resolveBindingArgForLegacyEdit(item.color, {
      tool: 'set_stroke', node_id: nodeId, bind_field: 'stroke',
    });
    if (r.kind === 'reject') return { ok: false, response: rejectionToResponse(r.reject) };
    colorPart = String(r.legacyValue);
  }

  const parts: string[] = [];
  if (item.weight !== undefined) parts.push(String(item.weight));
  if (colorPart !== undefined) parts.push(colorPart);
  if (item.align !== undefined) parts.push(item.align);

  if (parts.length === 0) {
    return { ok: false, response: { error: 'set_stroke requires "stroke" shorthand or at least one of: color, weight, align.' } };
  }
  props.stroke = parts.join(' ');
  return { ok: true, props };
}

export async function handleSetStroke(parameters: any): Promise<ToolResponse> {
  // Batch mode: nodes:[{node, color?, weight?, align?, stroke?}]
  if (Array.isArray(parameters.nodes)) {
    const editNodes: Array<{ node: string; props: Record<string, any> }> = [];
    for (const n of parameters.nodes) {
      if (!n?.node) {
        return { error: 'set_stroke batch: each item requires a "node" id.' };
      }
      const composed = await composeStrokeProps(n, String(n.node));
      if (!composed.ok) return composed.response;
      editNodes.push({ node: String(n.node), props: composed.props });
    }
    return handleEdit({ nodes: editNodes });
  }

  if (!parameters.node) {
    return { error: 'set_stroke requires "node" parameter (or "nodes" array for batch).' };
  }
  const nodeId = String(parameters.node);
  const composed = await composeStrokeProps(parameters, nodeId);
  if (!composed.ok) return composed.response;
  return handleEdit({ node: parameters.node, props: composed.props });
}

// Pure data extraction — no resolver needed; layout fields are primitives.
function extractLayoutProps(item: any): Record<string, any> {
  const props: Record<string, any> = {};
  if (item.layout !== undefined) props.layout = item.layout;
  if (item.gap !== undefined) props.gap = item.gap;
  if (item.cols !== undefined) props.cols = item.cols;
  if (item.rows !== undefined) props.rows = item.rows;
  if (item.rowGap !== undefined) props.rowGap = item.rowGap;
  if (item.colGap !== undefined) props.colGap = item.colGap;
  if (item.p !== undefined) props.p = item.p;
  if (item.justify !== undefined) props.justify = item.justify;
  if (item.align !== undefined) props.align = item.align;
  if (item.wrap !== undefined) props.wrap = item.wrap;
  return props;
}

export async function handleSetLayout(parameters: any): Promise<ToolResponse> {
  // Batch mode: nodes:[{node, layout?, gap?, p?, ...}]
  if (Array.isArray(parameters.nodes)) {
    const editNodes: Array<{ node: string; props: Record<string, any> }> = [];
    for (const n of parameters.nodes) {
      if (!n?.node) {
        return { error: 'set_layout batch: each item requires a "node" id.' };
      }
      const props = extractLayoutProps(n);
      if (Object.keys(props).length === 0) {
        return { error: `set_layout batch: item for node "${n.node}" requires at least one layout property.` };
      }
      editNodes.push({ node: String(n.node), props });
    }
    return handleEdit({ nodes: editNodes });
  }

  if (!parameters.node) {
    return { error: 'set_layout requires "node" parameter (or "nodes" array for batch).' };
  }

  const props = extractLayoutProps(parameters);
  if (Object.keys(props).length === 0) {
    return { error: 'set_layout requires at least one layout property.' };
  }

  return handleEdit({ node: parameters.node, props });
}

// ── move_node param transform ──
// Inline because the parent "/" → page-root-id resolution and required-arg
// validation are non-trivial.
async function handleMoveNodeInline(params: any): Promise<ToolResponse> {
  const hasParent = typeof params.parent === 'string' && params.parent.length > 0;
  const hasName = typeof params.name === 'string' && params.name.length > 0;
  const hasIndex = params.index != null;

  if (!hasParent && !hasName && !hasIndex) {
    return { error: 'move_node requires "parent", "name", or "index".' };
  }

  // "/" → page root id; bare id → pass through; undefined → keep current parent
  let parentId: string | undefined;
  if (hasParent) {
    parentId = (params.parent === '/' || params.parent === '')
      ? figma.currentPage.id
      : params.parent;
  }

  return handleMv({
    sourceId: params.node,
    parentId,
    newName: hasName ? params.name : undefined,
    atIndex: params.index,
  });
}

// ── Command handler type ──

export type CommandHandler = (parameters: any) => Promise<ToolResponse>;

// ── Dispatch table ──

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  // First-class tools (LLM-facing, verb_noun naming)
  jsx: handleJsx,
  inspect: handleInspect,
  describe: handleDescribe,
  edit: handleEdit,
  // Search tools
  find_nodes: (params) => handleGrep({ query: params.query || '', path: params.scope }),
  discover_props: (params) => handleGrep({ mode: 'properties', path: params.node, properties: params.props }),
  replace_props: handleReplaceProps,
  find_references: handleFindReferences,
  // Structure tools
  delete_node: (params) => handleRm({ sourceId: params.node }),
  move_node: handleMoveNodeInline,
  clone_node: handleCloneNode,
  // Variable tools
  list_variables: handleListVariables,
  create_collection: handleCreateCollection,
  create_variable: handleCreateVariable,
  ensure_collection: handleEnsureCollection,
  ensure_variable: handleEnsureVariable,
  set_variable_value: handleSetVariableValue,
  bind_variable: handleBindVariable,
  set_variable_mode: handleSetVariableMode,
  // Component tools
  create_component: (params) => handleCompCreate({ paths: [params.node] }),
  combine_components: (params) => handleCompCombine({ paths: params.nodes, name: params.name }),
  add_component_prop: (params) => handleCompProp({
    paths: [params.node],
    name: params.name,
    propType: params.type,
    defaultValue: params.default,
    bindTarget: params.bind,
  }),
  list_component_props: (params) => handleCompLs({ paths: [params.node] }),
  create_instance: (params) => handleCompInstance({ paths: [params.node], parent: params.parent }),
  // Setters (focused, single-intent — delegate to editHandler)
  set_text: handleSetText,
  set_fill: handleSetFill,
  set_stroke: handleSetStroke,
  set_layout: handleSetLayout,
  // Plugin data (private + shared) — replaces previous js-tool path
  read_plugin_data: handleReadPluginData,
  write_plugin_data: handleWritePluginData,
  // Selection (opt-in, LLM calls when needed) — inlined: trivial figma.currentPage.selection map
  get_selection: async () => {
    const selection = figma.currentPage.selection.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
    }));
    return { data: { selection, count: selection.length } };
  },
  // Vector creation — wraps figma.createVector + path data + stroke/fill via paint pipeline.
  create_vector: async (params) => {
    const width = Number(params?.width);
    const height = Number(params?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { error: 'create_vector requires positive numeric "width" and "height".' };
    }

    // Resolve parent (defaults to current page)
    let parent: BaseNode & ChildrenMixin = figma.currentPage;
    if (params.parent) {
      const found = await figma.getNodeByIdAsync(String(params.parent));
      if (!found || !('appendChild' in found)) {
        return { error: `create_vector: parent "${params.parent}" not found or cannot have children.` };
      }
      parent = found as BaseNode & ChildrenMixin;
    }

    // Path: prefer `data`, else compile `points`
    let pathData: string | undefined;
    if (typeof params.data === 'string' && params.data.trim()) {
      pathData = params.data.trim();
    } else if (Array.isArray(params.points) && params.points.length > 0) {
      const pts = params.points as Array<[number, number] | { x: number; y: number }>;
      const flat = pts.map((p: any) => Array.isArray(p) ? p : [p?.x, p?.y]);
      if (flat.some((p: any) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        return { error: 'create_vector: every "points" entry must be [x, y] with numeric coordinates.' };
      }
      const [x0, y0] = flat[0];
      const segments = flat.slice(1).map(([x, y]: any) => `L ${x} ${y}`).join(' ');
      pathData = `M ${x0} ${y0}${segments ? ' ' + segments : ''}`;
    } else {
      return { error: 'create_vector requires either "data" (SVG path string) or "points" ([[x,y], ...]).' };
    }

    const vector = figma.createVector();
    parent.appendChild(vector);
    try {
      vector.name = String(params.name ?? 'Vector');
      vector.x = Number(params.x ?? 0);
      vector.y = Number(params.y ?? 0);
      vector.resize(width, height);

      const winding = (params.windingRule === 'EVENODD') ? 'EVENODD' : 'NONZERO';
      vector.vectorPaths = [{ windingRule: winding, data: pathData! }];

      // Build prop bag for the standard apply pipeline (stroke / fill / weight / align).
      // updateNode handles the same string→Paint lowering as set_fill/set_stroke.
      const propBag: Record<string, any> = {};
      if (params.fill !== undefined && params.fill !== 'transparent') {
        propBag.fill = params.fill;
      } else {
        propBag.fill = 'transparent';
      }
      if (params.stroke !== undefined) {
        const strokeParts: string[] = [];
        if (params.strokeWeight !== undefined) strokeParts.push(String(params.strokeWeight));
        strokeParts.push(String(params.stroke));
        if (params.strokeAlign !== undefined) strokeParts.push(String(params.strokeAlign));
        propBag.stroke = strokeParts.join(' ');
      } else if (params.strokeWeight !== undefined || params.strokeAlign !== undefined) {
        // weight/align without explicit color → black default in shorthand
        const parts: string[] = [];
        if (params.strokeWeight !== undefined) parts.push(String(params.strokeWeight));
        parts.push('#000000');
        if (params.strokeAlign !== undefined) parts.push(String(params.strokeAlign));
        propBag.stroke = parts.join(' ');
      }

      // Reuse handleEdit so paint lowering, validation, and registry stay consistent
      const editRes = await handleEdit({ node: vector.id, props: propBag });
      if (editRes.error) {
        // Roll back partial vector if styling failed
        vector.remove();
        return { error: `create_vector: failed to apply styling — ${editRes.error}` };
      }

      return {
        data: {
          id: vector.id,
          name: vector.name,
          width: vector.width,
          height: vector.height,
          x: vector.x,
          y: vector.y,
          parent: { id: parent.id, name: 'name' in parent ? (parent as any).name : '(page)' },
          path: pathData,
        },
      };
    } catch (err: any) {
      try { vector.remove(); } catch { /* already detached */ }
      return { error: `create_vector failed: ${err?.message || String(err)}` };
    }
  },

  // Page navigation (cross-page workflows) — ID-driven, names not addressable.
  switch_page: async (params) => {
    const allPages = figma.root.children.filter(c => c.type === 'PAGE') as PageNode[];
    const roster = allPages.map(p => ({ id: p.id, name: p.name }));

    const pageId: string | undefined = params?.pageId;

    // No pageId → roster-only mode (discovery on first call)
    if (!pageId) {
      return {
        data: {
          currentPageId: figma.currentPage.id,
          currentPageName: figma.currentPage.name,
          pages: roster,
        },
      };
    }

    const target = allPages.find(p => p.id === pageId);
    if (!target) {
      return {
        error: `Page not found: "${pageId}". Available: ${roster.map(p => `"${p.name}" [${p.id}]`).join(', ')}`,
      };
    }

    const prev = figma.currentPage;
    if (target.id === prev.id) {
      return {
        data: {
          currentPageId: target.id,
          currentPageName: target.name,
          unchanged: true,
          pages: roster,
        },
      };
    }

    await figma.setCurrentPageAsync(target);
    return {
      data: {
        currentPageId: target.id,
        currentPageName: target.name,
        previousPageId: prev.id,
        previousPageName: prev.name,
        pages: roster,
      },
    };
  },
  // Visual verification (screenshot)
  get_screenshot: handleGetScreenshot,
  // knowledge is handled locally in sandbox — should not arrive at IPC
  knowledge: async () => ({
    error: 'knowledge is handled locally. This is an internal routing error.',
  }),
  // Legacy command names — internal use only (adapters + scratchpad routing)
  tree: handleTree,
  'scan-tokens': handleScanTokens,
};

// ── Dispatch function ──

export async function dispatchCommand(toolName: string, parameters: any): Promise<ToolResponse> {
  const handler = COMMAND_HANDLERS[toolName];
  if (!handler) {
    return {
      error: `Unknown tool "${toolName}". Available: ${Object.keys(COMMAND_HANDLERS).join(', ')}`,
    };
  }

  const result = await handler(parameters);

  // Auto-register created node IDs for session-scoped path preference
  if (!result.error && result.data?.idMap) {
    registerSessionNodes(Object.values(result.data.idMap));
  }

  return result;
}

