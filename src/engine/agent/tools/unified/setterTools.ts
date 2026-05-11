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
  set_fill({node: "1:2", bg: "linear-gradient(135deg, #8B5CF6 0%, #F97316 100%)"})

  // Batch — bulk paint update in one call:
  set_fill({nodes: [{node: "1:2", bg: "#FFF"}, {node: "1:3", bg: "#F5F5F5"}]})

fill = text color or shape fill. bg = frame background.
For stroke color, use set_stroke.

Accepted color formats (for fill or bg):
  hex                "#FFF", "#F5F5F5"
  gradient string    CSS-like subset, not full CSS:
                       "linear-gradient(<angle>deg, <#hex> <pos>%, ...)"
                       "linear-gradient(to <direction>, ...)"   directions: top/right/bottom/left + corners
                       "radial-gradient(<stops>)"               centered, no position/shape modifiers
                       "radial-gradient(circle, <stops>)"       circle shape only
                       "conic-gradient(from <angle>deg, ...)"
                     Rejected: "circle at X% Y%", "ellipse at ...", named colors, hsl().
  variable token     qualified bare name "$Surface/Card"
  transparent        "transparent" (bg only)`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID (single mode)' },
      // Strings only — see varTool.ts ensure_variable for ID-form workflow
      fill: { type: 'string', description: 'Text color or shape fill — hex, gradient string, or qualified bare-name token' },
      bg:   { type: 'string', description: 'Background — hex, gradient string, "transparent", or qualified bare-name token' },
      nodes: { type: 'array', description: 'Batch: [{node, fill?, bg?}]', items: { type: 'object', description: '{node, fill?, bg?}' } },
    },
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
  set_stroke({node: "1:2", color: "linear-gradient(90deg, #8B5CF6 0%, #F97316 100%)", weight: 1.5, align: "inside"})

  // Batch — bulk stroke update in one call:
  set_stroke({nodes: [{node: "1:2", color: "#E0E0E0", weight: 1}, {node: "1:3", color: "#333", weight: 2}]})

Shorthand: "weight color align" (e.g. "1 #E0E0E0 inside"). Hex only in shorthand.

Accepted color formats (for the explicit \`color\` field, not the shorthand):
  hex                "#E0E0E0"
  gradient string    CSS-like subset (see set_fill description for full grammar — same rules).
                     Common: "linear-gradient(<angle>deg, <#hex> <pos>%, ...)", "radial-gradient(<stops>)".
                     Rejected: "circle at X% Y%", named colors, hsl().
  variable token     qualified bare name "$Border/Default"

To bind a variable to the stroke color, use the explicit \`color\` field — the shorthand parser silently drops bare-name tokens.`,
  parameters: {
    type: 'object',
    properties: {
      node:   { type: 'string', description: 'Node ID (single mode)' },
      stroke: { type: 'string', description: 'Shorthand: "1 #E0E0E0 inside" — single-string form. Hex only; for gradient/variable use the explicit color field.' },
      // Strings only — see varTool.ts ensure_variable for ID-form workflow
      color:  { type: 'string', description: 'Stroke color — hex, gradient string, or qualified bare-name token' },
      weight: { type: 'number', description: 'Stroke weight in px' },
      align:  { type: 'string', enum: ['inside', 'outside', 'center'], description: 'Stroke alignment relative to the frame edge' },
      nodes:  { type: 'array', description: 'Batch: [{node, color?, weight?, align?, stroke?}]', items: { type: 'object', description: '{node, color?, weight?, align?, stroke?}' } },
    },
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

  // Batch — bulk update in one call:
  set_layout({nodes: [{node: "1:2", gap: 16, p: 24}, {node: "1:3", gap: 8, p: 12}]})

Controls spacing, padding, direction, and alignment of a container's children.
Grid: use layout:"grid" with cols/rows + gap (or rowGap/colGap for asymmetric).
Children fill the grid in insertion order.`,
  parameters: {
    type: 'object',
    properties: {
      node:    { type: 'string', description: 'Node ID (single mode)' },
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
      nodes:   { type: 'array', description: 'Batch: [{node, layout?, gap?, p?, ...}]', items: { type: 'object', description: '{node, layout?, gap?, p?, ...}' } },
    },
  },
};
