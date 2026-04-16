import { describe, expect, it } from 'vitest';
import { LoopDetector, type LoopFingerprint } from '../loopDetector';
import { buildLoopFingerprint } from '../loopFingerprint';
import type { ToolCallBlock } from '../../llm-client/providers/types';

function tc(name: string, input: Record<string, unknown> = {}): ToolCallBlock {
  return { type: 'tool_call', id: `tc_${Math.random().toString(36).slice(2, 6)}`, name, input };
}

function fp(calls: ToolCallBlock[]): LoopFingerprint {
  return buildLoopFingerprint(calls);
}

describe('LoopDetector — identical loop', () => {
  it('flags the Nth exact repetition of the same call', () => {
    const detector = new LoopDetector();
    const signature = fp([tc('inspect', { node: '1:1', depth: 2 })]);
    let result = null;

    // threshold = 3 → third occurrence trips it
    for (let i = 0; i < 3; i++) {
      result = detector.detect(signature, { identical: 3, monotone: 99 });
    }

    expect(result).not.toBeNull();
    expect(result?.type).toBe('identical');
    expect(result?.hint).toContain('3 times');
  });

  it('does not flag diverse calls', () => {
    const detector = new LoopDetector();
    let result = null;
    for (const node of ['1:1', '1:2', '1:3', '1:4']) {
      result = detector.detect(fp([tc('inspect', { node })]), { identical: 3, monotone: 99 });
    }
    expect(result).toBeNull();
  });
});

describe('LoopDetector — monotone loop', () => {
  it('flags the same tool pattern repeated N consecutive iterations with different args', () => {
    const detector = new LoopDetector();
    let result = null;

    // 4 consecutive inspect calls on different nodes — no identical loop,
    // but monotone "keeps inspecting without acting" pattern.
    for (const node of ['1:1', '1:2', '1:3', '1:4']) {
      result = detector.detect(fp([tc('inspect', { node })]), { identical: 99, monotone: 4 });
    }

    expect(result).not.toBeNull();
    expect(result?.type).toBe('monotone');
    expect(result?.hint).toContain('inspect');
    expect(result?.hint).toContain('4 consecutive');
  });

  it('flags a multi-tool pattern when the full set repeats', () => {
    const detector = new LoopDetector();
    let result = null;

    // Same [inspect, edit] pair 4 iterations in a row
    for (let i = 0; i < 4; i++) {
      result = detector.detect(
        fp([tc('inspect', { node: `1:${i}` }), tc('edit', { node: `1:${i}`, props: { opacity: i / 10 } })]),
        { identical: 99, monotone: 4 },
      );
    }

    expect(result).not.toBeNull();
    expect(result?.type).toBe('monotone');
    // toolsKey is sorted — alphabetical order regardless of call order
    expect(result?.hint).toContain('edit+inspect');
  });

  it('does not flag alternating patterns', () => {
    const detector = new LoopDetector();
    const sequence: ToolCallBlock[][] = [
      [tc('inspect', { node: '1:1' })],
      [tc('edit', { node: '1:1', props: { w: 100 } })],
      [tc('inspect', { node: '1:2' })],
      [tc('edit', { node: '1:2', props: { w: 200 } })],
    ];

    let result = null;
    for (const iter of sequence) {
      result = detector.detect(fp(iter), { identical: 99, monotone: 3 });
    }
    expect(result).toBeNull();
  });
});

describe('LoopDetector — reset', () => {
  it('clears history', () => {
    const detector = new LoopDetector();
    const signature = fp([tc('inspect', { node: '1:1' })]);

    detector.detect(signature, { identical: 2, monotone: 99 });
    detector.reset();
    // After reset, the next call is the "first" occurrence again.
    const result = detector.detect(signature, { identical: 2, monotone: 99 });
    expect(result).toBeNull();
  });
});

describe('buildLoopFingerprint', () => {
  it('produces identical signatures for args with different key order', () => {
    const a = buildLoopFingerprint([tc('edit', { node: '1:1', props: { w: 100, h: 50 } })]);
    const b = buildLoopFingerprint([tc('edit', { node: '1:1', props: { h: 50, w: 100 } })]);
    expect(a.signature).toBe(b.signature);
  });

  it('produces identical signatures for deeply nested key reorderings', () => {
    const a = buildLoopFingerprint([tc('edit', { node: '1:1', props: { layout: { dir: 'V', gap: 8 } } })]);
    const b = buildLoopFingerprint([tc('edit', { node: '1:1', props: { layout: { gap: 8, dir: 'V' } } })]);
    expect(a.signature).toBe(b.signature);
  });

  it('produces different signatures for different args', () => {
    const a = buildLoopFingerprint([tc('inspect', { node: '1:1' })]);
    const b = buildLoopFingerprint([tc('inspect', { node: '1:2' })]);
    expect(a.signature).not.toBe(b.signature);
  });

  it('sorts toolsKey alphabetically regardless of call order', () => {
    const a = buildLoopFingerprint([tc('inspect', {}), tc('edit', {})]);
    const b = buildLoopFingerprint([tc('edit', {}), tc('inspect', {})]);
    expect(a.toolsKey).toBe('edit+inspect');
    expect(b.toolsKey).toBe('edit+inspect');
  });

  it('preserves array order (arrays are semantically ordered)', () => {
    const a = buildLoopFingerprint([tc('edit', { nodes: ['1:1', '1:2'] })]);
    const b = buildLoopFingerprint([tc('edit', { nodes: ['1:2', '1:1'] })]);
    expect(a.signature).not.toBe(b.signature);
  });

  it('fails fast on circular references', () => {
    const circular: Record<string, unknown> = { node: '1:1' };
    circular.self = circular;
    expect(() => buildLoopFingerprint([tc('edit', circular)])).toThrow();
  });
});
