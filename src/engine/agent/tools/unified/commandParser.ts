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
    } else if (token === '--') {
      // End of options / separator — remaining tokens are positional
      for (let j = i + 1; j < tokens.length; j++) {
        positionalArgs.push(tokens[j]);
      }
      // Mark that we hit the separator so mapToToolArgs can detect it
      flags['--'] = true;
      break;
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

/** Known mk node types. */
const MK_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector', 'variantset']);

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
    // ── VFS read commands ──

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

    // ── New Unix CLI commands ──

    case 'mk': {
      if (input) {
        // Batch mode: multiple mk lines in input
        return { batch: input };
      }
      if (pos.length === 0) return null; // help mode
      return parseMkArgs(pos, flags);
    }

    case 'grep': {
      if (pos.length === 0) return null;
      const firstArg = pos[0];
      if (firstArg.startsWith('/')) {
        // Property discovery: grep /path/ prop1,prop2  or  grep /path/ props (all)
        const ALL_GREP_PROPS = ['fillColor', 'textColor', 'strokeColor', 'cornerRadius', 'gap', 'fontSize', 'fontFamily', 'fontWeight'];
        const rawProps = pos[1] ? pos[1].split(',') : [];
        const grepProps = (rawProps.length === 1 && rawProps[0] === 'props') ? ALL_GREP_PROPS : rawProps;
        return { path: firstArg, properties: grepProps, mode: 'properties' };
      }
      // Node search: grep <query> [path]
      return { query: firstArg, path: pos[1] || '/', mode: 'nodes' };
    }

    case 'sed': {
      const sedPath = pos[0];
      if (!sedPath) return null;

      const replacements: Record<string, Array<{ from: string | number; to: string | number }>> = {};
      for (let i = 1; i < pos.length; i++) {
        const token = pos[i];
        const colonIdx = token.indexOf(':');
        if (colonIdx < 0) continue;
        const prop = token.slice(0, colonIdx);
        const rest = token.slice(colonIdx + 1);
        const slashIdx = rest.lastIndexOf('/');
        if (slashIdx < 0) continue;
        const fromVal = rest.slice(0, slashIdx);
        const toVal = rest.slice(slashIdx + 1);
        if (!replacements[prop]) replacements[prop] = [];
        const numFrom = Number(fromVal);
        const numTo = Number(toVal);
        replacements[prop].push({
          from: !isNaN(numFrom) && fromVal !== '' ? numFrom : fromVal,
          to: !isNaN(numTo) && toVal !== '' ? numTo : toVal,
        });
      }
      if (input) {
        try {
          const parsed = JSON.parse(input);
          for (const [prop, rules] of Object.entries(parsed)) {
            if (!replacements[prop]) replacements[prop] = [];
            replacements[prop].push(...(rules as any[]));
          }
        } catch { /* CLI syntax is primary */ }
      }
      return { path: sedPath, replacements };
    }

    case 'man': {
      if (pos.length === 0) return { source: 'help' };
      const manFirst = pos[0];
      if (manFirst === 'guidelines') return { source: 'guidelines', query: pos.slice(1).join(' ') || undefined };
      if (manFirst === 'style-tags') return { source: 'style-tags' };
      if (manFirst === 'style') return { source: 'style', query: pos.slice(1).join(',') || undefined };
      return { source: 'help', query: pos.join(' ') };
    }

    // ── Legacy commands (backward compat — handler still uses these names) ──

    case 'design': {
      const ops = input || pos.join('\n') || '';
      if (!ops) return null;
      const args: Record<string, any> = { ops };
      const parentId = flags['p'] || flags['parent'];
      if (parentId) args.parentId = parentId;
      return args;
    }

    case 'replace': {
      const mode = pos[0];
      const rootId = pos[1];
      if (!mode || !rootId) return null;
      if (mode === 'search') {
        const props = pos[2] ? pos[2].split(',') : [];
        return { mode: 'search', rootId, properties: props };
      } else if (mode === 'replace' || mode === 'apply') {
        const raw = input || pos.slice(2).join(' ');
        if (!raw) return null;
        try { return { mode: 'replace', rootId, replacements: JSON.parse(raw) }; }
        catch { return { mode: 'replace', rootId, replacements: raw }; }
      }
      return null;
    }

    case 'query': {
      const source = pos[0];
      if (!source) return null;
      const query = pos.slice(1).join(' ') || (typeof flags['q'] === 'string' ? flags['q'] : undefined);
      const args: Record<string, any> = { source };
      if (query) args.query = query;
      return args;
    }

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
      const component = pos.find((p, i) => i > 0 && !p.startsWith('/') && !p.startsWith('{')) || '';
      const propsRaw = pos.find(p => p.startsWith('{')) || '';
      return { path, component, propsRaw: propsRaw || undefined };
    }

    default:
      if (isValidCommand(name) && pos.length === 0) return null;
      return null;
  }
}

// ── mk arg parser (extracted for batch reuse) ──

/**
 * Parse mk positional args into structured args.
 * Used by single mk command and by batch line parsing.
 */
export function parseMkArgs(
  pos: string[],
  flags: Record<string, string | boolean>,
): Record<string, any> {
  const path = pos[0] || '/';
  let type: string | undefined;
  let refComponent: string | undefined;
  let propsStart = 1;

  if (pos[1]) {
    if (MK_TYPES.has(pos[1])) {
      type = pos[1];
      propsStart = 2;
    } else if (pos[1].startsWith('ref:')) {
      refComponent = pos[1].slice(4);
      propsStart = 2;
    }
  }

  // Collect prop tokens (key:value) and text content
  const propTokens: string[] = [];
  const textParts: string[] = [];
  const hasSeparator = flags['--'] === true;

  // When -- is present, parseSingleCommand pushes all tokens after -- into positionalArgs
  // and sets flags['--']=true. All those post-separator tokens are already in pos.
  // We need to find where the separator was. Prop tokens are key:value format.
  for (let i = propsStart; i < pos.length; i++) {
    const t = pos[i];
    if (hasSeparator && !t.includes(':')) {
      // After separator: non-prop tokens are text content
      textParts.push(t);
    } else if (t.includes(':')) {
      propTokens.push(t);
    } else {
      // Non-prop, no separator — could be text content for text type
      textParts.push(t);
    }
  }

  let textContent: string | undefined;
  if (textParts.length > 0) {
    textContent = textParts.join(' ');
  }

  return {
    path,
    ...(type && { type }),
    ...(refComponent && { refComponent }),
    propTokens,
    ...(textContent && { textContent }),
  };
}

