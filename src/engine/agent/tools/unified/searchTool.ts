/**
 * @file searchTool.ts
 * @description Search tools — verb_noun first-class tools.
 *
 * 3 tools replacing the old `search({mode inferred})` pattern.
 */

import { ToolDefinition } from '../types';

export const findNodesDefinition: ToolDefinition = {
  name: 'find_nodes',
  executionStrategy: 'parallel',
  description: `Search nodes by name or type. Scoped to the current page — call switch_page first if your target lives on a different page.

Examples:
  find_nodes({query: "Button"})
  find_nodes({query: "frame", scope: "1:2"})`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — matches node name or type',
      },
      scope: {
        type: 'string',
        description: 'Limit search to subtree. Node ID (e.g. "1:2"). Default: entire page.',
      },
    },
    required: ['query'],
  },
};

export const discoverPropsDefinition: ToolDefinition = {
  name: 'discover_props',
  executionStrategy: 'parallel',
  description: `Discover unique property values in a subtree.

Examples:
  discover_props({node: "1:2", props: ["fillColor", "fontSize"]})

Searchable properties: fillColor, textColor, strokeColor, strokeWeight, opacity, cornerRadius, gap, fontSize, fontFamily, fontWeight.`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Target node ID (e.g. "1:2")',
      },
      props: {
        type: 'array',
        description: 'Properties to discover',
        items: { type: 'string', description: 'Property name' },
      },
    },
    required: ['node', 'props'],
  },
};

export const replacePropsDefinition: ToolDefinition = {
  name: 'replace_props',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Bulk find-and-replace property values across a subtree (target node + all descendants). Destructive batch mutation — no preview, no undo across many nodes. Returns per-rule match counts.

Use when:
- Theming pass: change every #FFF fill to #000 across a screen
- Token migration: bump every fontSize from 14 to 16
- Normalizing values left inconsistent by earlier passes
- The alternative is N targeted single-node calls (set_text / set_fill / edit)

Returns: { data: { replacements: [{ rule: 0, matched: 12 }, { rule: 1, matched: 0 }] } }

Parameters beyond schema:
- \`node\` is the subtree root; search recurses into all descendants (depth-first).
- Each rule's \`from\` is an EXACT-match string (no substring, no regex). For typed props (fontSize, opacity), pass values as strings — the executor coerces.
- Zero matches do NOT error — they return matched: 0. Sanity-check with discover_props first if you're unsure values exist.

Skip when:
- Updating a single known node — use set_text / set_fill / set_stroke / set_layout for type-aware single-intent edits, or edit for generic.
- Values are variable-bound (tokens) — replace_props bypasses bindings; use bind_variable to swap the token instead.
- You need partial / fuzzy match — replace_props is exact-only; you'll need find_nodes + a loop.

Examples:
  // single rule, white -> black
  replace_props({node: "1:2", rules: [{prop: "fillColor", from: "#FFF", to: "#000"}]})

  // batch theme update — both rules applied in one pass
  replace_props({node: "1:2", rules: [
    {prop: "fillColor", from: "#FFF", to: "#000"},
    {prop: "fontSize", from: "14", to: "16"}
  ]})`,
  parameters: {
    type: 'object',
    properties: {
      node: {
        type: 'string',
        description: 'Target node ID (e.g. "1:2")',
      },
      rules: {
        type: 'array',
        description: 'Replacement rules',
        items: {
          type: 'object',
          description: '{prop, from, to}',
          properties: {
            prop: { type: 'string', description: 'Property name' },
            from: { type: 'string', description: 'Value to find' },
            to: { type: 'string', description: 'Value to replace with' },
          },
          required: ['prop', 'from', 'to'],
        },
      },
    },
    required: ['node', 'rules'],
  },
};
