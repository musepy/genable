/**
 * @file variableBindingHandler.test.ts
 * @description Phase 2 step 4 / 7 tests for the variable-binding handler.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §6 + §7.
 *
 * Covers:
 *   - Successful bind when mode coverage complete.
 *   - MISSING_MODE_VALUES warning when target mode not covered (default 'all').
 *   - FALLBACK_BINDING warning when variable opts into fallback.
 *
 * The regression test variableResolver_regression.test.ts already exercises
 * the multi-match autopick path; here we focus on coverage semantics.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  variableBindingHandler,
  invalidateVariableCache,
} from '../variableBindingHandler';
import {
  setVariableResolutionMode,
  PLUGIN_DATA_MODE_COVERAGE,
} from '../modeCoverageCheck';

// ── Fixture ────────────────────────────────────────────────────────────────
//
// Single COLOR variable in a Theme collection with Light + Dark modes.
// Tests vary which modes have explicit values + which mode the node renders in.

const COLLECTION = {
  id: 'VariableCollectionId:1:1',
  name: 'Theme',
  modes: [
    { modeId: 'm:light', name: 'Light' },
    { modeId: 'm:dark', name: 'Dark' },
  ],
};

interface FixtureOpts {
  /** Mode names with explicit values. */
  definedModes: string[];
  /** Plugin data on the variable. */
  pluginData?: Record<string, string>;
  /** Mode the node renders in (defaults to first collection mode). */
  resolvedModeName?: string;
}

let lastBoundVariable: { id: string; name: string } | null = null;

function setupFixture(opts: FixtureOpts) {
  const valuesByMode: Record<string, unknown> = {};
  for (const name of opts.definedModes) {
    const m = COLLECTION.modes.find(mm => mm.name === name);
    if (m) valuesByMode[m.modeId] = '#FFFFFF';
  }

  const variable = {
    id: 'VariableID:1:5',
    name: 'Text/Primary',
    variableCollectionId: COLLECTION.id,
    resolvedType: 'COLOR' as const,
    valuesByMode,
    getPluginData(key: string): string {
      return opts.pluginData?.[key] ?? '';
    },
  };

  vi.stubGlobal('figma', {
    variables: {
      getLocalVariableCollectionsAsync: vi.fn(async () => [COLLECTION]),
      getLocalVariablesAsync: vi.fn(async () => [variable]),
      getVariableCollectionByIdAsync: vi.fn(async (id: string) =>
        id === COLLECTION.id ? COLLECTION : null,
      ),
      setBoundVariableForPaint: vi.fn(
        (basePaint: any, _field: 'color', v: { id: string; name: string }) => {
          lastBoundVariable = { id: v.id, name: v.name };
          return {
            ...basePaint,
            boundVariables: { color: { type: 'VARIABLE_ALIAS', id: v.id } },
          };
        },
      ),
    },
  });

  const resolvedModeName = opts.resolvedModeName ?? COLLECTION.modes[0].name;
  const resolvedMode = COLLECTION.modes.find(m => m.name === resolvedModeName)!;
  const node = {
    id: 'node:1',
    type: 'FRAME',
    fills: [],
    resolvedVariableModes: { [COLLECTION.id]: resolvedMode.modeId },
  } as unknown as SceneNode;

  return { node, variable };
}

beforeEach(() => {
  invalidateVariableCache();
  lastBoundVariable = null;
  setVariableResolutionMode('mode-coverage');
});

describe('variableBindingHandler — Phase 2 step 4 mode coverage', () => {
  it('binds when mode coverage is complete (no warnings)', async () => {
    const { node } = setupFixture({
      definedModes: ['Light', 'Dark'],
      resolvedModeName: 'Light',
    });

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(warnings).toEqual([]);
    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe('VariableID:1:5');
  });

  it('fails MISSING_MODE_VALUES when target mode is missing (default "all")', async () => {
    const { node } = setupFixture({
      definedModes: ['Light'],            // Dark missing
      resolvedModeName: 'Dark',
      // pluginData absent → defaults to "all"
    });

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('MISSING_MODE_VALUES');
    const w = warnings[0] as any;
    expect(w.variable_id).toBe('VariableID:1:5');
    expect(w.node_id).toBe('node:1');
    expect(w.missing_modes).toEqual(['Dark']);

    // CRITICAL: hard-fail must NOT bind. Spec §6.1 — "No binding applied."
    expect(lastBoundVariable).toBeNull();
  });

  it('binds with FALLBACK_BINDING warning when variable opts into fallback', async () => {
    const { node } = setupFixture({
      definedModes: ['Light'],
      resolvedModeName: 'Dark',
      pluginData: { [PLUGIN_DATA_MODE_COVERAGE]: 'opt-in-fallback' },
    });

    const warnings = await variableBindingHandler.apply(node, 'fills', '$Text/Primary');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('FALLBACK_BINDING');
    const w = warnings[0] as any;
    expect(w.missing_modes).toEqual(['Dark']);

    // Fallback path STILL binds — it's an audit signal, not a block.
    expect(lastBoundVariable).not.toBeNull();
    expect(lastBoundVariable!.id).toBe('VariableID:1:5');
  });

  // Note: the historical 'phase1' escape valve test was removed when the
  // phased-rollout enum collapsed to two values post-cutover-revert. Both
  // 'mode-coverage' and 'strict' now run the coverage check; there is no
  // setting that bypasses it.
});
