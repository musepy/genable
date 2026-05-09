/**
 * @file pluginDataTool.ts
 * @description Read / write Figma node pluginData and sharedPluginData.
 *
 * Plan B addition. Replaces the `js`-tool path for pluginData operations.
 */

import { ToolDefinition } from '../types';

export const readPluginDataDefinition: ToolDefinition = {
  name: 'read_plugin_data',
  executionStrategy: 'parallel',
  mutates: false,
  description: `Read plugin data (private or shared) from a Figma node.

Use for: i18n metadata, design-system tags, custom plugin annotations, anything stored via setPluginData / setSharedPluginData.

If \`namespace\` is omitted, reads private pluginData (\`node.getPluginData(key)\`).
If \`namespace\` is provided, reads sharedPluginData (\`node.getSharedPluginData(namespace, key)\`).

Returns \`{value: ""}\` (empty string) when the key does not exist — Figma's API never throws here.

Examples:
  read_plugin_data({node_id: "1:5", key: "ref"})
  read_plugin_data({node_id: "1:5", namespace: "i18n", key: "ref"})`,
  parameters: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'Figma node id (resolve via find_nodes / get_selection first).' },
      namespace: { type: 'string', description: 'Optional sharedPluginData namespace. Omit for private pluginData.' },
      key: { type: 'string', description: 'Key to read.' },
    },
    required: ['node_id', 'key'],
  },
};

export const writePluginDataDefinition: ToolDefinition = {
  name: 'write_plugin_data',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Write plugin data (private or shared) to a Figma node.

If \`namespace\` is omitted, writes private pluginData (\`node.setPluginData(key, value)\`).
If \`namespace\` is provided, writes sharedPluginData (\`node.setSharedPluginData(namespace, key, value)\`).

Pass an empty string as \`value\` to delete a key.

Examples:
  write_plugin_data({node_id: "1:5", key: "ref", value: "home_title"})
  write_plugin_data({node_id: "1:5", namespace: "i18n", key: "ref", value: "home.welcome_title"})`,
  parameters: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'Figma node id.' },
      namespace: { type: 'string', description: 'Optional sharedPluginData namespace.' },
      key: { type: 'string', description: 'Key to write.' },
      value: { type: 'string', description: 'Value (string). Pass "" to delete.' },
    },
    required: ['node_id', 'key', 'value'],
  },
};
