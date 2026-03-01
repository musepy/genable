/**
 * @file lineParser.ts
 * @description Parses a TokenizedLine (produced by lineTokenizer) into a structured
 * ParsedLine object ready for downstream action translation.
 *
 * Supported grammar (informal):
 *   [symbol =] command( [nodeType,] [parent=ref,] [targetRef,] [{props}] )
 *
 * Commands: create | update | delete | icon | image
 * Aliases: see COMMAND_ALIAS_MAP
 *
 * Error handling: if a line cannot be parsed, a ParsedLine with command 'PARSE_ERROR'
 * is returned and the error details are stored in `props`.
 */

import { TokenizedLine } from './lineTokenizer';
import { parseProps } from './propsParser';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedLine {
  /** 1-based line number in the original instruction text */
  lineNumber: number;
  /** Original raw text of the line */
  raw: string;
  /** Binding name (left-hand side of `=`), e.g. "header" */
  symbol?: string;
  /**
   * Normalized command name: create | update | delete | icon | image | PARSE_ERROR
   */
  command: string;
  /**
   * For `create`: the Figma node type (FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, ICON, etc.)
   * Derived from either the alias or the first positional argument.
   */
  nodeType?: string;
  /**
   * For `update` / `delete`: the target node reference (symbol or Figma ID)
   */
  targetRef?: string;
  /** The `parent=` named argument, giving the parent node reference */
  parentRef?: string;
  /** Parsed properties object from the `{...}` block */
  props?: Record<string, any>;
  /**
   * Auto-computed list of symbol references this line depends on.
   * Populated from parentRef and targetRef, excluding real Figma IDs
   * (real IDs contain `:`) and the literal keyword "root".
   */
  dependsOn: string[];
}

// ---------------------------------------------------------------------------
// Alias map
// ---------------------------------------------------------------------------

interface AliasTarget {
  command: string;
  nodeType?: string;
}

const COMMAND_ALIAS_MAP: Record<string, AliasTarget> = {
  // --- create variants ---
  create: { command: 'create' },
  createFrame: { command: 'create', nodeType: 'FRAME' },
  createText: { command: 'create', nodeType: 'TEXT' },
  createShape: { command: 'create', nodeType: 'RECTANGLE' },
  // --- update variants ---
  update: { command: 'update' },
  setLayout: { command: 'update' },
  setStyles: { command: 'update' },
  updateProps: { command: 'update' },
  // --- delete variants ---
  delete: { command: 'delete' },
  deleteNode: { command: 'delete' },
  // --- icon ---
  icon: { command: 'icon' },
  createIcon: { command: 'icon' },
  // --- image ---
  image: { command: 'image' },
};

// ---------------------------------------------------------------------------
// Valid node types for `create` command first-positional argument
// ---------------------------------------------------------------------------

const KNOWN_NODE_TYPES = new Set([
  'FRAME', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR', 'ICON',
  'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single tokenized line into a ParsedLine.
 *
 * @param line - A TokenizedLine produced by `tokenizeLines`
 * @returns A ParsedLine, possibly with command 'PARSE_ERROR' on failure
 */
export function parseLine(line: TokenizedLine): ParsedLine {
  try {
    return parseLineInternal(line);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      lineNumber: line.lineNumber,
      raw: line.raw,
      command: 'PARSE_ERROR',
      dependsOn: [],
      props: { error: message, raw: line.raw },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

function parseLineInternal(line: TokenizedLine): ParsedLine {
  const { raw, lineNumber } = line;

  // ------------------------------------------------------------------
  // 1. Extract optional symbol binding: `symbol = command(...)`
  // ------------------------------------------------------------------
  let symbol: string | undefined;
  let rest = raw;

  const eqIndex = findAssignmentEquals(raw);
  if (eqIndex !== -1) {
    const lhs = raw.slice(0, eqIndex).trim();
    // lhs must be a single identifier (no spaces, no special chars except _$)
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(lhs)) {
      symbol = lhs;
      rest = raw.slice(eqIndex + 1).trim();
    }
    // If lhs is not a valid identifier, treat the whole line as a bare command
  }

  // ------------------------------------------------------------------
  // 2. Extract command name and argument string
  // ------------------------------------------------------------------
  const parenOpen = rest.indexOf('(');
  if (parenOpen === -1) {
    throw new Error(`No opening parenthesis found in: ${raw}`);
  }

  const rawCommand = rest.slice(0, parenOpen).trim();
  if (!rawCommand) {
    throw new Error(`Empty command name in: ${raw}`);
  }

  // Find the matching closing paren (respects nesting + quotes)
  const parenClose = findMatchingParen(rest, parenOpen);
  if (parenClose === -1) {
    throw new Error(`Unmatched parenthesis in: ${raw}`);
  }

  const argsContent = rest.slice(parenOpen + 1, parenClose);

  // ------------------------------------------------------------------
  // 3. Resolve command alias
  // ------------------------------------------------------------------
  const aliasResult = resolveAlias(rawCommand);
  if (!aliasResult) {
    throw new Error(`Unknown command '${rawCommand}' in: ${raw}`);
  }

  const { command, nodeType: aliasNodeType } = aliasResult;

  // ------------------------------------------------------------------
  // 4. Parse argument list
  // ------------------------------------------------------------------
  const args = splitArgs(argsContent);

  let nodeType: string | undefined = aliasNodeType;
  let targetRef: string | undefined;
  let parentRef: string | undefined;
  let props: Record<string, any> | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i].trim();
    if (!arg) continue;

    // Named argument: parent=... or any other key=value
    if (arg.toLowerCase().startsWith('parent=')) {
      parentRef = extractNamedArgValue(arg, 'parent');
      continue;
    }

    // Props block: starts with {
    if (arg.startsWith('{')) {
      props = parseProps(arg);
      continue;
    }

    // First positional argument
    if (i === 0 || isFirstUnnamed(i, args)) {
      if (command === 'create') {
        // For create, first positional is the node type
        const upper = arg.toUpperCase();
        if (KNOWN_NODE_TYPES.has(upper)) {
          nodeType = upper;
          continue;
        }
        // If it's not a known type, check if it looks like a type anyway
        if (/^[A-Z_]+$/.test(upper)) {
          nodeType = upper;
          continue;
        }
        // Possibly the args were reordered — treat as unknown
      } else if (command === 'update' || command === 'delete') {
        // First positional is the target reference
        targetRef = arg;
        continue;
      }
    }

    // Subsequent positional that wasn't caught above — check for node type patterns
    if (command === 'create' && !nodeType) {
      const upper = arg.toUpperCase();
      if (KNOWN_NODE_TYPES.has(upper) || /^[A-Z_]+$/.test(upper)) {
        nodeType = upper;
        continue;
      }
    }

    // Unknown positional — may be a bareword ref for update/delete we missed
    if ((command === 'update' || command === 'delete') && !targetRef && !arg.startsWith('{')) {
      targetRef = arg;
    }
  }

  // ------------------------------------------------------------------
  // 5. Fallback: if icon/image still missing parentRef, check props
  // ------------------------------------------------------------------
  if (!parentRef && props && typeof props.parent === 'string') {
    parentRef = props.parent;
    delete props.parent;
  }

  // ------------------------------------------------------------------
  // 6. Compute dependsOn
  // ------------------------------------------------------------------
  const dependsOn = computeDependsOn(parentRef, targetRef);

  return {
    lineNumber,
    raw,
    symbol,
    command,
    nodeType,
    targetRef,
    parentRef,
    props,
    dependsOn,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the index of the `=` that acts as an assignment operator.
 * Skips over `==`, `>=`, `<=`, `!=` and any `=` inside quotes/parens/braces.
 * Returns -1 if no assignment equals is found.
 */
function findAssignmentEquals(raw: string): number {
  let inQuote: '"' | "'" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '(') { parenDepth++; continue; }
    if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); continue; }
    if (ch === '{') { braceDepth++; continue; }
    if (ch === '}') { braceDepth = Math.max(0, braceDepth - 1); continue; }

    if (ch === '=' && parenDepth === 0 && braceDepth === 0) {
      // Make sure it's not ==, >=, <=, !=
      const prev = i > 0 ? raw[i - 1] : '';
      const next = i + 1 < raw.length ? raw[i + 1] : '';
      if (next === '=' || prev === '!' || prev === '<' || prev === '>' || prev === '=') {
        continue;
      }
      return i;
    }
  }

  return -1;
}

/**
 * Find the index of the closing parenthesis that matches the opening paren at `openIdx`.
 * Respects nesting and quoted strings.
 */
function findMatchingParen(str: string, openIdx: number): number {
  let depth = 0;
  let inQuote: '"' | "'" | null = null;

  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];

    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }

    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Split the argument content (inside parentheses) into individual argument strings.
 * Respects nesting (parens, braces) and quoted strings — commas inside these are NOT
 * treated as separators.
 */
function splitArgs(argsContent: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < argsContent.length; i++) {
    const ch = argsContent[i];

    if (inQuote) {
      current += ch;
      if (ch === '\\') {
        i++;
        if (i < argsContent.length) current += argsContent[i];
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') { parenDepth++; current += ch; continue; }
    if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); current += ch; continue; }
    if (ch === '{') { braceDepth++; current += ch; continue; }
    if (ch === '}') { braceDepth = Math.max(0, braceDepth - 1); current += ch; continue; }

    if (ch === ',' && parenDepth === 0 && braceDepth === 0) {
      args.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    args.push(current);
  }

  return args;
}

/**
 * Extract the value from a named argument string like `parent=foo` or `parent="bar baz"`.
 */
function extractNamedArgValue(arg: string, paramName: string): string {
  const prefixLen = paramName.length + 1; // +1 for '='
  const raw = arg.slice(prefixLen).trim();

  // Remove surrounding quotes if present
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

/**
 * Check whether argument at index `i` is actually the first unnamed positional.
 * An argument is "unnamed" if it does not contain `=` at the top level outside quotes.
 */
function isFirstUnnamed(i: number, args: string[]): boolean {
  // Check all args before index i — if any are unnamed non-props, this isn't first
  for (let j = 0; j < i; j++) {
    const a = args[j].trim();
    if (!a) continue;
    if (a.startsWith('{')) continue;            // props block
    if (/^[a-z]+=/.test(a)) continue;          // named arg like parent=...
    // Found a prior unnamed arg
    return false;
  }
  return true;
}

/**
 * Resolve a raw command string to its canonical command and optional node type.
 * Returns null if the command is unrecognized.
 */
function resolveAlias(rawCommand: string): AliasTarget | null {
  // Direct lookup
  if (rawCommand in COMMAND_ALIAS_MAP) {
    return COMMAND_ALIAS_MAP[rawCommand];
  }

  // Case-insensitive fallback
  const lower = rawCommand.toLowerCase();
  for (const [key, value] of Object.entries(COMMAND_ALIAS_MAP)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  return null;
}

/**
 * Determine which symbols this line depends on, given the parentRef and targetRef.
 *
 * A reference is a symbol (dependency) if:
 *   - It is not undefined
 *   - It is not the literal string "root" (which maps to the page root, not a symbol)
 *   - It does not look like a real Figma node ID (real IDs contain `:`)
 */
function computeDependsOn(
  parentRef: string | undefined,
  targetRef: string | undefined
): string[] {
  const deps = new Set<string>();

  for (const ref of [parentRef, targetRef]) {
    if (!ref) continue;
    if (ref === 'root') continue;
    if (ref.includes(':')) continue; // Real Figma ID (e.g., "123:456")
    deps.add(ref);
  }

  return Array.from(deps);
}
