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
import { lsDefinition, catDefinition, treeDefinition } from './vfs';
import { designDefinition } from './design';
import { replaceDefinition } from './replace';
import { queryDefinition } from './query';
import {
  mkdirDefinition, mktextDefinition, writeDefinition,
  rmDefinition, cpDefinition, lnDefinition,
} from './fs';

/** All command definitions, keyed by command name. */
const COMMAND_MAP = new Map<string, ToolDefinition>([
  // VFS read commands (replaces context/outline/inspect)
  [lsDefinition.name, lsDefinition],
  [treeDefinition.name, treeDefinition],
  [catDefinition.name, catDefinition],
  // Write commands
  [designDefinition.name, designDefinition],
  [replaceDefinition.name, replaceDefinition],
  [queryDefinition.name, queryDefinition],
  // FS write commands — path-based create/modify/delete
  [mkdirDefinition.name, mkdirDefinition],
  [mktextDefinition.name, mktextDefinition],
  [writeDefinition.name, writeDefinition],
  [rmDefinition.name, rmDefinition],
  [cpDefinition.name, cpDefinition],
  [lnDefinition.name, lnDefinition],
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
 * Get help text for a command — CLI syntax, example-driven.
 * Used when LLM calls `run({command: "ls"})` with no args (help mode).
 * Pattern: description → CLI usage → examples → see also.
 */
export function getCommandHelp(commandName: string): string {
  const def = COMMAND_MAP.get(commandName);
  if (!def) {
    return `Unknown command "${commandName}". Available: ${COMMAND_NAMES.join(', ')}`;
  }

  const help = COMMAND_CLI_HELP[commandName];
  if (help) return help;

  // Fallback: auto-generate from definition
  return [
    `${commandName} — ${def.description.split('\n')[0]}`,
    '',
    `Usage: run({command: "${commandName} ..."})`,
    '',
    `See also: ${COMMAND_SEE_ALSO[commandName] || 'ls, tree, cat, design, replace, query'}`,
  ].join('\n');
}

/** CLI-style help text for each command. */
const COMMAND_CLI_HELP: Record<string, string> = {
  ls: `ls — List children of a design node.

Usage:
  ls /                      page root
  ls /Card/                 Card's children
  ls /Card/Header/          nested path

Shows: name, type, dimensions, layout, key properties.
Nodes with children shown with trailing "/".

See also: tree (structural hierarchy), cat (full properties)`,

  tree: `tree — Show structural tree of a design node.

Usage:
  tree /                    page structure
  tree /Card/               Card subtree
  tree /Card/ -d 2          shallow tree (depth 2)

Flags:
  -d N, --depth N           max depth (default 5, max 10)

Returns suggestedReads — paths worth inspecting with cat.
~100-300 tokens, much cheaper than cat for understanding structure.

See also: cat (full details), ls (quick listing)`,

  cat: `cat — Read full properties of a design node.

Usage:
  cat /Card/                full properties
  cat /Card/Header/Title    specific node
  cat /Card/ -s             with screenshot

Flags:
  -s, --screenshot          capture visual screenshot
  -d N, --depth N           max depth (default 5, max 10)

Output: XML with abbreviated attributes (w, h, layout, fill, size, weight, corner, p, shadow).
Auto-degrades to structural view when tree is large.

See also: tree (overview first), design (modify what you see)`,

  design: `design — Create, edit, or delete design nodes via flat ops.

Usage:
  run({command: "design", input: "card = frame(root, {w:400, h:'hug', bg:'#FFF'})"})
  run({command: "design -p 100:5", input: "update('100:6', {bg:'#000'})"})

Flags:
  -p ID, --parent ID        parent node for new nodes

Ops go in the "input" parameter (multiline). Syntax:
  symbol = type(parent, {props})          — create
  symbol = type(parent, {props}, 'text')  — create with content
  update('nodeId', {props})               — edit
  delete('nodeId')                        — delete

See also: cat (read before editing), tree (understand structure)`,

  replace: `replace — Batch search/replace properties across a subtree.

Usage:
  replace search <rootId> fillColor,textColor
  replace apply <rootId>  (with input = JSON replacements)

Modes:
  search    discover unique values for properties
  apply     replace from→to across subtree

Supported: fillColor, textColor, strokeColor, strokeWeight, opacity,
           cornerRadius, gap, fontSize, fontFamily, fontWeight

See also: cat (inspect before replacing), query nodes (find targets)`,

  query: `query — Search canvas nodes, guidelines, styles, and help.

Usage:
  query nodes button        search canvas for "button"
  query guidelines dashboard  design guidelines for dashboards
  query style-tags          list available style tags
  query style <tags>        get visual style guide
  query help                tool & workflow documentation
  query help <topic>        specific topic (components, variants, etc.)

See also: ls (browse by path), cat (read specific node)`,

  mkdir: `mkdir — Create a new frame node at a path.

Usage:
  mkdir /Card/ {w:400, layout:column, p:24, bg:#FFF}
  mkdir /Card/Header/ {layout:row, gap:8, w:fill}
  mkdir /Card/Icon/ -t ellipse {w:40, h:40, fill:#3B82F6}

Flags:
  -t TYPE, --type TYPE    node type (default: frame). Options: rect, ellipse, line, section, group

Path: last segment = name, prefix = parent. Props use design shorthands.

See also: mktext (text nodes), write (update), design (batch ops)`,

  mktext: `mktext — Create a new text node at a path.

Usage:
  mktext /Card/Title {size:24, weight:Bold, fill:#111} Card Title
  mktext /Card/Desc {size:14, fill:#6B7280, w:fill} Description text
  mktext /Card/Label Hello World

Text content follows the props block (or directly after path if no props).

See also: mkdir (frames), write (update text), design (batch ops)`,

  write: `write — Update properties of an existing node.

Usage:
  write /Card/ {bg:#000, corner:16}
  write /Card/Title {size:28, fill:#FFF}

Only listed properties change — unspecified remain unchanged.

See also: cat (read before writing), mkdir (create new)`,

  rm: `rm — Delete a node and its children.

Usage:
  rm /Card/OldSection/
  rm /Card/Header/Icon

See also: ls (check before deleting), cp (clone instead)`,

  cp: `cp — Clone a node to a new path with overrides.

Usage:
  cp /Card/Default/ /Card/Hover/ {bg:#EEE}
  cp /Card/Default/ /Card/Disabled/ {bg:#D9D9D9, Label.fill:#999}

Deep-copies the source. ChildName.prop:value overrides child properties.

See also: mkdir (create from scratch), ln (component instances)`,

  ln: `ln — Create a component instance at a path.

Usage:
  ln /Card/BtnInst Button {variant:'Size=Large'}
  ln /Form/Input TextInput {set:placeholder:'Email'}

References an existing Component or ComponentSet by name.

See also: cp (clone without components), design (batch instances)`,
};

/** Cross-references between commands for progressive discovery. */
const COMMAND_SEE_ALSO: Record<string, string> = {
  ls: 'tree (structural hierarchy), cat (full properties)',
  tree: 'cat (full details for specific nodes), ls (quick listing)',
  cat: 'tree (overview first), write (modify what you see)',
  design: 'cat (read before editing), mkdir/mktext (path-based create)',
  replace: 'cat (inspect before replacing), query (find targets)',
  query: 'ls (browse by path), cat (read specific node)',
  mkdir: 'mktext (text nodes), write (update), design (batch ops)',
  mktext: 'mkdir (frames), write (update text), design (batch ops)',
  write: 'cat (read before writing), mkdir (create new)',
  rm: 'ls (check before deleting), cp (clone instead)',
  cp: 'mkdir (create from scratch), ln (component instances)',
  ln: 'cp (clone without components), design (batch instances)',
};
