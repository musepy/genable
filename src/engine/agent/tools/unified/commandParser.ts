/**
 * @file commandParser.ts
 * @description Parse CLI-style command strings into structured tool args.
 *
 * Converts LLM-native CLI syntax into internal tool parameter objects.
 * Handles: "ls /Card/", "cat /Card/ -s", "tree / && cat /Card/Header/"
 *
 * Design: Layer 1 of the dual-layer architecture (execution layer).
 * - Tokenize respecting quoted strings
 * - Parse flags (-s, --depth 3) and positional args
 * - Map to tool-specific arg schemas
 * - Split && chains into sequential commands
 */

import { isValidCommand } from './commandRegistry';

// ── Types ──────────────────────────────────────────────────────────

export interface ParsedCommand {
  name: string;
  positionalArgs: string[];
  flags: Record<string, string | boolean>;
  raw: string;
}

export interface ParsedChain {
  commands: ParsedCommand[];
  /** Operators between commands. Length = commands.length - 1. */
  operators: ('&&')[];
}

// ── Tokenizer ──────────────────────────────────────────────────────

/**
 * Tokenize a command string, respecting single and double quotes.
 * "ls /My Card/"         → ["ls", "/My Card/"]
 * "cat '/path with spaces/'" → ["cat", "/path with spaces/"]
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
        // Don't include quote char in token
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '{') {
      // Brace-aware collection: keep {...} as a single token
      if (current) { tokens.push(current); current = ''; }
      let braceDepth = 1;
      current = '{';
      let inBraceQuote: string | null = null;
      while (++i < input.length && braceDepth > 0) {
        const bc = input[i];
        current += bc;
        if (inBraceQuote) {
          if (bc === inBraceQuote) inBraceQuote = null;
        } else if (bc === '"' || bc === "'") {
          inBraceQuote = bc;
        } else if (bc === '{') {
          braceDepth++;
        } else if (bc === '}') {
          braceDepth--;
        }
      }
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

// ── Single command parser ──────────────────────────────────────────

/**
 * Parse a single command segment (no chain operators).
 *
 * "cat /Card/ -s --depth 3"
 * → { name: "cat", positionalArgs: ["/Card/"], flags: { s: true, depth: "3" } }
 */
function parseSingleCommand(raw: string): ParsedCommand {
  const tokens = tokenize(raw.trim());

  if (tokens.length === 0) {
    return { name: '', positionalArgs: [], flags: {}, raw };
  }

  const name = tokens[0];
  const positionalArgs: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith('--') && token.length > 2) {
      // Long flag: --depth 3 or --screenshot (boolean)
      const flagName = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('-')) {
        flags[flagName] = next;
        i++;
      } else {
        flags[flagName] = true;
      }
    } else if (token.startsWith('-') && token.length === 2 && !token.startsWith('-/')) {
      // Short flag: -s or -d 3
      const flagName = token.slice(1);
      const next = tokens[i + 1];
      // Next token is a value if it doesn't look like a flag or path
      if (next && !next.startsWith('-') && !/^\//.test(next)) {
        flags[flagName] = next;
        i++;
      } else {
        flags[flagName] = true;
      }
    } else {
      positionalArgs.push(token);
    }
  }

  return { name, positionalArgs, flags, raw };
}

// ── Chain parser ───────────────────────────────────────────────────

/**
 * Parse a command string, splitting by && chain operators.
 *
 * "tree / && cat /Card/Header/"
 * → { commands: [parse("tree /"), parse("cat /Card/Header/")], operators: ['&&'] }
 *
 * Respects quoted strings — && inside quotes is not treated as an operator.
 */
export function parseCommandString(input: string): ParsedChain {
  const segments: string[] = [];
  const operators: ('&&')[] = [];

  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      current += ch;
      inQuote = ch;
    } else if (ch === '&' && input[i + 1] === '&') {
      if (current.trim()) segments.push(current.trim());
      operators.push('&&');
      current = '';
      i++; // skip second &
    } else {
      current += ch;
    }
  }

  if (current.trim()) segments.push(current.trim());

  return {
    commands: segments.map(parseSingleCommand),
    operators,
  };
}

// ── Arg mapping ────────────────────────────────────────────────────

/**
 * Map parsed CLI command to internal tool args based on command name.
 * Returns null if the command can't be mapped (triggers help mode).
 *
 * @param parsed - The parsed command (name + positionalArgs + flags)
 * @param input  - Optional multiline input (like stdin), used for design ops
 */
export function mapToToolArgs(
  parsed: ParsedCommand,
  input?: string,
): Record<string, any> | null {
  const { name, positionalArgs: pos, flags } = parsed;

  switch (name) {
    case 'ls':
      return { path: pos[0] || '/' };

    case 'tree': {
      const args: Record<string, any> = { path: pos[0] || '/' };
      const depth = flags['d'] || flags['depth'];
      if (depth) args.depth = Number(depth);
      return args;
    }

    case 'cat': {
      const args: Record<string, any> = { path: pos[0] || '/' };
      if (flags['s'] || flags['screenshot']) args.screenshot = true;
      const depth = flags['d'] || flags['depth'];
      if (depth) args.depth = Number(depth);
      return args;
    }

    case 'design': {
      const ops = input || pos.join('\n') || '';
      if (!ops) return null; // trigger help
      const args: Record<string, any> = { ops };
      const parentId = flags['p'] || flags['parent'];
      if (parentId) args.parentId = parentId;
      return args;
    }

    case 'replace': {
      const mode = pos[0]; // 'search' or 'replace'
      const rootId = pos[1];
      if (!mode || !rootId) return null; // trigger help

      if (mode === 'search') {
        // replace search <rootId> prop1,prop2
        const props = pos[2] ? pos[2].split(',') : [];
        return { mode: 'search', rootId, properties: props };
      } else if (mode === 'replace' || mode === 'apply') {
        // replace apply <rootId> — replacements via input
        const raw = input || pos.slice(2).join(' ');
        if (!raw) return null;
        try {
          return { mode: 'replace', rootId, replacements: JSON.parse(raw) };
        } catch {
          return { mode: 'replace', rootId, replacements: raw };
        }
      }
      return null;
    }

    case 'query': {
      const source = pos[0];
      if (!source) return null; // trigger help
      const query = pos.slice(1).join(' ') || (typeof flags['q'] === 'string' ? flags['q'] : undefined);
      const args: Record<string, any> = { source };
      if (query) args.query = query;
      return args;
    }

    // ── FS write commands ──

    case 'mkdir': {
      const path = pos[0] || '/';
      const propsRaw = pos.find(p => p.startsWith('{')) || '';
      const typeHint = flags['t'] || flags['type'];
      return { path, propsRaw, ...(typeHint ? { type: typeHint } : {}) };
    }

    case 'mktext': {
      const path = pos[0] || '/';
      const propsIdx = pos.findIndex(p => p.startsWith('{'));
      const propsRaw = propsIdx >= 0 ? pos[propsIdx] : '';
      // Text content = everything after props block (or after path if no props)
      const afterIdx = propsIdx >= 0 ? propsIdx + 1 : 1;
      const textContent = pos.slice(afterIdx).join(' ');
      return { path, propsRaw, textContent: textContent || undefined };
    }

    case 'write': {
      const path = pos[0] || '/';
      const propsRaw = pos.find(p => p.startsWith('{')) || '';
      return { path, propsRaw };
    }

    case 'rm':
      return { path: pos[0] || '/' };

    case 'cp': {
      const sourcePath = pos[0] || '';
      const destPath = pos.find((p, i) => i > 0 && p.startsWith('/')) || pos[1] || '';
      const propsRaw = pos.find(p => p.startsWith('{')) || '';
      return { sourcePath, destPath, propsRaw: propsRaw || undefined };
    }

    case 'ln': {
      const path = pos[0] || '';
      // Component name is the first positional arg that's not a path or props block
      const component = pos.find((p, i) => i > 0 && !p.startsWith('/') && !p.startsWith('{')) || '';
      const propsRaw = pos.find(p => p.startsWith('{')) || '';
      return { path, component, propsRaw: propsRaw || undefined };
    }

    default:
      // Unknown command — check if it's a valid command name (no args = help)
      if (isValidCommand(name) && pos.length === 0) return null;
      return null;
  }
}

