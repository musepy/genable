/**
 * @file varHandlers.ts
 * @description IPC handlers for variable management commands.
 * Runs on main thread with full figma.variables.* API access.
 *
 * Addressing: pure Figma IDs — VariableID:x:y, VariableCollectionId:x:y, modeId "1:0".
 * No path resolution, no name lookup.
 */

import type { ToolResponse, ToolWarning } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { parseHexToRGBA } from '../../utils/colorUtils';
import { invalidateVariableCache } from '../../engine/actions/handlers/variableBindingHandler';
import {
  PLUGIN_DATA_MODE_COVERAGE,
  PLUGIN_DATA_FALLBACK_REASON,
  validateFallbackReason,
  checkModeCoverage,
  buildFallbackBindingWarning,
  type ModeCoverageRequired,
} from '../../engine/actions/handlers/modeCoverageCheck';
import { figmaVariableCache } from '../../engine/figma-adapter/caches/figmaVariableCache';
import { traced } from './pipelineTracer';
import { getPropertyDef } from '../../constants/figma-property-registry-helpers';
import { computeVariableIdempotencyKey } from '../../engine/agent/tools/idempotency';

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

// ── ensure_collection ──
//
// Idempotent collection creation. Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.1
//
// Behavior on re-call with same idempotency_key (= sha256(""+name+""+canonical_json(modes))):
//   - If a collection with the same name + identical mode set already exists → return it
//     unchanged, idempotent reuse (warning: NAME_EXISTS_OUTSIDE_TARGET_COLLECTION omitted —
//     same-name collections are explicitly allowed by Figma; the warning code is for
//     variable-level cross-collection clashes, not collection-name reuse).
//   - Else create a new collection.
//
// Idempotency key for collections: sha256(name + "|" + "<COLLECTION>" + "|" +
// canonical_json(modes_sorted_by_name)). Differs from §3.1's variable formula
// because there is no `collection_id` to anchor on yet — the collection IS the
// thing being keyed.

export const handleEnsureCollection = traced('handleEnsureCollection()', 'varHandlers.ts', async function handleEnsureCollection(params: any): Promise<ToolResponse> {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  const modes: unknown = params.modes;
  const idempotencyKey = typeof params.idempotency_key === 'string' ? params.idempotency_key : '';

  if (!name) return { error: 'ensure_collection requires "name".' };
  if (!Array.isArray(modes) || modes.length === 0) {
    return { error: 'ensure_collection requires "modes" — a non-empty array of {name} entries.' };
  }
  if (!idempotencyKey) {
    return { error: 'ensure_collection requires "idempotency_key" (sha256 of name+modes per spec §3.1).' };
  }

  // Normalize modes to {name} array, accept either ["Light","Dark"] or [{name:"Light"},...]
  const modeNames: string[] = [];
  for (const m of modes) {
    if (typeof m === 'string') modeNames.push(m.trim());
    else if (m && typeof m === 'object' && typeof (m as any).name === 'string') {
      modeNames.push(String((m as any).name).trim());
    }
  }
  const cleanedModes = modeNames.filter(Boolean);
  if (cleanedModes.length === 0) {
    return { error: 'ensure_collection requires at least one non-empty mode name.' };
  }

  // Validate idempotency_key matches our canonical formula. Random / partial
  // keys rejected (closes codex finding §3.1 "random keys break dedup on retry").
  const expectedKey = computeVariableIdempotencyKey({
    collection_id: '',
    name,
    type: 'STRING',  // sentinel — collection key uses placeholder type slot
    values_by_mode: { modes: cleanedModes },
  });
  if (idempotencyKey !== expectedKey) {
    return {
      error: 'INVALID_IDEMPOTENCY_KEY: idempotency_key does not match canonical formula sha256(name + "|" + ... + "|" + canonical_json({modes:[...]})). See spec §3.1.',
    };
  }

  // Look up existing collection by name. If found and modes match, idempotent reuse.
  //
  // Mode order IS part of identity (Option A — see codex round-3 finding 5).
  // Figma's first mode is the default mode for any node not explicitly
  // overridden via setExplicitVariableModeForCollection; swapping order
  // changes which mode resolves at the root, which is a semantic change.
  // Therefore ["Light","Dark"] ≠ ["Dark","Light"] — caller asking for the
  // latter when only the former exists creates a NEW collection (and may
  // emit a NAME_EXISTS_OUTSIDE_TARGET_COLLECTION-style ambiguity later when
  // variables get bound, though the warning code itself is variable-scoped).
  // The idempotency_key formula already captures order because canonical_json
  // preserves array order; this comparison just mirrors that decision.
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const sameName = allCollections.filter(c => c.name === name);

  for (const c of sameName) {
    const existingModes = c.modes.map(m => m.name);
    // Order matters: ["Light","Dark"] vs ["Dark","Light"] are NOT the same
    // collection, because Figma uses the first-listed mode as the default.
    if (existingModes.length === cleanedModes.length &&
        existingModes.every((mn, i) => mn === cleanedModes[i])) {
      // Idempotent reuse.
      return {
        data: {
          collection_id: c.id,
          modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name })),
          reused: true,
        },
      };
    }
  }

  // Create new collection.
  const collection = figma.variables.createVariableCollection(name);
  collection.renameMode(collection.modes[0].modeId, cleanedModes[0]);
  for (let i = 1; i < cleanedModes.length; i++) {
    collection.addMode(cleanedModes[i]);
  }

  invalidateCaches();

  return {
    data: {
      collection_id: collection.id,
      modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    },
  };
});

// ── ensure_variable ──
//
// Idempotent variable creation with cross-collection name-clash detection.
// Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.1.
//
// Match criteria (collection_id, name, type):
//   - exactly 1 in target collection → idempotent reuse
//   - 0 in target, matches in OTHER collections → create + warning
//     NAME_EXISTS_OUTSIDE_TARGET_COLLECTION with candidates
//   - 0 anywhere → create
//   - 2+ in target collection (Figma allows duplicates) →
//     SAME_COLLECTION_NAME_DUPLICATE error
//
// values_by_mode is populated by iterating the map and calling setValueForMode
// per mode. The handler resolves mode names → modeIds via collection.modes.

export const handleEnsureVariable = traced('handleEnsureVariable()', 'varHandlers.ts', async function handleEnsureVariable(params: any): Promise<ToolResponse> {
  const collectionId = typeof params.collection_id === 'string' ? params.collection_id : '';
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  const type = normalizeVarType(params.type);
  const valuesByMode = (params.values_by_mode && typeof params.values_by_mode === 'object')
    ? params.values_by_mode as Record<string, unknown>
    : {};
  const idempotencyKey = typeof params.idempotency_key === 'string' ? params.idempotency_key : '';

  // Phase 2 step 4: mode_coverage_required — defaults to 'all'. Spec §6.2.
  // Default 'all' enforces strict mode-by-mode coverage at bind time.
  // 'opt-in-fallback' requires a structured `fallback_reason` (closes codex
  // Medium 8 — prevents using opt-in as a one-click bypass).
  const rawCoverage = typeof params.mode_coverage_required === 'string'
    ? params.mode_coverage_required.trim()
    : 'all';
  let modeCoverageRequired: ModeCoverageRequired;
  if (rawCoverage === 'opt-in-fallback') {
    modeCoverageRequired = 'opt-in-fallback';
  } else if (rawCoverage === 'all' || rawCoverage === '') {
    modeCoverageRequired = 'all';
  } else {
    return {
      error: `ensure_variable: invalid mode_coverage_required="${rawCoverage}" — must be "all" or "opt-in-fallback".`,
    };
  }

  let fallbackReason: string | undefined;
  if (modeCoverageRequired === 'opt-in-fallback') {
    const validated = validateFallbackReason(params.fallback_reason);
    if (!validated.ok) {
      return { error: validated.error };
    }
    fallbackReason = validated.reason;
  } else if (params.fallback_reason !== undefined && params.fallback_reason !== null && params.fallback_reason !== '') {
    // Caller passed a fallback_reason without opt-in — reject loudly so the
    // mismatch isn't silently dropped.
    return {
      error: 'ensure_variable: fallback_reason provided but mode_coverage_required is "all". Pass mode_coverage_required="opt-in-fallback" to use a fallback reason.',
    };
  }

  if (!collectionId) return { error: 'ensure_variable requires "collection_id".' };
  if (!name) return { error: 'ensure_variable requires "name".' };
  if (!type) return { error: 'ensure_variable requires "type" — one of COLOR, FLOAT, STRING, BOOLEAN.' };
  if (!idempotencyKey) {
    return { error: 'ensure_variable requires "idempotency_key" (sha256 per spec §3.1).' };
  }

  // Validate idempotency_key against the canonical formula.
  const expectedKey = computeVariableIdempotencyKey({
    collection_id: collectionId,
    name,
    type,
    values_by_mode: valuesByMode,
  });
  if (idempotencyKey !== expectedKey) {
    return {
      error: 'INVALID_IDEMPOTENCY_KEY: idempotency_key does not match canonical formula sha256(collection_id + "|" + name + "|" + type + "|" + canonical_json(values_by_mode)). See spec §3.1.',
    };
  }

  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    return { error: `Collection "${collectionId}" not found.` };
  }

  // Partition existing variables by collection.
  const allVars = await figma.variables.getLocalVariablesAsync();
  const matches = allVars.filter(v => v.name === name && v.resolvedType === type);
  const inTarget = matches.filter(v => v.variableCollectionId === collectionId);
  const elsewhere = matches.filter(v => v.variableCollectionId !== collectionId);

  // 2+ in target → SAME_COLLECTION_NAME_DUPLICATE
  if (inTarget.length >= 2) {
    return {
      error: `SAME_COLLECTION_NAME_DUPLICATE: ${inTarget.length} variables named "${name}" (${type}) exist in collection "${collection.name}". Pick one explicitly via list_variables.`,
      data: {
        candidates: inTarget.map(v => ({
          variable_id: v.id,
          name: v.name,
          collection_id: v.variableCollectionId,
          type: v.resolvedType,
        })),
      },
    };
  }

  // Resolve mode names → modeIds. We accept BOTH mode names and mode IDs in
  // values_by_mode keys — modeIds (e.g. "1:0") match directly; names map via
  // collection.modes.
  const modeNameToId = new Map<string, string>();
  const validModeIds = new Set<string>();
  for (const m of collection.modes) {
    modeNameToId.set(m.name, m.modeId);
    validModeIds.add(m.modeId);
  }
  // Pre-validate all keys resolve to a real modeId before mutating.
  const resolvedValues: Array<{ modeId: string; modeName: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(valuesByMode)) {
    let modeId: string | undefined;
    let modeName: string | undefined;
    if (validModeIds.has(k)) {
      modeId = k;
      modeName = collection.modes.find(m => m.modeId === k)?.name;
    } else if (modeNameToId.has(k)) {
      modeId = modeNameToId.get(k);
      modeName = k;
    }
    if (!modeId) {
      const available = collection.modes.map(m => `${m.name}(${m.modeId})`).join(', ');
      return { error: `values_by_mode key "${k}" is neither a mode name nor a modeId in collection "${collection.name}". Available: ${available}` };
    }
    resolvedValues.push({ modeId, modeName: modeName ?? '', value: v });
  }

  // Exactly 1 in target → candidate for idempotent reuse, BUT we must verify the
  // existing variable's actual values still match what the caller is asking for.
  // We compute a **content-equivalence fingerprint** on both sides — caller's
  // resolved (mode-name-keyed, Figma-coerced) values vs the existing variable's
  // live valuesByMode (also mode-name-keyed, already in Figma form). If the
  // variable was mutated since creation by a `js` tool, designer edit, stale
  // `set_variable_value`, or has different mode coverage, the fingerprints
  // diverge and we reject the silent-reuse path with STALE_VARIABLE_FINGERPRINT.
  //
  // Note: this comparison fingerprint is INTERNAL — it's NOT the caller's
  // idempotency_key (which validates the literal caller payload matches the
  // formula). The caller's hex-string COLOR `'#111111'` and Figma's stored
  // `{r:0.07,g:0.07,b:0.07,a:1}` would never share a literal-form fingerprint;
  // we coerce both sides through coerceValueForFigma to put them on the same
  // canonical footing before comparing.
  //
  // Edge case: existing valuesByMode has DIFFERENT mode keys than caller
  // (e.g., existing has only Default, caller specifies Default+Midnight).
  // That's a divergence — we surface STALE_VARIABLE_FINGERPRINT rather than
  // silently augment, because augmenting would be a hidden write inside what
  // the caller thinks is a pure reuse.
  if (inTarget.length === 1) {
    const existing = inTarget[0];

    // Map existing valuesByMode keys (modeIds) → mode names, the same way the
    // create branch builds mode_coverage. Only modes that resolve to a known
    // name are included — unknown modeIds (collection-mode mismatch from
    // history) are discarded for fingerprint purposes; this matches the
    // create-branch behaviour where mode_coverage drops unnamed modes.
    const modeIdToName = new Map<string, string>();
    for (const m of collection.modes) modeIdToName.set(m.modeId, m.name);

    const existingValuesByName: Record<string, unknown> = {};
    const existingModeCoverage: string[] = [];
    for (const [modeId, value] of Object.entries(existing.valuesByMode)) {
      const modeName = modeIdToName.get(modeId);
      if (modeName) {
        existingValuesByName[modeName] = value;
        existingModeCoverage.push(modeName);
      }
    }

    // Coerce caller values to Figma canonical form (same coercion used on
    // the create path). If coercion throws, the values are invalid for the
    // type — fall through to mismatch (caller fingerprint will show the
    // raw error).
    const callerValuesByName: Record<string, unknown> = {};
    let coercionFailed = false;
    for (const rv of resolvedValues) {
      if (!rv.modeName) continue;  // safety; shouldn't happen — pre-validated above
      try {
        callerValuesByName[rv.modeName] = coerceValueForFigma(rv.value, existing.resolvedType);
      } catch {
        coercionFailed = true;
        break;
      }
    }

    const existingFingerprint = computeVariableIdempotencyKey({
      collection_id: existing.variableCollectionId,
      name: existing.name,
      type: existing.resolvedType,
      values_by_mode: existingValuesByName,
    });
    const callerCanonicalFingerprint = coercionFailed
      ? '<coercion-failed>'
      : computeVariableIdempotencyKey({
          collection_id: existing.variableCollectionId,
          name: existing.name,
          type: existing.resolvedType,
          values_by_mode: callerValuesByName,
        });

    if (existingFingerprint !== callerCanonicalFingerprint) {
      const trunc = (s: string) => s.slice(0, 16) + '…';
      return {
        error:
          `STALE_VARIABLE_FINGERPRINT: existing variable "${existing.name}" in collection "${collection.name}" has fingerprint ${trunc(existingFingerprint)} but caller's intended state hashes to ${trunc(callerCanonicalFingerprint)}. ` +
          `The variable was likely mutated since creation (different values_by_mode, a missing mode, or an extra mode). ` +
          `Either call set_variable_value to align state with your intended values, or recompute idempotency_key from the existing-state values_by_mode and retry.`,
        data: {
          existing_variable_id: existing.id,
          existing_fingerprint: existingFingerprint,
          caller_fingerprint: callerCanonicalFingerprint,
        },
      };
    }

    // Persist coverage metadata on the reused variable. setPluginData is
    // idempotent — same value writes are no-ops in Figma.
    try {
      existing.setPluginData(PLUGIN_DATA_MODE_COVERAGE, modeCoverageRequired);
      if (fallbackReason !== undefined) {
        existing.setPluginData(PLUGIN_DATA_FALLBACK_REASON, fallbackReason);
      } else {
        // Clear stale reason when caller switches back to 'all'.
        existing.setPluginData(PLUGIN_DATA_FALLBACK_REASON, '');
      }
    } catch { /* best-effort — older Figma plugin runtime might lack setPluginData */ }

    return {
      data: {
        variable_id: existing.id,
        name: existing.name,
        type: existing.resolvedType,
        collection_id: existing.variableCollectionId,
        mode_coverage: existingModeCoverage,
        mode_coverage_required: modeCoverageRequired,
        reused: true,
      },
    };
  }

  // Create new variable in target collection.
  const newVar = figma.variables.createVariable(name, collection, type);
  // Apply values_by_mode.
  for (const rv of resolvedValues) {
    let figmaValue: any;
    try {
      figmaValue = coerceValueForFigma(rv.value, type);
    } catch (e: any) {
      // Roll back the partial creation to keep state clean.
      try { newVar.remove(); } catch { /* best-effort */ }
      return { error: `Invalid value for ${type} mode "${rv.modeName || rv.modeId}": ${e?.message ?? e}` };
    }
    try {
      newVar.setValueForMode(rv.modeId, figmaValue);
    } catch (e: any) {
      try { newVar.remove(); } catch { /* best-effort */ }
      return { error: `setValueForMode failed for mode "${rv.modeName || rv.modeId}": ${e?.message ?? e}` };
    }
  }

  // Persist mode_coverage_required + optional fallback_reason on the freshly
  // created variable. The data is read back at bind time by `checkModeCoverage`.
  try {
    newVar.setPluginData(PLUGIN_DATA_MODE_COVERAGE, modeCoverageRequired);
    if (fallbackReason !== undefined) {
      newVar.setPluginData(PLUGIN_DATA_FALLBACK_REASON, fallbackReason);
    }
  } catch { /* best-effort */ }

  invalidateCaches();

  // Build mode_coverage: every mode for which the new variable now has an
  // explicit value.
  const modeCoverage = resolvedValues
    .map(rv => rv.modeName)
    .filter((n): n is string => Boolean(n));

  const warnings: ToolWarning[] = [];
  if (elsewhere.length > 0) {
    warnings.push({
      code: 'NAME_EXISTS_OUTSIDE_TARGET_COLLECTION',
      message: `Variable "${name}" (${type}) also exists in ${elsewhere.length} other collection(s). Created new in target collection per spec §3.1 regime A.`,
      candidates: elsewhere.map(v => ({
        variable_id: v.id,
        name: v.name,
        collection_id: v.variableCollectionId,
        type: v.resolvedType,
      })),
    });
  }

  const response: ToolResponse = {
    data: {
      variable_id: newVar.id,
      name: newVar.name,
      type: newVar.resolvedType,
      collection_id: newVar.variableCollectionId,
      mode_coverage: modeCoverage,
      mode_coverage_required: modeCoverageRequired,
    },
  };
  if (warnings.length > 0) response.warnings = warnings;
  return response;
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

  // ── Phase 2 step 4: mode coverage check ────────────────────────────────
  // Spec §6.1 — applies to ALL variable types. bind_variable is the
  // FLOAT/STRING/BOOLEAN binding entry point (COLOR went through set_fill /
  // jsx → variableBindingHandler), so without this check the spec would
  // only enforce coverage on the COLOR path.
  const bindWarnings: ToolWarning[] = [];
  const coverage = await checkModeCoverage(node as SceneNode, variable);
  if (coverage.kind === 'fail') {
    return {
      error:
        `MISSING_MODE_VALUES: Variable ${coverage.variable_id} (${coverage.variable_name}) lacks values for modes: ` +
        `[${coverage.missing_modes.map(m => `'${m}'`).join(', ')}]. ` +
        `Node ${node.id} will render in one of these modes via mode chain. No binding applied.`,
      data: {
        code: 'MISSING_MODE_VALUES',
        node_id: node.id,
        variable_id: coverage.variable_id,
        variable_name: coverage.variable_name,
        collection_id: coverage.collection_id,
        missing_modes: coverage.missing_modes,
        recommended_next_action: {
          tool: 'ensure_variable',
          args: {
            collection_id: coverage.collection_id,
            name: coverage.variable_name,
            type: variable.resolvedType,
            // Caller fills values; we surface the missing mode names.
            values_by_mode: Object.fromEntries(coverage.missing_modes.map(m => [m, '<value-required>'])),
          },
        },
      },
    };
  }
  if (coverage.kind === 'fallback') {
    let reason: string | undefined;
    try { reason = variable.getPluginData(PLUGIN_DATA_FALLBACK_REASON) || undefined; } catch { /* */ }
    bindWarnings.push(toToolWarningFromHandler(buildFallbackBindingWarning({
      node_id: node.id,
      variable_id: variable.id,
      variable_name: variable.name,
      collection_id: variable.variableCollectionId,
      missing_modes: coverage.missing_modes,
      fallback_reason: reason,
    })));
  }

  try {
    node.setBoundVariable(canonicalProp as VariableBindableNodeField, variable);
    const response: ToolResponse = {
      data: {
        message: `Bound "${variable.name}" (${variable.resolvedType}) → ${node.name}.${canonicalProp}`,
        nodeId: node.id,
        variableId: variable.id,
      },
    };
    if (bindWarnings.length > 0) response.warnings = bindWarnings;
    return response;
  } catch (e: any) {
    return { error: `Failed to bind: ${e?.message ?? e}` };
  }
});

/**
 * Convert a handler-side `Warning` into the LLM-facing `ToolWarning` shape.
 * Local helper so we don't introduce another import; the two interfaces
 * have a compatible "code + bag" structure.
 */
function toToolWarningFromHandler(w: { code: string; message?: string; [k: string]: unknown }): ToolWarning {
  const out: ToolWarning = { code: w.code };
  if (w.message) out.message = w.message;
  for (const [k, v] of Object.entries(w)) {
    if (k === 'code' || k === 'message' || k === 'severity') continue;
    out[k] = v;
  }
  return out;
}

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
