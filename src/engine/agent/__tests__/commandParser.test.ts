import { describe, it, expect } from 'vitest';
import {
  parseCommandString,
  mapToToolArgs,
  parseMkArgs,
} from '../../agent/tools/unified/commandParser';
import { findClosestCommand } from '../../agent/tools/unified/commandRegistry';

// ── parseCommandString — chain operators ──────────────────────────

describe('parseCommandString', () => {
  it('parses single command', () => {
    const result = parseCommandString('ls /');
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].name).toBe('ls');
    expect(result.operators).toEqual([]);
  });

  it('parses && chain', () => {
    const result = parseCommandString('tree / && cat /Card/');
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].name).toBe('tree');
    expect(result.commands[1].name).toBe('cat');
    expect(result.operators).toEqual(['&&']);
  });

  it('parses || chain', () => {
    const result = parseCommandString('cat /Missing/ || man');
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].name).toBe('cat');
    expect(result.commands[1].name).toBe('man');
    expect(result.operators).toEqual(['||']);
  });

  it('parses ; chain', () => {
    const result = parseCommandString('mk /A/ frame ; mk /B/ frame');
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].name).toBe('mk');
    expect(result.commands[1].name).toBe('mk');
    expect(result.operators).toEqual([';']);
  });

  it('parses | pipe', () => {
    const result = parseCommandString('grep Button | cat');
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].name).toBe('grep');
    expect(result.commands[1].name).toBe('cat');
    expect(result.operators).toEqual(['|']);
  });

  it('parses mixed operators', () => {
    const result = parseCommandString('mk /A/ frame && mk /B/ frame ; ls /');
    expect(result.commands).toHaveLength(3);
    expect(result.operators).toEqual(['&&', ';']);
  });

  it('does not split && inside quotes', () => {
    const result = parseCommandString("mk /A/ text -- 'Hello && World'");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].name).toBe('mk');
  });

  it('does not split | inside quotes', () => {
    const result = parseCommandString('mk /A/ text -- "A | B"');
    expect(result.commands).toHaveLength(1);
  });

  it('does not confuse || with |', () => {
    const result = parseCommandString('ls / || tree /');
    expect(result.operators).toEqual(['||']);
    expect(result.commands).toHaveLength(2);
  });

  it('handles triple command chain', () => {
    const result = parseCommandString('ls / && tree / && cat /Card/');
    expect(result.commands).toHaveLength(3);
    expect(result.operators).toEqual(['&&', '&&']);
  });
});

// ── mapToToolArgs ─────────────────────────────────────────────────

describe('mapToToolArgs', () => {
  it('maps ls command', () => {
    const chain = parseCommandString('ls /Card/');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ path: '/Card/' });
  });

  it('maps tree with depth flag', () => {
    const chain = parseCommandString('tree / -d 3');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ path: '/', depth: 3 });
  });

  it('maps cat with screenshot flag', () => {
    const chain = parseCommandString('cat /Card/ -s');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ path: '/Card/', screenshot: true });
  });

  it('maps mk with type and props', () => {
    const chain = parseCommandString('mk /Card/ frame w:400 bg:#FFF');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toMatchObject({ path: '/Card/', type: 'frame' });
    expect(args!.propTokens).toContain('w:400');
    expect(args!.propTokens).toContain('bg:#FFF');
  });

  it('maps grep node search', () => {
    const chain = parseCommandString('grep Button');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ query: 'Button', path: '/', mode: 'nodes' });
  });

  it('maps grep property discovery', () => {
    const chain = parseCommandString('grep /Card/ fillColor,fontSize');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toMatchObject({ path: '/Card/', mode: 'properties' });
    expect(args!.properties).toEqual(['fillColor', 'fontSize']);
  });

  it('maps sed', () => {
    const chain = parseCommandString('sed /Card/ fillColor:#FFF/#000');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toMatchObject({ path: '/Card/' });
    expect(args!.replacements.fillColor).toEqual([{ from: '#FFF', to: '#000' }]);
  });

  it('returns null for command name only (help mode)', () => {
    const chain = parseCommandString('mk');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toBeNull();
  });

  it('maps rm', () => {
    const chain = parseCommandString('rm /OldNode/');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ path: '/OldNode/' });
  });

  it('maps mv with source and dest', () => {
    const chain = parseCommandString('mv /Card/OldTitle /Card/NewTitle');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ sourcePath: '/Card/OldTitle', destPath: '/Card/NewTitle' });
  });

  it('maps mv returns null with missing dest', () => {
    const chain = parseCommandString('mv /Card/OldTitle');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toBeNull();
  });

  it('maps mv returns null with no args', () => {
    const chain = parseCommandString('mv');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toBeNull();
  });

  it('maps man with topic', () => {
    const chain = parseCommandString('man guidelines dashboard');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).toEqual({ source: 'guidelines', query: 'dashboard' });
  });

  it('maps man with no args', () => {
    const chain = parseCommandString('man');
    const args = mapToToolArgs(chain.commands[0]);
    // man with no args → help source
    expect(args).toEqual({ source: 'help' });
  });
});

// ── parseMkArgs ───────────────────────────────────────────────────

describe('parseMkArgs', () => {
  it('parses basic frame', () => {
    const result = parseMkArgs(['/Card/', 'frame', 'w:400', 'h:300'], {});
    expect(result).toMatchObject({ path: '/Card/', type: 'frame' });
    expect(result.propTokens).toEqual(['w:400', 'h:300']);
  });

  it('parses ref component', () => {
    const result = parseMkArgs(['/Card/Btn', 'ref:Button'], {});
    expect(result).toMatchObject({ path: '/Card/Btn', refComponent: 'Button' });
  });

  it('parses text content after separator', () => {
    const result = parseMkArgs(['/Card/Title', 'text', 'size:24', 'Hello', 'World'], { '--': true });
    expect(result.textContent).toBe('Hello World');
    expect(result.propTokens).toContain('size:24');
  });

  it('preserves colons in text content when textAfterSeparator is provided', () => {
    const result = parseMkArgs(
      ['/Card/Title', 'text', 'size:24', 'font:SFPro', 'Hello'],
      { '--': true },
      'font:SFPro Hello',
    );
    expect(result.textContent).toBe('font:SFPro Hello');
    expect(result.propTokens).toEqual(['size:24']);
  });

  it('defaults path to /', () => {
    const result = parseMkArgs([], {});
    expect(result.path).toBe('/');
  });
});

// ── Memory text with colons — full pipeline ───────────────────────

describe('mk memory text with colons (full pipeline)', () => {
  it('preserves colon-containing tokens in text after --', () => {
    const chain = parseCommandString('mk /.agent/memory/test text -- font:SFPro and size:24 here');
    expect(chain.commands.length).toBe(1);
    const args = mapToToolArgs(chain.commands[0]);
    expect(args).not.toBeNull();
    expect(args!.textContent).toBe('font:SFPro and size:24 here');
    expect(args!.propTokens).toEqual([]);
  });

  it('preserves URLs with colons in text after --', () => {
    const chain = parseCommandString('mk /.agent/memory/urls text -- Visit https://example.com for details');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args!.textContent).toBe('Visit https://example.com for details');
  });

  it('still parses props before -- correctly', () => {
    const chain = parseCommandString('mk /Card/Title text size:24 weight:bold -- Hello World');
    const args = mapToToolArgs(chain.commands[0]);
    expect(args!.propTokens).toEqual(['size:24', 'weight:bold']);
    expect(args!.textContent).toBe('Hello World');
  });
});

// ── findClosestCommand — fuzzy matching ───────────────────────────

describe('findClosestCommand', () => {
  it('exact prefix match: "gre" → "grep"', () => {
    expect(findClosestCommand('gre')).toBe('grep');
  });

  it('exact prefix match: "se" → "sed"', () => {
    expect(findClosestCommand('se')).toBe('sed');
  });

  it('typo: "grp" → "grep"', () => {
    expect(findClosestCommand('grp')).toBe('grep');
  });

  it('typo: "lss" → "ls"', () => {
    expect(findClosestCommand('lss')).toBe('ls');
  });

  it('typo: "cst" → "cat"', () => {
    expect(findClosestCommand('cst')).toBe('cat');
  });

  it('no close match: "xyz" → null', () => {
    expect(findClosestCommand('xyz')).toBeNull();
  });

  it('no close match: "foobar" → null', () => {
    expect(findClosestCommand('foobar')).toBeNull();
  });

  it('case insensitive: "MK" → "mk"', () => {
    expect(findClosestCommand('MK')).toBe('mk');
  });

  it('prefix: "ma" → "man"', () => {
    expect(findClosestCommand('ma')).toBe('man');
  });

  it('prefix: "mv" → "mv"', () => {
    expect(findClosestCommand('mv')).toBe('mv');
  });
});
