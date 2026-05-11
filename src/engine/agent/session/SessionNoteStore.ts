/**
 * @file SessionNoteStore.ts
 * @description Session-scoped scratchpad the agent owns. Read + write key→markdown
 * pairs across turns; cleared at the start of every `run()` only when the run
 * itself starts a fresh session (handled by AgentRuntime, not here).
 *
 * Why not pluginData / per-node storage:
 *   pluginData is for component metadata (i18n tags, design-system refs).
 *   Session notes are agent-owned ephemeral state — separating them keeps
 *   the LLM-facing API clean (no node_id parameter, no namespace collisions).
 *
 * Storage backing:
 *   - Memory Map (always) — source of truth in production
 *   - Optional onUpdate callback — dev-bridge mirror fires this to persist to
 *     `BRIDGE_DIR/sessions/{sessionId}/{key}.md`. In production the callback is
 *     undefined and writes stay in memory.
 *
 * Well-known keys (soft hint — the LLM may use other names too):
 *   Forward:
 *   - plan       — turn-opening intent: what we're about to do, how many steps
 *   - decisions  — locked choices: style picked, accent token, font scale, etc.
 *   - brand      — durable brand notes (synced from a project design.md if present)
 *   - todo       — truly unfinished work for the next turn
 *   Backward (turn-end retrospective):
 *   - failures   — tool calls that failed this turn + recovery
 *   - gotchas    — validator warnings deliberately skipped, magic numbers + rationale
 *   - learnings  — DSL / Figma API surprises worth carrying forward
 */

export interface SessionNoteUpdate {
  sessionId: string;
  key: string;
  /** Empty string = delete. */
  value: string;
  ts: number;
}

export const WELL_KNOWN_NOTE_KEYS = ['plan', 'decisions', 'brand', 'todo', 'failures', 'gotchas', 'learnings'] as const;
export type WellKnownNoteKey = (typeof WELL_KNOWN_NOTE_KEYS)[number];

export class SessionNoteStore {
  private readonly notes = new Map<string, string>();
  private readonly sessionId: string;
  private readonly onUpdate?: (update: SessionNoteUpdate) => void;

  /** Per-turn access tracking for the turn-end hook (commit-before-end). */
  private touchedThisTurn = false;
  private writtenThisTurn = false;

  constructor(opts: { sessionId: string; onUpdate?: (update: SessionNoteUpdate) => void }) {
    this.sessionId = opts.sessionId;
    this.onUpdate = opts.onUpdate;
  }

  // ─── Storage ────────────────────────────────────────────────

  read(key: string): string {
    this.touchedThisTurn = true;
    return this.notes.get(key) ?? '';
  }

  /** Pass empty string to delete. */
  write(key: string, value: string): void {
    this.touchedThisTurn = true;
    this.writtenThisTurn = true;
    if (value === '') {
      this.notes.delete(key);
    } else {
      this.notes.set(key, value);
    }
    if (this.onUpdate) {
      try {
        this.onUpdate({ sessionId: this.sessionId, key, value, ts: Date.now() });
      } catch (e) {
        // mirror is best-effort; never let it break the agent path
        console.warn('[SessionNoteStore] onUpdate failed:', (e as Error)?.message);
      }
    }
  }

  list(): Array<{ key: string; chars: number }> {
    this.touchedThisTurn = true;
    return Array.from(this.notes.entries())
      .map(([key, value]) => ({ key, chars: value.length }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // ─── Context injection helper ────────────────────────────────

  /** All notes formatted as a markdown section for context injection. Empty string if none. */
  renderForContext(): string {
    if (this.notes.size === 0) return '';
    const lines: string[] = ['## Session Notes (your own scratchpad — read/write via session_note tool)'];
    const wellKnown = new Set<string>(WELL_KNOWN_NOTE_KEYS);
    const ordered = Array.from(this.notes.keys()).sort((a, b) => {
      const aw = wellKnown.has(a) ? 0 : 1;
      const bw = wellKnown.has(b) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.localeCompare(b);
    });
    for (const key of ordered) {
      lines.push(`\n### ${key}`);
      lines.push(this.notes.get(key) ?? '');
    }
    return lines.join('\n');
  }

  // ─── Turn-end hook accounting ────────────────────────────────

  hasTouchedThisTurn(): boolean {
    return this.touchedThisTurn;
  }

  hasWrittenThisTurn(): boolean {
    return this.writtenThisTurn;
  }

  resetTurnTracking(): void {
    this.touchedThisTurn = false;
    this.writtenThisTurn = false;
  }

  // ─── Session lifecycle ────────────────────────────────────────

  /** Drop everything. Called when starting a brand-new session ("New Design"). */
  clear(): void {
    this.notes.clear();
    this.touchedThisTurn = false;
    this.writtenThisTurn = false;
  }

  /** Diagnostics. */
  size(): number {
    return this.notes.size;
  }

  totalChars(): number {
    let total = 0;
    for (const v of this.notes.values()) total += v.length;
    return total;
  }
}
