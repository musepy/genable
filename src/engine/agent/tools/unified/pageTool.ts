/**
 * @file pageTool.ts
 * @description Tool for navigating between Figma pages.
 *
 * `switch_page` solves the "must stay on the page that contains target nodes"
 * pain point — Figma plugins default to `figma.currentPage`, and most node
 * operations are scoped to it. This tool exposes `figma.setCurrentPageAsync`
 * so the LLM can navigate the file directly.
 *
 * Returns the full page roster on every call — one call gets you context
 * (what pages exist) + action (switch). Avoids needing a separate list_pages
 * tool.
 */

import { ToolDefinition } from '../types';

export const switchPageDefinition: ToolDefinition = {
  name: 'switch_page',
  executionStrategy: 'sequential', // mutates global figma.currentPage
  mutates: false, // doesn't modify any node
  description: `Navigate between pages in the Figma file. ID-driven — names are not addressable (they can collide and change).

Two modes:
- switch_page({})              → return the page roster only, no switch (use to discover IDs on first call)
- switch_page({pageId: "1:23"})  → switch and return the updated state + roster

Pages are top-level containers under the file root. Most read/write operations default to figma.currentPage. Call this when you need to operate on nodes that live on a different page than the current one.

Returns:
- currentPageId, currentPageName — the now-current page (always present)
- pages — full roster [{id, name}] of every page in the file (always present)
- previousPageId, previousPageName — what you switched from (only when an actual switch happened)
- unchanged — true if target was already current

Typical flow:
1. switch_page({})                         // get IDs
2. switch_page({pageId: "<picked id>"})    // switch

When to call:
- User mentions content on a different page than the current one
- A previous tool reported a node ID is on a non-current page
- You need to inspect/modify nodes outside the active page

Don't call:
- For nodes already on the current page — figma.currentPage is the default scope, this would just waste an iteration
- Repeatedly to "explore" — every call returns the full pages roster, cache it`,
  parameters: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'Target page ID (e.g., "0:1"). Omit to just fetch the page roster without switching.',
      },
    },
  },
};
