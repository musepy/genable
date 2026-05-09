/**
 * @file pluginDataHandler.ts
 * @description IPC handlers for read_plugin_data / write_plugin_data tools.
 *
 * Plan B replacement for what previously required the `js` tool to invoke
 * `node.getPluginData` / `node.setPluginData` (and the shared variants).
 */

import type { ToolResponse } from '../../engine/agent/tools/types';

export async function handleReadPluginData(parameters: any): Promise<ToolResponse> {
  const { node_id, namespace, key } = parameters ?? {};
  if (!node_id || typeof node_id !== 'string') {
    return { error: 'read_plugin_data: "node_id" is required.' };
  }
  if (!key || typeof key !== 'string') {
    return { error: 'read_plugin_data: "key" is required.' };
  }

  const node = await (figma as any).getNodeByIdAsync(node_id);
  if (!node) {
    return { error: `Node "${node_id}" not found. Use find_nodes or get_selection to locate it first.` };
  }

  const ns = typeof namespace === 'string' && namespace.length > 0 ? namespace : null;
  const value = ns
    ? (node as any).getSharedPluginData(ns, key)
    : (node as any).getPluginData(key);

  return { data: { node_id, namespace: ns, key, value } };
}

export async function handleWritePluginData(parameters: any): Promise<ToolResponse> {
  const { node_id, namespace, key, value } = parameters ?? {};
  if (!node_id || typeof node_id !== 'string') {
    return { error: 'write_plugin_data: "node_id" is required.' };
  }
  if (!key || typeof key !== 'string') {
    return { error: 'write_plugin_data: "key" is required.' };
  }
  if (typeof value !== 'string') {
    return { error: 'write_plugin_data: "value" must be a string. Pass "" to delete.' };
  }

  const node = await (figma as any).getNodeByIdAsync(node_id);
  if (!node) {
    return { error: `Node "${node_id}" not found.` };
  }

  const ns = typeof namespace === 'string' && namespace.length > 0 ? namespace : null;
  if (ns) {
    (node as any).setSharedPluginData(ns, key, value);
  } else {
    (node as any).setPluginData(key, value);
  }

  return { data: { ok: true, node_id, namespace: ns, key } };
}
