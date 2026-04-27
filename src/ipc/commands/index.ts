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
import { handleJs } from './jsHandler';
import { handleJsx } from './jsxHandler';
import { handleInspect } from './inspectHandler';
import { handleGetScreenshot } from './screenshotHandler';
import { handleDescribe } from './describeHandler';
import { handleEdit } from './editHandler';
import { handleScanTokens } from './tokenScanner';
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

export async function handleSetFill(parameters: any): Promise<ToolResponse> {
  if (!parameters.node) {
    return { error: 'set_fill requires "node" parameter.' };
  }

  const props: Record<string, any> = {};
  if (parameters.fill !== undefined) props.fill = parameters.fill;
  if (parameters.bg !== undefined) props.bg = parameters.bg;

  if (Object.keys(props).length === 0) {
    return { error: 'set_fill requires at least one of: fill, bg.' };
  }

  return handleEdit({ node: parameters.node, props });
}

export async function handleSetStroke(parameters: any): Promise<ToolResponse> {
  if (!parameters.node) {
    return { error: 'set_stroke requires "node" parameter.' };
  }

  const props: Record<string, any> = {};

  // Shorthand mode: "1 #E0E0E0 inside"
  if (parameters.stroke !== undefined) {
    props.stroke = parameters.stroke;
  } else {
    // Explicit fields → compose shorthand
    const parts: string[] = [];
    if (parameters.weight !== undefined) parts.push(String(parameters.weight));
    if (parameters.color !== undefined) parts.push(parameters.color);
    if (parameters.align !== undefined) parts.push(parameters.align);

    if (parts.length === 0) {
      return { error: 'set_stroke requires "stroke" shorthand or at least one of: color, weight, align.' };
    }
    props.stroke = parts.join(' ');
  }

  return handleEdit({ node: parameters.node, props });
}

export async function handleSetLayout(parameters: any): Promise<ToolResponse> {
  if (!parameters.node) {
    return { error: 'set_layout requires "node" parameter.' };
  }

  const props: Record<string, any> = {};
  if (parameters.layout !== undefined) props.layout = parameters.layout;
  if (parameters.gap !== undefined) props.gap = parameters.gap;
  if (parameters.cols !== undefined) props.cols = parameters.cols;
  if (parameters.rows !== undefined) props.rows = parameters.rows;
  if (parameters.rowGap !== undefined) props.rowGap = parameters.rowGap;
  if (parameters.colGap !== undefined) props.colGap = parameters.colGap;
  if (parameters.p !== undefined) props.p = parameters.p;
  if (parameters.justify !== undefined) props.justify = parameters.justify;
  if (parameters.align !== undefined) props.align = parameters.align;
  if (parameters.wrap !== undefined) props.wrap = parameters.wrap;

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
  js: handleJs,
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
  // Selection (opt-in, LLM calls when needed) — inlined: trivial figma.currentPage.selection map
  get_selection: async () => {
    const selection = figma.currentPage.selection.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
    }));
    return { data: { selection, count: selection.length } };
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

