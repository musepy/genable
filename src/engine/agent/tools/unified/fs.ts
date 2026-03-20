/**
 * @file fs.ts
 * @description FS write command definitions — rm, cp.
 *
 * Path-based addressing → executor pipeline.
 * Commands use the same path system as ls/tree/cat for consistent read/write addressing.
 */

import { ToolDefinition } from '../types';

export const rmDefinition: ToolDefinition = {
  name: 'rm',
  category: 'modify',
  display: { displayName: 'Delete', group: 'design' },
  executionStrategy: 'sequential',
  description: `Delete a node and its children at the given path.

CLI: rm /Card/OldSection/
     rm /Card/Header/Icon`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the node to delete.',
      },
    },
    required: ['path'],
  },
  errors: {
    PATH_NOT_FOUND: 'No node found at the given path.',
    INVALID_TARGET: 'Cannot delete page root.',
    EXECUTION_ERROR: 'Failed to delete node.',
  },
};

export const cpDefinition: ToolDefinition = {
  name: 'cp',
  category: 'create',
  display: { displayName: 'Clone', group: 'design' },
  executionStrategy: 'sequential',
  description: `Clone a node to a new path with optional property overrides.

Deep-copies the source. Override props apply to clone root.
Use ChildName.prop:value for child overrides.

CLI: cp /Card/Default/ /Card/Hover/ {bg:#EEE}
     cp /Card/Default/ /Card/Disabled/ {bg:#D9D9D9, Label.fill:#999}`,
  parameters: {
    type: 'object',
    properties: {
      sourcePath: {
        type: 'string',
        description: 'Path to the source node to clone.',
      },
      destPath: {
        type: 'string',
        description: 'Path for the clone. Last segment = name, prefix = parent.',
      },
      propsRaw: {
        type: 'string',
        description: 'Override properties, e.g. {bg:#EEE}',
      },
    },
    required: ['sourcePath', 'destPath'],
  },
  errors: {
    MISSING_SOURCE: 'Source path is required.',
    MISSING_DEST: 'Destination path is required.',
    PATH_NOT_FOUND: 'Path not found.',
    INVALID_SOURCE: 'Cannot clone page root.',
    EXECUTION_ERROR: 'Failed to clone node.',
  },
};
