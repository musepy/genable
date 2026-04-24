/**
 * @file findReferencesHandler.ts
 * @description Reverse-lookup handler — walks currentPage and finds every node
 * that binds a given variable at either the node level or inside a Paint.
 *
 * See `unified/findReferencesTool.ts` for the LLM-facing contract.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { traced } from './pipelineTracer';

/**
 * Minimal duck-typed node shape consumed by buildReferencesList.
 * Matches real SceneNode for the fields we touch, and is easy to construct
 * in tests without figma.* mocks.
 */
export interface NodeLike {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  boundVariables?: unknown;
  fills?: unknown;
  strokes?: unknown;
}

export interface ReferenceEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Where on the node the binding lives, e.g. "boundVariables.paddingLeft" or "fills[0].boundVariables.color". */
  path: string;
}

/**
 * Shape of a Figma VARIABLE_ALIAS binding object.
 * Both `{paddingLeft: {type:"VARIABLE_ALIAS", id:"..."}}` entries on a node and
 * `paint.boundVariables.color` use this shape.
 */
interface VariableAlias {
  type?: string;
  id?: string;
}

function isAliasMatch(value: unknown, targetId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const alias = value as VariableAlias;
  return typeof alias.id === 'string' && alias.id === targetId;
}

/**
 * Pure helper — given a list of node-like objects and a target VariableID,
 * returns every reference site on those nodes.
 *
 * Scans:
 *   1. node-level `boundVariables.<key>` (paddingLeft, itemSpacing, opacity, …)
 *   2. per-paint `fills[i].boundVariables.color`
 *   3. per-paint `strokes[i].boundVariables.color`
 *
 * Invisible nodes are skipped. Per-node exceptions are swallowed so one
 * bad node cannot abort the whole scan.
 */
export function buildReferencesList(nodes: readonly NodeLike[], targetVariableId: string): ReferenceEntry[] {
  const refs: ReferenceEntry[] = [];

  for (const node of nodes) {
    if (!node || node.visible === false) continue;

    try {
      // 1. Node-level bindings
      const bv = node.boundVariables;
      if (bv && typeof bv === 'object') {
        for (const key of Object.keys(bv as Record<string, unknown>)) {
          const entry = (bv as Record<string, unknown>)[key];
          if (isAliasMatch(entry, targetVariableId)) {
            refs.push({
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              path: `boundVariables.${key}`,
            });
          }
        }
      }

      // 2. Per-paint bindings on fills
      const fills = node.fills;
      if (Array.isArray(fills)) {
        for (let i = 0; i < fills.length; i++) {
          const paint = fills[i];
          const color = paint && typeof paint === 'object'
            ? (paint as { boundVariables?: { color?: unknown } }).boundVariables?.color
            : undefined;
          if (isAliasMatch(color, targetVariableId)) {
            refs.push({
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              path: `fills[${i}].boundVariables.color`,
            });
          }
        }
      }

      // 3. Per-paint bindings on strokes
      const strokes = node.strokes;
      if (Array.isArray(strokes)) {
        for (let i = 0; i < strokes.length; i++) {
          const paint = strokes[i];
          const color = paint && typeof paint === 'object'
            ? (paint as { boundVariables?: { color?: unknown } }).boundVariables?.color
            : undefined;
          if (isAliasMatch(color, targetVariableId)) {
            refs.push({
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              path: `strokes[${i}].boundVariables.color`,
            });
          }
        }
      }
    } catch {
      // Skip this node on any unexpected read failure — don't abort the scan.
      continue;
    }
  }

  return refs;
}

const VARIABLE_ID_PATTERN = /^VariableID:[^\s]+$/;

export const handleFindReferences = traced(
  'handleFindReferences()',
  'findReferencesHandler.ts',
  async function handleFindReferences(parameters: any): Promise<ToolResponse> {
    const variableId = typeof parameters?.variable === 'string' ? parameters.variable.trim() : '';

    if (!variableId) {
      return { error: 'find_references requires "variable" (VariableID, e.g. "VariableID:1:5"). Get IDs from list_variables.' };
    }
    if (!VARIABLE_ID_PATTERN.test(variableId)) {
      return { error: `Invalid variable id "${variableId}" — expected shape "VariableID:x:y". Get IDs from list_variables.` };
    }

    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      return { error: `Variable "${variableId}" not found. Use list_variables to discover valid IDs.` };
    }

    // Walk currentPage; collect NodeLike view for the pure helper.
    const pageNodes = figma.currentPage.findAll(() => true) as unknown as NodeLike[];

    const references = buildReferencesList(pageNodes, variableId);

    return {
      data: {
        variable: variable.id,
        variableName: variable.name,
        variableType: variable.resolvedType,
        referenceCount: references.length,
        references,
      },
    };
  },
);
