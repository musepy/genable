/**
 * @file ryowStore.test.ts
 * @description Tests for the per-turn read-your-own-writes store.
 *
 * Pure data structure — no figma.* dependency. Covers:
 *   - LIFO insertion (most-recent first)
 *   - 50-entry cap eviction
 *   - snapshot scoping by tool name (variable-related vs non-variable)
 *   - clear() resets all state
 *   - isCreatedThisTurn semantics
 *   - findVariableByName lookup
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RyowStore, VARIABLE_RELATED_TOOLS } from '../ryowStore';

describe('RyowStore — record + snapshot', () => {
  let store: RyowStore;

  beforeEach(() => {
    store = new RyowStore();
  });

  it('snapshot is empty before any record', () => {
    const snap = store.snapshot('ensure_variable');
    expect(snap).toEqual({ collections: [], variables: [] });
  });

  it('records a variable and exposes it in snapshot()', () => {
    store.recordVariable({
      id: 'V1', name: 'Text/Primary', collection_id: 'C1', type: 'COLOR',
      mode_coverage: ['Light', 'Dark'],
      values_by_mode: { Light: '#111', Dark: '#EEE' },
    });
    const snap = store.snapshot('ensure_variable')!;
    expect(snap.variables).toHaveLength(1);
    expect(snap.variables[0].id).toBe('V1');
    expect(snap.variables[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a collection and exposes it in snapshot()', () => {
    store.recordCollection({
      id: 'C1', name: 'Theme',
      modes: [{ modeId: '1:0', name: 'Light' }, { modeId: '1:1', name: 'Dark' }],
    });
    const snap = store.snapshot('ensure_collection')!;
    expect(snap.collections).toHaveLength(1);
    expect(snap.collections[0]).toMatchObject({
      id: 'C1', name: 'Theme', fingerprint: 'C1',
    });
  });

  it('moves an existing entry to the front on re-record (LIFO move-to-front)', () => {
    store.recordVariable({ id: 'V1', name: 'A', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    store.recordVariable({ id: 'V2', name: 'B', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    // Re-record V1 — should jump back to front
    store.recordVariable({ id: 'V1', name: 'A', collection_id: 'C1', type: 'COLOR', mode_coverage: ['Light'] });
    const snap = store.snapshot('ensure_variable')!;
    expect(snap.variables.map(v => v.id)).toEqual(['V1', 'V2']);
    // Mode coverage was updated on the re-record
    expect(snap.variables[0].mode_coverage).toEqual(['Light']);
  });

  it('caps entries at 50, evicting oldest (LIFO)', () => {
    for (let i = 0; i < 60; i++) {
      store.recordVariable({
        id: `V${i}`, name: `var${i}`, collection_id: 'C1', type: 'COLOR', mode_coverage: [],
      });
    }
    const snap = store.snapshot('ensure_variable')!;
    expect(snap.variables).toHaveLength(50);
    // Most-recent (V59) is at the front; oldest survivor is V10 (V0..V9 evicted)
    expect(snap.variables[0].id).toBe('V59');
    expect(snap.variables[49].id).toBe('V10');
  });
});

describe('RyowStore — snapshot scoping', () => {
  let store: RyowStore;
  beforeEach(() => {
    store = new RyowStore();
    store.recordVariable({ id: 'V1', name: 'X', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
  });

  it('returns a snapshot for every name in VARIABLE_RELATED_TOOLS', () => {
    for (const tool of VARIABLE_RELATED_TOOLS) {
      const snap = store.snapshot(tool);
      expect(snap, `expected snapshot for ${tool}`).toBeDefined();
      expect(snap!.variables).toHaveLength(1);
    }
  });

  it('returns undefined for non-variable tools', () => {
    expect(store.snapshot('jsx')).toBeUndefined();
    expect(store.snapshot('inspect')).toBeUndefined();
    expect(store.snapshot('set_layout')).toBeUndefined();
    expect(store.snapshot('describe')).toBeUndefined();
  });

  it('snapshot returns undefined for list_variables (it is no longer in VARIABLE_RELATED_TOOLS)', () => {
    // Locked Phase 1 decision: only mutation tools seed _ryow. list_variables
    // is read-only and must not appear in VARIABLE_RELATED_TOOLS. Phase 2
    // staleness detection can re-add read tools deliberately if needed.
    expect(VARIABLE_RELATED_TOOLS.has('list_variables')).toBe(false);
    expect(store.snapshot('list_variables')).toBeUndefined();
  });

  it('returns a copy, not the live array (mutating snapshot must not affect store)', () => {
    const snap1 = store.snapshot('ensure_variable')!;
    snap1.variables.length = 0;
    const snap2 = store.snapshot('ensure_variable')!;
    expect(snap2.variables).toHaveLength(1);
  });
});

describe('RyowStore — isCreatedThisTurn', () => {
  let store: RyowStore;
  beforeEach(() => { store = new RyowStore(); });

  it('returns true for ids added this turn', () => {
    store.recordVariable({ id: 'V42', name: 'A', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    expect(store.isCreatedThisTurn('V42')).toBe(true);
  });

  it('returns false for unknown ids', () => {
    expect(store.isCreatedThisTurn('V99')).toBe(false);
  });

  it('returns false after clear()', () => {
    store.recordVariable({ id: 'V42', name: 'A', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    store.clear();
    expect(store.isCreatedThisTurn('V42')).toBe(false);
  });
});

describe('RyowStore — findVariableByName', () => {
  let store: RyowStore;
  beforeEach(() => {
    store = new RyowStore();
    store.recordVariable({ id: 'V1', name: 'Text/Primary', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    store.recordVariable({ id: 'V2', name: 'Spacing/md', collection_id: 'C1', type: 'FLOAT', mode_coverage: [] });
  });

  it('finds by name only', () => {
    expect(store.findVariableByName({ name: 'Text/Primary' })?.id).toBe('V1');
  });

  it('respects type filter', () => {
    expect(store.findVariableByName({ name: 'Text/Primary', type: 'COLOR' })?.id).toBe('V1');
    expect(store.findVariableByName({ name: 'Text/Primary', type: 'FLOAT' })).toBeUndefined();
  });

  it('respects collection_id filter', () => {
    expect(store.findVariableByName({ name: 'Text/Primary', collection_id: 'C1' })?.id).toBe('V1');
    expect(store.findVariableByName({ name: 'Text/Primary', collection_id: 'C9' })).toBeUndefined();
  });

  it('returns the most-recently-recorded match (LIFO)', () => {
    // Add a second Text/Primary in another collection — most-recent wins
    store.recordVariable({ id: 'V3', name: 'Text/Primary', collection_id: 'C2', type: 'COLOR', mode_coverage: [] });
    expect(store.findVariableByName({ name: 'Text/Primary' })?.id).toBe('V3');
  });
});

describe('RyowStore — clear', () => {
  it('empties both lists and the createdThisTurn set', () => {
    const store = new RyowStore();
    store.recordCollection({ id: 'C1', name: 'Theme', modes: [] });
    store.recordVariable({ id: 'V1', name: 'A', collection_id: 'C1', type: 'COLOR', mode_coverage: [] });
    store.clear();
    const snap = store.snapshot('ensure_variable')!;
    expect(snap.collections).toEqual([]);
    expect(snap.variables).toEqual([]);
    expect(store.isCreatedThisTurn('V1')).toBe(false);
  });
});
