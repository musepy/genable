/**
 * @file findReferencesHandler.test.ts
 * @description Pure-logic tests for the reverse-lookup helper.
 *
 * `buildReferencesList` is a pure function over plain node-like objects,
 * so no figma.* mocks are required (per CLAUDE.md). The outer
 * handleFindReferences wrapper (figma.currentPage.findAll,
 * figma.variables.getVariableByIdAsync) is covered via the dev bridge E2E.
 */

import { describe, it, expect } from 'vitest';
import { buildReferencesList, type NodeLike } from '../findReferencesHandler';

const TARGET = 'VariableID:1:5';
const OTHER = 'VariableID:9:9';

function node(overrides: Partial<NodeLike> & Pick<NodeLike, 'id' | 'name' | 'type'>): NodeLike {
  return { visible: true, ...overrides };
}

describe('buildReferencesList — node-level bindings', () => {
  it('emits one reference when boundVariables.paddingLeft matches the target', () => {
    const n = node({
      id: '1:2', name: 'Card', type: 'FRAME',
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: TARGET } },
    });
    const refs = buildReferencesList([n], TARGET);
    expect(refs).toEqual([
      { nodeId: '1:2', nodeName: 'Card', nodeType: 'FRAME', path: 'boundVariables.paddingLeft' },
    ]);
  });

  it('does not emit when boundVariables holds a non-matching id', () => {
    const n = node({
      id: '1:2', name: 'Card', type: 'FRAME',
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: OTHER } },
    });
    expect(buildReferencesList([n], TARGET)).toEqual([]);
  });

  it('emits two references when paddingLeft and itemSpacing both match', () => {
    const n = node({
      id: '1:2', name: 'Card', type: 'FRAME',
      boundVariables: {
        paddingLeft: { type: 'VARIABLE_ALIAS', id: TARGET },
        itemSpacing: { type: 'VARIABLE_ALIAS', id: TARGET },
        opacity: { type: 'VARIABLE_ALIAS', id: OTHER },
      },
    });
    const refs = buildReferencesList([n], TARGET);
    const paths = refs.map(r => r.path).sort();
    expect(paths).toEqual(['boundVariables.itemSpacing', 'boundVariables.paddingLeft']);
    for (const r of refs) {
      expect(r.nodeId).toBe('1:2');
      expect(r.nodeName).toBe('Card');
      expect(r.nodeType).toBe('FRAME');
    }
  });
});

describe('buildReferencesList — per-paint bindings', () => {
  it('emits a fills[0].boundVariables.color reference when the first paint binds the target', () => {
    const n = node({
      id: '1:5', name: 'Surface Accent', type: 'RECTANGLE',
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: TARGET } } },
      ],
    });
    const refs = buildReferencesList([n], TARGET);
    expect(refs).toEqual([
      { nodeId: '1:5', nodeName: 'Surface Accent', nodeType: 'RECTANGLE', path: 'fills[0].boundVariables.color' },
    ]);
  });

  it('emits correct indices when fills[0] and fills[2] both bind the target (fills[1] does not)', () => {
    const n = node({
      id: '1:6', name: 'Layered', type: 'RECTANGLE',
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: TARGET } } },
        { type: 'SOLID', color: { r: 0, g: 1, b: 0 } }, // no binding
        { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: TARGET } } },
      ],
    });
    const refs = buildReferencesList([n], TARGET);
    const paths = refs.map(r => r.path);
    expect(paths).toEqual(['fills[0].boundVariables.color', 'fills[2].boundVariables.color']);
  });

  it('emits strokes[i].boundVariables.color paths for stroke bindings', () => {
    const n = node({
      id: '1:7', name: 'Bordered', type: 'FRAME',
      strokes: [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, // no binding
        { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: TARGET } } },
      ],
    });
    const refs = buildReferencesList([n], TARGET);
    expect(refs).toEqual([
      { nodeId: '1:7', nodeName: 'Bordered', nodeType: 'FRAME', path: 'strokes[1].boundVariables.color' },
    ]);
  });
});

describe('buildReferencesList — defensive behavior', () => {
  it('returns no references for a node with no fills/strokes/boundVariables', () => {
    const n = node({ id: '1:8', name: 'Bare', type: 'FRAME' });
    expect(buildReferencesList([n], TARGET)).toEqual([]);
  });

  it('does not throw when boundVariables has odd shapes (null, primitive, empty)', () => {
    const nodes: NodeLike[] = [
      node({ id: '1:a', name: 'Null BV', type: 'FRAME', boundVariables: null as unknown as object }),
      node({ id: '1:b', name: 'Empty BV', type: 'FRAME', boundVariables: {} }),
      node({ id: '1:c', name: 'Primitive BV', type: 'FRAME', boundVariables: 42 as unknown as object }),
    ];
    expect(() => buildReferencesList(nodes, TARGET)).not.toThrow();
    expect(buildReferencesList(nodes, TARGET)).toEqual([]);
  });

  it('skips invisible nodes by default', () => {
    const visible = node({
      id: '1:9', name: 'Shown', type: 'FRAME',
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: TARGET } },
    });
    const hidden = node({
      id: '1:10', name: 'Hidden', type: 'FRAME',
      visible: false,
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: TARGET } },
    });
    const refs = buildReferencesList([visible, hidden], TARGET);
    expect(refs.length).toBe(1);
    expect(refs[0].nodeId).toBe('1:9');
  });

  it('ignores non-object entries inside boundVariables (e.g. undefined / stringy values)', () => {
    const n = node({
      id: '1:11', name: 'Weird', type: 'FRAME',
      boundVariables: { paddingLeft: undefined as unknown as object, itemSpacing: 'nope' as unknown as object },
    });
    expect(buildReferencesList([n], TARGET)).toEqual([]);
  });

  it('ignores a paint whose boundVariables.color id does not match', () => {
    const n = node({
      id: '1:12', name: 'Other Color', type: 'RECTANGLE',
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: OTHER } } },
      ],
    });
    expect(buildReferencesList([n], TARGET)).toEqual([]);
  });

  it('aggregates references from both node-level and per-paint binds on a single node', () => {
    const n = node({
      id: '1:13', name: 'Hybrid', type: 'FRAME',
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: TARGET } },
      fills: [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: TARGET } } },
      ],
    });
    const refs = buildReferencesList([n], TARGET);
    const paths = refs.map(r => r.path).sort();
    expect(paths).toEqual(['boundVariables.paddingLeft', 'fills[0].boundVariables.color']);
  });
});
