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

/**
 * Alias map: cat/mk shorthand → grep/sed internal property names.
 * `fill` expands to BOTH fillColor and textColor since cat output uses `fill` for both.
 */
const PROP_ALIASES: Record<string, string[]> = {
  fill:    ['fillColor', 'textColor'],
  bg:      ['fillColor'],
  color:   ['textColor'],
  corner:  ['cornerRadius'],
  radius:  ['cornerRadius'],
  size:    ['fontSize'],
  font:    ['fontFamily'],
  weight:  ['fontWeight'],
  stroke:  ['strokeColor'],
  strokeW: ['strokeWeight'],
};

/** Expand a single property name through aliases. Returns canonical names. */
function expandPropAlias(prop: string): string[] {
  return PROP_ALIASES[prop] || [prop];
}

// ── Types ──────────────────────────────────────────────────────────

export interface ParsedCommand {
  name: string;
  positionalArgs: string[];
  flags: Record<string, string | boolean>;
  raw: string;
  /** Raw text after `--` separator, before tokenization. Preserved for commands like mk that need verbatim text content. */
  textAfterSeparator?: string;
}

/** Chain operators: && (and), || (or), ; (seq), | (pipe). */
export type ChainOperator = '&&' | '||' | ';' | '|';

export interface ParsedChain {
  commands: ParsedCommand[];
  /** Operators between commands. Length = commands.length - 1. */
  operators: ChainOperator[];
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
  let textAfterSeparator: string | undefined;

  // Extract raw text after " -- " before tokenization destroys it
  const separatorMatch = raw.match(/\s--\s([\s\S]*)$/);
  if (separatorMatch) {
    textAfterSeparator = separatorMatch[1].trim();
  }

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

  return { name, positionalArgs, flags, raw, ...(textAfterSeparator !== undefined && { textAfterSeparator }) };
}

// ── Chain parser ───────────────────────────────────────────────────

/**
 * Parse a command string, splitting by chain operators: &&, ||, ;, |
 *
 * "tree / && cat /Card/Header/"   → sequential, stop on failure
 * "mk /A/ ; mk /B/"              → sequential, run regardless
 * "cat /A/ || man"                → run second only if first fails
 * "grep Button | cat"             → pipe: first result feeds into second
 *
 * Respects quoted strings — operators inside quotes are not treated as operators.
 */
export function parseCommandString(input: string): ParsedChain {
  const segments: string[] = [];
  const operators: ChainOperator[] = [];

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
    } else if (ch === '|' && input[i + 1] === '|') {
      if (current.trim()) segments.push(current.trim());
      operators.push('||');
      current = '';
      i++; // skip second |
    } else if (ch === '|') {
      if (current.trim()) segments.push(current.trim());
      operators.push('|');
      current = '';
    } else if (ch === ';') {
      if (current.trim()) segments.push(current.trim());
      operators.push(';');
      current = '';
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
const MK_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'icon', 'image', 'group', 'section', 'vector', 'component', 'variantset']);

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
  const { name, positionalArgs: pos, flags, textAfterSeparator } = parsed;

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
      return parseMkArgs(pos, flags, textAfterSeparator);
    }

    case 'grep': {
      if (pos.length === 0) return null;
      const firstArg = pos[0];
      if (firstArg.startsWith('/')) {
        // Property discovery: grep /path/ prop1,prop2  or  grep /path/ props (all)
        const ALL_GREP_PROPS = ['fillColor', 'textColor', 'strokeColor', 'cornerRadius', 'gap', 'fontSize', 'fontFamily', 'fontWeight'];
        const rawProps = pos[1] ? pos[1].split(',') : [];
        // Expand aliases: fill → [fillColor, textColor], corner → [cornerRadius], etc.
        const grepProps = (rawProps.length === 1 && rawProps[0] === 'props')
          ? ALL_GREP_PROPS
          : rawProps.flatMap(p => expandPropAlias(p));
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
        const rawProp = token.slice(0, colonIdx);
        const rest = token.slice(colonIdx + 1);
        const slashIdx = rest.lastIndexOf('/');
        if (slashIdx < 0) continue;
        const fromVal = rest.slice(0, slashIdx);
        const toVal = rest.slice(slashIdx + 1);
        const numFrom = Number(fromVal);
        const numTo = Number(toVal);
        const rule = {
          from: !isNaN(numFrom) && fromVal !== '' ? numFrom : fromVal,
          to: !isNaN(numTo) && toVal !== '' ? numTo : toVal,
        };
        // Expand aliases: fill → [fillColor, textColor], corner → [cornerRadius], etc.
        for (const prop of expandPropAlias(rawProp)) {
          if (!replacements[prop]) replacements[prop] = [];
          replacements[prop].push(rule);
        }
      }
      if (input) {
        try {
          const parsed = JSON.parse(input);
          for (const [rawProp, rules] of Object.entries(parsed)) {
            for (const prop of expandPropAlias(rawProp)) {
              if (!replacements[prop]) replacements[prop] = [];
              replacements[prop].push(...(rules as any[]));
            }
          }
        } catch { /* CLI syntax is primary */ }
      }
      return { path: sedPath, replacements };
    }

    case 'js': {
      // js <expression> or js with multiline input
      // Use raw string (not tokenized) — JS code has braces/arrows that tokenizer mangles
      const rawCode = parsed.raw.replace(/^js\s*/, '');
      const code = input || rawCode || '';
      if (!code) return null; // help mode
      return { code };
    }

    case 'subtask': {
      // subtask <prompt text> — all positional args form the prompt
      const subtaskPrompt = input || pos.join(' ') || '';
      if (!subtaskPrompt) return null; // help mode
      return { prompt: subtaskPrompt };
    }

    case 'more':
      return { id: pos[0] || '' };

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

    case 'mv': {
      const sourcePath = pos[0] || '';
      const destPath = pos[1] || '';
      if (!sourcePath || !destPath) return null;
      const args: Record<string, any> = { sourcePath, destPath };
      const atFlag = flags['at'];
      if (atFlag !== undefined) args.at = Number(atFlag);
      return args;
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

    // ── Design system commands ──

    case 'var': {
      if (pos.length === 0) return null; // help mode
      const sub = pos[0];
      switch (sub) {
        case 'ls':
          return { subcommand: 'ls', collection: pos[1] || undefined, verbose: !!(flags['v'] || flags['verbose']) };
        case 'mk': {
          // Check for --collection flag (collection creation mode)
          if (flags['collection']) {
            return {
              subcommand: 'mk-collection',
              collection: flags['collection'] as string,
              modes: flags['modes'] as string || undefined,
            };
          }
          // Variable creation/update: var mk collection/name TYPE value [--mode X]
          return {
            subcommand: 'mk',
            variable: pos[1],
            varType: pos[2],
            value: pos.slice(3).join(' ') || undefined,
            mode: flags['mode'] as string || undefined,
          };
        }
        case 'bind':
          // var bind /node/path prop collection/varName
          return {
            subcommand: 'bind',
            nodePath: pos[1],
            property: pos[2],
            variable: pos[3],
          };
        case 'alias':
          // var alias semantic/name target/name
          return {
            subcommand: 'alias',
            variable: pos[1],
            target: pos[2],
          };
        default:
          return null;
      }
    }

    case 'comp': {
      if (pos.length === 0) return null; // help mode
      const sub = pos[0];
      switch (sub) {
        case 'create':
          return { subcommand: 'create', paths: [pos[1]] };
        case 'combine': {
          const compPaths = pos.slice(1).filter(p => p.startsWith('/'));
          return {
            subcommand: 'combine',
            paths: compPaths,
            name: flags['name'] as string || undefined,
          };
        }
        case 'prop':
          // comp prop /Component/ PropName TYPE [defaultValue]
          return {
            subcommand: 'prop',
            paths: [pos[1]],
            name: pos[2],
            propType: pos[3],
            defaultValue: pos[4] || undefined,
          };
        case 'ls':
          return { subcommand: 'ls', paths: [pos[1] || '/'] };
        case 'instance':
          return {
            subcommand: 'instance',
            paths: [pos[1]],
            parent: flags['parent'] as string || undefined,
          };
        default:
          return null;
      }
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
  textAfterSeparator?: string,
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
    } else if (pos[1] === 'ref' && pos[2]) {
      refComponent = pos[2];
      propsStart = 3;
    }
  }

  const hasSeparator = flags['--'] === true;

  // When textAfterSeparator is available, use it directly as textContent.
  // This preserves verbatim text (including tokens with ":") that would otherwise
  // be misclassified as prop tokens by the heuristic below.
  if (hasSeparator && textAfterSeparator !== undefined) {
    // Props are only tokens BEFORE the separator (those without ":" would have been
    // positional args before we hit "--"). Since parseSingleCommand mixes pre/post
    // separator tokens, we count: pre-separator props = tokens from propsStart that
    // were collected before the separator tokens were appended.
    // With textAfterSeparator we don't need the post-separator tokens at all for text.
    const propTokens: string[] = [];
    // Tokens from the separator onward were appended to pos by parseSingleCommand.
    // We need to figure out how many pre-separator tokens there are.
    // Pre-separator tokens: positionalArgs collected before the break.
    // Post-separator tokens: those pushed in the `for (let j = i + 1 ...)` loop.
    // Since we tokenized the post-separator part, count how many tokens that is:
    const postTokens = tokenize(textAfterSeparator);
    const preSeparatorEnd = pos.length - postTokens.length;
    for (let i = propsStart; i < preSeparatorEnd; i++) {
      propTokens.push(pos[i]);
    }
    return {
      path,
      ...(type && { type }),
      ...(refComponent && { refComponent }),
      propTokens,
      textContent: textAfterSeparator,
    };
  }

  // Fallback: no textAfterSeparator — use heuristic (key:value = prop, rest = text)
  const propTokens: string[] = [];
  const textParts: string[] = [];

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

