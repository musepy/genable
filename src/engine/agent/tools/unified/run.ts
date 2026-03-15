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
  description: `Execute a command via CLI syntax.

Read commands:
  ls /path/              — list children ("/" = page root)
  tree /path/ [-d N]     — structural skeleton (id, type, dims)
  cat /path/ [-s]        — full properties (-s = screenshot)

Write commands (path-based):
  mkdir /path/ {props}         — create frame (use -t for rect/ellipse/line)
  mktext /path/ {props} text   — create text node
  write /path/ {props}         — update properties
  rm /path/                    — delete node
  cp /src/ /dest/ {overrides}  — clone with overrides
  ln /path/ Component {props}  — create component instance

Batch commands:
  design [-p parentId]   — create/edit/delete nodes (flat ops via input)
  replace search|apply <rootId> ...  — batch property replacement
  query nodes|guidelines|style|help [term]  — search & knowledge

Path: "/" = page root, "/Card/" = by name, "/100:5/" = by Figma ID.
Chain: "mkdir /Card/ {w:400} && mktext /Card/Title {size:24} Hello" — sequential.
Help: command name only (e.g. "mkdir") for detailed usage.

Examples:
  run({command: "ls /"})
  run({command: "mkdir /Card/ {w:400, layout:column, p:24, bg:#FFF}"})
  run({command: "mktext /Card/Title {size:24, weight:Bold, fill:#111} Card Title"})
  run({command: "write /Card/ {corner:16, bg:#000}"})
  run({command: "rm /Card/OldSection/"})
  run({command: "cp /Card/Default/ /Card/Hover/ {bg:#EEE}"})
  run({command: "cat /Card/Header/ -s"})
  run({command: "design -p 100:5", input: "title = text(root, {size:24}, 'Hello')"})`,
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
