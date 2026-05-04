/**
 * @file setStrictBinding.test.ts
 * @description IPC-level tests for set_fill / set_stroke object-form
 * (structured-input) behavior.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.2.
 *
 * What this verifies:
 *   - Bare-name string shorthands ($Coll/Name, "1 $Brand/600 inside") pass
 *     through to the legacy variableBindingHandler unchanged.
 *   - Structured object inputs ({variable_id} / {collection_id, name, type}
 *     / {color}) translate to legacy edit({props}) calls so the downstream
 *     binding pipeline keeps working.
 *   - Object-form failure modes (STALE_VARIABLE_ID,
 *     AMBIGUOUS_VARIABLE_REFERENCE, VARIABLE_NOT_FOUND) surface as error
 *     envelopes without invoking handleEdit.
 *
 * History: this file used to assert a 'strict' resolver mode that rejected
 * bare-name strings at the boundary (BARE_NAME_REJECTED_PHASE2). The strict
 * mode + the rejection envelope were removed in May 2026 — see
 * agentBehaviorConfig.ts header for context. Object-form parsing is preserved
 * as a parallel input shape for non-LLM callers.
 *
 * Mocking philosophy:
 *   handleEdit is mocked so the test only exercises the resolver shim + the
 *   schema translation. The figma.variables surface is mocked for the
 *   resolver's lookups only — minimal surface, no node/font logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../editHandler', () => ({
  handleEdit: vi.fn(async (params: any) => ({
    data: { changed: true, _passedParams: params },
  })),
}));

import { handleSetFill, handleSetStroke } from '../index';
import { handleEdit } from '../editHandler';

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
});

// ─── set_fill ──────────────────────────────────────────────────────────────

describe('handleSetFill — string passthrough', () => {
  it('passes bare-name string through unchanged', async () => {
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
});

describe('handleSetFill — object form', () => {
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
});

// ─── set_stroke ────────────────────────────────────────────────────────────

describe('handleSetStroke — string passthrough', () => {
  it('passes shorthand string through unchanged (hex)', async () => {
    stubFigmaVariables([]);
    await handleSetStroke({ node: '1:2', stroke: '1 #E0E0E0' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 #E0E0E0' },
    });
  });

  it('passes shorthand string with bare-name through', async () => {
    stubFigmaVariables([]);
    // expandShorthands treats the $-prefixed part as a variable reference
    // (see expandShorthands.ts stroke expander) so the binding flows through
    // the variableBindingHandler downstream.
    await handleSetStroke({ node: '1:2', stroke: '1 $Brand/600' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 $Brand/600' },
    });
  });
});

describe('handleSetStroke — object form', () => {
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
