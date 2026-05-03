/**
 * @file strictResolver.test.ts
 * @description Phase 2 step 5+6 — Phase 0 strict resolver tests.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.2 / §4.1 / §5.3.
 *
 * Resolver itself is mode-agnostic (it always resolves the input shape), but
 * the bare-name reject is intrinsic to the input form. Tests exercise:
 *
 *   - Bare-name strings → BARE_NAME_REJECTED_PHASE2 (always — caller
 *     decides not to invoke this resolver in non-strict modes).
 *   - {variable_id} → 'variable' result; assertion failures map to
 *     STALE_VARIABLE_ID with the right reason discriminator.
 *   - {collection_id, name, type} → 'variable' on unique match;
 *     AMBIGUOUS_VARIABLE_REFERENCE on 2+; VARIABLE_NOT_FOUND on 0.
 *   - {color: hex} → 'color' passthrough.
 *
 * Mocking philosophy (per docs/TESTING.md): only the figma.variables surface
 * the resolver consults. Node creation, fonts, layout — not touched.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { resolveStrictBinding } from '../strictResolver';
import { computeVariableIdempotencyKey } from '../../../agent/tools/idempotency';

// ── Fixtures ─────────────────────────────────────────────────────────────

const COLL_A = {
  id: 'VariableCollectionId:1:1',
  name: 'Theme',
  modes: [{ modeId: 'm:light', name: 'Light' }, { modeId: 'm:dark', name: 'Dark' }],
};
const COLL_B = {
  id: 'VariableCollectionId:2:2',
  name: 'Old Theme',
  modes: [{ modeId: 'm:base', name: 'Base' }],
};

function buildVariable(overrides: {
  id: string;
  name: string;
  collection_id: string;
  type?: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  values_by_mode?: Record<string, unknown>;
}): Variable {
  return {
    id: overrides.id,
    name: overrides.name,
    variableCollectionId: overrides.collection_id,
    resolvedType: (overrides.type ?? 'COLOR') as Variable['resolvedType'],
    valuesByMode: overrides.values_by_mode ?? {},
    getPluginData: vi.fn(() => ''),
  } as unknown as Variable;
}

function stubFigmaVariables(variables: Variable[], collections = [COLL_A, COLL_B]) {
  vi.stubGlobal('figma', {
    variables: {
      getLocalVariablesAsync: vi.fn(async () => variables),
      getLocalVariableCollectionsAsync: vi.fn(async () => collections),
      getVariableByIdAsync: vi.fn(async (id: string) =>
        variables.find(v => v.id === id) ?? null,
      ),
      getVariableCollectionByIdAsync: vi.fn(async (id: string) =>
        collections.find(c => c.id === id) ?? null,
      ),
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── Bare-name reject ─────────────────────────────────────────────────────

describe('resolveStrictBinding — bare-name reject', () => {
  it('rejects "$Brand/600" with BARE_NAME_REJECTED_PHASE2', async () => {
    stubFigmaVariables([]);
    const r = await resolveStrictBinding('$Brand/600', { tool: 'set_fill', node_id: 'n:1' });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('BARE_NAME_REJECTED_PHASE2');
    expect(r.message).toContain('strict mode');
    expect(r.recommended_next_action).toEqual({
      tool: 'list_variables',
      args: { filter: 'Brand/600' },
    });
  });
});

// ── ID-form ──────────────────────────────────────────────────────────────

describe('resolveStrictBinding — {variable_id} form', () => {
  it('accepts a valid variable_id', async () => {
    const v = buildVariable({ id: 'VariableID:1:5', name: 'Text/Primary', collection_id: COLL_A.id });
    stubFigmaVariables([v]);

    const r = await resolveStrictBinding({ variable_id: 'VariableID:1:5' });
    expect(r.kind).toBe('variable');
    if (r.kind !== 'variable') return;
    expect(r.variable.id).toBe('VariableID:1:5');
  });

  it('returns STALE_VARIABLE_ID when variable does not exist', async () => {
    stubFigmaVariables([]);
    const r = await resolveStrictBinding({ variable_id: 'VariableID:9:9' });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('STALE_VARIABLE_ID');
    expect(r.message).toContain('not found');
  });

  it('validates expected_name and rejects on rename drift', async () => {
    const v = buildVariable({ id: 'VariableID:1:5', name: 'Text/Primary', collection_id: COLL_A.id });
    stubFigmaVariables([v]);

    const r = await resolveStrictBinding({
      variable_id: 'VariableID:1:5',
      expected_name: 'Text/Old',
    });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('STALE_VARIABLE_ID');
    expect(r.actual_name).toBe('Text/Primary');
    expect(r.message).toContain('renamed');
  });

  it('validates expected_fingerprint and rejects on value drift', async () => {
    // Variable has `Light: #FFF`; agent's expected fingerprint was captured
    // when the variable held `Light: #000`. Fingerprint mismatch fires.
    const v = buildVariable({
      id: 'VariableID:1:5',
      name: 'Text/Primary',
      collection_id: COLL_A.id,
      values_by_mode: { 'm:light': '#FFFFFF' },
    });
    stubFigmaVariables([v]);

    const stale = computeVariableIdempotencyKey({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { 'm:light': '#000000' },
    });

    const r = await resolveStrictBinding({
      variable_id: 'VariableID:1:5',
      expected_fingerprint: stale,
    });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('STALE_VARIABLE_ID');
    expect(r.actual_fingerprint).toBeTruthy();
    expect(r.message).toContain('fingerprint drift');
  });

  it('passes when expected_fingerprint matches live state', async () => {
    const valuesByMode = { 'm:light': '#FFFFFF', 'm:dark': '#000000' };
    const v = buildVariable({
      id: 'VariableID:1:5',
      name: 'Text/Primary',
      collection_id: COLL_A.id,
      values_by_mode: valuesByMode,
    });
    stubFigmaVariables([v]);

    const fingerprint = computeVariableIdempotencyKey({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: valuesByMode,
    });

    const r = await resolveStrictBinding({
      variable_id: 'VariableID:1:5',
      expected_fingerprint: fingerprint,
    });
    expect(r.kind).toBe('variable');
  });
});

// ── Triple-form ──────────────────────────────────────────────────────────

describe('resolveStrictBinding — {collection_id, name, type} form', () => {
  it('resolves to a single match when triple is unique', async () => {
    const v = buildVariable({ id: 'VariableID:1:5', name: 'Text/Primary', collection_id: COLL_A.id });
    stubFigmaVariables([v]);

    const r = await resolveStrictBinding({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });
    expect(r.kind).toBe('variable');
    if (r.kind !== 'variable') return;
    expect(r.variable.id).toBe('VariableID:1:5');
  });

  it('returns AMBIGUOUS_VARIABLE_REFERENCE when 2+ match', async () => {
    // Two same-name COLOR variables in the SAME collection (Figma allows this
    // in some flows — exercises hard-fail path).
    const v1 = buildVariable({ id: 'VariableID:1:5', name: 'Text/Primary', collection_id: COLL_A.id });
    const v2 = buildVariable({ id: 'VariableID:1:6', name: 'Text/Primary', collection_id: COLL_A.id });
    stubFigmaVariables([v1, v2]);

    const r = await resolveStrictBinding(
      { collection_id: COLL_A.id, name: 'Text/Primary', type: 'COLOR' },
      { tool: 'set_fill', node_id: 'n:1', bind_field: 'fill' },
    );
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('AMBIGUOUS_VARIABLE_REFERENCE');
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates!.map(c => c.variable_id).sort()).toEqual(['VariableID:1:5', 'VariableID:1:6']);
    expect(r.recommended_next_action?.tool).toBe('set_fill');
  });

  it('returns VARIABLE_NOT_FOUND when 0 match', async () => {
    stubFigmaVariables([
      buildVariable({ id: 'VariableID:9:9', name: 'Other', collection_id: COLL_A.id }),
    ]);

    const r = await resolveStrictBinding({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('VARIABLE_NOT_FOUND');
    expect(r.recommended_next_action?.tool).toBe('ensure_variable');
    expect(r.candidates).toEqual([]);
  });

  it('does not match across collections — same name in another collection is NOT a hit', async () => {
    const v = buildVariable({ id: 'VariableID:2:5', name: 'Text/Primary', collection_id: COLL_B.id });
    stubFigmaVariables([v]);

    const r = await resolveStrictBinding({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('VARIABLE_NOT_FOUND');
  });

  it('does not match across types — same name FLOAT does not satisfy COLOR query', async () => {
    const v = buildVariable({
      id: 'VariableID:1:7', name: 'Text/Primary', collection_id: COLL_A.id, type: 'FLOAT',
    });
    stubFigmaVariables([v]);

    const r = await resolveStrictBinding({
      collection_id: COLL_A.id,
      name: 'Text/Primary',
      type: 'COLOR',
    });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('VARIABLE_NOT_FOUND');
  });
});

// ── Color form ───────────────────────────────────────────────────────────

describe('resolveStrictBinding — {color} form', () => {
  it('passes through a hex color', async () => {
    stubFigmaVariables([]);
    const r = await resolveStrictBinding({ color: '#FF0000' });
    expect(r.kind).toBe('color');
    if (r.kind !== 'color') return;
    expect(r.hex).toBe('#FF0000');
  });
});

// ── Invalid input ────────────────────────────────────────────────────────

describe('resolveStrictBinding — invalid input', () => {
  it('rejects unrecognized object shapes', async () => {
    stubFigmaVariables([]);
    const r = await resolveStrictBinding({ wrong_field: 'x' });
    expect(r.kind).toBe('reject');
    if (r.kind !== 'reject') return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});
