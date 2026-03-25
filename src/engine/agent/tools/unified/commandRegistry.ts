/**
 * @file commandRegistry.ts
 * @description Registry of individual command definitions.
 * The `run` tool is a single LLM-facing entry point that dispatches to these commands.
 * Downstream code (IPC, validation, cleaning, loop detection) sees command names, not 'run'.
 *
 * CLI form: commands are invoked via CLI strings (e.g. "ls /Card/", "cat /Card/ -s").
 * Help text reflects CLI syntax and includes cross-references for progressive discovery.
 */

import { ToolDefinition } from '../types';
import { rmDefinition, cpDefinition } from './fs';
// Unix CLI commands
import { mvDefinition } from './mv';
import { grepDefinition } from './grep';
import { sedDefinition } from './sed';
import { manDefinition } from './man';
import { jsDefinition } from './js';
import { varDefinition } from './var';
import { compDefinition } from './comp';
import { jsxDefinition } from './jsx';
import { inspectDefinition } from './inspect';
import { editDefinition } from './edit';

/** Built-in `more` command — reads from overflow store (runs locally, no IPC). */
const moreDefinition: ToolDefinition = {
  name: 'more',
  category: 'read',
  display: { displayName: 'More', group: 'read' },
  executionStrategy: 'sequential',
  description: 'Page through truncated output. Usage: more <id>. Supports pipe: more <id> | grep <pattern>',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Overflow ID from truncated output' } }, required: ['id'] },
};

/** All command definitions, keyed by command name. */
const COMMAND_MAP = new Map<string, ToolDefinition>([
  // Unix CLI commands
  [mvDefinition.name, mvDefinition],
  [grepDefinition.name, grepDefinition],
  [sedDefinition.name, sedDefinition],
  [manDefinition.name, manDefinition],
  [jsDefinition.name, jsDefinition],
  [moreDefinition.name, moreDefinition],
  // Design system commands
  [varDefinition.name, varDefinition],
  [compDefinition.name, compDefinition],
  // First-class tools (registered for help/validation)
  [jsxDefinition.name, jsxDefinition],
  [inspectDefinition.name, inspectDefinition],
  [editDefinition.name, editDefinition],
  // FS write commands
  [rmDefinition.name, rmDefinition],
  [cpDefinition.name, cpDefinition],
]);

/** All valid command names. */
export const COMMAND_NAMES = [...COMMAND_MAP.keys()] as const;

/** Check if a string is a valid command name. */
export function isValidCommand(name: string): boolean {
  return COMMAND_MAP.has(name);
}

/** Get the full ToolDefinition for a command. */
export function getCommandDefinition(name: string): ToolDefinition | undefined {
  return COMMAND_MAP.get(name);
}

/** Get all command definitions as an array. */
export function getAllCommandDefinitions(): ToolDefinition[] {
  return [...COMMAND_MAP.values()];
}

/**
 * Find the closest matching command name using Levenshtein distance.
 * Returns null if no close match (distance > 3).
 */
export function findClosestCommand(input: string): string | null {
  const lower = input.toLowerCase();
  let best: string | null = null;
  // Threshold scales with input length: short inputs need closer match
  let bestDist = lower.length <= 3 ? 2 : 4; // max edit distance 1 for short, 3 for long

  for (const name of COMMAND_NAMES) {
    const d = levenshtein(lower, name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
    // Also check prefix match (e.g. "gre" → "grep")
    if (name.startsWith(lower) && lower.length >= 2) {
      return name;
    }
  }
  return best;
}

/** Simple Levenshtein distance (bounded for short strings). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/**
 * Get help text for a command — CLI syntax, example-driven.
 * Used when LLM calls `run({command: "ls"})` with no args (help mode).
 * Pattern: description → CLI usage → examples → see also.
 */
export function getCommandHelp(commandName: string): string {
  const def = COMMAND_MAP.get(commandName);
  if (!def) {
    const suggestion = findClosestCommand(commandName);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return `Unknown command "${commandName}".${hint} Available: ${COMMAND_NAMES.join(', ')}`;
  }

  const help = COMMAND_CLI_HELP[commandName];
  if (help) return help;

  // Fallback: auto-generate from definition
  return [
    `${commandName} — ${def.description.split('\n')[0]}`,
    '',
    `Usage: run({command: "${commandName} ..."})`,
    '',
    `See also: ${COMMAND_SEE_ALSO[commandName] || 'grep, sed, inspect, jsx, edit'}`,
  ].join('\n');
}

/** CLI-style help text for each command. */
const COMMAND_CLI_HELP: Record<string, string> = {
  grep: `grep — Search nodes or discover property values.

Usage:
  grep Button                            search nodes by name
  grep frame                             search nodes by type
  grep Card#1:2 fillColor,fontSize       discover property values in subtree

Modes:
  Node search — first arg is NOT a ref: grep <query>
  Property discovery — first arg IS a ref: grep Name#id prop1,prop2

Properties: fillColor, textColor, strokeColor, strokeWeight, opacity,
            cornerRadius, gap, fontSize, fontFamily, fontWeight

See also: inspect (inspect found node), sed (replace discovered values)`,

  sed: `sed — Batch search-and-replace properties across a subtree.

Usage:
  sed Card#1:2 fillColor:#3B82F6/#8B5CF6
  sed Card#1:2 fontSize:14/16 cornerRadius:8/12

Syntax: sed Name#id prop:from/to [prop:from/to ...]

Node addressing: use Name#id refs from jsx/inspect results.
Use grep first to discover current values, then sed to replace them.

See also: grep (discover values first), inspect (verify changes)`,

  man: `man — Get design guidelines, style guides, and help documentation.

Usage:
  man                           list all help topics
  man components                help topic: components
  man variants                  help topic: variant matrices
  man guidelines dashboard      design guidelines for dashboards
  man style-tags                list available visual style tags
  man style dark-mode,minimal   get visual style guide by tags

Sources: help (default), guidelines, style-tags, style

See also: grep (find nodes), jsx (create)`,

  mv: `mv — Move or rename a design node.

Usage:
  mv OldTitle#1:2 /Card/NewTitle              # rename
  mv Logo#1:3 Footer#1:4                      # move to different parent
  mv Item#1:5 Item#1:5 --at 0                 # reorder to first position

Node addressing: use Name#id refs from jsx/inspect results.

Rules:
  - Dest is existing container → move INTO it (keep original name)
  - Dest doesn't exist → split into parent + name (rename + reparent)
  - Same parent → rename only

See also: cp (clone), rm (delete), edit (update props)`,

  rm: `rm — Delete a node and its children.

Usage:
  rm Card#1:2
  rm Header#1:3
  rm /Card/Placeholder*                       # glob: delete matching nodes

Node addressing: use Name#id refs from jsx/inspect results.

See also: inspect (check before deleting), cp (clone instead)`,

  cp: `cp — Clone a node with overrides.

Usage:
  cp Card#1:2 /Card/Hover/ {bg:#EEE}
  cp Card#1:2 /Card/Disabled/ {bg:#D9D9D9, Label.fill:#999}

Node addressing: use Name#id refs from jsx/inspect results.
Deep-copies the source. ChildName.prop:value overrides child properties.

See also: jsx (create from scratch), comp instance (component instances)`,

  js: `js — Execute JavaScript in the Figma plugin runtime.

Usage:
  js figma.currentPage.children.length                              # expression
  js figma.currentPage.findAll(n => n.type === 'TEXT').length        # query
  js figma.currentPage.selection.map(n => n.name)                   # selection

Multiline (via input):
  run({command: "js", input: "const texts = figma.currentPage.findAll(n => n.type === 'TEXT')\\ntexts.forEach(t => { t.fills = [{type:'SOLID',color:{r:1,g:0,b:0}}] })\\nreturn texts.length"})

Rules:
  - Full access to figma.* API (Plugin API)
  - Use return to output a value (expressions auto-return)
  - Async/await supported
  - Results auto-serialized (nodes → {id, type, name, width, height})
  - Arrays capped at 100 items

See also: inspect (inspect nodes), jsx (create), grep (search nodes)`,

  var: `var — Manage Figma variables (design tokens).

Subcommands:
  var ls                                    list all collections & variables
  var ls Theme                              filter by collection name
  var mk colors/primary COLOR #1A1A1A       create COLOR variable
  var mk spacing/md FLOAT 16                create FLOAT variable
  var mk --collection Theme --modes Light,Dark  create collection with modes
  var mk Theme/bg COLOR #FFF --mode Light   set per-mode value
  var bind Card#1:2 fills Theme/bg          bind variable to node
  var alias semantic/text colors/primary    create alias

Workflow:
  1. var mk --collection ... → create collection
  2. var mk coll/name TYPE value → create variables
  3. var bind Name#id prop coll/name → bind to design nodes

See also: comp (component variants), jsx (create nodes with $var binding), grep (discover properties)`,

  comp: `comp — Manage Figma components and variants.

Subcommands:
  comp create Button#1:2                       convert frame to component
  comp combine Btn1#1:2 Btn2#1:3 --name Button combine as variant set
  comp prop Button#1:2 Label TEXT "Click"       add component property
  comp ls Button#1:2                            list properties & variants
  comp instance Button#1:2 [--parent Card#1:4]  create instance

Node addressing: use Name#id refs from jsx/inspect results.

Workflow:
  1. Create frames with jsx (e.g. Primary, Secondary, Ghost buttons)
  2. comp create Name#id → convert to components
  3. comp combine → merge into variant set
  4. comp prop → add configurable properties

See also: var (design tokens), jsx (create frames), cp (clone with overrides)`,

  more: `more — Page through truncated output.

Usage:
  more 1                          view full output of overflow/1
  more 1 | grep ERROR             search in truncated output
  more 1 | tail 50                last 50 lines

When a command output exceeds 200 lines, it is truncated and saved.
The truncation message includes "overflow/N" — use more N to retrieve it.

See also: inspect (read nodes), grep (search)`,

  jsx: `jsx — Create design trees with nested JSX-like syntax.

Usage:
  run({command: "jsx", input: "<frame name='Card' w={400} layout='column' p={24} bg='#FFF' corner={12}>\\n  <text name='Title' size={24} weight='Bold' fill='#111'>Card Title</text>\\n  <text name='Body' size={14} fill='#666' w='fill'>Description</text>\\n</frame>"})

Elements: frame, text, rect, ellipse, line, icon, image, instance, component, group, section, vector

Attributes: same shorthands as mk (w, h, bg, layout, gap, p, corner, fill, size, weight)

Syntax:
  <type name="..." key={number} key="string">children</type>
  <type key={value}/>                                          self-closing
  <text size={24}>text content here</text>                     text content
  <instance ref="Button" variant="Size=Large"/>                component instance

Multiple roots:
  <frame name="A" ...>...</frame>
  <frame name="B" ...>...</frame>

Use jsx for tree creation (5+ nodes). Use edit for updates.

See also: edit (update props), inspect (inspect result), man (design guidelines)`,

};

/** Cross-references between commands for progressive discovery. */
const COMMAND_SEE_ALSO: Record<string, string> = {
  mv: 'cp (clone), rm (delete), edit (update props)',
  grep: 'inspect (inspect found node), sed (replace values)',
  sed: 'grep (discover values first), inspect (verify changes)',
  man: 'grep (find nodes), jsx (create)',
  rm: 'inspect (check before deleting), cp (clone instead)',
  cp: 'jsx (create from scratch), comp instance (component instances)',
  js: 'inspect (inspect nodes), jsx (create), grep (search nodes)',
  more: 'inspect (read nodes), grep (search)',
  var: 'comp (component variants), jsx (create with $var binding), grep (discover values)',
  comp: 'var (design tokens), jsx (create frames), cp (clone with overrides)',
  jsx: 'edit (update props), inspect (inspect result), man (design guidelines)',
};
