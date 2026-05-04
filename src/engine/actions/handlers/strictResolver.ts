/**
 * STATUS — opt-in only (post May 2026 cutover revert).
 * This resolver is invoked exclusively when the runtime is configured with
 * `agentBehaviorConfig.variableResolution: 'strict'`. The default mode
 * (`'mode-coverage'`) routes bare-name `"$Token"` strings through the legacy
 * `variableBindingHandler` (silent-pick first match) and never enters this
 * file. The May 2026 attempt to flip the default to strict (commits a13ab4a /
 * 05774dc) was reverted in 56aefe6 because string-mode providers stringified
 * the structured `{variable_id}` object form taught in setter descriptions,
 * causing silent-black fills. Strict remains an opt-in pending real E2E
 * validation.
 *
 * Note on naming: the runtime error code `BARE_NAME_REJECTED_PHASE2` keeps
 * its historical "PHASE2" suffix on purpose — that string is emitted in
 * tool-response error envelopes and may appear in compressed transcript
 * history; renaming it could break LLM error-pattern matching. "PHASE2" in
 * this constant refers to the historical rollout phase (the §3.2 cutover),
 * not the current `VariableResolutionMode` enum value.
 *
 * @file strictResolver.ts
 * @description Phase 0 symbol resolution layer for the discriminated-union
 * variable-binding tool inputs (set_fill / set_stroke). Spec
 * docs/knowledge/variable-resolver-design-2026-05.md §3.2 / §4.1 / §5.3.
 *
 * Three input forms (strict mode):
 *   { variable_id, expected_name?, expected_fingerprint? } — ID + optional stability assertion
 *   { collection_id, name, type }                          — structured-name → resolved by triple
 *   { color: hex }                                          — raw hex passthrough
 *
 * Phase 0 runs PER tool call (not batched) — see §8 #1: a batch resolved
 * upfront would either fail subsequent calls (ensure_variable not yet
 * applied) or resolve to stale state.
 *
 * Returned discriminator:
 *   { kind: 'variable',  variable: Variable }
 *   { kind: 'color',     hex: string }
 *   { kind: 'reject',    error: string, code: string, recommended_next_action?, candidates?, ... }
 *
 * The IPC-side caller (set_fill / set_stroke handler) translates the
 * `variable` outcome into a downstream binding, the `color` outcome into a
 * raw fill, and the `reject` outcome into an error envelope.
 *
 * Gating
 * ──────
 * The resolver itself is mode-agnostic — IT ALWAYS RESOLVES the input. The
 * CALLER decides whether to invoke it (strict mode does) or fall back to
 * the legacy bare-name path (mode-coverage does). One exception: the
 * resolver checks bare-name strings ("$Name") and rejects them with
 * BARE_NAME_REJECTED_PHASE2 — the input shape, not the runtime mode, drives
 * that decision. Mode-coverage callers must not pass strings to this
 * resolver; pass them through the legacy path.
 *
 * The fingerprint formula in `computeVariableIdempotencyKey` is used for
 * `expected_fingerprint`. Mismatch = STALE_VARIABLE_ID.
 */

import { computeVariableIdempotencyKey } from '../../agent/tools/idempotency';

// ── Discriminated input ──────────────────────────────────────────────────

export type StrictBindingInput =
  | StrictByIdInput
  | StrictByTripleInput
  | StrictColorInput;

export interface StrictByIdInput {
  variable_id: string;
  expected_name?: string;
  expected_fingerprint?: string;
}

export interface StrictByTripleInput {
  collection_id: string;
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
}

export interface StrictColorInput {
  color: string;
}

// ── Discriminated result ─────────────────────────────────────────────────

export type StrictResolveResult =
  | { kind: 'variable'; variable: Variable }
  | { kind: 'color'; hex: string }
  | StrictRejectResult;

export interface StrictRejectResult {
  kind: 'reject';
  /** Tool-response error code. See spec §4.1. */
  code:
    | 'BARE_NAME_REJECTED_PHASE2'
    | 'STALE_VARIABLE_ID'
    | 'AMBIGUOUS_VARIABLE_REFERENCE'
    | 'VARIABLE_NOT_FOUND'
    | 'INVALID_INPUT';
  message: string;
  recommended_next_action?: { tool: string; args: Record<string, unknown> } | null;
  candidates?: Array<{
    variable_id: string;
    name: string;
    collection_id: string;
    collection_name?: string;
    type?: string;
    mode_coverage?: string[];
    /** "preexisting" until enriched by AgentRuntime via RyowStore. */
    source: 'preexisting' | 'created_this_turn';
  }>;
  /** When code === STALE_VARIABLE_ID: the actual current name read from Figma. */
  actual_name?: string;
  /** When code === STALE_VARIABLE_ID: the actual fingerprint computed from current state. */
  actual_fingerprint?: string;
}

// ── Type guards ──────────────────────────────────────────────────────────

export function isByIdInput(v: unknown): v is StrictByIdInput {
  return !!v && typeof v === 'object'
    && typeof (v as any).variable_id === 'string'
    && (v as any).variable_id.length > 0;
}

export function isByTripleInput(v: unknown): v is StrictByTripleInput {
  if (!v || typeof v !== 'object') return false;
  const o = v as any;
  return typeof o.collection_id === 'string' && o.collection_id.length > 0
    && typeof o.name === 'string' && o.name.length > 0
    && (o.type === 'COLOR' || o.type === 'FLOAT' || o.type === 'STRING' || o.type === 'BOOLEAN');
}

export function isColorInput(v: unknown): v is StrictColorInput {
  return !!v && typeof v === 'object'
    && typeof (v as any).color === 'string'
    && (v as any).color.length > 0;
}

/**
 * Detect a bare-name string of form "$Name" or "$Collection/Name". Strict
 * mode rejects this at the tool boundary (spec §3.2). Caller may also
 * pass a plain hex string ("#FFF") which is still allowed via StrictColorInput.
 */
export function isBareNameString(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('$');
}

// ── Phase 0 resolution ───────────────────────────────────────────────────

/**
 * Find every variable matching (collection_id, name, type) in the LIVE
 * Figma state. Returns an array — caller policy decides 0 / 1 / 2+ handling.
 * Spec §3.2 (structured-name form).
 *
 * NOTE: this does NOT use the cache from variableBindingHandler.ts — that
 * cache is keyed by name, not by triple, and may be stale relative to
 * intra-batch creations. Phase 0 must see the latest state.
 */
async function findVariablesByTriple(
  collection_id: string,
  name: string,
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
): Promise<Variable[]> {
  const all = await figma.variables.getLocalVariablesAsync();
  return all.filter(
    v =>
      v.variableCollectionId === collection_id &&
      v.name === name &&
      v.resolvedType === type,
  );
}

/**
 * Build candidate metadata for the AMBIGUOUS_VARIABLE_REFERENCE envelope
 * (spec §4.1.b). All `source` fields default to "preexisting"; AgentRuntime
 * enriches them via RyowStore in afterToolExec.
 */
async function buildCandidates(
  variables: Variable[],
): Promise<StrictRejectResult['candidates']> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collById = new Map<
    string,
    { name: string; modes: { modeId: string; name: string }[] }
  >();
  for (const c of collections) {
    const modes = Array.isArray((c as any).modes)
      ? (c as any).modes.map((m: any) => ({ modeId: m.modeId, name: m.name }))
      : [];
    collById.set(c.id, { name: c.name, modes });
  }
  return variables.map(v => {
    const coll = collById.get(v.variableCollectionId);
    const valuesByMode = (v as any).valuesByMode as
      | Record<string, unknown>
      | undefined;
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
      source: 'preexisting' as const,
    };
  });
}

/**
 * Compute the canonical fingerprint of a live Variable for ID-stability
 * checking. Mirrors `computeVariableIdempotencyKey` in the ensure_variable
 * pipeline so a freshly created variable's `_ryow.fingerprint` matches
 * what this function will return on a subsequent re-read.
 *
 * Important: `valuesByMode` uses MODE IDS as keys here, not mode NAMES.
 * The ensure_variable handler already canonicalizes to mode IDs before
 * computing the key (see varHandlers.ts:516-525), so the two computations
 * agree as long as the same canonicalization is applied. Skipped when the
 * caller did not pass `expected_fingerprint`.
 */
function computeLiveFingerprint(variable: Variable): string {
  return computeVariableIdempotencyKey({
    collection_id: variable.variableCollectionId,
    name: variable.name,
    type: variable.resolvedType as 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
    values_by_mode: (variable as any).valuesByMode || {},
  });
}

/**
 * Run Phase 0 resolution on a strict-mode binding input. The caller (e.g.
 * handleSetFill) decides whether to invoke this — bare-name rejection is
 * gated on 'strict' only. Object-form inputs flow through the resolver in
 * any mode (they're additive — the LLM can opt in any time).
 *
 * Spec §3.2:
 *   - `{variable_id}` → look up; STALE_VARIABLE_ID if missing or expected_*
 *     mismatch.
 *   - `{collection_id, name, type}` → look up; AMBIGUOUS / NOT_FOUND if 2+ / 0.
 *   - `{color}` → passthrough hex.
 */
export async function resolveStrictBinding(
  input: unknown,
  context?: { tool: string; node_id?: string; bind_field?: 'fill' | 'stroke' },
): Promise<StrictResolveResult> {
  // ── Bare-name string ──
  if (isBareNameString(input)) {
    const bareName = input.slice(1);
    return {
      kind: 'reject',
      code: 'BARE_NAME_REJECTED_PHASE2',
      message:
        `Bare-name binding "${input}" is not allowed in Phase 2 strict mode. ` +
        `Pass either {variable_id: "VariableID:..."} or ` +
        `{collection_id: "VariableCollectionId:...", name: "${bareName}", type: "<COLOR|FLOAT|STRING|BOOLEAN>"} ` +
        `as the structured fill argument. See variable-resolver-design §3.2.`,
      recommended_next_action: {
        tool: 'list_variables',
        args: { filter: bareName },
      },
    };
  }

  // ── Color input ──
  if (isColorInput(input)) {
    return { kind: 'color', hex: input.color };
  }

  // ── ID-form ──
  if (isByIdInput(input)) {
    const variable = await figma.variables.getVariableByIdAsync(input.variable_id);
    if (!variable) {
      return {
        kind: 'reject',
        code: 'STALE_VARIABLE_ID',
        message:
          `Variable ${input.variable_id} not found. Possibly deleted between turns. No binding applied.`,
        recommended_next_action: null,
      };
    }
    // Optional ID-stability assertion (spec §3.2 / Critical 1).
    if (typeof input.expected_name === 'string' && variable.name !== input.expected_name) {
      return {
        kind: 'reject',
        code: 'STALE_VARIABLE_ID',
        message:
          `Variable ${input.variable_id} renamed: expected "${input.expected_name}", live name is "${variable.name}". ` +
          `No binding applied — re-discover the intended variable via list_variables.`,
        actual_name: variable.name,
        recommended_next_action: {
          tool: 'list_variables',
          args: { filter: input.expected_name },
        },
      };
    }
    if (typeof input.expected_fingerprint === 'string') {
      const live = computeLiveFingerprint(variable);
      if (live !== input.expected_fingerprint) {
        return {
          kind: 'reject',
          code: 'STALE_VARIABLE_ID',
          message:
            `Variable ${input.variable_id} fingerprint drift: expected ${input.expected_fingerprint.slice(0, 8)}…, ` +
            `live ${live.slice(0, 8)}…. The variable's name, collection, or values_by_mode changed since the assertion was captured. ` +
            `No binding applied.`,
          actual_fingerprint: live,
          actual_name: variable.name,
          recommended_next_action: null,
        };
      }
    }
    return { kind: 'variable', variable };
  }

  // ── Triple-form ──
  if (isByTripleInput(input)) {
    const matches = await findVariablesByTriple(input.collection_id, input.name, input.type);
    if (matches.length === 0) {
      return {
        kind: 'reject',
        code: 'VARIABLE_NOT_FOUND',
        message:
          `No ${input.type} variable named "${input.name}" exists in collection ${input.collection_id}. ` +
          `Create it via ensure_variable, or check the triple via list_variables.`,
        recommended_next_action: {
          tool: 'ensure_variable',
          args: {
            collection_id: input.collection_id,
            name: input.name,
            type: input.type,
            // Caller fills values_by_mode after deciding what each mode
            // should hold — surfaced as a hint, not a complete recipe.
            values_by_mode: {},
          },
        },
        candidates: [],
      };
    }
    if (matches.length > 1) {
      // Per spec §4.1.b, ambiguity is a hard fail in strict mode (separate
      // from Phase 1's AMBIGUOUS_NAME_AUTOPICK soft warning, which still
      // binds the first match).
      return {
        kind: 'reject',
        code: 'AMBIGUOUS_VARIABLE_REFERENCE',
        message:
          `${matches.length} ${input.type} variables match name "${input.name}" in collection ${input.collection_id}. ` +
          `Pass {variable_id} explicitly to disambiguate. No binding applied.`,
        recommended_next_action: {
          tool: context?.tool === 'set_stroke' ? 'set_stroke' : 'set_fill',
          args: {
            ...(context?.node_id ? { node: context.node_id } : {}),
            [context?.bind_field === 'stroke' ? 'stroke' : 'fill']: {
              variable_id: matches[0].id,
            },
          },
        },
        candidates: await buildCandidates(matches),
      };
    }
    return { kind: 'variable', variable: matches[0] };
  }

  return {
    kind: 'reject',
    code: 'INVALID_INPUT',
    message:
      `Unrecognized binding input shape. Expected one of: ` +
      `{variable_id}, {collection_id, name, type}, or {color}. Got: ${typeof input === 'object' ? JSON.stringify(input) : String(input)}`,
    recommended_next_action: null,
  };
}
