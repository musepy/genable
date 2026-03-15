import { ToolDefinition } from '../types';

/**
 * Unified create/update command — like Unix mkdir/touch/>.
 * Path exists → update, path doesn't exist → create.
 * Replaces: mkdir, mktext, write, ln, design.
 */
export const mkDefinition: ToolDefinition = {
  name: 'mk',
  category: 'create',
  display: { displayName: 'Make', group: 'design' },
  executionStrategy: 'sequential',
  description: `Create or update a design node (upsert).

**Syntax**: \`mk /path/ [type] key:value... [-- text content]\`

- Path exists → UPDATE (only listed props change, type ignored)
- Path doesn't exist → CREATE (type defaults to frame)
- Types: frame, text, rect, ellipse, line, icon, image, group, section, vector
- \`ref:ComponentName\` → create component instance
- \`--\` separates props from text content (shell convention)

**Props**: space-separated \`key:value\` pairs. Quote complex values: \`shadow:'0,4,16,0,#000A'\`.
Same shorthands as design: w, h, bg, layout, gap, p, corner, fill, stroke, shadow, pattern.

**Examples**:
  mk /Card/ frame w:400 layout:column gap:16 p:24 bg:#FFF corner:12
  mk /Card/Title text size:24 weight:Bold fill:#111 -- Card Title
  mk /Card/ corner:16                                  # update existing
  mk /Card/Btn ref:Button variant:'Size=Large'          # component instance

**Batch** (via input parameter — multiple lines):
  run({command: "mk", input: "/Card/ frame w:400 layout:column\\n/Card/Title text size:24 -- Hello"})

Batch supports parent-child references within the same call.

Returns: compact receipt with { idMap, created, edited, deleted, failed, errors, warnings, violations }`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path for the node. Last segment = name, prefix = parent.',
      },
      type: {
        type: 'string',
        description: 'Node type (default: frame).',
      },
      refComponent: {
        type: 'string',
        description: 'Component name for ref: instances.',
      },
      propTokens: {
        type: 'array',
        description: 'Property key:value pairs.',
        items: { type: 'string', description: 'Property key:value pair' },
      },
      textContent: {
        type: 'string',
        description: 'Text content (after --).',
      },
      batch: {
        type: 'string',
        description: 'Multiline mk commands for batch execution.',
      },
    },
    required: [],
  },
  errors: {
    INVALID_PATH: 'Path must end with a node name.',
    PATH_NOT_FOUND: 'Parent path not found.',
    PARSE_ERROR: 'Failed to parse mk command.',
    EXECUTION_ERROR: 'Failed to create/update node.',
  },
};
