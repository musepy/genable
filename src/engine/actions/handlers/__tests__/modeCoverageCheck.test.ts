/**
 * @file modeCoverageCheck.test.ts
 * @description Tests for write-time mode-coverage validation.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §6.
 *
 * Mocking philosophy (per docs/TESTING.md): only the figma.* surface
 * `findMissingModesAsync` actually consults — getVariableCollectionByIdAsync.
 * The Variable / SceneNode arguments are constructed inline as plain objects
 * with the few fields the checker reads (`valuesByMode`, `variableCollectionId`,
 * `getPluginData`, `resolvedVariableModes`).
 */

import { vi, describe, it, expect } from 'vitest';
import {
  checkModeCoverage,
  validateFallbackReason,
  PLUGIN_DATA_MODE_COVERAGE,
} from '../modeCoverageCheck';

// ── Fixture helpers ───────────────────────────────────────────────────────

interface FixtureOpts {
  /** Modes the variable has explicit values for. */
  definedModes: string[];
  /** All modes in the collection. */
  collectionModes: string[];
  /** Which mode the node renders in (defaults to first collection mode). */
  resolvedModeName?: string;
  /** Plugin data on the variable — defaults to "all". */
  pluginData?: Record<string, string>;
}

function setupFixture(opts: FixtureOpts) {
  const collectionId = 'VariableCollectionId:1:1';
  const modes = opts.collectionModes.map((name, i) => ({
    modeId: `${collectionId}:m${i}`,
    name,
  }));
  const resolvedModeName = opts.resolvedModeName ?? opts.collectionModes[0];
  const resolvedMode = modes.find(m => m.name === resolvedModeName)!;

  const valuesByMode: Record<string, unknown> = {};
  for (const name of opts.definedModes) {
    const m = modes.find(mm => mm.name === name);
    if (m) valuesByMode[m.modeId] = '#FFFFFF';
  }

  const collection = { id: collectionId, name: 'Theme', modes };
  vi.stubGlobal('figma', {
    variables: {
      getVariableCollectionByIdAsync: vi.fn(async (id: string) =>
        id === collectionId ? collection : null,
      ),
    },
  });

  const variable = {
    id: 'VariableID:1:5',
    name: 'Text/Primary',
    variableCollectionId: collectionId,
    resolvedType: 'COLOR' as const,
    valuesByMode,
    getPluginData(key: string): string {
      return opts.pluginData?.[key] ?? '';
    },
  } as unknown as Variable;

  const node = {
    id: 'node:1',
    type: 'FRAME',
    resolvedVariableModes: { [collectionId]: resolvedMode.modeId },
  } as unknown as SceneNode;

  return { node, variable, collection };
}

describe('checkModeCoverage — happy path', () => {
  it('returns ok when variable has all modes', async () => {
    const { node, variable } = setupFixture({
      collectionModes: ['Light', 'Dark'],
      definedModes: ['Light', 'Dark'],
      resolvedModeName: 'Light',
    });
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('pass');
  });

  it('returns ok when target mode is covered (other modes missing is OK at write time)', async () => {
    // Spec §6.1: only fail when the *target* render mode is missing. Other
    // missing modes are future hazards but not blockers right now.
    const { node, variable } = setupFixture({
      collectionModes: ['Light', 'Dark', 'Midnight'],
      definedModes: ['Light'],            // Dark + Midnight missing
      resolvedModeName: 'Light',          // node renders in Light → covered
    });
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('pass');
  });
});

describe('checkModeCoverage — failure path (mode_coverage_required="all")', () => {
  it('returns fail with missing_modes when target mode is not covered', async () => {
    const { node, variable } = setupFixture({
      collectionModes: ['Light', 'Dark', 'Midnight'],
      definedModes: ['Light'],
      resolvedModeName: 'Midnight',       // node renders in Midnight → missing
    });
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    // Reports ALL missing modes for diagnostic value (Dark + Midnight).
    expect(result.missing_modes.sort()).toEqual(['Dark', 'Midnight']);
    expect(result.variable_id).toBe('VariableID:1:5');
    expect(result.variable_name).toBe('Text/Primary');
    expect(result.collection_id).toBe('VariableCollectionId:1:1');
  });

  it('defaults to "all" when no plugin data is set (legacy variables behave conservatively)', async () => {
    const { node, variable } = setupFixture({
      collectionModes: ['Light', 'Dark'],
      definedModes: ['Light'],
      resolvedModeName: 'Dark',
      pluginData: {},                     // no key set
    });
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fail');
  });
});

describe('checkModeCoverage — opt-in-fallback', () => {
  it('returns kind:"fallback" with FALLBACK_BINDING data when variable opts into fallback', async () => {
    const { node, variable } = setupFixture({
      collectionModes: ['Light', 'Dark'],
      definedModes: ['Light'],
      resolvedModeName: 'Dark',
      pluginData: { [PLUGIN_DATA_MODE_COVERAGE]: 'opt-in-fallback' },
    });
    const result = await checkModeCoverage(node, variable);
    expect(result.kind).toBe('fallback');
    if (result.kind !== 'fallback') return;
    expect(result.missing_modes).toEqual(['Dark']);
    expect(result.mode_coverage_required).toBe('opt-in-fallback');
  });
});

// Note: historical 'phase1' / 'strict' enum values were removed in the May
// 2026 strict-mode cleanup. The check now runs unconditionally on every
// variable bind call (no runtime gate).

describe('validateFallbackReason — structured phrase rule (codex Medium 8)', () => {
  it('rejects non-string', () => {
    const r = validateFallbackReason(undefined);
    expect(r.ok).toBe(false);
  });

  it('rejects empty / whitespace-only string', () => {
    expect(validateFallbackReason('').ok).toBe(false);
    expect(validateFallbackReason('   ').ok).toBe(false);
  });

  it('rejects unstructured prose without "fallback to <mode>"', () => {
    const r = validateFallbackReason('We just want a default value');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('fallback to');
  });

  it('accepts the structured phrase "fallback to Midnight"', () => {
    const r = validateFallbackReason(
      'Component is desktop-only; fallback to Desktop in Mobile mode.',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reason).toContain('fallback to Desktop');
  });

  it('is case-insensitive on the verb', () => {
    const r = validateFallbackReason('FALLBACK TO Light when Dark not specified');
    expect(r.ok).toBe(true);
  });
});
