/**
 * @file variableResolver_regression.test.ts
 * @description Regression test for the stale-variable silent-pick bug.
 *
 * Bug doc: docs/knowledge/variable-resolver-design-2026-05.md §1
 *
 * Root cause (verified in code):
 *   src/engine/actions/handlers/variableBindingHandler.ts:33
 *
 *     // Fallback key: just "name" (backward compat when unambiguous)
 *     if (!varCache.has(v.name)) varCache.set(v.name, v as unknown as VariableValue);
 *
 *   When LLM passes a bare-name token like "$Text/Primary", findVariable does
 *   `cache.get("Text/Primary")`. If two variables share the same `name` field
 *   (one orphan from a prior session, one just created this turn), the cache
 *   only stores the FIRST encountered — silent first-wins.
 *
 *   Iteration order from `figma.variables.getLocalVariablesAsync()` is the
 *   driver. In practice the orphan tends to come first (older creation time)
 *   so the resolver picks the orphan.
 *
 * REGRESSION INTENT: this test documents the BUG. Once the §3 strict resolver
 * lands and rejects bare-name lookups (or returns AMBIGUOUS_VARIABLE_REFERENCE),
 * the assertions here must flip — see the inline TODO marker.
 *
 * Mocking philosophy (per docs/TESTING.md): mock only the specific figma.variables
 * surface the resolver consults — getLocalVariableCollectionsAsync,
 * getLocalVariablesAsync, setBoundVariableForPaint. We do NOT mock node creation,
 * fonts, layout, or any path the resolver does not touch.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  variableBindingHandler,
  invalidateVariableCache,
  setRyowCreatedThisTurn,
  clearRyowCreatedThisTurn,
} from '../variableBindingHandler';

// ── Fixture: two variables, same name, two different collections ────────────
//
// Collection A = "Old Theme" — orphan left over from a prior E2E session.
// Collection B = "Finance/Theme" — just created this turn.
// Both contain a COLOR variable named "Text/Primary".
//
// Iteration order in getLocalVariablesAsync mirrors what we observe in the
// real Figma file: orphans first (older creation), fresh variables last.

const ORPHAN_COLLECTION = {
  id: 'VariableCollectionId:1870:3000',
  name: 'Old Theme',
};
const FRESH_COLLECTION = {
  id: 'VariableCollectionId:1894:4900',
  name: 'Finance/Theme',
};

const ORPHAN_VAR = {
  id: 'VariableID:1870:3106',          // observed in trigger-1777742280329 logs
  name: 'Text/Primary',
  variableCollectionId: ORPHAN_COLLECTION.id,
  resolvedType: 'COLOR' as const,
};
const FRESH_VAR = {
  id: 'VariableID:1894:4930',          // the one the LLM JUST created this turn
  name: 'Text/Primary',
  variableCollectionId: FRESH_COLLECTION.id,
  resolvedType: 'COLOR' as const,
};

// ── Minimal figma.variables.* mock ───────────────────────────────────────────
//
// Only stubs the three calls the resolver pipeline reaches:
//   1. getLocalVariableCollectionsAsync — for collection name lookup
//   2. getLocalVariablesAsync           — populates the cache that has the bug
//   3. setBoundVariableForPaint         — used to bind COLOR vars to a fill;
//                                         we capture which variable it received

let lastBoundVariable: { id: string; name: string } | null = null;

vi.stubGlobal('figma', {
  variables: {
    getLocalVariableCollectionsAsync: vi
      .fn()
      .mockResolvedValue([ORPHAN_COLLECTION, FRESH_COLLECTION]),
    getLocalVariablesAsync: vi
      .fn()
      .mockResolvedValue([ORPHAN_VAR, FRESH_VAR]),
    // Phase 2 step 4 hook — mode-coverage check calls this to look up the
    // variable's collection and compute resolved-mode coverage. Returning
    // null here causes findMissingModesAsync to short-circuit (treat as
    // pass), which preserves the regression-test's focus on resolver
    // ambiguity rather than coverage. Fixtures define no `modes` field,
    // so a more elaborate mock would not exercise additional logic here.
    getVariableCollectionByIdAsync: vi.fn().mockResolvedValue(null),
    setBoundVariableForPaint: vi.fn(
      (basePaint: any, _field: 'color', variable: { id: string; name: string }) => {
        // Capture the variable the resolver picked. The real Figma API returns
        // a SolidPaint with boundVariables.color pointing to the variable —
        // we mimic just enough shape for the handler not to crash.
        lastBoundVariable = { id: variable.id, name: variable.name };
        return {
          ...basePaint,
          boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable.id } },
        };
      },
    ),
  },
});

// Minimal SceneNode mock — only `fills` setter is exercised when binding
// COLOR vars to fills. No layout, no children, no fonts.
function mockNode(): SceneNode {
  const node: any = {
    id: 'test:1',
    type: 'FRAME',
    fills: [],
  };
  return node as SceneNode;
}

describe('variableBindingHandler — stale variable silent-pick (REGRESSION)', () => {
  beforeEach(() => {
    invalidateVariableCache();
    lastBoundVariable = null;
    clearRyowCreatedThisTurn();
  });

  it('LEGACY (no RYOW context): bare-name "$Text/Primary" falls back to first match (orphan wins) and emits AMBIGUOUS_NAME_AUTOPICK', async () => {
    // When no RYOW snapshot is set (manual unit tests, internal callers
    // without an AgentRuntime / IPC dispatcher), the handler must preserve
    // legacy behavior — pick variables[0] (first by getLocalVariablesAsync
    // order, which is the orphan). The warning still surfaces every
    // candidate so the audit signal is unchanged.
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('AMBIGUOUS_NAME_AUTOPICK');
    const w = warnings[0] as any;
    expect(w.picked_variable_id).toBe(ORPHAN_VAR.id);
    expect(w.candidates).toHaveLength(2);

    // Candidates must include both the orphan AND the fresh variable so the
    // agent can recover on the next turn by passing the ID directly.
    const candidateIds = w.candidates.map((c: any) => c.variable_id).sort();
    expect(candidateIds).toEqual([FRESH_VAR.id, ORPHAN_VAR.id].sort());

    // Each candidate carries enough metadata for downstream auditing —
    // collection_name, type, mode_coverage. `source` defaults to "preexisting"
    // because the resolver runs in main-thread context with no RyowStore;
    // AgentRuntime enriches `source` to "created_this_turn" in afterToolExec.
    const orphanCand = w.candidates.find((c: any) => c.variable_id === ORPHAN_VAR.id);
    const freshCand = w.candidates.find((c: any) => c.variable_id === FRESH_VAR.id);
    expect(orphanCand.collection_name).toBe('Old Theme');
    expect(freshCand.collection_name).toBe('Finance/Theme');
    expect(orphanCand.type).toBe('COLOR');
  });

  it('RYOW tie-break: bare-name "$Text/Primary" picks the fresh variable when RYOW says it was created this turn (FIX)', async () => {
    // The bug: handler was picking variables[0] (orphan) even though the
    // AMBIGUOUS_NAME_AUTOPICK warning's `suggested_id` (set later by
    // AgentRuntime from RyowStore) pointed to FRESH_VAR. Resulting LLM
    // saw "should use X / actually used Y" disagreement and looped.
    //
    // Fix: when RYOW snapshot says FRESH_VAR was created this turn, the
    // handler picks FRESH_VAR over the orphan, so picked_variable_id
    // and (downstream) suggested_id naturally agree.
    setRyowCreatedThisTurn(new Set([FRESH_VAR.id]));
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(FRESH_VAR.id);
    expect(lastBoundVariable!.id).not.toBe(ORPHAN_VAR.id);

    // Warning still emitted (ambiguity still exists) — but picked_variable_id
    // now reflects the tie-broken pick, naturally agreeing with the
    // RyowStore-derived suggested_id downstream.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('AMBIGUOUS_NAME_AUTOPICK');
    const w = warnings[0] as any;
    expect(w.picked_variable_id).toBe(FRESH_VAR.id);
    expect(w.candidates).toHaveLength(2);
  });

  it('RYOW tie-break: empty RYOW set behaves identically to legacy (no RYOW context)', async () => {
    // Defensive: an explicit empty Set must not change behavior — handler
    // still picks variables[0]. Guards against a regression where the
    // filter returns [] but the code accidentally picks from the empty
    // filter result instead of falling back to variables[0].
    setRyowCreatedThisTurn(new Set());
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);

    expect(warnings).toHaveLength(1);
    const w = warnings[0] as any;
    expect(w.picked_variable_id).toBe(ORPHAN_VAR.id);
  });

  it('RYOW tie-break: RYOW set with only an unrelated id falls back to variables[0]', async () => {
    // RYOW ids that don't match any candidate must NOT change pick — handler
    // falls back to variables[0]. (Real-world scenario: RYOW carries a
    // recently-created variable from a different collection, unrelated to
    // the current bare-name lookup.)
    setRyowCreatedThisTurn(new Set(['VariableID:9999:9999']));
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);

    expect(warnings).toHaveLength(1);
    const w = warnings[0] as any;
    expect(w.picked_variable_id).toBe(ORPHAN_VAR.id);
  });

  it('RYOW tie-break: RYOW set with multiple ids picks the first match in `variables` order', async () => {
    // When RYOW says BOTH variables were created this turn, the filter
    // yields both — we then pick the FIRST in `variables` array order
    // (which mirrors getLocalVariablesAsync order). Documents the policy:
    // RYOW filters, then standard ordering picks within the filtered set.
    setRyowCreatedThisTurn(new Set([ORPHAN_VAR.id, FRESH_VAR.id]));
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(lastBoundVariable).not.toBeNull();
    // ORPHAN_VAR is first in getLocalVariablesAsync order (see fixture).
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);

    expect(warnings).toHaveLength(1);
    const w = warnings[0] as any;
    expect(w.picked_variable_id).toBe(ORPHAN_VAR.id);
  });

  it('REGRESSION: collection-qualified "$Old Theme/Text/Primary" correctly resolves to the orphan (sanity check that disambiguation key works)', async () => {
    // Sanity check: the cache *does* store collection-qualified keys
    // (variableBindingHandler.ts:31). Passing the qualified name
    // "Old Theme/Text/Primary" should hit the orphan deterministically —
    // confirming the disambiguation path works when the agent uses it.
    // The LLM doesn't reliably use this form, hence the bug.
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Old Theme/Text/Primary');

    expect(warnings).toEqual([]);
    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);
  });

  it('REGRESSION: collection-qualified "$Finance/Theme/Text/Primary" correctly resolves to the fresh variable', async () => {
    // Mirror of the above — confirms that *if* the agent qualified by
    // collection it would land on the fresh variable. The Phase 1 strict
    // resolver makes this form (or a (collection_id, name, type) triple)
    // mandatory.
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Finance/Theme/Text/Primary');

    expect(warnings).toEqual([]);
    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(FRESH_VAR.id);
  });
});

// ── Object-form resolver coverage ────────────────────────────────────────
//
// Same-name fixture, exercising the object-form resolver directly instead of
// variableBindingHandler. Object form is the parallel input shape (structured
// objects via {variable_id} or {collection_id, name, type}). The May 2026
// strict-mode cleanup removed the bare-name boundary check from this
// resolver — strings now flow through variableBindingHandler unchanged.

import { resolveStrictBinding } from '../strictResolver';

describe('strictResolver — same-name fixture', () => {
  it('object form: {collection_id, name, type} for the orphan resolves deterministically to the orphan', async () => {
    const result = await resolveStrictBinding({
      collection_id: ORPHAN_COLLECTION.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });

    expect(result.kind).toBe('variable');
    if (result.kind !== 'variable') return;
    expect(result.variable.id).toBe(ORPHAN_VAR.id);
  });

  it('object form: {collection_id, name, type} for the fresh collection resolves deterministically to the fresh variable', async () => {
    const result = await resolveStrictBinding({
      collection_id: FRESH_COLLECTION.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });

    expect(result.kind).toBe('variable');
    if (result.kind !== 'variable') return;
    expect(result.variable.id).toBe(FRESH_VAR.id);
  });
});
