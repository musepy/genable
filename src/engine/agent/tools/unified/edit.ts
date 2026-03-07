import { ToolDefinition } from '../types';

/**
 * Unified edit tool — single entry point for modifying and deleting existing nodes.
 * Replaces both patch_node and delete_node with a unified XML interface.
 * Same attribute syntax as create (CSS names, abbreviations, Figma-native).
 */
export const editDefinition: ToolDefinition = {
  name: 'edit',
  category: 'modify',
  display: { displayName: 'Edit', group: 'design' },
  executionStrategy: 'sequential',
  idempotent: false,
  dependencies: ['read'],
  description: `Modify or delete existing nodes using XML markup. Same CSS/abbreviation syntax as create.

CANNOT create new nodes — only modify or delete existing ones. To add new nodes, use \`create\` instead.
Every tag MUST have an \`id\` attribute referencing a real Figma node ID (from \`read\` or previous \`create\` idMap).
Only include properties you want to CHANGE — unspecified properties remain unchanged.
Use \`<delete id="xxx"/>\` to remove a node and all its children.
To REPLACE a node: \`edit\` to delete the old one, then \`create\` to add the new one.

IMPORTANT: Always use \`read\` first to get real nodeIds before editing.

\`\`\`json
edit({
  "xml": "<frame id='100:5' bg='#F3F4F6' corner='16'/><text id='100:8' fill='#EF4444' size='18'>Updated Title</text><delete id='100:12'/>"
})
\`\`\`

Attributes accept the same CSS names, abbreviations, and Figma-native names as \`create\`:
- \`bg\`, \`fill\`, \`fills\`, \`stroke\`, \`p\`, \`gap\`, \`corner\`, \`shadow\`, \`w\`, \`h\`, \`size\`, \`weight\`, etc.

Returns: per-node results with success/error status.`,
  parameters: {
    type: 'object',
    properties: {
      xml: {
        type: 'string',
        description:
          'XML markup for editing. Each tag must have id="<nodeId>". Use <delete id="xxx"/> to remove nodes.',
      },
    },
    required: ['xml'],
  },
  errors: {
    EMPTY_XML: 'A non-empty "xml" string must be provided.',
    XML_PARSE_ERROR: 'Failed to parse the XML edit markup.',
    NODE_NOT_FOUND: 'One or more nodeIds do not exist. Use read to get valid IDs.',
    APPLY_ERROR: 'Failed to update one or more nodes.',
    EXECUTION_ERROR: 'An unexpected error occurred in the edit pipeline.',
  },
};
