import { describe, it, expect } from 'vitest';
import { paintHandler } from '../paintHandler';
import { effectHandler } from '../effectHandler';
import { unitValueHandler } from '../unitValueHandler';
import { resizeHandler } from '../resizeHandler';
import { defaultHandler } from '../defaultHandler';
import { applyProperty } from '../index';

// Minimal mock node for testing handler match/apply logic
function mockNode(overrides: Record<string, any> = {}): SceneNode {
  const node: any = {
    id: 'test:1',
    type: 'FRAME',
    width: 100,
    height: 100,
    fills: [],
    strokes: [],
    effects: [],
    resize(w: number, h: number) { node.width = w; node.height = h; },
    ...overrides,
  };
  return node as SceneNode;
}

describe('paintHandler', () => {
  it('matches fills and strokes', () => {
    const node = mockNode();
    expect(paintHandler.match('fills', [{ type: 'SOLID', color: '#FF0000' }], node)).toBe(true);
    expect(paintHandler.match('strokes', [{ type: 'SOLID', color: '#000' }], node)).toBe(true);
    expect(paintHandler.match('name', 'test', node)).toBe(false);
  });
});

describe('effectHandler', () => {
  it('matches only effects key', () => {
    const node = mockNode();
    expect(effectHandler.match('effects', [], node)).toBe(true);
    expect(effectHandler.match('fills', [], node)).toBe(false);
  });
});

describe('unitValueHandler', () => {
  it('matches letterSpacing and lineHeight with valid value types', () => {
    const node = mockNode();
    expect(unitValueHandler.match('letterSpacing', 2, node)).toBe(true);
    expect(unitValueHandler.match('lineHeight', '150%', node)).toBe(true);
    expect(unitValueHandler.match('lineHeight', { value: 20, unit: 'PIXELS' }, node)).toBe(true);
    expect(unitValueHandler.match('fontSize', 14, node)).toBe(false);
  });
});

describe('resizeHandler', () => {
  it('matches width/height on nodes with resize method', () => {
    const node = mockNode();
    expect(resizeHandler.match('width', 200, node)).toBe(true);
    expect(resizeHandler.match('height', 300, node)).toBe(true);
    expect(resizeHandler.match('name', 'test', node)).toBe(false);
  });

  it('does not match if node lacks resize', () => {
    const node = mockNode();
    delete (node as any).resize;
    expect(resizeHandler.match('width', 200, node)).toBe(false);
  });
});

describe('defaultHandler', () => {
  it('matches any property that exists on node', () => {
    const node = mockNode({ name: 'Test', opacity: 1 });
    expect(defaultHandler.match('name', 'New', node)).toBe(true);
    expect(defaultHandler.match('opacity', 0.5, node)).toBe(true);
    expect(defaultHandler.match('nonExistent', 'x', node)).toBe(false);
  });

  it('assigns value directly', async () => {
    const node = mockNode({ opacity: 1 });
    const warnings = await defaultHandler.apply(node, 'opacity', 0.5);
    expect(warnings).toEqual([]);
    expect((node as any).opacity).toBe(0.5);
  });

  it('skips readonly properties', async () => {
    const node = {} as any;
    Object.defineProperty(node, 'type', { value: 'FRAME', writable: false });
    node.id = 'test:1';
    const warnings = await defaultHandler.apply(node as SceneNode, 'type', 'TEXT');
    expect(warnings[0].code).toBe('SKIPPED_READONLY');
  });
});

describe('applyProperty (pipeline)', () => {
  it('routes fills to paintHandler', async () => {
    const node = mockNode();
    // lowerPaints will be called — just verify no crash with simple input
    const warnings = await applyProperty(node, 'fills', [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
    expect(warnings).toEqual([]);
    expect((node as any).fills).toHaveLength(1);
  });

  it('routes width to resizeHandler', async () => {
    const node = mockNode();
    const warnings = await applyProperty(node, 'width', 250);
    expect(warnings).toEqual([]);
    expect(node.width).toBe(250);
    expect(node.height).toBe(100); // unchanged
  });

  it('routes unknown props to UNSUPPORTED_PROP', async () => {
    const node = mockNode();
    const warnings = await applyProperty(node, 'totallyFake', 'value');
    expect(warnings[0].code).toBe('UNSUPPORTED_PROP');
  });
});
