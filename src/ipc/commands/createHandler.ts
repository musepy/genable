/**
 * @file createHandler.ts
 * @description Handler for the `create` tool — structured JSON node creation.
 *
 * Takes a JSON array of node objects, converts to flat ops, executes.
 * No string parsing — the LLM's tool call JSON is the structure.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { nodesToFlatOps, type CreateNode } from '../../engine/create/nodesToFlatOps';
import { executeFlatOps } from './shared';

export async function handleCreate(parameters: any): Promise<ToolResponse> {
  const { nodes, parentId } = parameters;

  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return {
      data: {
        message: 'create — Build design trees with structured JSON nodes.',
        usage: 'create({nodes: [{tag: "frame", name: "Card", w: 400, layout: "column", p: 24}, {tag: "text", name: "Title", parent: "Card", size: 24, content: "Hello"}]})',
        nodeFields: {
          required: 'tag (frame/text/rect/...), name',
          structure: 'parent (references another node\'s name)',
          text: 'content (text content for text nodes)',
          instance: 'ref (component name), variant (selector)',
          props: 'w, h, layout, gap, p, bg, corner, fill, size, weight, etc.',
        },
      },
    };
  }

  // Validate nodes
  const errors: string[] = [];
  const validNodes: CreateNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') {
      errors.push(`Node ${i}: not an object`);
      continue;
    }
    if (!node.tag || typeof node.tag !== 'string') {
      errors.push(`Node ${i}: missing or invalid 'tag'`);
      continue;
    }
    if (!node.name || typeof node.name !== 'string') {
      // Auto-generate name from tag if missing
      node.name = node.tag;
    }
    validNodes.push(node as CreateNode);
  }

  if (validNodes.length === 0) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: errors.length > 0
          ? `No valid nodes: ${errors.join('; ')}`
          : 'Empty nodes array.',
      },
    };
  }

  const flatOps = nodesToFlatOps(validNodes);
  const result = await executeFlatOps(flatOps, parentId);

  if (errors.length > 0) {
    const warnings = errors.map(e => `[warn] ${e}`).join('\n');
    result._stderr = result._stderr
      ? warnings + '\n' + result._stderr
      : warnings;
  }

  return result;
}
