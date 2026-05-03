/**
 * @file ryowStore.ts
 * @description Read-Your-Own-Writes store: per-turn LIFO buffer of variable
 * collections + variables created/mutated by mutation tools.
 *
 * Spec: docs/knowledge/variable-resolver-design-2026-05.md §3.3
 *
 *   _ryow: {
 *     collections: [{name, id, modes, fingerprint}],
 *     variables:   [{name, id, collection_id, type, mode_coverage, fingerprint}],
 *   }
 *
 * Lifecycle:
 *  - Built per-turn, cleared at turn_start.
 *  - Capped at 50 most-recent entries per kind (LIFO eviction).
 *  - Stored in agentRuntime instance memory, not persistent.
 *  - Survives within a turn, gone across turns.
 *
 * Response scoping (Item 2 of Phase 1):
 *   `_ryow` is attached only to responses from variable-related tools — see
 *   `VARIABLE_RELATED_TOOLS`. Non-variable tools' responses do NOT carry it.
 *
 * Subtask boundary:
 *   Subtask child runtime starts with an empty store (no parent inheritance)
 *   in Phase 1. See AgentRuntime instantiation.
 */

import { computeVariableIdempotencyKey } from './tools/idempotency';

/**
 * Tools that variable-related responses come from. Only these tool results
 * receive a `_ryow` block. List is intentionally narrow per §3.3.
 *
 * Read tools are excluded by the locked Phase 1 decision: only mutation
 * tools seed `_ryow`. `list_variables` is read-only and was intentionally
 * removed. Phase 2 staleness detection can re-add read tools if needed,
 * with deliberate justification.
 */
export const VARIABLE_RELATED_TOOLS: ReadonlySet<string> = new Set<string>([
  'ensure_collection',
  'ensure_variable',
  'create_collection',
  'create_variable',
  'set_variable_value',
  'set_fill',
  'set_stroke',
  'set_text',
  'bind_variable',
]);

const MAX_ENTRIES_PER_KIND = 50;

export interface RyowCollectionEntry {
  name: string;
  id: string;
  modes: { modeId: string; name: string }[];
  /** Fingerprint of the collection's identity — currently `id` itself. */
  fingerprint: string;
}

export interface RyowVariableEntry {
  name: string;
  id: string;
  collection_id: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  /** Mode names where the variable has an explicit value. Empty = none. */
  mode_coverage: string[];
  /**
   * Fingerprint via `computeVariableIdempotencyKey`. Recomputed every
   * `recordVariable` call so subsequent value mutations advance the
   * fingerprint and a holder of an old ID can detect drift.
   */
  fingerprint: string;
}

export interface RyowBlock {
  collections: RyowCollectionEntry[];
  variables: RyowVariableEntry[];
}

export class RyowStore {
  private collections: RyowCollectionEntry[] = [];
  private variables: RyowVariableEntry[] = [];

  /** Variable IDs added to this store this turn. Used to compute `source`. */
  private variableIdsThisTurn: Set<string> = new Set();

  recordCollection(entry: {
    name: string;
    id: string;
    modes: { modeId: string; name: string }[];
  }): void {
    const ent: RyowCollectionEntry = {
      name: entry.name,
      id: entry.id,
      modes: entry.modes,
      fingerprint: entry.id,
    };
    // Move-to-front: remove existing entry with same id, then unshift (LIFO).
    this.collections = this.collections.filter(c => c.id !== entry.id);
    this.collections.unshift(ent);
    if (this.collections.length > MAX_ENTRIES_PER_KIND) {
      this.collections.length = MAX_ENTRIES_PER_KIND;
    }
  }

  recordVariable(entry: {
    name: string;
    id: string;
    collection_id: string;
    type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
    mode_coverage: string[];
    values_by_mode?: Record<string, unknown>;
  }): void {
    const fingerprint = computeVariableIdempotencyKey({
      collection_id: entry.collection_id,
      name: entry.name,
      type: entry.type,
      values_by_mode: entry.values_by_mode ?? {},
    });
    const ent: RyowVariableEntry = {
      name: entry.name,
      id: entry.id,
      collection_id: entry.collection_id,
      type: entry.type,
      mode_coverage: entry.mode_coverage,
      fingerprint,
    };
    this.variables = this.variables.filter(v => v.id !== entry.id);
    this.variables.unshift(ent);
    if (this.variables.length > MAX_ENTRIES_PER_KIND) {
      this.variables.length = MAX_ENTRIES_PER_KIND;
    }
    this.variableIdsThisTurn.add(entry.id);
  }

  /**
   * Snapshot of the store, scoped to the calling tool. Returns `undefined`
   * for non-variable tools so callers can attach unconditionally.
   */
  snapshot(toolName: string): RyowBlock | undefined {
    if (!VARIABLE_RELATED_TOOLS.has(toolName)) return undefined;
    return {
      collections: this.collections.slice(),
      variables: this.variables.slice(),
    };
  }

  /** True iff a variable with this ID was added to the store this turn. */
  isCreatedThisTurn(variableId: string): boolean {
    return this.variableIdsThisTurn.has(variableId);
  }

  /**
   * Look up a variable by name + type (and optional collection). Returns
   * the most-recently-seen match, used as `suggested_id` in
   * AMBIGUOUS_NAME_AUTOPICK warnings.
   */
  findVariableByName(args: {
    name: string;
    type?: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
    collection_id?: string;
  }): RyowVariableEntry | undefined {
    for (const v of this.variables) {
      if (v.name !== args.name) continue;
      if (args.type && v.type !== args.type) continue;
      if (args.collection_id && v.collection_id !== args.collection_id) continue;
      return v;
    }
    return undefined;
  }

  /** Drop all entries. Called at turn_start. */
  clear(): void {
    this.collections = [];
    this.variables = [];
    this.variableIdsThisTurn = new Set();
  }
}
