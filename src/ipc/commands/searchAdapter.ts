/**
 * @file searchAdapter.ts
 * @description Adapters for search tools — maps structured params to searchHandlers.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleGrep, handleSed } from './searchHandlers';

export async function handleFindNodes(params: any): Promise<ToolResponse> {
  return handleGrep({
    query: params.query || '',
    path: params.scope,
  });
}

export async function handleDiscoverProps(params: any): Promise<ToolResponse> {
  return handleGrep({
    mode: 'properties',
    path: params.node,
    properties: params.props,
  });
}

export async function handleReplaceProps(params: any): Promise<ToolResponse> {
  // Convert rules array [{prop, from, to}] to Record<string, Array<{from, to}>>
  const replacements: Record<string, Array<{ from: string | number; to: string | number }>> = {};
  if (Array.isArray(params.rules)) {
    for (const rule of params.rules) {
      const from = isFinite(Number(rule.from)) ? Number(rule.from) : rule.from;
      const to = isFinite(Number(rule.to)) ? Number(rule.to) : rule.to;
      if (!replacements[rule.prop]) replacements[rule.prop] = [];
      replacements[rule.prop].push({ from, to });
    }
  }
  if (Object.keys(replacements).length === 0) {
    return { error: 'replace_props requires "rules" array with [{prop, from, to}].' };
  }
  return handleSed({ path: params.node, replacements });
}
