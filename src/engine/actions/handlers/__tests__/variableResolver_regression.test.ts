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
  });

  it('PHASE 1 (warn_pick_record): bare-name "$Text/Primary" still silently picks the orphan, BUT now emits AMBIGUOUS_NAME_AUTOPICK with full candidate list', async () => {
    // The LLM just created FRESH_VAR (id 1894:4930) earlier this turn,
    // and now passes a bare-name token. Phase 1 keeps backward-compat
    // silent-pick semantics (still binds first match) BUT surfaces a
    // warning so the LLM can self-correct on the next turn (spec §5.1).
    // The runtime emits a corresponding `ambiguous_autopick` event for
    // dev-bridge auditing.
    const node = mockNode();

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    // Phase 1: silent-pick still happens — orphan wins, fresh loses.
    // (Phase 2 will reject bare-name and require ID-form or
    // (collection_id, name, type) triple.)
    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe(ORPHAN_VAR.id);
    expect(lastBoundVariable!.id).not.toBe(FRESH_VAR.id);

    // NEW (Phase 1 warn_pick_record): warning surfaces every candidate so
    // the agent / dev-bridge audit catches the silent-pick.
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
