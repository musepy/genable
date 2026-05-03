/**
 * @file setStrictBinding.test.ts
 * @description Phase 2 step 5+6 — IPC-level tests for set_fill / set_stroke
 * strict-mode + structured-input behavior.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.2 / §5.3.
 *
 * What this verifies:
 *   - Default 'phase2-mode-coverage' mode keeps bare-name shorthands working
 *     (set_stroke "1 $Brand" still flows through, no rejection).
 *   - 'phase2-strict' mode rejects bare-name (BARE_NAME_REJECTED_PHASE2)
 *     before reaching handleEdit.
 *   - Structured object inputs ({variable_id} / {collection_id, name, type}
 *     / {color}) are translated to legacy edit({props}) calls so the
 *     downstream binding pipeline keeps working unchanged.
 *
 * Mocking philosophy:
 *   handleEdit is mocked so the test only exercises the strict-resolver
 *   shim + the schema translation. The figma.variables surface is mocked
 *   for the resolver's lookups only — minimal surface, no node/font logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../editHandler', () => ({
  handleEdit: vi.fn(async (params: any) => ({
    data: { changed: true, _passedParams: params },
  })),
}));

import { handleSetFill, handleSetStroke } from '../index';
import { handleEdit } from '../editHandler';
import { setVariableResolutionMode } from '../../../engine/actions/handlers/modeCoverageCheck';

const mockHandleEdit = vi.mocked(handleEdit);

const COLL = {
  id: 'VariableCollectionId:1:1',
  name: 'Theme',
  modes: [{ modeId: 'm:light', name: 'Light' }, { modeId: 'm:dark', name: 'Dark' }],
};

function makeVariable(opts: {
  id: string;
  name: string;
  collection_id?: string;
  type?: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
}): Variable {
  return {
    id: opts.id,
    name: opts.name,
    variableCollectionId: opts.collection_id ?? COLL.id,
    resolvedType: (opts.type ?? 'COLOR') as Variable['resolvedType'],
    valuesByMode: {},
  } as unknown as Variable;
}

function stubFigmaVariables(variables: Variable[], collections = [COLL]) {
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
  mockHandleEdit.mockClear();
  vi.unstubAllGlobals();
  setVariableResolutionMode('phase2-mode-coverage');
});

// ─── set_fill ──────────────────────────────────────────────────────────────

describe('handleSetFill — phase2-mode-coverage (default)', () => {
  it('passes bare-name string through unchanged (backward compat)', async () => {
    stubFigmaVariables([]);
    await handleSetFill({ node: '1:2', bg: '$Bg/Surface' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { bg: '$Bg/Surface' },
    });
  });

  it('passes hex string through unchanged', async () => {
    stubFigmaVariables([]);
    await handleSetFill({ node: '1:2', fill: '#333333' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { fill: '#333333' },
    });
  });

  it('translates {variable_id} object form to qualified bare-name', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Bg/Surface' }),
    ]);
    await handleSetFill({
      node: '1:2',
      bg: { variable_id: 'VariableID:1:5' },
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { bg: '$Theme/Bg/Surface' },
    });
  });

  it('translates {collection_id, name, type} triple to qualified bare-name', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Bg/Surface' }),
    ]);
    await handleSetFill({
      node: '1:2',
      bg: { collection_id: COLL.id, name: 'Bg/Surface', type: 'COLOR' },
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { bg: '$Theme/Bg/Surface' },
    });
  });

  it('translates {color: hex} to raw hex', async () => {
    stubFigmaVariables([]);
    await handleSetFill({ node: '1:2', fill: { color: '#FF0000' } });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { fill: '#FF0000' },
    });
  });
});

describe('handleSetFill — phase2-strict', () => {
  beforeEach(() => setVariableResolutionMode('phase2-strict'));

  it('rejects bare-name string with BARE_NAME_REJECTED_PHASE2', async () => {
    stubFigmaVariables([]);
    const result = await handleSetFill({ node: '1:2', bg: '$Bg/Surface' });

    expect(result.error).toContain('strict mode');
    expect(result.data?.code).toBe('BARE_NAME_REJECTED_PHASE2');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('still accepts hex strings (no rejection)', async () => {
    stubFigmaVariables([]);
    await handleSetFill({ node: '1:2', fill: '#333333' });

    expect(mockHandleEdit).toHaveBeenCalled();
  });

  it('accepts {variable_id} object form', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Bg/Surface' }),
    ]);
    const result = await handleSetFill({
      node: '1:2',
      bg: { variable_id: 'VariableID:1:5' },
    });

    expect(result.error).toBeUndefined();
    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { bg: '$Theme/Bg/Surface' },
    });
  });

  it('rejects {variable_id} when expected_name mismatches', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Bg/Surface' }),
    ]);
    const result = await handleSetFill({
      node: '1:2',
      bg: { variable_id: 'VariableID:1:5', expected_name: 'Old/Name' },
    });

    expect(result.data?.code).toBe('STALE_VARIABLE_ID');
    expect(result.data?.actual_name).toBe('Bg/Surface');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('returns AMBIGUOUS_VARIABLE_REFERENCE when triple matches 2+ variables', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Bg/Surface' }),
      makeVariable({ id: 'VariableID:1:6', name: 'Bg/Surface' }),
    ]);
    const result = await handleSetFill({
      node: '1:2',
      bg: { collection_id: COLL.id, name: 'Bg/Surface', type: 'COLOR' },
    });

    expect(result.data?.code).toBe('AMBIGUOUS_VARIABLE_REFERENCE');
    expect(result.data?.candidates).toHaveLength(2);
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('returns VARIABLE_NOT_FOUND when triple matches 0', async () => {
    stubFigmaVariables([]);
    const result = await handleSetFill({
      node: '1:2',
      bg: { collection_id: COLL.id, name: 'Missing', type: 'COLOR' },
    });

    expect(result.data?.code).toBe('VARIABLE_NOT_FOUND');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('accepts {color} form (raw hex passthrough)', async () => {
    stubFigmaVariables([]);
    const result = await handleSetFill({
      node: '1:2',
      fill: { color: '#00FF00' },
    });

    expect(result.error).toBeUndefined();
    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { fill: '#00FF00' },
    });
  });
});

// ─── set_stroke ────────────────────────────────────────────────────────────

describe('handleSetStroke — phase2-mode-coverage (default)', () => {
  it('passes shorthand string through unchanged (backward compat for hex)', async () => {
    stubFigmaVariables([]);
    await handleSetStroke({ node: '1:2', stroke: '1 #E0E0E0' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 #E0E0E0' },
    });
  });

  it('passes shorthand string with bare-name through (backward compat)', async () => {
    stubFigmaVariables([]);
    // The shorthand is allowed in non-strict mode; expandShorthands treats
    // the $-prefixed part as a variable reference (after the parser fix in
    // step 6) so the binding actually flows through. The IPC handler does
    // NOT reject in this mode.
    await handleSetStroke({ node: '1:2', stroke: '1 $Brand/600' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 $Brand/600' },
    });
  });

  it('translates color={variable_id} into qualified bare-name shorthand', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Border/Default' }),
    ]);
    await handleSetStroke({
      node: '1:2',
      color: { variable_id: 'VariableID:1:5' },
      weight: 1,
      align: 'inside',
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 $Theme/Border/Default inside' },
    });
  });

  it('translates color={collection_id, name, type} triple', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Border/Default' }),
    ]);
    await handleSetStroke({
      node: '1:2',
      color: { collection_id: COLL.id, name: 'Border/Default', type: 'COLOR' },
      weight: 2,
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '2 $Theme/Border/Default' },
    });
  });
});

describe('handleSetStroke — phase2-strict', () => {
  beforeEach(() => setVariableResolutionMode('phase2-strict'));

  it('rejects shorthand "1 $Brand/600" with BARE_NAME_REJECTED_PHASE2', async () => {
    stubFigmaVariables([]);
    const result = await handleSetStroke({ node: '1:2', stroke: '1 $Brand/600' });

    expect(result.error).toContain('Phase 2 strict mode');
    expect(result.data?.code).toBe('BARE_NAME_REJECTED_PHASE2');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('accepts hex-only shorthand "1 #E0E0E0 inside"', async () => {
    stubFigmaVariables([]);
    await handleSetStroke({ node: '1:2', stroke: '1 #E0E0E0 inside' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 #E0E0E0 inside' },
    });
  });

  it('accepts color={variable_id} structured form', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Border/Default' }),
    ]);
    const result = await handleSetStroke({
      node: '1:2',
      color: { variable_id: 'VariableID:1:5' },
      weight: 1,
    });

    expect(result.error).toBeUndefined();
    expect(mockHandleEdit).toHaveBeenCalled();
  });

  it('rejects color={variable_id} with expected_fingerprint mismatch', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Border/Default' }),
    ]);
    const result = await handleSetStroke({
      node: '1:2',
      color: {
        variable_id: 'VariableID:1:5',
        expected_fingerprint: 'a'.repeat(64), // wrong fingerprint
      },
      weight: 1,
    });

    expect(result.data?.code).toBe('STALE_VARIABLE_ID');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('returns AMBIGUOUS_VARIABLE_REFERENCE when color triple matches 2+', async () => {
    stubFigmaVariables([
      makeVariable({ id: 'VariableID:1:5', name: 'Border/Default' }),
      makeVariable({ id: 'VariableID:1:6', name: 'Border/Default' }),
    ]);
    const result = await handleSetStroke({
      node: '1:2',
      color: { collection_id: COLL.id, name: 'Border/Default', type: 'COLOR' },
      weight: 1,
    });

    expect(result.data?.code).toBe('AMBIGUOUS_VARIABLE_REFERENCE');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });
});
