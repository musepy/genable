/**
 * @file setterAdapter.ts
 * @description IPC adapters for setter tools — translate typed setter params
 * into edit-compatible params, then delegate to the shared applyEdit pipeline.
 *
 * Each setter constrains the parameter space but reuses the same
 * editHandler → nodeFactory → handler pipeline under the hood.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleEdit } from './editHandler';

// ── set_text ────────────────────────────────────────────────────────────────

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

// ── set_fill ────────────────────────────────────────────────────────────────

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

// ── set_stroke ──────────────────────────────────────────────────────────────

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

// ── set_layout ──────────────────────────────────────────────────────────────

export async function handleSetLayout(parameters: any): Promise<ToolResponse> {
  if (!parameters.node) {
    return { error: 'set_layout requires "node" parameter.' };
  }

  const props: Record<string, any> = {};
  if (parameters.layout !== undefined) props.layout = parameters.layout;
  if (parameters.gap !== undefined) props.gap = parameters.gap;
  if (parameters.p !== undefined) props.p = parameters.p;
  if (parameters.justify !== undefined) props.justify = parameters.justify;
  if (parameters.align !== undefined) props.align = parameters.align;
  if (parameters.wrap !== undefined) props.wrap = parameters.wrap;

  if (Object.keys(props).length === 0) {
    return { error: 'set_layout requires at least one layout property.' };
  }

  return handleEdit({ node: parameters.node, props });
}
