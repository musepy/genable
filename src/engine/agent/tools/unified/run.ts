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
import { COMMAND_NAMES } from './commandRegistry';

/**
 * Build the run tool description dynamically from registered commands.
 * Layer 0: command list injected into tool description.
 * Layer 1+: `command` alone → help, `man topic` → deep docs.
 */
function buildRunDescription(): string {
  // Command catalog — grouped by function
  const COMMAND_CATALOG: Record<string, Array<[string, string]>> = {
    'Move & Delete': [
      ['mv Name#id /dest/', 'move or rename node'],
      ['rm Name#id', 'delete node (supports glob: rm /Card/Old*)'],
      ['cp Name#id /dest/ {overrides}', 'clone with overrides'],
    ],
    'Search & Replace': [
      ['grep <query>', 'search nodes by name/type'],
      ['grep Name#id props', 'discover property values'],
      ['sed Name#id prop:from/to', 'batch property replacement'],
    ],
    Knowledge: [
      ['man [topic]', 'help, guidelines, style guides'],
    ],
    Variables: [
      ['var ls [collection]', 'list collections & variables'],
      ['var mk <coll/name> TYPE value', 'create variable (COLOR, FLOAT, BOOLEAN, STRING)'],
      ['var mk --collection <name> --modes A,B', 'create collection with modes'],
      ['var bind Name#id prop coll/name', 'bind variable to node property'],
      ['var alias semantic/name target/name', 'create alias (semantic → primitive)'],
    ],
    Components: [
      ['comp create Name#id', 'convert frame to component'],
      ['comp combine N1#id N2#id --name X', 'combine as variant set'],
      ['comp prop Name#id Prop TYPE [default]', 'add component property'],
      ['comp ls Name#id', 'list component properties & variants'],
      ['comp instance Name#id [--parent P#id]', 'create instance'],
    ],
    Scripting: [
      ['js <code>', 'execute JavaScript (full figma.* API access)'],
    ],
    Pager: [
      ['more <id>', 'page through truncated output'],
    ],
  };

  const lines: string[] = [
    'Advanced operations via CLI syntax. For common tasks, prefer the dedicated tools:',
    '  jsx({markup: "..."})   — create design trees',
    '  inspect({node: "Name#id"}) — read/inspect nodes',
    '  edit({node: "Name#id", props: {...}}) — update properties',
    '',
  ];

  for (const [group, cmds] of Object.entries(COMMAND_CATALOG)) {
    lines.push(`${group}:`);
    for (const [usage, desc] of cmds) {
      lines.push(`  ${usage.padEnd(42)} — ${desc}`);
    }
    lines.push('');
  }

  lines.push(
    'Node addressing: "Name#id" (e.g. "Card#100:5") from jsx/inspect results. "/" = page root.',
    'Glob: /Card/Btn* matches children starting with "Btn".',
    '$LAST: expands to last created/modified node ID.',
    'Chain: cmd1 && cmd2 (and), cmd1 ; cmd2 (seq), cmd1 || cmd2 (or), cmd1 | cmd2 (pipe)',
    '',
    'Examples:',
    '  run({command: "grep Button"})',
    '  run({command: "sed Card#1:2 fillColor:#FFF/#000"})',
    '  run({command: "mv OldTitle#1:3 /Card/NewTitle"})',
    '  run({command: "rm Card#1:2"})',
    '  run({command: "var mk colors/primary COLOR #1A1A1A"})',
  );

  return lines.join('\n');
}

export const runDefinition: ToolDefinition = {
  name: 'run',
  category: 'control',
  display: { displayName: 'Run', group: 'system' },
  executionStrategy: 'sequential',
  description: buildRunDescription(),
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
