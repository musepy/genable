import { describe, it, expect } from 'vitest';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { NODE_TYPES } from '../../constants/figma-api';
import { formatPaintForLLM } from '../../domain/property-specs';

describe('NodeSerializer - Compression', () => {

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

// ════════════════════════════════════════════════════════════════
// Phase 3: facet-based reads — verify variables surface correctly
// ════════════════════════════════════════════════════════════════

describe('NodeSerializer - Facets', () => {

  it('default (no facets) on a FRAME+TEXT tree matches legacy visual-role output', () => {
    const textChild = {
      id: '2:1', type: 'TEXT', name: 'Label', visible: true,
      characters: 'Hello', fontSize: 14, fontName: { family: 'Inter', style: 'Regular' },
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true }],
      children: [],
    };
    const root = {
      id: '1:1', type: 'FRAME', name: 'Card', visible: true,
      layoutMode: 'VERTICAL', itemSpacing: 8, paddingLeft: 16, paddingRight: 16,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true }],
      // Computed props that should stay blind on the default path:
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
      explicitVariableModes: { 'VariableCollectionId:1:1': '1:0' },
      children: [textChild],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(root, { pruneDefaults: true });

    // No facets → boundVariables + explicitVariableModes NOT surfaced (legacy behaviour).
    expect((serialized.props as any).boundVariables).toBeUndefined();
    expect((serialized.props as any).explicitVariableModes).toBeUndefined();

    // Visible design props survive (byte-identical to pre-Phase-3 output).
    expect(serialized.props.layoutMode).toBe('VERTICAL');
    expect(serialized.props.name).toBe('Card');
    expect(serialized.children).toHaveLength(1);
    expect(serialized.children?.[0].props.name).toBe('Label');
  });

  it("facets:['variables'] surfaces node.boundVariables with VARIABLE_ALIAS intact", () => {
    const node = {
      id: '1:1', type: 'FRAME', name: 'Token-bound',
      paddingLeft: 16,
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
      children: [],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(node, {
      pruneDefaults: true,
      facets: new Set(['variables']),
    });

    expect((serialized.props as any).boundVariables).toEqual({
      paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' },
    });
  });

  it("facets:['variables'] surfaces node.explicitVariableModes", () => {
    const node = {
      id: '1:1', type: 'FRAME', name: 'Modes',
      explicitVariableModes: { 'VariableCollectionId:1:1': '1:0' },
      children: [],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(node, {
      pruneDefaults: true,
      facets: new Set(['variables']),
    });

    expect((serialized.props as any).explicitVariableModes).toEqual({
      'VariableCollectionId:1:1': '1:0',
    });
  });

  it("facets:['variables'] does NOT emit non-variable props like fills or layout", () => {
    const node = {
      id: '1:1', type: 'FRAME', name: 'Mixed',
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
      children: [],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(node, {
      pruneDefaults: true,
      facets: new Set(['variables']),
    });

    expect((serialized.props as any).boundVariables).toBeDefined();
    expect((serialized.props as any).fills).toBeUndefined();
    expect(serialized.props.layoutMode).toBeUndefined();
    expect((serialized.props as any).gap).toBeUndefined();
  });

  it("facets:['paint'] preserves Paint.boundVariables.color via formatPaintForLLM", () => {
    // Direct test of the formatter — the stripper lived here pre-Phase-3.
    const paintWithBinding = {
      type: 'SOLID',
      color: { r: 1, g: 1, b: 1 },
      opacity: 1,
      boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
    };
    const formatted = formatPaintForLLM(paintWithBinding);
    expect(formatted).toEqual({
      color: '#FFFFFF',
      boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
    });

    // Downstream: through the NodeSerializer pipeline, the fills array carries the
    // object-form Paint (not the short hex string) so the binding survives into JSON.
    const node = {
      id: '1:1', type: 'FRAME', name: 'Bound fill',
      fills: [paintWithBinding],
      children: [],
    } as any;
    const serialized = NodeSerializer.serializeWithCompression(node, {
      pruneDefaults: true,
      facets: new Set(['paint']),
    });
    const fills = (serialized.props as any).fills;
    expect(Array.isArray(fills) && fills.length).toBe(1);
    expect(fills[0].boundVariables?.color).toEqual({ type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' });
  });

  it("facets:['all'] returns layout props AND boundVariables together", () => {
    const node = {
      id: '1:1', type: 'FRAME', name: 'Both',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 12,
      paddingLeft: 16,
      boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' } },
      explicitVariableModes: { 'VariableCollectionId:1:1': '1:0' },
      children: [],
    } as any;

    const serialized = NodeSerializer.serializeWithCompression(node, {
      pruneDefaults: true,
      facets: new Set(['all']),
    });

    expect(serialized.props.layoutMode).toBe('HORIZONTAL');
    expect((serialized.props as any).gap).toBe(12);
    expect(serialized.props.paddingLeft).toBe(16);
    expect((serialized.props as any).boundVariables).toEqual({
      paddingLeft: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:5' },
    });
    expect((serialized.props as any).explicitVariableModes).toEqual({
      'VariableCollectionId:1:1': '1:0',
    });
  });
});
