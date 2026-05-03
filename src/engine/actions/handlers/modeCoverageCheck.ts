/**
 * @file modeCoverageCheck.ts
 * @description Phase 2 step 4 — write-time mode coverage validation for
 * variable bindings.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §6.
 *
 *   For every binding call:
 *     1. Read node.resolvedVariableModes for the variable's collection.
 *     2. Read variable.valuesByMode keys.
 *     3. If any mode in the resolved chain is missing from values → fail
 *        with MISSING_MODE_VALUES.
 *
 * Applies to ALL variable types (COLOR, FLOAT, STRING, BOOLEAN) — closes
 * codex Medium 7. The handler asks "given this variable + this target node,
 * will any rendered mode fall through to a fallback value?". If yes, the
 * binding is rejected unless the variable opted into fallback semantics
 * via `mode_coverage_required: 'opt-in-fallback'` (persisted on the variable
 * via setPluginData — see §6.2).
 *
 * Plumbing — runtime mode flag:
 *   The `agentBehaviorConfig.variableResolution` setting (phase1 /
 *   phase2-mode-coverage / phase2-strict / auto) reaches this main-thread
 *   module via a setter. AgentRuntime calls `setVariableResolutionMode()`
 *   in the sandbox; the IPC dispatcher mirrors the value into the main
 *   thread per-call from `_meta.variableResolution` on tool params (see
 *   `src/ipc/commands/index.ts` `dispatchCommand`).
 *
 * 'phase1' bypasses this check entirely (escape valve, §7.1).
 */

import type { Warning } from './types';
import type { VariableResolutionMode } from '../../agent/agentBehaviorConfig';

// Plugin data keys — see spec §6.2.
export const PLUGIN_DATA_MODE_COVERAGE = 'mode_coverage_required';
export const PLUGIN_DATA_FALLBACK_REASON = 'fallback_reason';

/** Allowed values for the persisted mode_coverage_required flag. */
export type ModeCoverageRequired = 'all' | 'opt-in-fallback';

/**
 * Result of a coverage check. Either:
 *  - `kind: 'pass'` — bind freely
 *  - `kind: 'fallback'` — bind, but emit FALLBACK_BINDING warning (variable
 *    is opt-in-fallback)
 *  - `kind: 'fail'` — DO NOT bind, surface MISSING_MODE_VALUES upward as
 *    a structured error envelope.
 */
export type ModeCoverageResult =
  | { kind: 'pass' }
  | {
      kind: 'fallback';
      missing_modes: string[];
      mode_coverage_required: 'opt-in-fallback';
    }
  | {
      kind: 'fail';
      missing_modes: string[];
      collection_id: string;
      variable_id: string;
      variable_name: string;
    };

// ── Module-level resolution-mode state ─────────────────────────────────────
//
// The agent runtime sets this once at construction; the IPC dispatcher also
// updates it per-call from `_meta.variableResolution` (so cross-thread sync
// works without a dedicated init IPC). Default mirrors AgentBehaviorConfig
// — the constant is duplicated here intentionally to avoid a circular import
// on agent → handlers → agent.

let currentResolutionMode: VariableResolutionMode = 'phase2-mode-coverage';

/**
 * Set the active variable-resolver phase. Called by AgentRuntime at
 * construction and by the IPC dispatcher per-call. Tests can call this
 * directly to flip the mode without spinning up an AgentRuntime.
 */
export function setVariableResolutionMode(mode: VariableResolutionMode): void {
  currentResolutionMode = mode;
}

/** Read the active variable-resolver phase. */
export function getVariableResolutionMode(): VariableResolutionMode {
  return currentResolutionMode;
}

/**
 * Read the persisted `mode_coverage_required` flag for a variable. Returns
 * `'all'` (the default) when no plugin data is present, so legacy variables
 * created before Phase 2 step 4 shipped behave conservatively.
 */
export function readModeCoverageRequired(variable: Variable): ModeCoverageRequired {
  try {
    const raw = variable.getPluginData(PLUGIN_DATA_MODE_COVERAGE);
    if (raw === 'opt-in-fallback') return 'opt-in-fallback';
    return 'all';
  } catch {
    return 'all';
  }
}

/**
 * Validate `fallback_reason` against the structured-phrase rule (spec §6.2):
 * "fallback to <mode_name>". Returns the trimmed reason on success, an
 * error message on failure.
 */
export function validateFallbackReason(
  reason: unknown,
): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof reason !== 'string') {
    return {
      ok: false,
      error:
        'fallback_reason is required when mode_coverage_required="opt-in-fallback" — must contain the structured phrase "fallback to <mode_name>".',
    };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: 'fallback_reason must be a non-empty string containing "fallback to <mode_name>".',
    };
  }
  // Greppable phrase: "fallback to <something>". Case-insensitive on the
  // verb, but the mode name capture must be at least one non-whitespace char.
  if (!/\bfallback\s+to\s+\S/i.test(trimmed)) {
    return {
      ok: false,
      error:
        'fallback_reason must contain the structured phrase "fallback to <mode_name>" (machine-greppable). ' +
        'Example: "Component is desktop-only; fallback to Desktop in Mobile mode."',
    };
  }
  return { ok: true, reason: trimmed };
}

/**
 * Look up the collection, then compute the set of modes the variable lacks
 * values for in the target node's resolved-mode chain.
 *
 * Returns `null` when:
 *   - the variable has values for every mode in its collection, OR
 *   - the variable lacks values for some modes but the target node's
 *     resolved mode for this collection IS covered (no current render hazard).
 *
 * Returns `{missing, collection_id, collection_name}` when the binding would
 * fall through at the target's actual render mode.
 */
export async function findMissingModesAsync(
  node: SceneNode,
  variable: Variable,
): Promise<{ missing: string[]; collection_id: string; collection_name: string } | null> {
  const collectionId = variable.variableCollectionId;

  // Read the variable's mode coverage (mode IDs that have explicit values).
  const valuesByMode = variable.valuesByMode || {};
  const definedModeIds = new Set(Object.keys(valuesByMode));

  // Read the node's resolved mode for the variable's collection.
  // `node.resolvedVariableModes` returns a Record<VariableCollectionId, modeId>.
  // For modes not in the chain, the node falls back to the collection's
  // default (first) mode.
  const resolvedModesMap: Record<string, string> | undefined =
    (node as any).resolvedVariableModes;

  // Look up the collection to get its full mode list.
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    // Cannot validate — return null (treat as pass) and let the binding
    // fail downstream if it really is broken. This is a "missing collection"
    // case, not a missing-mode case.
    return null;
  }

  const modeIdToName = new Map<string, string>();
  for (const m of collection.modes) modeIdToName.set(m.modeId, m.name);

  // Determine which mode the node will resolve to. If node has an explicit
  // resolved mode for this collection, use it. Otherwise the node resolves
  // to the collection's default mode (first listed).
  const targetModeId = resolvedModesMap?.[collectionId] ?? collection.modes[0]?.modeId;

  // Per spec §6.1: "If any mode in the resolved chain is missing from values
  // → fail." The "resolved chain" for a single node + collection is just the
  // one mode that the node will render in. But to give the LLM useful
  // diagnostic data, we report ALL modes in the collection that lack values
  // — that's the full set of modes the variable would fail in if the user
  // ever switched mode.
  //
  // Spec language is "any mode in the resolved chain", which on a leaf node
  // is one mode. We use the broader interpretation (all collection modes)
  // because the audit value is higher; the binding still passes if the
  // *target* mode is covered.
  const missing: string[] = [];
  for (const m of collection.modes) {
    if (!definedModeIds.has(m.modeId)) {
      missing.push(m.name);
    }
  }
  if (missing.length === 0) return null;

  // Critical: only fail if the missing-mode set INCLUDES the target mode.
  // Other missing modes are not in this binding's render path; they're
  // future hazards but not blockers right now. (The audit data is still
  // valuable — surfaced via the warning's missing_modes list.)
  const targetModeName = targetModeId ? modeIdToName.get(targetModeId) : undefined;
  if (targetModeName && missing.includes(targetModeName)) {
    return {
      missing,
      collection_id: collectionId,
      collection_name: collection.name,
    };
  }

  // Target mode is covered — bind succeeds. We could still surface a
  // best-practice warning that other modes are uncovered; defer that
  // until we have a real signal it matters.
  return null;
}

/**
 * Glue: compute coverage result honoring `agentBehaviorConfig.variableResolution`
 * and the variable's `mode_coverage_required` plugin data.
 *
 * Returns a discriminated `ModeCoverageResult` that callers translate into
 * either a successful bind, a fallback-warning bind, or a hard-fail error
 * envelope.
 */
export async function checkModeCoverage(
  node: SceneNode,
  variable: Variable,
): Promise<ModeCoverageResult> {
  // Phase 1 escape valve: skip the check entirely.
  if (currentResolutionMode === 'phase1') {
    return { kind: 'pass' };
  }

  const result = await findMissingModesAsync(node, variable);
  if (!result) return { kind: 'pass' };

  const required = readModeCoverageRequired(variable);
  if (required === 'opt-in-fallback') {
    return {
      kind: 'fallback',
      missing_modes: result.missing,
      mode_coverage_required: 'opt-in-fallback',
    };
  }

  return {
    kind: 'fail',
    missing_modes: result.missing,
    collection_id: result.collection_id,
    variable_id: variable.id,
    variable_name: variable.name,
  };
}

/**
 * Build the canonical MISSING_MODE_VALUES warning payload that handlers
 * surface. Carries enough data for runtime event emission and structured
 * `recommended_next_action` reconstruction.
 *
 * NOTE: this is a Warning, not an error envelope — emitting the full §4.1.d
 * envelope happens at the IPC handler boundary. The handler converts this
 * warning into either a tool-level error string (when result.kind === 'fail')
 * or a non-fatal warning entry (when 'fallback').
 */
export function buildMissingModeValuesWarning(args: {
  node_id: string;
  variable_id: string;
  variable_name: string;
  collection_id: string;
  missing_modes: string[];
  values_by_mode_hint?: Record<string, string>;
}): Warning {
  return {
    code: 'MISSING_MODE_VALUES',
    severity: 'warning',
    message:
      `Variable ${args.variable_id} (${args.variable_name}) lacks values for modes: ` +
      `[${args.missing_modes.map(m => `'${m}'`).join(', ')}]. ` +
      `Node ${args.node_id} will render in one of these modes via mode chain. No binding applied.`,
    node_id: args.node_id,
    variable_id: args.variable_id,
    variable_name: args.variable_name,
    collection_id: args.collection_id,
    missing_modes: args.missing_modes,
  };
}

/**
 * Build the FALLBACK_BINDING warning emitted when an opt-in-fallback variable
 * is bound despite incomplete mode coverage. Carries the same diagnostic
 * data as MISSING_MODE_VALUES; the caller distinguishes by `code`.
 */
export function buildFallbackBindingWarning(args: {
  node_id: string;
  variable_id: string;
  variable_name: string;
  collection_id: string;
  missing_modes: string[];
  fallback_reason?: string;
}): Warning {
  return {
    code: 'FALLBACK_BINDING',
    severity: 'warning',
    message:
      `Variable ${args.variable_id} (${args.variable_name}) bound despite missing modes: ` +
      `[${args.missing_modes.map(m => `'${m}'`).join(', ')}]. ` +
      `Variable opted into fallback via mode_coverage_required="opt-in-fallback".`,
    node_id: args.node_id,
    variable_id: args.variable_id,
    variable_name: args.variable_name,
    collection_id: args.collection_id,
    missing_modes: args.missing_modes,
    fallback_reason: args.fallback_reason,
  };
}
