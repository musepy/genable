/**
 * @file findReferencesTool.ts
 * @description First-class reverse-lookup tool — "which nodes use this variable?"
 *
 * The forward question ("what does this node bind?") is answered by
 * `inspect({node, facets:["variables"]})`. The reverse question — who
 * references a given variable — had no first-class tool and used to push
 * the LLM into the `js` escape hatch (slow, error-prone, timed out).
 *
 * MVP: variables only; currentPage only; no pagination.
 * Future (NOT this MVP): component?, style?, includeInvisible?, cross-page.
 */
import type { ToolDefinition } from '../types';

export const findReferencesDefinition: ToolDefinition = {
  name: 'find_references',
  executionStrategy: 'parallel',
  description: `Find every node on the current page that references a given variable.

This is the REVERSE of inspect: inspect asks "what does this node bind?",
find_references asks "who uses this variable?". Use it when renaming,
auditing, or swapping tokens — you need to know all the binding sites
before you touch the variable.

Scan scope: currentPage only. Invisible nodes are skipped by default.
Node-level bindings (e.g. boundVariables.paddingLeft) and per-paint color
bindings (fills[i].boundVariables.color, strokes[i].boundVariables.color)
are both returned.

Parameters:
  variable  — VariableID (e.g. "VariableID:1:5"). Required.

Returns:
  {variable, variableName, variableType, referenceCount,
   references: [{nodeId, nodeName, nodeType, path}, ...]}

  path values look like:
    "boundVariables.paddingLeft"
    "fills[0].boundVariables.color"
    "strokes[2].boundVariables.color"

Examples:
  find_references({variable: "VariableID:1:5"})`,
  parameters: {
    type: 'object',
    properties: {
      variable: {
        type: 'string',
        description: 'VariableID to look up (e.g. "VariableID:1:5"). Get IDs from list_variables.',
      },
    },
    required: ['variable'],
  },
};
