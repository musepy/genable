import { describe, it, expect } from 'vitest';
import { NodeLayerSchema, coerceNodeLayer } from './schema/layerSchema';
import { NODE_TYPES, PROPS } from './constants/figma-api';

function parseElastic(input: any) {
  const coerced = coerceNodeLayer(input);
  return NodeLayerSchema.parse(coerced);
}

describe('Phase 2: New Node Types Schema Validation', () => {
  it('should allow ELLIPSE node type', () => {
    const input = {
      type: 'ELLIPSE',
      props: {
        name: 'My Circle',
        width: 100,
        height: 100,
        fills: ['#FF0000']
      }
    };
    const result = parseElastic(input);
    expect(result.type).toBe(NODE_TYPES.ELLIPSE);
    expect(result.props[PROPS.name]).toBe('My Circle');
  });

  it('should allow LINE node type', () => {
    const input = {
      type: 'LINE',
      props: {
        name: 'Divider Line',
        width: 200,
        rotation: 45,
        strokes: ['#000000']
      }
    };
    const result = parseElastic(input);
    expect(result.type).toBe(NODE_TYPES.LINE);
    expect(result.props[PROPS.rotation]).toBe(45);
  });

  it('should allow SECTION node type', () => {
    const input = {
      type: 'SECTION',
      props: {
        name: 'Main Section',
        fills: ['#F5F5F5']
      }
    };
    const result = parseElastic(input);
    expect(result.type).toBe(NODE_TYPES.SECTION);
  });

  it('should allow GROUP node type and preserve it if no layout', () => {
    const input = {
      type: 'GROUP',
      props: { name: 'My Group' },
      children: [
        { type: 'RECTANGLE', props: { name: 'Rect 1' } }
      ]
    };
    const result = parseElastic(input);
    expect(result.type).toBe(NODE_TYPES.GROUP);
    expect(result.children).toHaveLength(1);
  });

  it('should allow native properties even if they are not in our formal list (Knowledge Tolerance)', () => {
    const input = {
      type: 'RECTANGLE',
      props: {
        name: 'Custom Rect',
        someNativeFigmaProp: 'allowed due to passthrough',
        strokeLeftWeight: 5 // Real Figma property
      }
    };
    const result = parseElastic(input);
    expect(result.props).toHaveProperty('someNativeFigmaProp');
    expect(result.props).toHaveProperty('strokeLeftWeight');
  });
});
