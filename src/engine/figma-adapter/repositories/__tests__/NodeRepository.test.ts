import { describe, it, expect, vi } from 'vitest';
import { NodeRepository } from '../NodeRepository';

describe('NodeRepository.applyLayout - positioning and constraints', () => {
  const makeNode = (parentLayoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE') => {
    const parent = {
      type: 'FRAME',
      layoutMode: parentLayoutMode
    } as any;

    return {
      id: '100:1',
      type: 'FRAME',
      parent,
      width: 100,
      height: 80,
      x: 10,
      y: 20,
      layoutMode: 'NONE',
      layoutPositioning: 'AUTO',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      resize: vi.fn(function (this: any, w: number, h: number) {
        this.width = w;
        this.height = h;
      })
    } as any;
  };

  it('applies ABSOLUTE positioning + x/y for auto-layout child', () => {
    const repo = new NodeRepository();
    const node = makeNode('VERTICAL');

    repo.applyLayout(node, {
      layoutPositioning: 'ABSOLUTE',
      x: 120,
      y: 64
    });

    expect(node.layoutPositioning).toBe('ABSOLUTE');
    expect(node.x).toBe(120);
    expect(node.y).toBe(64);
  });

  it('normalizes constraints aliases to canonical values', () => {
    const repo = new NodeRepository();
    const node = makeNode('NONE');

    repo.applyLayout(node, {
      constraints: {
        horizontal: 'LEFT_RIGHT',
        vertical: 'BOTTOM'
      }
    });

    expect(node.constraints).toEqual({
      horizontal: 'STRETCH',
      vertical: 'MAX'
    });
  });

  it('does not apply x/y to auto-layout flow children unless ABSOLUTE', () => {
    const repo = new NodeRepository();
    const node = makeNode('HORIZONTAL');

    repo.applyLayout(node, {
      layoutPositioning: 'AUTO',
      x: 200,
      y: 150
    });

    expect(node.layoutPositioning).toBe('AUTO');
    expect(node.x).toBe(10);
    expect(node.y).toBe(20);
  });
});
