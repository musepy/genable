/**
 * @file varHandlers.ts
 * @description IPC handlers for variable management commands.
 * Runs on main thread with full figma.variables.* API access.
 *
 * Addressing: pure Figma IDs — VariableID:x:y, VariableCollectionId:x:y, modeId "1:0".
 * No path resolution, no name lookup.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { parseHexToRGBA } from '../../utils/colorUtils';
import { invalidateVariableCache } from '../../engine/actions/handlers/variableBindingHandler';
import { figmaVariableCache } from '../../engine/figma-adapter/caches/figmaVariableCache';
import { traced } from './pipelineTracer';
import { getPropertyDef } from '../../constants/figma-property-registry-helpers';

/**
 * DSL-layer alias map for bind_variable's `prop` parameter.
 * Translates shorthand names (LLM-friendly) → canonical Figma bindable field names.
 * This is DSL sugar, NOT a Figma truth — registry owns the canonical names and their
 * bindable typing. Identity entries (e.g. `opacity: 'opacity'`) are omitted; unmatched
 * keys pass through to the registry lookup unchanged.
 */
export const BIND_ALIAS_MAP: Record<string, string> = {
  gap: 'itemSpacing',
  padding: 'paddingTop',
  'padding-top': 'paddingTop',
  'padding-right': 'paddingRight',
  'padding-bottom': 'paddingBottom',
  'padding-left': 'paddingLeft',
  corner: 'cornerRadius',
  'corner-radius': 'cornerRadius',
  'font-size': 'fontSize',
};

/**
 * Pure validator for bind_variable's prop/node-type/variable-type triple.
 * Factored out for testability (no figma.* access) — applied inside
 * handleBindVariable after the variable and node are resolved.
 *
 * Returns `null` when binding is allowed, otherwise an error message suitable
 * for returning as `ToolResponse.error`.
 */
export function validateBindRequest(args: {
  nodeType: string;
  prop: string;
  variableType: 'FLOAT' | 'BOOLEAN' | 'STRING' | 'COLOR';
  variableName: string;
}): { canonicalProp: string; error: string | null } {
  const canonicalProp = BIND_ALIAS_MAP[args.prop.toLowerCase()] ?? args.prop;

  // width/height are readonly (computed post-layout); reject with actionable redirect.
  if (canonicalProp === 'width' || canonicalProp === 'height') {
    const axis = canonicalProp === 'width' ? 'Horizontal' : 'Vertical';
    const sizeKind = canonicalProp === 'width' ? 'Width' : 'Height';
    return {
      canonicalProp,
      error:
        `Cannot bind variable to ${canonicalProp} directly — ${canonicalProp} is computed post-layout and not writable. ` +
        `Instead: set layoutSizing${axis} to "FIXED"/"FILL"/"HUG", or bind the variable to a size-contributing numeric prop ` +
        `(padding*, itemSpacing, min${sizeKind}, max${sizeKind}).`,
    };
  }

  const def = getPropertyDef(args.nodeType, canonicalProp);
  if (!def || def.bindable === undefined) {
    return {
      canonicalProp,
      error:
        `Property "${canonicalProp}" is not bindable on ${args.nodeType} nodes. ` +
        `Bindable examples for ${args.nodeType}: itemSpacing, paddingLeft, cornerRadius, opacity, visible.`,
    };
  }
  if (def.bindable !== args.variableType) {
    return {
      canonicalProp,
      error:
        `Type mismatch: "${canonicalProp}" on ${args.nodeType} accepts ${def.bindable} variables, ` +
        `but "${args.variableName}" is ${args.variableType}. Use a ${def.bindable} variable or bind to a different prop.`,
    };
  }

  return { canonicalProp, error: null };
}

// ── list_variables ──
//
// Flat response: { variables[], collections[], nextCursor? }
// - `collection` filter: only variables in that VariableCollectionId
// - `filter`: substring match on variable name (case-insensitive)
// - `cursor`: opaque string (currently stringified offset)
// - `limit`: default 100

const DEFAULT_LIMIT = 100;

export const handleListVariables = traced('handleListVariables()', 'varHandlers.ts', async function handleListVariables(params: any): Promise<ToolResponse> {
  const filterCollectionId = typeof params.collection === 'string' ? params.collection : undefined;
  const filterSubstring = typeof params.filter === 'string' ? params.filter.toLowerCase() : undefined;
  const rawLimit = typeof params.limit === 'number' ? params.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(rawLimit, 1000));
  const offset = parseCursor(params.cursor);

  const allVariables = await figma.variables.getLocalVariablesAsync();

  let filtered = allVariables;
  if (filterCollectionId) {
    filtered = filtered.filter(v => v.variableCollectionId === filterCollectionId);
  }
  if (filterSubstring) {
    filtered = filtered.filter(v => v.name.toLowerCase().includes(filterSubstring));
  }

  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < filtered.length ? String(nextOffset) : undefined;

  // Collect only referenced collections
  const referencedCollectionIds = new Set(page.map(v => v.variableCollectionId));
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const collections = allCollections
    .filter(c => referencedCollectionIds.has(c.id))
    .map(c => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    }));

  const variables = page.map(v => ({
    id: v.id,
    name: v.name,
    variableCollectionId: v.variableCollectionId,
    resolvedType: v.resolvedType,
    valuesByMode: v.valuesByMode,
  }));

  const data: any = { variables, collections };
  if (nextCursor !== undefined) data.nextCursor = nextCursor;

  return { data };
});

function parseCursor(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── create_collection ──

export const handleCreateCollection = traced('handleCreateCollection()', 'varHandlers.ts', async function handleCreateCollection(params: any): Promise<ToolResponse> {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  const modes: unknown = params.modes;

  if (!name) return { error: 'create_collection requires "name".' };
  if (!Array.isArray(modes) || modes.length === 0) {
    return { error: 'create_collection requires "modes" — a non-empty array of mode names.' };
  }
  const modeNames = modes.map(m => String(m).trim()).filter(Boolean);
  if (modeNames.length === 0) {
    return { error: 'create_collection requires at least one non-empty mode name.' };
  }

  const collection = figma.variables.createVariableCollection(name);
  collection.renameMode(collection.modes[0].modeId, modeNames[0]);
  for (let i = 1; i < modeNames.length; i++) {
    collection.addMode(modeNames[i]);
  }

  invalidateCaches();

  return {
    data: {
      id: collection.id,
      modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    },
  };
});

// ── create_variable ──

export const handleCreateVariable = traced('handleCreateVariable()', 'varHandlers.ts', async function handleCreateVariable(params: any): Promise<ToolResponse> {
  const collectionId = typeof params.collection === 'string' ? params.collection : '';
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  const type = normalizeVarType(params.type);

  if (!collectionId) return { error: 'create_variable requires "collection" (VariableCollectionId).' };
  if (!name) return { error: 'create_variable requires "name".' };
  if (!type) return { error: 'create_variable requires "type" — one of COLOR, FLOAT, STRING, BOOLEAN.' };

  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    return { error: `Collection "${collectionId}" not found. Use list_variables to discover collection ids.` };
  }

  const variable = figma.variables.createVariable(name, collection, type);

  invalidateCaches();

  return { data: { id: variable.id } };
});

// ── set_variable_value ──

export const handleSetVariableValue = traced('handleSetVariableValue()', 'varHandlers.ts', async function handleSetVariableValue(params: any): Promise<ToolResponse> {
  const variableId = typeof params.variable === 'string' ? params.variable : '';
  const modeId = typeof params.mode === 'string' ? params.mode : '';
  const rawValue = params.value;

  if (!variableId) return { error: 'set_variable_value requires "variable" (VariableID).' };
  if (!modeId) return { error: 'set_variable_value requires "mode" (modeId from the variable\'s collection).' };
  if (rawValue === undefined || rawValue === null) {
    return { error: 'set_variable_value requires "value".' };
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    return { error: `Variable "${variableId}" not found.` };
  }

  let figmaValue: any;
  try {
    figmaValue = coerceValueForFigma(rawValue, variable.resolvedType);
  } catch (e: any) {
    return { error: `Invalid value for ${variable.resolvedType}: ${e?.message ?? e}` };
  }

  try {
    variable.setValueForMode(modeId, figmaValue);
  } catch (e: any) {
    return { error: `setValueForMode failed: ${e?.message ?? e}` };
  }

  invalidateCaches();

  return { data: { ok: true } };
});

/**
 * Coerce an LLM-supplied value into the shape Figma's setValueForMode wants.
 * - Alias objects pass through verbatim.
 * - Hex strings become {r,g,b,a} in 0-1 range for COLOR.
 * - Other types are type-checked lightly.
 */
function coerceValueForFigma(raw: any, type: VariableResolvedDataType): any {
  // Alias passthrough
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
    if (typeof raw.id !== 'string') throw new Error('VARIABLE_ALIAS requires "id"');
    return { type: 'VARIABLE_ALIAS', id: raw.id };
  }

  if (type === 'COLOR') {
    if (typeof raw === 'string') return parseHexToRGBA(raw);
    if (raw && typeof raw === 'object' && typeof raw.r === 'number') {
      const { r, g, b, a } = raw;
      return { r, g, b, a: typeof a === 'number' ? a : 1 };
    }
    throw new Error('COLOR expects #hex string or {r,g,b,a?}');
  }
  if (type === 'FLOAT') {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
    throw new Error('FLOAT expects a number');
  }
  if (type === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw;
    throw new Error('BOOLEAN expects true or false');
  }
  if (type === 'STRING') {
    if (typeof raw === 'string') return raw;
    throw new Error('STRING expects a string');
  }
  throw new Error(`Unknown resolvedType: ${type}`);
}

// ── bind_variable ──

export const handleBindVariable = traced('handleBindVariable()', 'varHandlers.ts', async function handleBindVariable(params: any): Promise<ToolResponse> {
  const nodeRef = typeof params.node === 'string' ? params.node : '';
  const prop = typeof params.prop === 'string' ? params.prop : '';
  const variableId = typeof params.variable === 'string' ? params.variable : '';

  if (!nodeRef || !prop || !variableId) {
    return { error: 'bind_variable requires "node", "prop", and "variable".' };
  }

  const resolved = await resolvePathToNode(nodeRef);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot bind variables to a page node.' };
  }
  const node = resolved.node;

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    return { error: `Variable "${variableId}" not found.` };
  }

  // COLOR variables are not bindable via this tool — the Figma API requires
  // wrapping them in a Paint object, which either overwrites existing fills or
  // silently creates one on a transparent container (unintended side effect).
  // Direct the caller to the intent-aligned tools instead.
  if (variable.resolvedType === 'COLOR') {
    return {
      error: `bind_variable does not bind COLOR variables — they need to be embedded in a Paint. Use set_fill({node, bg: "$${variable.name}"}) or set_stroke, or specify bg/fill="$${variable.name}" when creating the node via jsx.`,
    };
  }

  // Registry-driven validation (pure): alias resolution + bindable check + type check.
  // Replaces the old hand-coded allowlist; adding a bindable prop to the registry
  // automatically makes it accepted here.
  const validation = validateBindRequest({
    nodeType: node.type,
    prop,
    variableType: variable.resolvedType,
    variableName: variable.name,
  });
  if (validation.error) {
    return { error: validation.error };
  }
  const canonicalProp = validation.canonicalProp;

  try {
    node.setBoundVariable(canonicalProp as VariableBindableNodeField, variable);
    return {
      data: {
        message: `Bound "${variable.name}" (${variable.resolvedType}) → ${node.name}.${canonicalProp}`,
        nodeId: node.id,
        variableId: variable.id,
      },
    };
  } catch (e: any) {
    return { error: `Failed to bind: ${e?.message ?? e}` };
  }
});

// ── set_variable_mode ──

export const handleSetVariableMode = traced('handleSetVariableMode()', 'varHandlers.ts', async function handleSetVariableMode(params: any): Promise<ToolResponse> {
  const nodeRef = typeof params.node === 'string' ? params.node : '';
  const collectionId = typeof params.collection === 'string' ? params.collection : '';
  const modeId = typeof params.mode === 'string' ? params.mode : '';

  if (!nodeRef || !collectionId || !modeId) {
    return { error: 'set_variable_mode requires "node", "collection", and "mode".' };
  }

  const resolved = await resolvePathToNode(nodeRef);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot set variable mode on a page node.' };
  }
  const node = resolved.node;

  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    return { error: `Collection "${collectionId}" not found.` };
  }

  const mode = collection.modes.find(m => m.modeId === modeId);
  if (!mode) {
    const available = collection.modes.map(m => `${m.modeId}(${m.name})`).join(', ');
    return { error: `Mode "${modeId}" not found in collection. Available: ${available}` };
  }

  try {
    (node as SceneNode).setExplicitVariableModeForCollection(collection, mode.modeId);
    return {
      data: {
        message: `Set "${node.name}" to use mode "${mode.name}" of "${collection.name}"`,
        nodeId: node.id,
        collection: collection.id,
        mode: mode.modeId,
      },
    };
  } catch (e: any) {
    return { error: `Failed to set mode: ${e?.message ?? e}` };
  }
});

// ── Helpers ──

function invalidateCaches(): void {
  invalidateVariableCache();
  figmaVariableCache.invalidate();
}

function normalizeVarType(raw: unknown): VariableResolvedDataType | null {
  if (typeof raw !== 'string') return null;
  const t = raw.toUpperCase();
  if (t === 'COLOR') return 'COLOR';
  if (t === 'FLOAT') return 'FLOAT';
  if (t === 'BOOLEAN') return 'BOOLEAN';
  if (t === 'STRING') return 'STRING';
  return null;
}
