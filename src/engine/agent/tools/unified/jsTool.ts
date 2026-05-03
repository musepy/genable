/**
 * @file jsTool.ts
 * @description Execute JavaScript in the Figma plugin runtime.
 *
 * Replaces: run js (from `run` CLI).
 * Escape hatch — full access to figma.* API.
 */

import { ToolDefinition } from '../types';

export const jsToolDefinition: ToolDefinition = {
  name: 'js',
  executionStrategy: 'sequential',
  mutates: true,
  description: `Execute JavaScript in the Figma plugin runtime — full figma.* API access. Escape hatch for reads and API patterns the dedicated tools don't cover. For visual properties — fills, text, layout, stroke — the dedicated setters (set_fill, set_text, set_layout, set_stroke) run the same idMap + validation pipeline the rest of the agent relies on; prefer them so changes stay traceable.

Examples:
  js({code: "var n = await figma.getNodeByIdAsync('1:5'); return n.componentPropertyDefinitions"})
  js({code: "var all = await figma.currentPage.findAllAsync(); return all.filter(n => n.type === 'VECTOR').map(n => n.id)"})
  // For listing the page tree, prefer inspect({node:"/"}) or find_nodes({query:"..."}) — figma.currentPage.children is blocked.

Rules:
  - Full access to figma global (Figma Plugin API)
  - Use return for multi-statement code
  - Async/await supported
  - Results auto-serialized (nodes -> {id, type, name, width, height})
  - Arrays capped at 100 items

Gotchas (sandbox is strict, parser errors don't include line numbers):
  - Writes: use flat top-level \`var x = figma.getNodeById(id); x.prop = value;\` — avoid method-chain assignment like \`figma.getNodeById(x).fills = Y\`
  - \`findAll\` (sync) is blocked — use \`await findAllAsync()\` then filter client-side
  - Predicate callbacks inside findAllAsync may fail — prefer filter-after
  - fills/effects are frozen — build a new array and assign, don't mutate in place
  - On "expecting ';'" errors with no line info, shrink the script by halves to isolate`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. Use return to output a value.',
      },
    },
    required: ['code'],
  },
};
