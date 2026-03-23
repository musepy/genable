/**
 * @file vfs.ts
 * @description Virtual filesystem tool definitions — ls, cat, tree.
 *
 * Maps Unix filesystem metaphors to Figma scene graph navigation.
 * Nodes = directories, properties = file contents.
 * Path-based addressing replaces nodeId-based addressing.
 *
 * CLI form: invoked as "ls /path/", "cat /path/ -s", "tree /path/ -d 2".
 * These definitions describe the internal parameter schemas (post-parsing).
 */

import { ToolDefinition } from '../types';

export const lsDefinition: ToolDefinition = {
  name: 'ls',
  category: 'read',
  display: { displayName: 'List', group: 'inspect' },
  executionStrategy: 'parallel',
  description: `List children of a design node — like Unix ls.

Path format: "/" for page root, "/NodeName/" for named nodes, "/Parent/Child/" for nested.
Segments match by node name. Use name#id ref from ls output: "Card#100:5".

Shows: name, type, dimensions, layout, key visual properties for each child.
Nodes with children shown with trailing "/".

CLI: ls /                    → page root
     ls /Card/               → Card's children
     ls /Card/Header/        → nested`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to list. "/" for page root.',
      },
    },
    required: ['path'],
  },
  errors: {
    'PATH_NOT_FOUND': 'No node found at the given path. Check available names with ls on parent.',
    'NOT_A_CONTAINER': 'Node has no children to list.',
  },
};

export const catDefinition: ToolDefinition = {
  name: 'cat',
  category: 'read',
  display: { displayName: 'Inspect', group: 'inspect' },
  executionStrategy: 'parallel',
  description: `Read full properties of a design node — like Unix cat.

Returns all visual properties: fills, fonts, effects, padding, cornerRadius, shadow, layout, sizing.
Auto-degrades to structural view when tree is large. Use tree() first, then cat specific children.

Output format: XML with abbreviated attributes (w, h, layout, fill, size, weight, corner, p, shadow).
Text content appears as tag body: <text size="16">Hello</text>.

CLI: cat /Card/              → full properties
     cat /Card/Header/Title  → specific node
     cat /Card/ -s           → with screenshot`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the node.',
      },
      depth: {
        type: 'number',
        description: 'Max depth (default: 5, max: 10).',
        minimum: 1,
        maximum: 10,
      },
      screenshot: {
        type: 'boolean',
        description: 'Capture a screenshot of the node.',
      },
    },
    required: ['path'],
  },
  errors: {
    'PATH_NOT_FOUND': 'No node found at the given path.',
  },
};

export const treeDefinition: ToolDefinition = {
  name: 'tree',
  category: 'read',
  display: { displayName: 'Tree', group: 'inspect' },
  executionStrategy: 'parallel',
  description: `Show structural tree of a design node — like Unix tree.

Displays hierarchy with id, name, type, dimensions, layout mode. ~100-300 tokens.
Much cheaper than cat for understanding structure. Text nodes show content inline.

Returns suggestedReads — paths of complex children worth inspecting with cat.

Progressive reading pattern:
1. ls /         — discover what's on the page
2. tree /Card/  — see the Card's structure
3. cat /Card/Header/Title — full details for specific nodes

CLI: tree /                  → page structure
     tree /Card/             → Card subtree
     tree /Card/ -d 2        → shallow tree (depth 2)`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the root node. "/" for page root.',
      },
      depth: {
        type: 'number',
        description: 'Max depth (default: 5, max: 10).',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['path'],
  },
  errors: {
    'PATH_NOT_FOUND': 'No node found at the given path.',
  },
};
