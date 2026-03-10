import { ToolDefinition } from '../types';

/**
 * Unified design tool — single entry point for creating, modifying, and deleting nodes.
 * Merges the former create + edit tools into one. Mode is determined per-tag:
 *   - No id attr → create new node
 *   - Has id attr → modify existing node
 *   - <delete id="xxx"/> → delete node
 */
export const designDefinition: ToolDefinition = {
  name: 'design',
  category: 'create',
  display: { displayName: 'Design', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: true,
  dependencies: [],
  description: `Create new nodes, modify existing nodes, and delete nodes — all in a single call using XML markup.

**Mode is per-tag** (no global mode flag):
- Tags WITHOUT \`id\` → **create** new nodes (nesting = parent-child)
- Tags WITH \`id\` → **edit** existing nodes (only listed properties change)
- \`<delete id="xxx"/>\` → **delete** node and its children

Tags: frame, text, rect, ellipse, line, icon, image, group, section, vector, ref, delete
Attributes accept CSS names (layout, gap, background), abbreviations (w, h, size, weight, corner, p, bg), and Figma-native names.

**Shorthands**:
- \`p="16"\` → uniform padding; \`p="16 24"\` → V H; \`p="10 20 30 40"\` → T R B L
- \`shadow="0,4,16,0,#0000001A"\` → DROP_SHADOW; \`inset,...\` → INNER_SHADOW; \`;\` for multiple
- \`fill="#FFF"\` / \`fills="#A,#B"\` → fills array; \`stroke="#D1D5DB"\` → strokes array

**Mixed example** (create + edit + delete in one call):
\`\`\`json
design({
  "xml": "<frame name='Card' layout='column' gap='16' p='24' w='400' height='hug' bg='#FFFFFF' corner='16'><text size='20' weight='Bold' fill='#111827'>Title</text></frame><text id='100:8' fill='#EF4444'>Updated text</text><delete id='100:12'/>",
  "parentId": "200:1"
})
\`\`\`

## CRITICAL SIZING RULE
Frames default to 100×100px when width/height is omitted — almost NEVER correct.
ALWAYS set explicit dimensions or use height="hug" / width="fill".
Common sizes: Card root 360-480px wide, Input height 44px, Button height 44-48px, Icon 20-24px.

## Reusable Components
Use \`reusable='true'\` on a \`<frame>\` to create a Figma Component.
Use \`<ref component='Name'>\` to create instances. Use \`set:childName='text'\` for text overrides.

## Edit rules
- Every edit tag MUST have \`id\` referencing a real Figma node ID (from \`inspect\`/\`outline\` or previous \`design\` idMap).
- Only include properties you want to CHANGE — unspecified properties remain unchanged.
- Edit tags are flat — no nested children under edit tags.

## Progressive creation (important)
Aim for **≤20 create nodes per call**. For complex designs (dashboards, landing pages, multi-section layouts):
1. First call: skeleton — outer container + section placeholder frames (names, sizing, bg only)
2. Subsequent calls: fill each section with its content (one call per logical area)
3. This produces better quality — smaller batches = fewer attribute omissions.

## Handling partial failures
DO NOT regenerate the entire design on partial failure. Check errors, use idMap, retry only failed operations.

Returns: compact receipt with { idMap, created, edited, deleted, failed, errors, warnings, defaultsApplied, defaultsAppliedCount, violations }`,
  parameters: {
    type: 'object',
    properties: {
      xml: {
        type: 'string',
        description:
          'XML design markup. Tags without id = create new nodes. Tags with id = edit existing nodes. <delete id="xxx"/> = remove nodes. Use single quotes for attributes.',
      },
      parentId: {
        type: 'string',
        description:
          'Real Figma node ID to use as the default parent for top-level CREATE nodes. If omitted, nodes are added to the current page. Does not affect edit/delete operations.',
      },
    },
    required: ['xml'],
  },
  errors: {
    EMPTY_XML: 'A non-empty "xml" string must be provided.',
    XML_PARSE_ERROR: 'Failed to parse the XML design markup.',
    PARTIAL_FAILURE: 'Some operations failed during execution.',
    EXECUTION_ERROR: 'An unexpected error occurred in the design pipeline.',
  },
};
