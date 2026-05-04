/**
 * @file jsxHandler.test.ts
 * @description Tests for `handleJsx` — focused on the warning-propagation
 * fix that lets AMBIGUOUS_NAME_AUTOPICK survive the JSX path.
 *
 * Bug context (pre-fix): jsx is the dominant write path (whole-design
 * generation in a single tool call with N $Token bindings). Both
 * `templateCompiler.walkTree` and `jsxHandler` dropped binding warnings
 * before they reached `response.warnings`, so the LLM never received the
 * Phase 1 self-correction signal even though the resolver emitted one.
 *
 * Test strategy: mock the heavy collaborators (`compileAndExecute`,
 * `walkTree`, `centerNodeInViewport`, `prefetchIcons`, `figma.*`) and
 * inject controlled walk output. We're not exercising sucrase or
 * nodeFactory here — those are tested separately. We're verifying ONLY
 * that `handleJsx` lifts AMBIGUOUS_NAME_AUTOPICK warnings out of
 * `ctx.warnings` into `response.warnings` with full payload + dedup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be declared BEFORE the SUT import ────────────────────────────

vi.mock('../../../engine/jsx/templateCompiler', async () => {
  const actual = await vi.importActual<
    typeof import('../../../engine/jsx/templateCompiler')
  >('../../../engine/jsx/templateCompiler');
  return {
    ...actual,
    // Pretend compilation always succeeds with a single FRAME root.
    compileAndExecute: vi.fn(async () => ({
      vnodes: [{ type: 'FRAME', props: {}, children: [] }],
    })),
    collectIconNames: vi.fn(() => []),
    // Walk pushes the warnings we care about into ctx and returns a result.
    walkTree: vi.fn(async (_vnode: any, _parent: any, ctx: any) => {
      // Two distinct nodes, two ambiguity hits, and one duplicate to verify dedup.
      ctx.warnings.push({
        code: 'AMBIGUOUS_NAME_AUTOPICK',
        severity: 'warning',
        message: 'Bare-name lookup found 2 variables.',
        picked_variable_id: 'V1',
        candidates: [
          { variable_id: 'V1', name: 'Text/Primary', type: 'COLOR' },
          { variable_id: 'V2', name: 'Text/Primary', type: 'COLOR' },
        ],
        node_id: 'mock:1',
      });
      ctx.warnings.push({
        code: 'AMBIGUOUS_NAME_AUTOPICK',
        severity: 'warning',
        message: 'Bare-name lookup found 2 variables.',
        picked_variable_id: 'V1',
        candidates: [
          { variable_id: 'V1', name: 'Text/Primary', type: 'COLOR' },
          { variable_id: 'V2', name: 'Text/Primary', type: 'COLOR' },
        ],
        // SAME picked_variable_id + SAME node_id → must dedupe.
        node_id: 'mock:1',
      });
      ctx.warnings.push({
        code: 'AMBIGUOUS_NAME_AUTOPICK',
        severity: 'warning',
        message: 'Bare-name lookup found 2 variables.',
        picked_variable_id: 'V1',
        candidates: [
          { variable_id: 'V1', name: 'Text/Primary', type: 'COLOR' },
          { variable_id: 'V2', name: 'Text/Primary', type: 'COLOR' },
        ],
        // Different node — distinct warning, NOT a dup.
        node_id: 'mock:2',
      });
      // An unrelated walk warning that must NOT bleed through to response.warnings.
      ctx.warnings.push({
        code: 'NORMALIZE',
        severity: 'warning',
        message: 'normalizer fixup',
      });
      ctx.rollbackStack.push('mock:1');
      return {
        nodeId: 'mock:1',
        name: 'frame',
        type: 'FRAME',
        childRefs: [],
      };
    }),
  };
});

vi.mock('../../../engine/actions/nodeFactory', async () => {
  const actual = await vi.importActual<
    typeof import('../../../engine/actions/nodeFactory')
  >('../../../engine/actions/nodeFactory');
  return {
    ...actual,
    centerNodeInViewport: vi.fn((p: any) => p),
    prefetchIcons: vi.fn(async () => undefined),
  };
});

vi.mock('../../../engine/jsx/normalizeTree', () => ({
  normalizeTree: vi.fn(),
}));

// figma.* surface needed by handleJsx response builder + auto-pan + tag.
vi.stubGlobal('figma', {
  getNodeByIdAsync: vi.fn().mockResolvedValue(null), // forces simple-data branch
  viewport: { scrollAndZoomIntoView: vi.fn() },
});

// SUT — import AFTER mocks.
import { handleJsx } from '../jsxHandler';

describe('handleJsx — AMBIGUOUS_NAME_AUTOPICK propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('jsx propagates AMBIGUOUS_NAME_AUTOPICK warnings to response.warnings', async () => {
    const response = await handleJsx({
      markup: '<Frame fills="$Text/Primary"/>',
    });

    expect(response.error).toBeUndefined();
    expect(Array.isArray(response.warnings)).toBe(true);

    // AMBIGUOUS_NAME_AUTOPICK only — NORMALIZE must be filtered out.
    expect(response.warnings!.every(w => w.code === 'AMBIGUOUS_NAME_AUTOPICK')).toBe(true);

    // Each warning carries the full payload (picked_variable_id, candidates,
    // node_id) — not the lossy {code, message} pair.
    for (const w of response.warnings!) {
      const wAny = w as any;
      expect(wAny.picked_variable_id).toBe('V1');
      expect(Array.isArray(wAny.candidates)).toBe(true);
      expect(wAny.candidates.length).toBeGreaterThanOrEqual(2);
      expect(typeof wAny.node_id).toBe('string');
      // severity is dropped at the wire boundary (encoded by warnings[] location).
      expect((w as any).severity).toBeUndefined();
    }
  });

  it('dedupes warnings with the same picked_variable_id + node_id but keeps distinct nodes', async () => {
    const response = await handleJsx({
      markup: '<Frame fills="$Text/Primary"/>',
    });

    // walkTree mock pushed three AMBIGUOUS warnings:
    //   - mock:1 (V1)
    //   - mock:1 (V1)  ← duplicate, must collapse
    //   - mock:2 (V1)  ← distinct node, must keep
    expect(response.warnings).toHaveLength(2);
    const nodeIds = response.warnings!.map(w => (w as any).node_id).sort();
    expect(nodeIds).toEqual(['mock:1', 'mock:2']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PAINT_INVALID + per-property apply failures (the silent-black story)
// ────────────────────────────────────────────────────────────────────────────
//
// Pre-fix bug: paintHandler / effectHandler / resizeHandler emitted warnings
// when a per-property apply threw (e.g. paintHandler → lowerPaints rejecting
// an object literal), but jsxHandler's allowlist filtered them out. Result:
// the LLM saw `jsx` success while the canvas had black fills / missing
// effects. May 2026 weather widget run produced 36 silent black fills via
// this exact gap before SYSTEM.md was realigned.
//
// Test strategy: re-mock walkTree to push a PAINT_INVALID warning carrying
// the node_id, assert it survives aggregation. We need a fresh module so
// the previous mock doesn't leak — vi.resetModules() + dynamic import.

describe('handleJsx — per-property apply failures (PAINT_INVALID etc.)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('forwards PAINT_INVALID + EFFECT_INVALID + RESIZE_FAILED as response.warnings', async () => {
    vi.doMock('../../../engine/jsx/templateCompiler', async () => {
      const actual = await vi.importActual<
        typeof import('../../../engine/jsx/templateCompiler')
      >('../../../engine/jsx/templateCompiler');
      return {
        ...actual,
        compileAndExecute: vi.fn(async () => ({
          vnodes: [{ type: 'FRAME', props: {}, children: [] }],
        })),
        collectIconNames: vi.fn(() => []),
        walkTree: vi.fn(async (_v: any, _p: any, ctx: any) => {
          // Per-property apply failures (the silent-black bug).
          ctx.warnings.push({
            code: 'PAINT_INVALID',
            severity: 'warning',
            message: 'Failed to apply fills: not a function',
            node_id: 'mock:paint',
          });
          ctx.warnings.push({
            code: 'EFFECT_INVALID',
            severity: 'warning',
            message: 'Failed to apply effects: bad shadow shape',
            node_id: 'mock:fx',
          });
          ctx.warnings.push({
            code: 'RESIZE_FAILED',
            severity: 'warning',
            message: 'Failed to resize: width must be > 0',
            node_id: 'mock:size',
          });
          // A walk-internal warning that must NOT bleed through.
          ctx.warnings.push({
            code: 'NORMALIZE',
            severity: 'warning',
            message: 'normalizer fixup',
          });
          ctx.rollbackStack.push('mock:paint');
          return {
            nodeId: 'mock:paint',
            name: 'frame',
            type: 'FRAME',
            childRefs: [],
          };
        }),
      };
    });
    vi.doMock('../../../engine/actions/nodeFactory', async () => {
      const actual = await vi.importActual<
        typeof import('../../../engine/actions/nodeFactory')
      >('../../../engine/actions/nodeFactory');
      return {
        ...actual,
        centerNodeInViewport: vi.fn((p: any) => p),
        prefetchIcons: vi.fn(async () => undefined),
      };
    });
    vi.doMock('../../../engine/jsx/normalizeTree', () => ({
      normalizeTree: vi.fn(),
    }));

    const { handleJsx: handleJsxFresh } = await import('../jsxHandler');
    const response = await handleJsxFresh({
      markup: '<Frame fill="#bogus"/>',
    });

    expect(response.error).toBeUndefined();
    expect(Array.isArray(response.warnings)).toBe(true);

    const codes = response.warnings!.map(w => w.code).sort();
    expect(codes).toEqual(['EFFECT_INVALID', 'PAINT_INVALID', 'RESIZE_FAILED']);

    // node_id correlation preserved so the LLM can target a recovery action.
    const byCode = new Map(response.warnings!.map(w => [w.code, w as any]));
    expect(byCode.get('PAINT_INVALID')!.node_id).toBe('mock:paint');
    expect(byCode.get('EFFECT_INVALID')!.node_id).toBe('mock:fx');
    expect(byCode.get('RESIZE_FAILED')!.node_id).toBe('mock:size');

    // severity stripped at the wire boundary.
    for (const w of response.warnings!) {
      expect((w as any).severity).toBeUndefined();
    }
  });
});
