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
  description: `Move or rename a design node.

**Syntax**: \`mv /source/ /dest/\`

- Same parent → RENAME (just changes name)
- Different parent → MOVE (reparent + optional rename)
- Dest is an existing container → move INTO it (keep original name)

**Examples**:
  mv /Card/OldTitle /Card/NewTitle            # rename
  mv /Card/Header/Logo /Card/Footer/Logo      # move to different parent
  mv /Card/Header/Logo /Card/Footer/          # move into Footer, keep name

See also: cp (clone), rm (delete), mk (create/update)`,
  parameters: {
    type: 'object',
    properties: {
      sourcePath: {
        type: 'string',
        description: 'Path to the node to move/rename.',
      },
      destPath: {
        type: 'string',
        description: 'Destination path. Last segment = new name, prefix = new parent.',
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
