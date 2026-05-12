/**
 * @file vectorTool.ts
 * @description High-level wrapper around figma.createVector — agents can draw
 * chart lines, custom icons, and freeform paths without falling to the `js`
 * escape hatch (which accounts for ~34% of `js` usage in dogfood corpus).
 *
 * Two path inputs:
 *   data:   raw SVG path string ("M 0 0 L 100 100")
 *   points: polyline shortcut [[x,y], ...] — compiled to "M x0 y0 L x1 y1 ..."
 *
 * Default fill is "transparent" — hides the Figma quirk where vectors render
 * with a black fill unless `fills:[]` is set explicitly. Stroke styling reuses
 * the same lowering pipeline as set_stroke, so gradient stroke / variable
 * tokens work uniformly.
 */

import { ToolDefinition } from '../types';

export const createVectorDefinition: ToolDefinition = {
  name: 'create_vector',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Create a vector node from SVG path data or a list of points. Use for chart lines, custom icon paths, freeform curves, or any shape that needs path data.

Examples:
  // Polyline (chart trend line)
  create_vector({
    parent: "1:23", name: "TrendLine",
    x: 40, y: 20, width: 550, height: 240,
    points: [[0,144],[90,96],[180,120],[270,64],[360,80],[450,40],[540,72]],
    stroke: "#6366F1", strokeWeight: 2
  })

  // Raw SVG path (custom shape)
  create_vector({
    parent: "1:23", name: "Wave",
    width: 200, height: 60,
    data: "M 0 30 Q 50 0 100 30 T 200 30",
    stroke: "linear-gradient(90deg, #8B5CF6 0%, #F97316 100%)",
    strokeWeight: 1.5
  })

Path input — provide ONE of:
  points: [[x,y], ...]   compiled to "M x0 y0 L x1 y1 ..." (polyline shortcut)
  data:   "M ... L ..."  raw SVG path (LLM-native; supports M, L, C, Q, A, Z)

Stroke / fill (same formats as set_stroke / set_fill):
  hex            "#6366F1"
  gradient       "linear-gradient(angle, #color stop%, ...)"
  variable       qualified bare name "$Brand/Primary"

Default fill is "transparent" so the vector shows only its stroke. Pass an explicit fill if you want it filled.

When NOT to use:
  - Standard rectangles / ellipses / lines — use jsx <Rect/>, <Ellipse/>, <Line/> elements (simpler, batch-friendly)
  - Existing vector edits — use edit / set_stroke instead`,
  parameters: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Parent node ID. Omit to attach to the current page.' },
      name:   { type: 'string', description: 'Node name (default: "Vector").' },
      x:      { type: 'number', description: 'X position relative to parent (default: 0).' },
      y:      { type: 'number', description: 'Y position relative to parent (default: 0).' },
      width:  { type: 'number', description: 'Vector bounds width in px.' },
      height: { type: 'number', description: 'Vector bounds height in px.' },
      data:   { type: 'string', description: 'Raw SVG path string. Mutually exclusive with `points`.' },
      points: {
        type: 'array',
        description: 'Polyline points as [[x,y], ...]. Compiled internally to "M x0 y0 L x1 y1 ...". Mutually exclusive with `data`.',
        items: {
          type: 'array',
          description: '[x, y] pair',
          items: { type: 'number', description: 'coordinate' },
        },
      },
      windingRule:  { type: 'string', enum: ['NONZERO', 'EVENODD'], description: 'Path fill winding rule (default: NONZERO).' },
      stroke:       { type: 'string', description: 'Stroke color — hex, gradient string, or qualified bare-name token.' },
      strokeWeight: { type: 'number', description: 'Stroke weight in px (default: 1).' },
      strokeAlign:  { type: 'string', enum: ['inside', 'outside', 'center'], description: 'Stroke alignment relative to the path (default: center).' },
      fill:         { type: 'string', description: 'Fill — hex / gradient / variable / "transparent" (default: "transparent").' },
    },
    required: ['width', 'height'],
  },
};
