/**
 * @file setterTools.ts
 * @description Focused setter tools — each represents a single design decision.
 *
 * Setters constrain the parameter space so the LLM can only pass
 * properties relevant to one intent. Contrast with `edit` which
 * accepts arbitrary props (batch_update role).
 *
 * All setters route to the same handler pipeline:
 *   setter params → IPC → setterAdapter → editHandler.applyEdit → nodeFactory
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
For stroke color, use set_stroke.`,
  parameters: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Node ID' },
      fill: { type: 'string', description: 'Text color or shape fill (hex)' },
      bg:   { type: 'string', description: 'Background color (hex, "transparent", or gradient)' },
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

Shorthand: "weight color align" (e.g. "1 #E0E0E0 inside").`,
  parameters: {
    type: 'object',
    properties: {
      node:   { type: 'string', description: 'Node ID' },
      stroke: { type: 'string', description: 'Shorthand: "1 #E0E0E0 inside"' },
      color:  { type: 'string', description: 'Stroke color (hex)' },
      weight: { type: 'number', description: 'Stroke weight in px' },
      align:  { type: 'string', description: 'inside | outside | center' },
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

Controls spacing, padding, direction, and alignment of a container's children.`,
  parameters: {
    type: 'object',
    properties: {
      node:    { type: 'string', description: 'Node ID' },
      layout:  { type: 'string', description: 'row | column' },
      gap:     { type: 'number', description: 'Spacing between children (px)' },
      p:       { type: 'number', description: 'Padding — number, "v h", or "t r b l"' },
      justify: { type: 'string', description: 'Main axis: center | space-between | start | end' },
      align:   { type: 'string', description: 'Cross axis: center | start | end | baseline' },
      wrap:    { type: 'string', description: 'wrap | nowrap' },
    },
    required: ['node'],
  },
};
