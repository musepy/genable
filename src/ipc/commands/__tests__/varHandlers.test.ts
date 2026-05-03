/**
 * @file varHandlers.test.ts
 * @description Pure-logic tests for bind_variable validation.
 *
 * No figma.* mocks — `validateBindRequest` is a pure function that consumes
 * a resolved nodeType + variableType and returns an error string (or null).
 * The outer `handleBindVariable` wrapper (figma API calls, node resolution)
 * is NOT covered here; validate those paths via the dev bridge E2E.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateBindRequest,
  BIND_ALIAS_MAP,
  handleEnsureCollection,
  handleEnsureVariable,
} from '../varHandlers';
import { computeVariableIdempotencyKey } from '../../../engine/agent/tools/idempotency';

describe('validateBindRequest — alias map', () => {
  it('translates "gap" → "itemSpacing" and allows FLOAT on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'gap', variableType: 'FLOAT', variableName: 'Spacing/md',
    });
    expect(r.canonicalProp).toBe('itemSpacing');
    expect(r.error).toBeNull();
  });

  it('translates "padding" → "paddingTop"', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'padding', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.canonicalProp).toBe('paddingTop');
    expect(r.error).toBeNull();
  });

  it('translates "padding-left" → "paddingLeft"', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'padding-left', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.canonicalProp).toBe('paddingLeft');
    expect(r.error).toBeNull();
  });

  it('translates "corner" and "corner-radius" → "cornerRadius"', () => {
    expect(validateBindRequest({
      nodeType: 'FRAME', prop: 'corner', variableType: 'FLOAT', variableName: 'R/md',
    }).canonicalProp).toBe('cornerRadius');
    expect(validateBindRequest({
      nodeType: 'FRAME', prop: 'corner-radius', variableType: 'FLOAT', variableName: 'R/md',
    }).canonicalProp).toBe('cornerRadius');
  });

  it('translates "font-size" → "fontSize" — but TEXT.fontSize is not registry-bindable (object-typed)', () => {
    // Regression guard: fontSize currently isn't marked bindable in the registry
    // (valueType:'object'). If we ever flip the registry to mark it bindable,
    // this test needs updating.
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'font-size', variableType: 'FLOAT', variableName: 'FS/body',
    });
    expect(r.canonicalProp).toBe('fontSize');
    // Either the registry makes it bindable (error:null) or it stays not-bindable.
    // We assert only the alias works; the bindability outcome follows registry truth.
    expect([null, expect.stringContaining('not bindable')]).toContainEqual(r.error);
  });

  it('BIND_ALIAS_MAP has no identity entries (opacity/visible/width/height must fall through)', () => {
    expect(BIND_ALIAS_MAP['opacity']).toBeUndefined();
    expect(BIND_ALIAS_MAP['visible']).toBeUndefined();
    expect(BIND_ALIAS_MAP['width']).toBeUndefined();
    expect(BIND_ALIAS_MAP['height']).toBeUndefined();
  });
});

describe('validateBindRequest — width/height rejection', () => {
  it('rejects width with "computed post-layout" and "layoutSizingHorizontal" redirect', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'width', variableType: 'FLOAT', variableName: 'W/sm',
    });
    expect(r.canonicalProp).toBe('width');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('computed post-layout');
    expect(r.error).toContain('layoutSizingHorizontal');
    // Should suggest size-contributing props as the alternative
    expect(r.error).toMatch(/minWidth|maxWidth|padding|itemSpacing/);
  });

  it('rejects height with "computed post-layout" and "layoutSizingVertical" redirect', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'height', variableType: 'FLOAT', variableName: 'H/sm',
    });
    expect(r.canonicalProp).toBe('height');
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('computed post-layout');
    expect(r.error).toContain('layoutSizingVertical');
    expect(r.error).toMatch(/minHeight|maxHeight|padding|itemSpacing/);
  });
});

describe('validateBindRequest — registry-driven bindable lookup', () => {
  it('accepts FLOAT → paddingLeft on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'paddingLeft', variableType: 'FLOAT', variableName: 'P/lg',
    });
    expect(r.error).toBeNull();
  });

  it('accepts BOOLEAN → visible on FRAME', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'visible', variableType: 'BOOLEAN', variableName: 'show/card',
    });
    expect(r.error).toBeNull();
  });

  it('accepts STRING → characters on TEXT', () => {
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'characters', variableType: 'STRING', variableName: 'Copy/title',
    });
    expect(r.error).toBeNull();
  });

  it('rejects FLOAT → characters (STRING-only bindable) with type-mismatch message', () => {
    const r = validateBindRequest({
      nodeType: 'TEXT', prop: 'characters', variableType: 'FLOAT', variableName: 'N/count',
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('Type mismatch');
    expect(r.error).toContain('STRING');
    expect(r.error).toContain('FLOAT');
  });

  it('rejects BOOLEAN → paddingLeft (FLOAT-only) with type-mismatch message', () => {
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'paddingLeft', variableType: 'BOOLEAN', variableName: 'dense',
    });
    expect(r.error).toContain('Type mismatch');
    expect(r.error).toContain('FLOAT');
  });

  it('rejects non-bindable prop with "not bindable on X nodes" message', () => {
    // `name` is a STRING prop but not bindable in the registry.
    const r = validateBindRequest({
      nodeType: 'FRAME', prop: 'name', variableType: 'STRING', variableName: 'Label/card',
    });
    expect(r.error).toContain('not bindable on FRAME');
  });

  it('rejects unknown node type with "not bindable" message', () => {
    const r = validateBindRequest({
      nodeType: 'WIDGET', prop: 'paddingLeft', variableType: 'FLOAT', variableName: 'P/md',
    });
    expect(r.error).toContain('not bindable on WIDGET');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ensure_variable / ensure_collection
//
// Mock surface: figma.variables.{getLocalVariablesAsync,
// getLocalVariableCollectionsAsync, getVariableCollectionByIdAsync,
// createVariable, createVariableCollection}. We do NOT mock anything else —
// the handler logic is what's under test.
// ─────────────────────────────────────────────────────────────────────────

interface MockMode { modeId: string; name: string }
interface MockCollection {
  id: string;
  name: string;
  modes: MockMode[];
  renameMode: (id: string, n: string) => void;
  addMode: (n: string) => string;
}
interface MockVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  valuesByMode: Record<string, unknown>;
  setValueForMode: (modeId: string, value: unknown) => void;
  remove: () => void;
  /** Plugin data store — keyed exactly like Figma's per-variable getPluginData/setPluginData. */
  __pluginData?: Record<string, string>;
  getPluginData: (key: string) => string;
  setPluginData: (key: string, value: string) => void;
}

let mockCollections: MockCollection[] = [];
let mockVariables: MockVariable[] = [];
let nextVarSerial = 1;
let nextModeSerial = 1;

function makeCollection(id: string, name: string, modeNames: string[]): MockCollection {
  const modes: MockMode[] = modeNames.map((n, i) => ({ modeId: `${id}:m${i}`, name: n }));
  return {
    id,
    name,
    modes,
    renameMode(modeId: string, newName: string) {
      const m = modes.find(x => x.modeId === modeId);
      if (m) m.name = newName;
    },
    addMode(newName: string): string {
      const id = `m${nextModeSerial++}`;
      modes.push({ modeId: id, name: newName });
      return id;
    },
  };
}

function setupFigmaMock() {
  vi.stubGlobal('figma', {
    variables: {
      getLocalVariablesAsync: vi.fn(async () => mockVariables.slice()),
      getLocalVariableCollectionsAsync: vi.fn(async () => mockCollections.slice()),
      getVariableCollectionByIdAsync: vi.fn(async (id: string) =>
        mockCollections.find(c => c.id === id) ?? null,
      ),
      createVariable: vi.fn((name: string, collection: MockCollection, type: any) => {
        const id = `VariableID:${nextVarSerial++}`;
        const variable: MockVariable = {
          id,
          name,
          variableCollectionId: collection.id,
          resolvedType: type,
          valuesByMode: {},
          __pluginData: {},
          setValueForMode(modeId, value) { this.valuesByMode[modeId] = value; },
          remove() {
            const idx = mockVariables.findIndex(v => v.id === id);
            if (idx >= 0) mockVariables.splice(idx, 1);
          },
          getPluginData(key: string): string {
            return this.__pluginData?.[key] ?? '';
          },
          setPluginData(key: string, value: string): void {
            if (!this.__pluginData) this.__pluginData = {};
            this.__pluginData[key] = value;
          },
        };
        mockVariables.push(variable);
        return variable;
      }),
      createVariableCollection: vi.fn((name: string) => {
        const id = `VariableCollectionId:${mockCollections.length + 1}`;
        const c = makeCollection(id, name, ['__placeholder__']);
        mockCollections.push(c);
        return c;
      }),
      // No-op cache invalidation hooks called by handler
      getVariableByIdAsync: vi.fn(async (id: string) =>
        mockVariables.find(v => v.id === id) ?? null,
      ),
    },
  });
}

beforeEach(() => {
  mockCollections = [];
  mockVariables = [];
  nextVarSerial = 1;
  nextModeSerial = 1;
  setupFigmaMock();
});

describe('handleEnsureCollection — idempotency + reuse', () => {
  function key(name: string, modes: string[]): string {
    return computeVariableIdempotencyKey({
      collection_id: '',
      name,
      type: 'STRING',
      values_by_mode: { modes },
    });
  }

  it('creates a new collection when none exists', async () => {
    const r = await handleEnsureCollection({
      name: 'Theme',
      modes: ['Light', 'Dark'],
      idempotency_key: key('Theme', ['Light', 'Dark']),
    });
    expect(r.error).toBeUndefined();
    expect(r.data?.collection_id).toMatch(/^VariableCollectionId/);
    expect(r.data?.modes).toEqual([
      { modeId: expect.any(String), name: 'Light' },
      { modeId: expect.any(String), name: 'Dark' },
    ]);
  });

  it('returns existing collection on idempotent reuse (same name + modes)', async () => {
    const k = key('Theme', ['Light', 'Dark']);
    const first = await handleEnsureCollection({ name: 'Theme', modes: ['Light', 'Dark'], idempotency_key: k });
    const second = await handleEnsureCollection({ name: 'Theme', modes: ['Light', 'Dark'], idempotency_key: k });
    expect(second.error).toBeUndefined();
    expect(second.data?.collection_id).toBe(first.data?.collection_id);
    expect(second.data?.reused).toBe(true);
  });

  it('rejects mismatched idempotency_key', async () => {
    const r = await handleEnsureCollection({
      name: 'Theme',
      modes: ['Light', 'Dark'],
      idempotency_key: 'cafef00d',
    });
    expect(r.error).toContain('INVALID_IDEMPOTENCY_KEY');
  });

  it('rejects missing required params', async () => {
    expect((await handleEnsureCollection({})).error).toContain('name');
    expect((await handleEnsureCollection({ name: 'X' })).error).toContain('modes');
    expect((await handleEnsureCollection({ name: 'X', modes: ['Light'] })).error).toContain('idempotency_key');
  });
});

describe('handleEnsureVariable — idempotency + dedup', () => {
  let collectionId: string;

  function varKey(name: string, type: any, values: Record<string, unknown>): string {
    return computeVariableIdempotencyKey({
      collection_id: collectionId,
      name,
      type,
      values_by_mode: values,
    });
  }

  beforeEach(async () => {
    const c = await handleEnsureCollection({
      name: 'Theme',
      modes: ['Light', 'Dark'],
      idempotency_key: computeVariableIdempotencyKey({
        collection_id: '',
        name: 'Theme',
        type: 'STRING',
        values_by_mode: { modes: ['Light', 'Dark'] },
      }),
    });
    collectionId = c.data!.collection_id as string;
  });

  it('creates a fresh variable + populates values_by_mode (mode names)', async () => {
    const k = varKey('Text/Primary', 'COLOR', { Light: '#111111', Dark: '#EEEEEE' });
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: { Light: '#111111', Dark: '#EEEEEE' },
      idempotency_key: k,
    });
    expect(r.error).toBeUndefined();
    expect(r.data?.variable_id).toMatch(/^VariableID/);
    expect(r.data?.mode_coverage).toEqual(['Light', 'Dark']);
    // The created variable should have setValueForMode called for each mode
    const created = mockVariables.find(v => v.id === r.data!.variable_id);
    expect(created).toBeDefined();
    expect(Object.keys(created!.valuesByMode).length).toBe(2);
  });

  it('returns existing variable on idempotent reuse', async () => {
    const k = varKey('Text/Primary', 'COLOR', { Light: '#111111', Dark: '#EEEEEE' });
    const first = await handleEnsureVariable({
      collection_id: collectionId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#111111', Dark: '#EEEEEE' }, idempotency_key: k,
    });
    const second = await handleEnsureVariable({
      collection_id: collectionId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#111111', Dark: '#EEEEEE' }, idempotency_key: k,
    });
    expect(second.error).toBeUndefined();
    expect(second.data?.variable_id).toBe(first.data?.variable_id);
    expect(second.data?.reused).toBe(true);
  });

  it('rejects mismatched idempotency_key', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId, name: 'X', type: 'COLOR',
      values_by_mode: { Light: '#111' }, idempotency_key: 'random',
    });
    expect(r.error).toContain('INVALID_IDEMPOTENCY_KEY');
  });

  it('warns NAME_EXISTS_OUTSIDE_TARGET_COLLECTION when same name lives elsewhere', async () => {
    // Seed a stale variable in another collection
    const otherColl = await handleEnsureCollection({
      name: 'Old Theme', modes: ['Light'],
      idempotency_key: computeVariableIdempotencyKey({
        collection_id: '', name: 'Old Theme', type: 'STRING', values_by_mode: { modes: ['Light'] },
      }),
    });
    const otherId = otherColl.data!.collection_id as string;
    await handleEnsureVariable({
      collection_id: otherId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#000000' },
      idempotency_key: computeVariableIdempotencyKey({
        collection_id: otherId, name: 'Text/Primary', type: 'COLOR',
        values_by_mode: { Light: '#000000' },
      }),
    });

    // Now create the same name in the target collection
    const r = await handleEnsureVariable({
      collection_id: collectionId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#111111' },
      idempotency_key: varKey('Text/Primary', 'COLOR', { Light: '#111111' }),
    });
    expect(r.error).toBeUndefined();
    expect(r.warnings).toBeDefined();
    expect(r.warnings![0].code).toBe('NAME_EXISTS_OUTSIDE_TARGET_COLLECTION');
    expect((r.warnings![0] as any).candidates).toHaveLength(1);
  });

  it('fails SAME_COLLECTION_NAME_DUPLICATE when 2+ matches in target collection (Figma allows duplicates)', async () => {
    // Seed two same-named variables directly in mockVariables (skipping handler)
    const collection = mockCollections.find(c => c.id === collectionId)!;
    mockVariables.push({
      id: 'VariableID:dup1', name: 'Dup', variableCollectionId: collection.id,
      resolvedType: 'COLOR', valuesByMode: {},
      setValueForMode() {}, remove() {},
    });
    mockVariables.push({
      id: 'VariableID:dup2', name: 'Dup', variableCollectionId: collection.id,
      resolvedType: 'COLOR', valuesByMode: {},
      setValueForMode() {}, remove() {},
    });

    const r = await handleEnsureVariable({
      collection_id: collectionId, name: 'Dup', type: 'COLOR',
      values_by_mode: {},
      idempotency_key: varKey('Dup', 'COLOR', {}),
    });
    expect(r.error).toContain('SAME_COLLECTION_NAME_DUPLICATE');
    expect(r.data?.candidates).toHaveLength(2);
  });

  it('rejects unknown mode key in values_by_mode', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId, name: 'X', type: 'COLOR',
      values_by_mode: { Banana: '#FFF' },
      idempotency_key: varKey('X', 'COLOR', { Banana: '#FFF' }),
    });
    expect(r.error).toContain('Banana');
    expect(r.error).toContain('Light');
  });

  // ── Round-3 codex Findings 3 & 4 — reuse path correctness ──

  it('rejects reuse when existing variable\'s actual values differ from caller\'s key (Finding 3)', async () => {
    // Seed an existing variable with values { Light: #111111, Dark: #EEEEEE }.
    const collection = mockCollections.find(c => c.id === collectionId)!;
    const lightModeId = collection.modes.find(m => m.name === 'Light')!.modeId;
    const darkModeId = collection.modes.find(m => m.name === 'Dark')!.modeId;
    mockVariables.push({
      id: 'VariableID:stale',
      name: 'Text/Primary',
      variableCollectionId: collection.id,
      resolvedType: 'COLOR',
      valuesByMode: {
        [lightModeId]: { r: 0.07, g: 0.07, b: 0.07, a: 1 },  // ~#111111
        [darkModeId]: { r: 0.93, g: 0.93, b: 0.93, a: 1 },   // ~#EEEEEE
      },
      setValueForMode() {}, remove() {},
    });

    // Caller passes a DIFFERENT values_by_mode (key reflects new content; the
    // formula validation passes). Wrapper must NOT silently reuse — it must
    // detect divergence and raise STALE_VARIABLE_FINGERPRINT.
    const callerValues = { Light: '#FF0000', Dark: '#00FF00' };
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Text/Primary',
      type: 'COLOR',
      values_by_mode: callerValues,
      idempotency_key: varKey('Text/Primary', 'COLOR', callerValues),
    });
    expect(r.error).toContain('STALE_VARIABLE_FINGERPRINT');
    expect(r.data?.existing_variable_id).toBe('VariableID:stale');
    expect(typeof r.data?.existing_fingerprint).toBe('string');
    expect(typeof r.data?.caller_fingerprint).toBe('string');
    expect(r.data?.existing_fingerprint).not.toBe(r.data?.caller_fingerprint);
  });

  it('returns mode_coverage on reuse path (Finding 4)', async () => {
    // First call creates the variable.
    const k = varKey('Text/Primary', 'COLOR', { Light: '#111111', Dark: '#EEEEEE' });
    const first = await handleEnsureVariable({
      collection_id: collectionId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#111111', Dark: '#EEEEEE' }, idempotency_key: k,
    });
    expect(first.data?.mode_coverage).toEqual(['Light', 'Dark']);

    // Second call hits the reuse branch — must also include mode_coverage so
    // RyowStore audit data stays accurate.
    const second = await handleEnsureVariable({
      collection_id: collectionId, name: 'Text/Primary', type: 'COLOR',
      values_by_mode: { Light: '#111111', Dark: '#EEEEEE' }, idempotency_key: k,
    });
    expect(second.error).toBeUndefined();
    expect(second.data?.reused).toBe(true);
    expect(Array.isArray(second.data?.mode_coverage)).toBe(true);
    expect((second.data!.mode_coverage as string[]).sort()).toEqual(['Dark', 'Light']);
  });

  it('rejects reuse when existing variable has different mode keys than caller (Finding 3 edge)', async () => {
    // Existing has only Light filled; caller specifies Light + Dark.
    const collection = mockCollections.find(c => c.id === collectionId)!;
    const lightModeId = collection.modes.find(m => m.name === 'Light')!.modeId;
    mockVariables.push({
      id: 'VariableID:partial',
      name: 'Surface/Bg',
      variableCollectionId: collection.id,
      resolvedType: 'COLOR',
      valuesByMode: {
        [lightModeId]: { r: 1, g: 1, b: 1, a: 1 },
        // No Dark entry — augmenting silently would be a hidden write.
      },
      setValueForMode() {}, remove() {},
    });

    const callerValues = { Light: '#FFFFFF', Dark: '#000000' };
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Surface/Bg',
      type: 'COLOR',
      values_by_mode: callerValues,
      idempotency_key: varKey('Surface/Bg', 'COLOR', callerValues),
    });
    expect(r.error).toContain('STALE_VARIABLE_FINGERPRINT');
    expect(r.data?.existing_variable_id).toBe('VariableID:partial');
  });
});

describe('handleEnsureCollection — mode order is part of identity (Finding 5, Option A)', () => {
  function key(name: string, modes: string[]): string {
    return computeVariableIdempotencyKey({
      collection_id: '',
      name,
      type: 'STRING',
      values_by_mode: { modes },
    });
  }

  // Decision: mode ORDER is semantic (Option A from spec round-3 finding 5).
  // Figma uses the first-listed mode as the default for any node that doesn't
  // explicitly override via setExplicitVariableModeForCollection. Swapping
  // order changes which mode wins at the root → it's a different collection.
  // Expected behaviour: the second call (reversed order) does NOT match the
  // existing collection, so a fresh collection is created. The idempotency_key
  // is formula-correct (canonical_json preserves array order) so the
  // INVALID_IDEMPOTENCY_KEY guard does not fire.
  it('treats ["Light","Dark"] vs ["Dark","Light"] as DIFFERENT collections', async () => {
    const first = await handleEnsureCollection({
      name: 'Theme', modes: ['Light', 'Dark'],
      idempotency_key: key('Theme', ['Light', 'Dark']),
    });
    expect(first.error).toBeUndefined();
    const firstId = first.data!.collection_id as string;

    const second = await handleEnsureCollection({
      name: 'Theme', modes: ['Dark', 'Light'],
      idempotency_key: key('Theme', ['Dark', 'Light']),
    });
    expect(second.error).toBeUndefined();
    expect(second.data?.collection_id).not.toBe(firstId);
    expect(second.data?.reused).toBeUndefined();
    // First mode of the second collection is Dark — confirms ordering matters.
    expect((second.data!.modes as MockMode[])[0].name).toBe('Dark');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handleEnsureVariable — mode_coverage_required + fallback_reason
//
// Spec §6.2 — strict default ('all'), opt-in-fallback requires structured
// reason, persisted via setPluginData. Tests cover: default, missing reason
// rejection, unstructured reason rejection, valid acceptance, persistence.
// ─────────────────────────────────────────────────────────────────────────

describe('handleEnsureVariable — mode_coverage_required (Phase 2 step 4)', () => {
  let collectionId: string;

  function varKey(name: string, type: any, values: Record<string, unknown>): string {
    return computeVariableIdempotencyKey({
      collection_id: collectionId,
      name,
      type,
      values_by_mode: values,
    });
  }

  beforeEach(async () => {
    const c = await handleEnsureCollection({
      name: 'Theme',
      modes: ['Light', 'Dark'],
      idempotency_key: computeVariableIdempotencyKey({
        collection_id: '',
        name: 'Theme',
        type: 'STRING',
        values_by_mode: { modes: ['Light', 'Dark'] },
      }),
    });
    collectionId = c.data!.collection_id as string;
  });

  it('defaults mode_coverage_required to "all" when not specified', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Surface/Bg',
      type: 'COLOR',
      values_by_mode: { Light: '#FFFFFF', Dark: '#000000' },
      idempotency_key: varKey('Surface/Bg', 'COLOR', { Light: '#FFFFFF', Dark: '#000000' }),
    });
    expect(r.error).toBeUndefined();
    expect(r.data?.mode_coverage_required).toBe('all');
  });

  it('rejects opt-in-fallback without fallback_reason', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Spacing/desktop',
      type: 'FLOAT',
      values_by_mode: { Light: 24 },
      idempotency_key: varKey('Spacing/desktop', 'FLOAT', { Light: 24 }),
      mode_coverage_required: 'opt-in-fallback',
      // fallback_reason missing
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('fallback_reason');
  });

  it('rejects opt-in-fallback when fallback_reason lacks the structured "fallback to <mode>" phrase', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Spacing/desktop',
      type: 'FLOAT',
      values_by_mode: { Light: 24 },
      idempotency_key: varKey('Spacing/desktop', 'FLOAT', { Light: 24 }),
      mode_coverage_required: 'opt-in-fallback',
      fallback_reason: 'we just want a default',  // unstructured prose
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('fallback to');
  });

  it('accepts opt-in-fallback with a valid "fallback to <mode>" reason', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Spacing/desktop',
      type: 'FLOAT',
      values_by_mode: { Light: 24 },
      idempotency_key: varKey('Spacing/desktop', 'FLOAT', { Light: 24 }),
      mode_coverage_required: 'opt-in-fallback',
      fallback_reason: 'Desktop-only metric; fallback to Light in Dark mode.',
    });
    expect(r.error).toBeUndefined();
    expect(r.data?.mode_coverage_required).toBe('opt-in-fallback');
  });

  it('rejects fallback_reason when mode_coverage_required is "all" (mismatch)', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Surface/Bg',
      type: 'COLOR',
      values_by_mode: { Light: '#FFFFFF', Dark: '#000000' },
      idempotency_key: varKey('Surface/Bg', 'COLOR', { Light: '#FFFFFF', Dark: '#000000' }),
      mode_coverage_required: 'all',
      fallback_reason: 'fallback to Light in Dark mode',
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('fallback_reason');
  });

  it('persists mode_coverage_required and fallback_reason via setPluginData (read back)', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'Spacing/desktop',
      type: 'FLOAT',
      values_by_mode: { Light: 24 },
      idempotency_key: varKey('Spacing/desktop', 'FLOAT', { Light: 24 }),
      mode_coverage_required: 'opt-in-fallback',
      fallback_reason: 'Desktop-only metric; fallback to Light in Dark mode.',
    });
    expect(r.error).toBeUndefined();
    const created = mockVariables.find(v => v.id === r.data!.variable_id);
    expect(created).toBeDefined();
    expect(created!.getPluginData('mode_coverage_required')).toBe('opt-in-fallback');
    expect(created!.getPluginData('fallback_reason')).toContain('fallback to Light');
  });

  it('rejects invalid mode_coverage_required value', async () => {
    const r = await handleEnsureVariable({
      collection_id: collectionId,
      name: 'X',
      type: 'COLOR',
      values_by_mode: { Light: '#FFFFFF', Dark: '#000000' },
      idempotency_key: varKey('X', 'COLOR', { Light: '#FFFFFF', Dark: '#000000' }),
      mode_coverage_required: 'sometimes',  // not in enum
    });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('mode_coverage_required');
  });
});

