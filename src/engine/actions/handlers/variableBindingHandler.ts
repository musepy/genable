/**
 * @file variableBindingHandler.ts
 * @description Binds Figma variables to node properties via $varName syntax.
 *
 * Usage in mk:  padding:$layout/containerPad  fill:$bg/primary  visible:$visibility/navLinks
 *
 * The handler detects string values starting with '$', looks up the variable
 * by name, and calls setBoundVariable() or setBoundVariableForPaint().
 *
 * Phase 1 strict-resolver `warn_pick_record` semantics
 * (spec §5.1): when a bare-name token resolves to multiple candidates, we
 * STILL bind the first match (backward compat) BUT emit an
 * `AMBIGUOUS_NAME_AUTOPICK` warning carrying every candidate so the LLM can
 * self-correct on the next turn. The runtime sees this warning and emits
 * the corresponding `ambiguous_autopick` event, also enriching candidates
 * with `source` and `suggested_id` from its RyowStore (Option B plumbing —
 * resolver-side `source` and `suggested_id` are left undefined here because
 * RyowStore lives in the sandbox-side AgentRuntime, not in this main-thread
 * handler; the runtime fills them in afterToolExec).
 */

import { PropertyHandler, Warning } from './types';

// Properties that use paint-based variable binding (color variables)
const PAINT_PROPS = new Set(['fills', 'strokes']);

// Lazy cache: populated on first use within a session.
// Multi-value-per-key — both the qualified ("Collection/name") and bare
// ("name") form accumulate ALL matches so the resolver can detect ambiguity
// (silent first-pick was the bug — see project_stale_variable_reuse.md).
let varCache: Map<string, Variable[]> | null = null;

async function ensureCache(): Promise<Map<string, Variable[]>> {
  if (varCache) return varCache;
  const cache = new Map<string, Variable[]>();
  // Build collection id → name lookup
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collById = new Map<string, string>();
  for (const c of collections) collById.set(c.id, c.name);
  // getLocalVariablesAsync() with no filter returns all types
  const all = await figma.variables.getLocalVariablesAsync();
  for (const v of all) {
    const collName = collById.get(v.variableCollectionId) || '';
    // Primary key: "Collection/name" (disambiguates duplicates across collections)
    if (collName) {
      const key = `${collName}/${v.name}`;
      const list = cache.get(key) ?? [];
      list.push(v);
      cache.set(key, list);
    }
    // Fallback key: just "name" (multi-value — every same-name var lands here)
    const list = cache.get(v.name) ?? [];
    list.push(v);
    cache.set(v.name, list);
  }
  varCache = cache;
  return cache;
}

/** Call this to invalidate the cache (e.g., after creating new variables). */
export function invalidateVariableCache(): void {
  varCache = null;
}

/**
 * Look up every variable matching `name` (qualified or bare). Returns an
 * empty array if none. The CALLER decides ambiguity policy.
 */
async function findVariables(name: string): Promise<Variable[]> {
  const cache = await ensureCache();
  return cache.get(name) ?? [];
}

/**
 * Build an AMBIGUOUS_NAME_AUTOPICK warning from a multi-match list.
 * `picked` is the one the resolver actually bound (currently first). Fields
 * `source` and `suggested_id` are filled in by the AgentRuntime from its
 * RyowStore — see file header note about Option B plumbing.
 */
async function buildAmbiguousAutopickWarning(
  picked: Variable,
  candidates: Variable[],
): Promise<Warning> {
  // Resolve collection metadata for each candidate. Cached lookup is cheap;
  // we already paid the read in ensureCache(). This re-fetch keeps the
  // function self-contained without threading the lookup map through.
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collById = new Map<string, { name: string; modes: { modeId: string; name: string }[] }>();
  for (const c of collections) {
    const modes = Array.isArray((c as any).modes)
      ? (c as any).modes.map((m: any) => ({ modeId: m.modeId, name: m.name }))
      : [];
    collById.set(c.id, { name: c.name, modes });
  }

  return {
    code: 'AMBIGUOUS_NAME_AUTOPICK',
    severity: 'warning',
    message: `Bare-name lookup found ${candidates.length} variables. Bound the first match (${picked.id}); see candidates for alternatives.`,
    picked_variable_id: picked.id,
    // suggested_id: filled by AgentRuntime from RyowStore.findVariableByName.
    candidates: candidates.map(v => {
      const coll = collById.get(v.variableCollectionId);
      const valuesByMode = (v as any).valuesByMode as Record<string, unknown> | undefined;
      const definedModeIds = valuesByMode ? Object.keys(valuesByMode) : [];
      const modeCoverage = coll
        ? definedModeIds
            .map(mid => coll.modes.find(m => m.modeId === mid)?.name)
            .filter((n): n is string => Boolean(n))
        : [];
      return {
        variable_id: v.id,
        name: v.name,
        collection_id: v.variableCollectionId,
        collection_name: coll?.name,
        type: v.resolvedType,
        mode_coverage: modeCoverage,
        // source: filled by AgentRuntime — "created_this_turn" if RyowStore
        // tracks this id, else "preexisting".
        source: 'preexisting' as const,
      };
    }),
  };
}

export const variableBindingHandler: PropertyHandler = {
  name: 'variableBinding',

  match(_key: string, value: any): boolean {
    return typeof value === 'string' && value.startsWith('$');
  },

  async apply(node: SceneNode, key: string, value: any): Promise<Warning[]> {
    const varName = (value as string).slice(1); // strip leading $
    let variables = await findVariables(varName);

    if (variables.length === 0) {
      // Invalidate cache and retry once (variable may have been created recently)
      invalidateVariableCache();
      variables = await findVariables(varName);
      if (variables.length === 0) {
        return [{
          code: 'VARIABLE_NOT_FOUND',
          severity: 'warning',
          message: `Variable '${varName}' not found. Create it first or check the name.`,
        }];
      }
    }

    // Phase 1 silent-pick: STILL bind the first match for backward compat.
    // Phase 2 (later) will reject bare-name and require ID-form or
    // (collection_id, name, type) triple.
    const variable = variables[0];

    const warnings: Warning[] = [];
    if (variables.length > 1) {
      warnings.push(await buildAmbiguousAutopickWarning(variable, variables));
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
      return warnings;
    } catch (e: any) {
      return [
        ...warnings,
        {
          code: 'VARIABLE_BIND_FAILED',
          severity: 'warning',
          message: `Failed to bind '${varName}' to '${key}': ${e?.message ?? e}`,
        },
      ];
    }
  },
};
