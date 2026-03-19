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
// New Unix CLI commands
import { mkDefinition } from './mk';
import { mvDefinition } from './mv';
import { grepDefinition } from './grep';
import { sedDefinition } from './sed';
import { manDefinition } from './man';
import { jsDefinition } from './js';
import { subtaskDefinition } from './subtask';
import { varDefinition } from './var';
import { compDefinition } from './comp';
import { renderDefinition } from './render';
import { tokenDefinition } from './token';

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
  // VFS read commands
  [lsDefinition.name, lsDefinition],
  [treeDefinition.name, treeDefinition],
  [catDefinition.name, catDefinition],
  // New Unix CLI commands
  [mkDefinition.name, mkDefinition],
  [mvDefinition.name, mvDefinition],
  [grepDefinition.name, grepDefinition],
  [sedDefinition.name, sedDefinition],
  [manDefinition.name, manDefinition],
  [jsDefinition.name, jsDefinition],
  [moreDefinition.name, moreDefinition],
  [subtaskDefinition.name, subtaskDefinition],
  // Design system commands
  [varDefinition.name, varDefinition],
  [compDefinition.name, compDefinition],
  // Semantic rendering
  [renderDefinition.name, renderDefinition],
  [tokenDefinition.name, tokenDefinition],
  // FS write commands — path-based
  [rmDefinition.name, rmDefinition],
  [cpDefinition.name, cpDefinition],
  // Legacy commands (backward compat — will be removed in future)
  [designDefinition.name, designDefinition],
  [replaceDefinition.name, replaceDefinition],
  [queryDefinition.name, queryDefinition],
  [mkdirDefinition.name, mkdirDefinition],
  [mktextDefinition.name, mktextDefinition],
  [writeDefinition.name, writeDefinition],
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
    `See also: ${COMMAND_SEE_ALSO[commandName] || 'ls, tree, cat, design, replace, query'}`,
  ].join('\n');
}

/** CLI-style help text for each command. */
const COMMAND_CLI_HELP: Record<string, string> = {
  mk: `mk — Create or update a design node (upsert).

Usage:
  mk /Card/ frame w:400 layout:column gap:16 p:24 bg:#FFF corner:12
  mk /Card/Title text size:24 weight:Bold fill:#111 -- Card Title
  mk /Card/ corner:16                                  # update existing
  mk /Card/Btn ref:Button variant:'Size=Large'          # component instance

Rules:
  - Path exists → UPDATE (only listed props change, type ignored)
  - Path doesn't exist → CREATE (type defaults to frame)
  - Props: space-separated key:value. Quote complex values.
  - -- separates props from text content
  - ref:Name creates a component instance

Batch (multiple lines via input):
  run({command: "mk", input: "/Card/ frame w:400\\n/Card/Title text size:24 -- Hello"})

See also: cat (read before writing), grep (find nodes), man (usage guides)`,

  grep: `grep — Search nodes or discover property values.

Usage:
  grep Button                        search nodes by name
  grep frame                         search nodes by type
  grep /Card/ fillColor,fontSize     discover property values in subtree

Modes:
  Node search — first arg is NOT a path: grep <query> [/scope/]
  Property discovery — first arg IS a path: grep /path/ prop1,prop2

Properties: fillColor, textColor, strokeColor, strokeWeight, opacity,
            cornerRadius, gap, fontSize, fontFamily, fontWeight

See also: cat (inspect found node), sed (replace discovered values)`,

  sed: `sed — Batch search-and-replace properties across a subtree.

Usage:
  sed /Card/ fillColor:#3B82F6/#8B5CF6
  sed /Card/ fontSize:14/16 cornerRadius:8/12
  sed /100:5/ textColor:#000/#FFF fillColor:#FFF/#1A1A2E

Syntax: sed /path/ prop:from/to [prop:from/to ...]

Use grep first to discover current values, then sed to replace them.

See also: grep (discover values first), cat (verify changes)`,

  man: `man — Get design guidelines, style guides, and help documentation.

Usage:
  man                           list all help topics
  man components                help topic: components
  man variants                  help topic: variant matrices
  man guidelines dashboard      design guidelines for dashboards
  man style-tags                list available visual style tags
  man style dark-mode,minimal   get visual style guide by tags

Sources: help (default), guidelines, style-tags, style

See also: grep (find nodes), mk (create/update)`,

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

  mv: `mv — Move or rename a design node.

Usage:
  mv /Card/OldTitle /Card/NewTitle            # rename
  mv /Card/Header/Logo /Card/Footer/Logo      # move + rename
  mv /Card/Header/Logo /Card/Footer/          # move into Footer, keep name

Rules:
  - Dest is existing container → move INTO it (keep original name)
  - Dest doesn't exist → split into parent + name (rename + reparent)
  - Same parent → rename only

See also: cp (clone), rm (delete), mk (create/update)`,

  rm: `rm — Delete a node and its children.

Usage:
  rm /Card/OldSection/
  rm /Card/Header/Icon
  rm /Card/Placeholder*                       # glob: delete matching nodes

See also: ls (check before deleting), cp (clone instead)`,

  cp: `cp — Clone a node to a new path with overrides.

Usage:
  cp /Card/Default/ /Card/Hover/ {bg:#EEE}
  cp /Card/Default/ /Card/Disabled/ {bg:#D9D9D9, Label.fill:#999}

Deep-copies the source. ChildName.prop:value overrides child properties.

See also: mkdir (create from scratch), ln (component instances)`,

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

See also: cat (inspect nodes), mk (create/update), grep (search nodes)`,

  subtask: `subtask — Delegate a focused sub-task to a child agent.

Usage:
  subtask Design a sidebar with nav links and user avatar
  subtask Create a data table with 5 columns and sample rows

The child agent:
  - Shares your tools, canvas, and system prompt
  - Has its own iteration budget (max 20 iterations)
  - Returns its result and statistics when done
  - Is automatically canceled if you are canceled

Use for independent pieces of complex designs. Don't use for
simple operations that take 1-2 tool calls.

See also: man (design guidelines), mk (create/update)`,

  var: `var — Manage Figma variables (design tokens).

Subcommands:
  var ls                                    list all collections & variables
  var ls Theme                              filter by collection name
  var mk colors/primary COLOR #1A1A1A       create COLOR variable
  var mk spacing/md FLOAT 16                create FLOAT variable
  var mk --collection Theme --modes Light,Dark  create collection with modes
  var mk Theme/bg COLOR #FFF --mode Light   set per-mode value
  var bind /Card/ fills Theme/bg            bind variable to node
  var alias semantic/text colors/primary    create alias

Workflow:
  1. var mk --collection ... → create collection
  2. var mk coll/name TYPE value → create variables
  3. var bind /path/ prop coll/name → bind to design nodes

See also: comp (component variants), mk (create nodes with $var binding), grep (discover properties)`,

  comp: `comp — Manage Figma components and variants.

Subcommands:
  comp create /Button/Primary                  convert frame to component
  comp combine /Btn1/ /Btn2/ --name Button     combine as variant set
  comp prop /Button/ Label TEXT "Click"         add component property
  comp ls /Button/                              list properties & variants
  comp instance /Button/ --parent /Card/        create instance

Workflow:
  1. Create frames with mk (e.g. Primary, Secondary, Ghost buttons)
  2. comp create /each/frame → convert to components
  3. comp combine → merge into variant set
  4. comp prop → add configurable properties

See also: var (design tokens), mk (create frames), cp (clone with overrides)`,

  more: `more — Page through truncated output.

Usage:
  more 1                          view full output of overflow/1
  more 1 | grep ERROR             search in truncated output
  more 1 | tail 50                last 50 lines

When a command output exceeds 200 lines, it is truncated and saved.
The truncation message includes "overflow/N" — use more N to retrieve it.

See also: cat (read nodes), grep (search), tree (structure)`,

  token: `token — View and customize style tokens for render command.

Subcommands:
  token ls                                    list all tokens with values
  token ls text                               text tokens only
  token ls container                          container tokens only
  token set bubble fill:#1E1B4B corner:20     update existing token
  token set my-label --text size:14 fill:#666 create new text token
  token set my-box --container p:32 fill:#FFF create new container token
  token rm my-label                           remove custom token (defaults can't be removed)
  token reset                                 reset all to defaults

Tokens define visual styles for the render command.
Props use mk shorthand: size, weight, fill, corner, p, gap, layout, w, h, etc.

See also: render (use tokens), man (design guidelines)`,

  render: `render — Create designs using style tokens (semantic markup).

Usage:
  run({command: "render", input: "card\\n  h1: \\"Dashboard\\"\\n  body: \\"Overview\\""})

Syntax (indentation = nesting):
  container-token [override:value ...]
    text-token: "content"

Text tokens: h1, h2, h3, body, body-sm, caption, stat-value, stat-label, overline
Container tokens: page, card, row, column, section, chip

Examples:
  card
    h1: "Settings"
    body: "Manage your account"

  page
    row gap:24
      card
        stat-value: "1,234"
        stat-label: "Users"
      card
        stat-value: "$45.6K"
        stat-label: "Revenue"

Container overrides: row gap:24, card fill:#F8FAFC p:32

See also: mk (custom designs), cat (inspect result)`,

  ln: `ln — Create a component instance at a path.

Usage:
  ln /Card/BtnInst Button {variant:'Size=Large'}
  ln /Form/Input TextInput {set:placeholder:'Email'}

References an existing Component or ComponentSet by name.

See also: cp (clone without components), design (batch instances)`,
};

/** Cross-references between commands for progressive discovery. */
const COMMAND_SEE_ALSO: Record<string, string> = {
  mk: 'cat (read before writing), grep (find nodes), man (usage guides)',
  mv: 'cp (clone), rm (delete), mk (create/update)',
  grep: 'cat (inspect found node), sed (replace values)',
  sed: 'grep (discover values first), cat (verify changes)',
  man: 'grep (find nodes), mk (create/update)',
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
  js: 'cat (inspect nodes), mk (create/update), grep (search nodes)',
  subtask: 'man (design guidelines), mk (create/update)',
  more: 'cat (read nodes), grep (search), tree (structure)',
  var: 'comp (component variants), mk (create with $var binding), grep (discover values)',
  comp: 'var (design tokens), mk (create frames), cp (clone with overrides)',
  render: 'mk (custom designs), token (customize styles), cat (inspect result)',
  token: 'render (use tokens), var (design tokens), man (guidelines)',
};
