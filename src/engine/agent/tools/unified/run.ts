/**
 * @file run.ts
 * @description Single LLM-facing tool — CLI string interface.
 *
 * LLM sends: run({command: "ls /"})
 * Internally: parse CLI string → route to command handler
 *
 * Supports:
 * - CLI syntax: "ls /", "cat /Card/ -s", "tree / --depth 2"
 * - Chain operator: "tree / && cat /Card/Header/"
 * - Multiline input: run({command: "design", input: "ops..."})
 * - Progressive disclosure: command name only → help text
 */

import { ToolDefinition } from '../types';

export const runDefinition: ToolDefinition = {
  name: 'run',
  category: 'control',
  display: { displayName: 'Run', group: 'system' },
  executionStrategy: 'sequential',
  description: `Execute a command via CLI syntax. 10 Unix commands.

Read:
  ls /path/              — list children ("/" = page root)
  tree /path/ [-d N]     — structural skeleton
  cat /path/ [-s]        — full properties (-s = screenshot)

Write:
  mk /path/ [type] key:value... [-- text]  — create or update (upsert)
  mv /src/ /dest/        — move or rename node
  rm /path/              — delete node (supports glob: rm /Card/Old*)
  cp /src/ /dest/ {overrides}  — clone with overrides

Search & Replace:
  grep <query>           — search nodes by name/type
  grep /path/ props      — discover property values
  sed /path/ prop:from/to  — batch property replacement

Knowledge:
  man [topic]            — help, guidelines, style guides

Path: "/" = page root, "/Card/" = by name, "/100:5/" = by Figma ID.
Glob: /Card/Btn* matches children starting with "Btn". Works in rm, cat, ls.
$LAST: expands to last created/modified node ID. Works in chains and across calls.
Chain operators:
  &&  run next only if previous succeeded
  ;   run next regardless
  ||  run next only if previous failed
Help: command name only (e.g. "mk") for detailed usage.

Output metadata: [exit:N | Xs] — exit:0 success, exit:1 error, exit:127 not found.

Examples:
  run({command: "ls /"})
  run({command: "mk /Card/ frame w:400 layout:column p:24 bg:#FFF corner:12"})
  run({command: "mk /Card/Title text size:24 weight:Bold fill:#111 -- Card Title"})
  run({command: "mk /Card/ corner:16"})
  run({command: "mv /Card/OldTitle /Card/NewTitle"})
  run({command: "rm /Card/OldSection/"})
  run({command: "rm /Card/Placeholder*"})
  run({command: "cp /Card/Default/ /Card/Hover/ {bg:#EEE}"})
  run({command: "cat /Card/Header/ -s"})
  run({command: "grep Button"})
  run({command: "sed /Card/ fillColor:#FFF/#000"})
  run({command: "man components"})
  run({command: "mk /Card/ frame w:400 && mk $LAST/Title text size:24 -- Hello"})
  run({command: "mk", input: "/Card/ frame w:400 layout:column\\n/Card/Title text size:24 -- Hello"})`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'CLI command string. Examples: "ls /", "cat /Card/ -s", "tree / && cat /Card/"',
      },
      input: {
        type: 'string',
        description: 'Multiline input data (like stdin). Used for design ops and replace rules.',
      },
    },
    required: ['command'],
  },
};
