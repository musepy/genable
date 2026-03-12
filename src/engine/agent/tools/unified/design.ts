import { ToolDefinition } from '../types';

/**
 * Unified design tool — single entry point for creating, modifying, and deleting nodes.
 * Uses flat ops format (one operation per line).
 */
export const designDefinition: ToolDefinition = {
  name: 'design',
  category: 'create',
  display: { displayName: 'Design', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: true,
  dependencies: [],
  description: `Create, modify, and delete design nodes — all in a single call using flat ops format (one operation per line).

**Flat ops format** (one operation per line):
- **Create**: \`symbol = type(parent, {props})\` or \`symbol = type(parent, {props}, 'text content')\`
- **Edit**: \`update('nodeId', {props})\` — only listed properties change
- **Delete**: \`delete('nodeId')\` — removes node and children
- **Instance**: \`symbol = ref('ComponentName', parent, {props})\`
- **Node types**: frame, text, rect, ellipse, line, icon, image, group, section, vector
- **frame vs primitives**: Use \`frame\` for ALL UI elements — buttons, badges, chips, avatars, inputs, icon containers, any element that could have children. Use \`rect\`/\`ellipse\`/\`line\` ONLY for pure decorative shapes that will NEVER have children (dividers, background blobs, decorative dots). When in doubt, use \`frame\`.
- **Parent**: symbol from previous line, \`root\` for top-level, or \`'200:3'\` (quoted Figma ID)
- **Comments**: lines starting with \`//\` are ignored
- **Props**: \`{key:value, key:'string'}\` — single quotes for strings, unquoted numbers

**Three attribute naming systems** (all accepted):
1. CSS-semantic: layout, justifyContent, alignItems, gap, background, borderRadius
2. Abbreviations: w, h, size, weight, corner, p, bg, sizingH, sizingV
3. Figma-native: layoutMode, primaryAxisAlignItems, itemSpacing, cornerRadius

**Shorthands**:
- \`p:24\` → uniform padding; \`p:'16 24'\` → V H; \`p:'10 20 30 40'\` → T R B L
- \`shadow:'0,4,16,0,#0000001A'\` → DROP_SHADOW; \`'inset,...'\` → INNER_SHADOW; \`';'\` separates multiple
- \`fill:'#FFF'\` → fills array; \`stroke:'#D1D5DB'\` → strokes array
- \`pattern:'row'\` → layout:row + width:hug + height:hug + transparent bg (explicit props override defaults)
  - Patterns: \`row\`, \`column\`, \`row-fill\` (w:fill), \`column-fill\` (h:fill), \`stack\` (no auto-layout)

**Example** (create + edit + delete in one call):
\`\`\`
design({
  "ops": "card = frame(root, {name:'Card', layout:'column', gap:16, p:24, w:400, height:'hug', bg:'#FFFFFF', corner:16})\\ntitle = text(card, {name:'Title', size:20, weight:'Bold', fill:'#111827'}, 'Card Title')\\ndesc = text(card, {name:'Desc', size:14, fill:'#6B7280', w:'fill'}, 'Card description text')\\nupdate('100:8', {fill:'#EF4444'})\\ndelete('100:12')",
  "parentId": "200:1"
})
\`\`\`

## CRITICAL SIZING RULE
Frames default to 100×100px when width/height is omitted — almost NEVER correct.
ALWAYS set explicit dimensions or use height:'hug' / w:'fill'.
Common sizes: Card root 360-480px wide, Input height 44px, Button height 44-48px, Icon 20-24px.

Text nodes use the same sizing as frames: \`w:'fill'\` to stretch to parent, omit for hug.
\`textAutoResize\` is auto-filled (FILL→HEIGHT, otherwise→WIDTH_AND_HEIGHT).

## Reusable Components
Use \`reusable:true\` on a frame to create a Figma Component.
Use \`ref('Name', parent, {props})\` to create instances. Use \`set:childName:'text'\` for text overrides.

## Variants (ComponentSet)
Create variant components with Figma variant naming (\`PropName=Value\`), then combine into a ComponentSet:
1. Define each variant as \`reusable:true\` with name \`'PropName=Value'\` (multi-axis: \`'Size=Small, Style=Primary'\`)
2. Combine: \`sym = variantSet(parent, {name:'SetName', from:'comp1,comp2,...'})\`
3. Instance with variant selection: \`ref('SetName', parent, {variant:'PropName=Value', set:label:'text'})\`
   - Partial match: \`variant:'Size=Large'\` matches \`Size=Large, Style=Primary\`
   - Falls back to default variant if no match

## Edit rules
- \`update\`/\`delete\` MUST reference a real Figma node ID (from inspect/outline or previous design idMap).
- Only include properties you want to CHANGE — unspecified properties remain unchanged.

## Progressive creation (important)
Aim for **≤20 create nodes per call**. For complex designs:
1. First call: skeleton — outer container + section placeholder frames
2. Subsequent calls: fill each section with its content
3. This produces better quality — smaller batches = fewer attribute omissions.

## Handling partial failures
DO NOT regenerate the entire design on partial failure. Check errors, use idMap, retry only failed operations.

Returns: compact receipt with { idMap, created, edited, deleted, failed, errors, warnings, violations }`,
  parameters: {
    type: 'object',
    properties: {
      ops: {
        type: 'string',
        description:
          'Flat ops design markup. One operation per line. Create, update, and delete operations.',
      },
      parentId: {
        type: 'string',
        description:
          'Real Figma node ID to use as the default parent for top-level CREATE nodes. If omitted, nodes are added to the current page. Does not affect update/delete operations.',
      },
    },
    required: ['ops'],
  },
  errors: {
    EMPTY_OPS: 'A non-empty "ops" string must be provided.',
    PARSE_ERROR: 'Failed to parse the flat ops design markup.',
    PARTIAL_FAILURE: 'Some operations failed during execution.',
    EXECUTION_ERROR: 'An unexpected error occurred in the design pipeline.',
  },
};
