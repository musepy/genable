/**
 * @file variableBindingHandler.ts
 * @description Binds Figma variables to node properties via $varName syntax.
 *
 * Usage in mk:  padding:$layout/containerPad  fill:$bg/primary  visible:$visibility/navLinks
 *
 * The handler detects string values starting with '$', looks up the variable
 * by name, and calls setBoundVariable() or setBoundVariableForPaint().
 */

import { PropertyHandler, Warning } from './types';

// Properties that use paint-based variable binding (color variables)
const PAINT_PROPS = new Set(['fills', 'strokes']);

// Lazy cache: populated on first use within a session
let varCache: Map<string, VariableValue> | null = null;

async function ensureCache(): Promise<Map<string, VariableValue>> {
  if (varCache) return varCache;
  varCache = new Map();
  // Build collection id → name lookup
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collById = new Map<string, string>();
  for (const c of collections) collById.set(c.id, c.name);
  // getLocalVariablesAsync() with no filter returns all types
  const all = await figma.variables.getLocalVariablesAsync();
  for (const v of all) {
    const collName = collById.get(v.variableCollectionId) || '';
    // Primary key: "Collection/name" (disambiguates duplicates across collections)
    if (collName) varCache.set(`${collName}/${v.name}`, v as unknown as VariableValue);
    // Fallback key: just "name" (backward compat when unambiguous)
    if (!varCache.has(v.name)) varCache.set(v.name, v as unknown as VariableValue);
  }
  return varCache;
}

/** Call this to invalidate the cache (e.g., after creating new variables). */
export function invalidateVariableCache(): void {
  varCache = null;
}

type VariableValue = Variable;

async function findVariable(name: string): Promise<Variable | null> {
  const cache = await ensureCache();
  return (cache.get(name) as Variable) ?? null;
}

export const variableBindingHandler: PropertyHandler = {
  name: 'variableBinding',

  match(_key: string, value: any): boolean {
    return typeof value === 'string' && value.startsWith('$');
  },

  async apply(node: SceneNode, key: string, value: any): Promise<Warning[]> {
    const varName = (value as string).slice(1); // strip leading $
    const variable = await findVariable(varName);

    if (!variable) {
      // Invalidate cache and retry once (variable may have been created recently)
      invalidateVariableCache();
      const retryVar = await findVariable(varName);
      if (!retryVar) {
        return [{
          code: 'VARIABLE_NOT_FOUND',
          severity: 'warning',
          message: `Variable '${varName}' not found. Create it first or check the name.`,
        }];
      }
      return this.apply(node, key, value);
    }

    try {
      if (PAINT_PROPS.has(key)) {
        // Color variable → bind via paint
        const paint = figma.variables.setBoundVariableForPaint(
          { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
          'color',
          variable,
        );
        (node as any)[key] = [paint];
      } else {
        // Numeric / boolean variable → direct binding
        node.setBoundVariable(key as VariableBindableNodeField, variable);
      }
      return [];
    } catch (e: any) {
      return [{
        code: 'VARIABLE_BIND_FAILED',
        severity: 'warning',
        message: `Failed to bind '${varName}' to '${key}': ${e?.message ?? e}`,
      }];
    }
  },
};
