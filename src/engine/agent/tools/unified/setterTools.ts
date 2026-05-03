/**
 * @file setterTools.ts
 * @description Focused setter tools — each represents a single design decision.
 *
 * Setters constrain the parameter space so the LLM can only pass
 * properties relevant to one intent. Contrast with `edit` which
 * accepts arbitrary props (batch_update role).
 *
 * All setters route to the same handler pipeline:
 *   setter params → IPC → index.ts inline handlers → editHandler.applyEdit → nodeFactory
 */

import type { ToolDefinition } from '../types';

// ── set_text ────────────────────────────────────────────────────────────────

export const setTextDefinition: ToolDefinition = {
  name: 'set_text',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set text content on one or more nodes.

  set_text({node: "1:2", text: "Hello World"})
  set_text({nodes: [{node: "1:2", text: "Title"}, {node: "1:3", text: "Subtitle"}]})

Use this when changing what text says. For text styling (font, size, weight), use edit.`,
  parameters: {
    type: 'object',
    properties: {
      node:  { type: 'string', description: 'Node ID' },
      text:  { type: 'string', description: 'New text content' },
      nodes: { type: 'array', description: 'Batch: [{node, text}]', items: { type: 'object', description: '{node, text}' } },
    },
  },
};

// ── set_fill ────────────────────────────────────────────────────────────────

export const setFillDefinition: ToolDefinition = {
  name: 'set_fill',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set fill or background color on a node.

  set_fill({node: "1:2", bg: "#F5F5F5"})
  set_fill({node: "1:2", fill: "#333333"})
  set_fill({node: "1:2", bg: "#1A1A1A", fill: "#FFFFFF"})

fill = text color or shape fill. bg = frame background.
For stroke color, use set_stroke.

Variable bindings (structured form, recommended):
  set_fill({node: "1:2", bg: {variable_id: "VariableID:1:5"}})
  set_fill({node: "1:2", bg: {collection_id: "VariableCollectionId:1:1", name: "Bg/Surface", type: "COLOR"}})

Bare-name strings ("$Brand/600") and hex strings still work in the current
default mode. When the resolver advances to phase2-strict, structured form
will be required (bare-name → BARE_NAME_REJECTED_PHASE2).`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID' },
      // Schema accepts both string and object forms — JSON Schema unions are
      // rare in this codebase; we declare type:'string' for back-compat with
      // existing tooling and document the object form in the description.
      fill: { type: 'string', description: 'Text color or shape fill — hex ("#FFF"), bare-name ("$Text/Primary"), or object {variable_id} | {collection_id, name, type} | {color}' },
      bg:   { type: 'string', description: 'Background — hex, "transparent", gradient, or object {variable_id} | {collection_id, name, type} | {color}' },
    },
    required: ['node'],
  },
};

// ── set_stroke ──────────────────────────────────────────────────────────────

export const setStrokeDefinition: ToolDefinition = {
  name: 'set_stroke',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set stroke (border) on a node.

  set_stroke({node: "1:2", stroke: "1 #E0E0E0"})
  set_stroke({node: "1:2", stroke: "2 #333 inside"})
  set_stroke({node: "1:2", color: "#E0E0E0", weight: 1, align: "inside"})

Shorthand: "weight color align" (e.g. "1 #E0E0E0 inside").

Variable bindings (structured form, recommended — fixes the round-2
shorthand parser bug where "1 $Brand/600" silently dropped the binding):
  set_stroke({node: "1:2", color: {variable_id: "VariableID:1:5"}, weight: 1, align: "inside"})
  set_stroke({node: "1:2", color: {collection_id: "VariableCollectionId:1:1", name: "Border/Default", type: "COLOR"}, weight: 1})

Bare-name shorthand ("1 $Brand/600") still works in the current default
mode but loses the binding silently. When the resolver advances to
phase2-strict, the bare-name path is REJECTED — pass the structured form
above to bind a variable to a stroke color.`,
  parameters: {
    type: 'object',
    properties: {
      node:   { type: 'string', description: 'Node ID' },
      stroke: { type: 'string', description: 'Shorthand: "1 #E0E0E0 inside" — single-string form. Bare-name "$Token" inside the shorthand silently drops the binding; prefer color={...} structured form for variables.' },
      color:  { type: 'string', description: 'Stroke color — hex ("#E0E0E0"), bare-name ("$Brand/600"), or object {variable_id} | {collection_id, name, type} | {color}' },
      weight: { type: 'number', description: 'Stroke weight in px' },
      align:  { type: 'string', enum: ['inside', 'outside', 'center'], description: 'Stroke alignment relative to the frame edge' },
    },
    required: ['node'],
  },
};

// ── set_layout ──────────────────────────────────────────────────────────────

export const setLayoutDefinition: ToolDefinition = {
  name: 'set_layout',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Set auto-layout properties on a container.

  set_layout({node: "1:2", gap: 16, p: 24})
  set_layout({node: "1:2", layout: "row", justify: "space-between"})
  set_layout({node: "1:2", layout: "column", gap: 8, p: "16 24", align: "center"})
  set_layout({node: "1:2", layout: "grid", cols: 3, rows: 2, gap: 16})

Controls spacing, padding, direction, and alignment of a container's children.
Grid: use layout:"grid" with cols/rows + gap (or rowGap/colGap for asymmetric).
Children fill the grid in insertion order.`,
  parameters: {
    type: 'object',
    properties: {
      node:    { type: 'string', description: 'Node ID' },
      layout:  { type: 'string', enum: ['row', 'column', 'grid'], description: 'Auto-layout mode' },
      gap:     { type: 'number', description: 'Spacing between children (px). On grid sets both row+column gap.' },
      rowGap:  { type: 'number', description: 'Grid row gap (px, grid only)' },
      colGap:  { type: 'number', description: 'Grid column gap (px, grid only)' },
      cols:    { type: 'number', description: 'Grid column count (required when layout="grid")' },
      rows:    { type: 'number', description: 'Grid row count (required when layout="grid")' },
      p:       { type: 'number', description: 'Padding — number, "v h", or "t r b l"' },
      justify: { type: 'string', enum: ['center', 'space-between', 'start', 'end'], description: 'Main axis (flex only)' },
      align:   { type: 'string', enum: ['center', 'start', 'end', 'baseline'], description: 'Cross axis (flex only)' },
      wrap:    { type: 'string', enum: ['wrap', 'nowrap'], description: 'Wrap behaviour (flex only)' },
    },
    required: ['node'],
  },
};
