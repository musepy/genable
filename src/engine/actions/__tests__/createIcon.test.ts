/**
 * @file createIcon.test.ts
 * @description Regression coverage for the lucide ICON variable-fill crash.
 *
 * Root cause being fixed: expandShorthands returns variable-ref fills as a
 * BARE STRING (e.g. "$Text/Primary") so the variableBindingHandler can pick
 * them up. The previous createIcon code passed that bare string straight to
 * lowerPaints, which calls `.map` on it and threw "not a function".
 *
 * These tests:
 *   1. Sanity — hex array fills still go through lowerPaints + direct assign.
 *   2. Regression — variable-ref fill ($Token) routes through applyProperty
 *      (variableBindingHandler) and never touches lowerPaints.
 *   3. Same coverage for variable-ref strokes.
 *   4. Defensive guard — lowerPaints throws a clear error when given a string.
 *
 * Mocking minimalism mirrors handlers.test.ts / variableResolver_regression.test.ts —
 * stub only the figma.* surface that createIcon touches, plus mock the
 * applyProperty module so we can assert the variable-ref routing call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock iconify so createIcon doesn't make network calls ───────────────────
vi.mock('../../figma-adapter/assets/iconify', () => ({
  fetchIconSvg: vi.fn().mockResolvedValue(
    '<svg width="24" height="24"><path d="M0 0 L10 10"/></svg>',
  ),
  prefetchIcons: vi.fn(),
}));

// ── Mock applyProperty so we can assert variable-ref routing ────────────────
// Use vi.hoisted to keep the mock fn reachable from the hoisted vi.mock factory.
const { applyPropertyMock } = vi.hoisted(() => ({
  applyPropertyMock: vi.fn(async () => ({
    warnings: [],
    diff: { key: '', changed: false },
  })),
}));
vi.mock('../handlers', () => ({
  applyProperty: applyPropertyMock,
}));

import { createIcon } from '../nodeFactory';
import { lowerPaints } from '../../figma/figma-lowering';

// ── Minimal vector child mock ───────────────────────────────────────────────
function makeVectorChild() {
  return {
    id: 'svg:1:vec:1',
    type: 'VECTOR',
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    strokeWeight: 1,
  };
}

// ── Minimal iconNode mock — what figma.createNodeFromSvg returns ────────────
function makeIconNode() {
  const vec = makeVectorChild();
  return {
    id: 'icon:1',
    type: 'FRAME',
    width: 24,
    height: 24,
    fills: [],
    strokes: [],
    children: [vec],
    rescale: vi.fn(),
    findAll: vi.fn().mockReturnValue([vec]),
    remove: vi.fn(),
    setPluginData: vi.fn(),
  };
}

let iconNode: ReturnType<typeof makeIconNode>;

vi.stubGlobal('figma', {
  createNodeFromSvg: vi.fn(() => {
    iconNode = makeIconNode();
    return iconNode;
  }),
});

describe('createIcon — variable-ref fill/stroke routing (lucide ICON crash regression)', () => {
  beforeEach(() => {
    applyPropertyMock.mockClear();
  });

  it('hex array fill: applies via lowerPaints + direct assignment (sanity — pre-existing behavior preserved)', async () => {
    // Caller mimics what expandShorthands produces for `fill="#FFFFFF"`:
    // an array, NOT a bare string.
    const result = await createIcon(null, {
      iconName: 'lucide:home',
      fills: ['#FFFFFF'],
    });

    expect(result.nodeId).toBe('icon:1');
    // Variable-ref path was never taken — no applyProperty calls for fills.
    const fillsRoutedThroughHandler = applyPropertyMock.mock.calls.some(
      (c) => c[1] === 'fills',
    );
    expect(fillsRoutedThroughHandler).toBe(false);
    // Vector child got the lowered fills directly.
    const child = iconNode.findAll.mock.results[0].value[0];
    expect(Array.isArray(child.fills)).toBe(true);
    expect(child.fills[0].type).toBe('SOLID');
  });

  it('$Token fill: routes through applyProperty (no lowerPaints crash)', async () => {
    // expandShorthands turns `fill="$Text/Primary"` into a bare string.
    // Previously createIcon called lowerPaints("$Text/Primary") → crash.
    // Now it must dispatch via applyProperty for each vector child.
    const result = await createIcon(null, {
      iconName: 'lucide:skip-back',
      fills: '$Text/Primary',
    });

    expect(result.nodeId).toBe('icon:1');
    // applyProperty was invoked with ('fills', '$Text/Primary') for the child.
    const fillCall = applyPropertyMock.mock.calls.find(
      (c) => c[1] === 'fills' && c[2] === '$Text/Primary',
    );
    expect(fillCall).toBeDefined();
  });

  it('$Token stroke: routes through applyProperty similarly', async () => {
    const result = await createIcon(null, {
      iconName: 'lucide:skip-forward',
      strokes: '$Brand/Primary',
    });

    expect(result.nodeId).toBe('icon:1');
    const strokeCall = applyPropertyMock.mock.calls.find(
      (c) => c[1] === 'strokes' && c[2] === '$Brand/Primary',
    );
    expect(strokeCall).toBeDefined();
  });
});

describe('lowerPaints — defensive guard against non-array input', () => {
  it('throws a clear error when given a string instead of an array', () => {
    // This is the secondary fix — before, calling .map on a string threw
    // a confusing "paints.map is not a function" up the stack. Now it
    // throws an error that names the actual problem.
    expect(() => lowerPaints('$Text/Primary' as any)).toThrow(
      /lowerPaints expected an array, got string/,
    );
  });

  it('throws when given an object', () => {
    expect(() => lowerPaints({ color: '#FFF' } as any)).toThrow(
      /lowerPaints expected an array, got object/,
    );
  });

  it('still accepts arrays (no regression on the happy path)', () => {
    const result = lowerPaints([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('SOLID');
  });
});
