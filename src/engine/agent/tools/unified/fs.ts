/**
 * @file fs.ts
 * @description Unix FS write command definitions — mkdir, mktext, write, rm, cp, ln.
 *
 * Thin translation layer: path-based addressing → flat ops → existing executor pipeline.
 * Commands use the same path system as ls/tree/cat for consistent read/write addressing.
 *
 * CLI form: invoked as "mkdir /Card/ {w:400}", "mktext /Card/Title {size:24} Hello".
 * These definitions describe the internal parameter schemas (post-parsing).
 */

import { ToolDefinition } from '../types';

export const mkdirDefinition: ToolDefinition = {
  name: 'mkdir',
  category: 'create',
  display: { displayName: 'Create', group: 'design' },
  executionStrategy: 'sequential',
  description: `Create a new frame node at the given path.

Path: last segment = node name, prefix = parent. "/" = page root.
Default type is frame. Use -t flag for rect, ellipse, line, section, group.
Props use the same shorthands as design: w, h, bg, layout, gap, p, corner, fill, etc.

CLI: mkdir /Card/ {w:400, layout:column, p:24, bg:#FFF, corner:16}
     mkdir /Card/Header/ {layout:row, gap:8, w:fill}
     mkdir /Card/Icon/ -t ellipse {w:40, h:40, fill:#3B82F6}`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path for the new node. Last segment = name, prefix = parent.',
      },
      propsRaw: {
        type: 'string',
        description: 'Properties block, e.g. {w:400, layout:column}',
      },
      type: {
        type: 'string',
        description: 'Node type override (default: frame). Options: frame, rect, ellipse, line, section, group.',
      },
    },
    required: ['path'],
  },
  errors: {
    INVALID_PATH: 'Path must end with a node name.',
    PATH_NOT_FOUND: 'Parent path not found.',
    PARSE_ERROR: 'Failed to parse properties.',
    EXECUTION_ERROR: 'Failed to create node.',
  },
};

export const mktextDefinition: ToolDefinition = {
  name: 'mktext',
  category: 'create',
  display: { displayName: 'Create Text', group: 'design' },
  executionStrategy: 'sequential',
  description: `Create a new text node at the given path.

Path: last segment = node name, prefix = parent.
Text content follows the props block (or directly after path if no props).

CLI: mktext /Card/Title {size:24, weight:Bold, fill:#111} Card Title
     mktext /Card/Desc {size:14, fill:#6B7280, w:fill} Description text
     mktext /Card/Label Hello World`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path for the new text node.',
      },
      propsRaw: {
        type: 'string',
        description: 'Properties block, e.g. {size:24, fill:#111}',
      },
      textContent: {
        type: 'string',
        description: 'Text content for the node.',
      },
    },
    required: ['path'],
  },
  errors: {
    INVALID_PATH: 'Path must end with a node name.',
    PATH_NOT_FOUND: 'Parent path not found.',
    PARSE_ERROR: 'Failed to parse properties.',
    EXECUTION_ERROR: 'Failed to create text node.',
  },
};

export const writeDefinition: ToolDefinition = {
  name: 'write',
  category: 'modify',
  display: { displayName: 'Update', group: 'design' },
  executionStrategy: 'sequential',
  description: `Update properties of an existing node at the given path.

Only listed properties change — unspecified properties remain unchanged.
Same property shorthands as design tool.

CLI: write /Card/ {bg:#000, corner:16}
     write /Card/Title {size:28, fill:#FFF}
     write /Card/Header/ {layout:row, gap:12}`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the node to update.',
      },
      propsRaw: {
        type: 'string',
        description: 'Properties to update, e.g. {bg:#000, corner:16}',
      },
    },
    required: ['path', 'propsRaw'],
  },
  errors: {
    PATH_NOT_FOUND: 'No node found at the given path.',
    INVALID_TARGET: 'Cannot write to page root.',
    EMPTY_PROPS: 'No properties provided.',
    EXECUTION_ERROR: 'Failed to update node.',
  },
};

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

export const lnDefinition: ToolDefinition = {
  name: 'ln',
  category: 'create',
  display: { displayName: 'Instance', group: 'design' },
  executionStrategy: 'sequential',
  description: `Create a component instance at the given path.

References an existing Component or ComponentSet by name.
Use variant:'PropName=Value' for variant selection.
Use set:childName:'text' for text overrides.

CLI: ln /Card/BtnInst Button {variant:'Size=Large'}
     ln /Form/Input TextInput {set:placeholder:'Email'}`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path for the instance. Last segment = name, prefix = parent.',
      },
      component: {
        type: 'string',
        description: 'Component or ComponentSet name to instantiate.',
      },
      propsRaw: {
        type: 'string',
        description: "Properties and overrides, e.g. {variant:'Size=Large'}",
      },
    },
    required: ['path', 'component'],
  },
  errors: {
    MISSING_PATH: 'Path is required.',
    MISSING_COMPONENT: 'Component name is required.',
    PATH_NOT_FOUND: 'Parent path not found.',
    EXECUTION_ERROR: 'Failed to create instance.',
  },
};
