import { ToolDefinition } from '../types';

/**
 * Move/rename command — like Unix mv.
 * Same parent → rename. Different parent → reparent (+ optional rename).
 */
export const mvDefinition: ToolDefinition = {
  name: 'mv',
  category: 'modify',
  display: { displayName: 'Move', group: 'design' },
  executionStrategy: 'sequential',
  description: `Move, rename, or reorder a design node.

**Syntax**: \`mv Name#id /dest/ [--at N]\`

- Same parent → RENAME (just changes name)
- Different parent → MOVE (reparent + optional rename)
- Dest is an existing container → move INTO it (keep original name)
- \`--at N\` → reorder within parent (0 = first child, -1 = last)

**Examples**:
  mv OldTitle#1:2 /Card/NewTitle              # rename
  mv Logo#1:3 Footer#1:4                      # move to different parent
  mv Item3#1:5 Item3#1:5 --at 0               # move to first position

See also: cp (clone), rm (delete), edit (update props)`,
  parameters: {
    type: 'object',
    properties: {
      sourcePath: {
        type: 'string',
        description: 'Source node ref (Name#id) or path.',
      },
      destPath: {
        type: 'string',
        description: 'Destination node ref (Name#id) or path. Last segment = new name.',
      },
      at: {
        type: 'number',
        description: 'Target index within parent children. 0 = first, -1 = last. Used for reordering.',
      },
    },
    required: ['sourcePath', 'destPath'],
  },
  errors: {
    MISSING_SOURCE: 'Source path is required.',
    MISSING_DEST: 'Destination path is required.',
    PATH_NOT_FOUND: 'Path not found.',
    INVALID_SOURCE: 'Cannot move page root.',
    INVALID_DEST: 'Destination is not a container.',
    EXECUTION_ERROR: 'Failed to move node.',
  },
};
