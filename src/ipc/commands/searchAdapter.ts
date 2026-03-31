/**
 * @file searchAdapter.ts
 * @description Thin adapter for the `search` tool — routes structured params
 * to existing handleGrep/handleSed handlers.
 *
 * Mode inference:
 *   replace param present + node → replace mode (→ handleSed)
 *   props param present + node   → discover mode (→ handleGrep properties)
 *   otherwise                    → find mode (→ handleGrep nodes)
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { handleGrep, handleSed } from './searchHandlers';

/**
 * Parse a replace string like "fillColor:#FFF/#000 fontSize:14/16"
 * into the format handleSed expects: { fillColor: [{from:"#FFF", to:"#000"}], fontSize: [{from:14, to:16}] }
 */
function parseReplaceString(raw: string): Record<string, Array<{ from: string | number; to: string | number }>> {
  const result: Record<string, Array<{ from: string | number; to: string | number }>> = {};

  // Split by spaces, each token is "prop:from/to"
  const tokens = raw.trim().split(/\s+/);
  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx < 0) continue;

    const prop = token.slice(0, colonIdx);
    const rest = token.slice(colonIdx + 1);

    // Split from/to by "/" — but handle hex colors like #FFF/#000
    const slashIdx = rest.indexOf('/');
    if (slashIdx < 0) continue;

    const fromStr = rest.slice(0, slashIdx);
    const toStr = rest.slice(slashIdx + 1);

    // Coerce numeric values
    const from = isFinite(Number(fromStr)) ? Number(fromStr) : fromStr;
    const to = isFinite(Number(toStr)) ? Number(toStr) : toStr;

    if (!result[prop]) result[prop] = [];
    result[prop].push({ from, to });
  }

  return result;
}

export async function handleSearch(params: any): Promise<ToolResponse> {
  // Replace mode: node + replace string
  if (params.replace && params.node) {
    const replacements = parseReplaceString(params.replace);
    if (Object.keys(replacements).length === 0) {
      return { error: { code: 'MISSING_REPLACEMENTS', message: 'Cannot parse replacement rules. Format: "prop:from/to [prop:from/to ...]"' } };
    }
    return handleSed({ path: params.node, replacements });
  }

  // Discover mode: node + props array
  if (params.props && params.node) {
    return handleGrep({
      mode: 'properties',
      path: params.node,
      properties: params.props,
    });
  }

  // Find mode: search by query
  return handleGrep({
    query: params.query || '',
    path: params.scope,
  });
}
