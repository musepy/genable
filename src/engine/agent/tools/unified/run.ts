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
    Read: [
      ['ls /path/', 'list children ("/" = page root)'],
      ['tree /path/ [-d N]', 'structural skeleton'],
      ['cat /path/ [-s]', 'full properties (-s = screenshot)'],
    ],
    Write: [
      ['mk /path/ [type] key:value... [-- text]', 'create or update (upsert)'],
      ['  padding:$layout/pad  fill:$bg/primary', '→ $varName binds a Figma variable by name'],
      ['  textStyle:Heading/H1  fillStyle:Brand', '→ applies a local style by name'],
      ['  weight:semibold (or semi-bold)', '→ aliases: thin,light,medium,semibold,bold,extrabold,black'],
      ['mv /src/ /dest/', 'move or rename node'],
      ['rm /path/', 'delete node (supports glob: rm /Card/Old*)'],
      ['cp /src/ /dest/ {overrides}', 'clone with overrides'],
    ],
    'Search & Replace': [
      ['grep <query>', 'search nodes by name/type'],
      ['grep /path/ props', 'discover property values'],
      ['sed /path/ prop:from/to', 'batch property replacement'],
    ],
    Knowledge: [
      ['man [topic]', 'help, guidelines, style guides'],
    ],
    Scripting: [
      ['js <code>', 'execute JavaScript (full figma.* API access)'],
    ],
    Pager: [
      ['more <id>', 'page through truncated output'],
    ],
  };

  const lines: string[] = [`Execute a command via CLI syntax. ${COMMAND_NAMES.length} commands.`, ''];

  for (const [group, cmds] of Object.entries(COMMAND_CATALOG)) {
    lines.push(`${group}:`);
    for (const [usage, desc] of cmds) {
      lines.push(`  ${usage.padEnd(42)} — ${desc}`);
    }
    lines.push('');
  }

  lines.push(
    'Path: "/" = page root, "/Card/" = by name, "/#100:5/" = by Figma ID (# prefix).',
    'Glob: /Card/Btn* matches children starting with "Btn". Works in rm, cat, ls.',
    '$LAST: expands to last created/modified node ID. Works in chains and across calls.',
    'Chain operators:',
    '  &&  run next only if previous succeeded',
    '  ;   run next regardless',
    '  ||  run next only if previous failed',
    '  |   pipe output to next command',
    'Help: command name only (e.g. "mk") for detailed usage.',
    '',
    'Output metadata: [exit:N | Xs] — exit:0 success, exit:1 error, exit:127 not found.',
    '',
    'Examples:',
    '  run({command: "ls /"})',
    '  run({command: "mk /Card/ frame w:400 layout:column p:24 bg:#FFF corner:12"})',
    '  run({command: "mk /Card/Title text size:24 weight:Bold fill:#111 -- Card Title"})',
    '  run({command: "cat /Card/Header/ -s"})',
    '  run({command: "grep Button"})',
    '  run({command: "sed /Card/ fillColor:#FFF/#000"})',
    '  run({command: "mk /Card/ frame w:400 && mk $LAST/Title text size:24 -- Hello"})',
    '  run({command: "mk", input: "/Card/ frame w:400 layout:column\\n/Card/Title text size:24 -- Hello"})',
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
