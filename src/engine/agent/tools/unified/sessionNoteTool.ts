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
  description: `Read / write your own session scratchpad. Persists across turns within one design session ("New Design" resets it). Use to commit decisions and plans BEFORE acting, and update todos AFTER acting.

Actions:
  action: "read"   → read({key}) returns the current value (empty string if unset)
  action: "write"  → write({key, value}) replaces or deletes (pass value:"" to delete)
  action: "list"   → list({}) returns [{key, chars}] for all existing notes

Recommended keys (soft hint — feel free to add others):
  - plan       — this turn's intent + step outline (write at turn start)
  - decisions  — locked choices: style picked + reason, accent token, font scale, hero treatment, etc. (write BEFORE jsx)
  - brand      — durable brand notes pulled from a project design.md (if user supplied one)
  - todo       — carry-over: what's unfinished, what to revisit next turn (update at turn end)

You may invent additional keys (e.g. \`learnings\`, \`risks\`) when useful.

REQUIRED behavior:
  - On the FIRST turn of a new session you MUST write at least \`decisions\` before any jsx.
  - Before ending ANY turn you MUST read at least one key (catch up on prior notes) AND write at least one (record what changed).
  - When jsx uses a color / font / size, that value should also appear in \`decisions\` — token traceability beats free-style invention.

Examples:
  session_note({action: "write", key: "plan", value: "Build Quill AI hero only (per user prompt). 1) navbar, 2) hero split: copy left + product mockup right. ~25 tool calls budget."})
  session_note({action: "write", key: "decisions", value: "Style: fintech-dark.\\nAccent: #3B82F6 (style.accent — NOT indigo).\\nFont: Space Grotesk display / Inter body.\\nHero treatment: split (overrides anatomy VERTICAL — desktop convention).\\nH1 size: 32 (style.display)."})
  session_note({action: "read", key: "decisions"})
  session_note({action: "list"})
  session_note({action: "write", key: "todo", value: "MockAIBubble lost on first jsx — investigate absolute+hug-parent silent failure."})`,
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
