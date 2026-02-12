import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { PROPS, NODE_TYPES } from '../../constants/figma-api';

// Mock figma global
vi.stubGlobal('figma', {
  getNodeById: vi.fn(),
});

describe('NodeSerializer - Compression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prune properties that match default values', () => {
    const mockNode = {
      type: 'FRAME',
      name: 'Test Frame',
      visible: true,      // Default
      opacity: 1,         // Default
      layoutMode: 'NONE', // Default
      itemSpacing: 0,     // Default (gap)
      children: [],
      // Mocked getter for extractFigmaNodeData compatibility if needed
      get: (key: string) => (mockNode as any)[key]
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(mockNode, { pruneDefaults: true });

    // Constants should be present
    expect(serialized.type).toBe(NODE_TYPES.FRAME);
    expect(serialized.props.name).toBe('Test Frame');

    // Defaults should be pruned
    expect(serialized.props.visible).toBeUndefined();
    expect(serialized.props.opacity).toBeUndefined();
    expect(serialized.props.layoutMode).toBeUndefined();
  });

  it('should preserve properties that differ from default values', () => {
    const mockNode = {
      type: 'FRAME',
      name: 'Modified Frame',
      visible: false,      // NON-DEFAULT
      opacity: 0.5,        // NON-DEFAULT
      layoutMode: 'HORIZONTAL', // NON-DEFAULT
      constraints: { horizontal: 'MAX', vertical: 'MIN' }, // NON-DEFAULT
      children: [],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(mockNode, { pruneDefaults: true });

    expect(serialized.props.visible).toBe(false);
    expect(serialized.props.opacity).toBe(0.5);
    expect(serialized.props.layoutMode).toBe('HORIZONTAL');
    expect(serialized.props.constraints).toEqual({ horizontal: 'MAX', vertical: 'MIN' });
  });

  it('should respect maxDepth limit', () => {
    const subChild = { type: 'TEXT', name: 'SubChild', visible: true, characters: 'Hello', children: [] };
    const child = { type: 'FRAME', name: 'Child', visible: true, children: [subChild] };
    const root = { type: 'FRAME', name: 'Root', visible: true, children: [child] };

    // depth 0: Root, depth 1: Child, depth 2: SubChild
    const serialized = NodeSerializer.serializeWithCompression(root, { maxDepth: 1 });

    expect(serialized.name).toBeUndefined(); // NodeLayer doesn't have name at root, it's in props
    expect(serialized.props.name).toBe('Root');
    expect(serialized.children).toHaveLength(1);
    expect(serialized.children?.[0].props.name).toBe('Child');
    // SubChild should be pruned because it's at depth 2 and maxDepth is 1
    expect(serialized.children?.[0].children).toBeUndefined();
  });

  it('should prune empty arrays', () => {
    const mockNode = {
      type: 'FRAME',
      name: 'Test',
      fills: [], // Empty array
      children: []
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(mockNode, { pruneDefaults: true });
    expect(serialized.props.fills).toBeUndefined();
  });
});
