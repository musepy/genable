/**
 * @file sessionNoteTool.ts
 * @description session_note — agent-owned scratchpad for plan/decisions/brand/todo.
 *
 * One tool, three actions (read / write / list). Why one tool not three:
 *   - The space is intentionally small and tightly scoped — three separate
 *     tool names would inflate the tool menu without adding clarity.
 *   - Most uses follow read→write within the same iteration; the LLM can
 *     batch when execution strategy permits.
 *
 * Key convention is a soft hint: `plan / decisions / brand / todo` are the
 * recommended slots, but any string is accepted (lets agents grow new slots
 * organically as they need them).
 */

import { ToolDefinition } from '../types';

export const sessionNoteDefinition: ToolDefinition = {
  name: 'session_note',
  executionStrategy: 'sequential', // writes mutate shared state — keep ordered
  description: `Read / write your own session scratchpad. Persists across turns within one design session ("New Design" resets it). Notes are how state carries from this turn into the next — the next session loads them as context.

Actions:
  action: "read"   → read({key}) returns the current value (empty string if unset)
  action: "write"  → write({key, value}) replaces or deletes (pass value:"" to delete)
  action: "list"   → list({}) returns [{key, chars}] for all existing notes

Slots — FORWARD-LOOKING (what we plan / commit to):
  - plan       — this turn's intent + step outline (write at turn start)
  - decisions  — locked choices: style picked + reason, accent token, font scale, hero treatment, etc. (write BEFORE jsx)
  - brand      — durable brand notes pulled from a project design.md (if user supplied one)
  - todo       — TRULY unfinished work for the next turn (omit if everything shipped)

Slots — BACKWARD-LOOKING (what happened, write AT TURN END — AUTO-MERGE on write):
  - failures   — tool calls that failed this turn + how you worked around them.
                 Example: "jsx items='stretch' rejected (DSL valid: center|start|end|space-between|baseline); retried with 'center'."
                 If a failure repeats a class you've seen before, name the class.
  - gotchas    — validator warnings you noticed but chose not to fix + why.
                 Example: "4 LOW_CONTRAST on nav links (2.5:1) — deliberate for ambient-grey style; revisit if user complains."
                 Also: magic numbers / hand-tuned positions and what motivated them.
                 Example: "Glow ellipses at (-180, 220) / (1060, 70) — placed half outside frame to bleed in."
  - learnings  — surprises about this codebase / DSL / Figma API.
                 Example: "radial-gradient(circle at X% Y%) rejected — DSL only takes the simple form. Same trap as CSS-prior bleed elsewhere."

BACKWARD-LOOKING slots auto-merge: writing to \`failures / gotchas / learnings\` appends to prior content after a "---" divider — your new value never silently overwrites accumulated retrospective notes. To replace fresh, first \`write({value: ""})\` to clear, then write again. The result \`data.merged=true\` flag confirms when merge happened.

REQUIRED behavior:
  - First turn: write at least \`decisions\` BEFORE any jsx (commit-before-act).
  - Subsequent turns: \`read\` \`decisions\` and \`learnings\` BEFORE any jsx — those slots survive across turns and your conversationHistory won't carry the full content reliably. Your turn's adjacent <system-reminder> snapshot also surfaces current notes, but explicit \`read\` proves you considered them.
  - Every turn end: write at least ONE of \`failures / gotchas / learnings\` if ANY of these happened this turn:
      • a tool call returned an error
      • a tool call returned warnings you chose not to fix
      • you hand-tuned a coordinate / size / color away from a value the model would have picked
      • you found a DSL behavior that surprised you
    "All clean, no carry-over" is almost never accurate — at least one backward slot belongs.
  - jsx that uses a color / font / size should round-trip through \`decisions\` (token traceability).

Examples:
  session_note({action: "write", key: "decisions", value: "Style: fintech-dark.\\nAccent: #3B82F6 (style.accent — NOT indigo).\\nFont: Space Grotesk display / Inter body.\\nHero treatment: split (overrides anatomy VERTICAL — desktop convention).\\nH1 size: 32 (style.display)."})
  session_note({action: "write", key: "failures", value: "jsx #6 align='stretch' rejected (DSL valid: center|start|end|space-between|baseline) — retried with 'center'. Same CSS-prior class as gradient: model has CSS values that DSL doesn't accept."})
  session_note({action: "write", key: "gotchas", value: "8 LOW_CONTRAST warnings on nav links + secondary CTA (2.5:1 against dark bg). Left as-is — user prompt didn't require WCAG pass; flagging in case next iteration tightens contrast."})
  session_note({action: "write", key: "learnings", value: "layoutPositioning='absolute' children render correctly inside auto-layout frame, but parent needs clipsContent=true to suppress overflow on big glow ellipses."})
  session_note({action: "read", key: "decisions"})
  session_note({action: "list"})`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'list'],
        description: 'read | write | list',
      },
      key: {
        type: 'string',
        description: 'Note key. Required for read/write. Recommended slots: plan, decisions, brand, todo.',
      },
      value: {
        type: 'string',
        description: 'Markdown body for write. Pass "" to delete. Ignored for read/list.',
      },
    },
    required: ['action'],
  },
};
