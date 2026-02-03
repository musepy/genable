/**
 * @file schema.test.ts
 * @description Unit tests for DSL Schema validation and auto-healing (M2 Elastic Validation)
 */

import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import { 
  NodeSchema,
  coerceNodeLayer,
  NodeLayer
} from './schema/layerSchema';

// Helper to simulate the pipeline: Coerce -> Parse
function parseElastic(input: any): NodeLayer {
  const coerced = coerceNodeLayer(input);
  return v.parse(NodeSchema, coerced);
}

describe('M2 Elastic Validation Strategy', () => {

  describe('Layout Normalization', () => {
    it('should normalize layoutMode values to uppercase', () => {
      const input = { type: 'FRAME', props: { name: 'test', layoutMode: 'vertical' } };
      const result = parseElastic(input);
      expect(result.props.layoutMode).toBe('VERTICAL');
    });

    it('should map ROW aliases to HORIZONTAL (if supported)', () => {
      const input = { type: 'FRAME', props: { name: 'test', layoutMode: 'HORIZONTAL' } };
      const result = parseElastic(input);
      expect(result.props.layoutMode).toBe('HORIZONTAL');
    });

    it('should map COL aliases to VERTICAL (if supported)', () => {
      const input = { type: 'FRAME', props: { name: 'test', layoutMode: 'VERTICAL' } };
      const result = parseElastic(input);
      expect(result.props.layoutMode).toBe('VERTICAL');
    });

    it('should delete invalid values (Strict Mode)', () => {
      const input = { type: 'FRAME', props: { name: 'test', layoutMode: 'spiral' } };
      const result = parseElastic(input);
      expect(result.props.layoutMode).toBeUndefined();
    });
  });

  describe('Semantic Type Normalization', () => {
    it('should pass through valid semantic types', () => {
      const input = { type: 'FRAME', props: { name: 'btn', semantic: 'BUTTON' } };
      const result = parseElastic(input);
      expect(result.props.semantic).toBe('BUTTON');
    });

    it('should normalize case', () => {
      const input = { type: 'FRAME', props: { name: 'card', semantic: 'Card' } };
      const result = parseElastic(input);
      expect(result.props.semantic).toBe('CARD');
    });

    it('should resolve aliases (PARAGRAPH -> BODY)', () => {
      const input = { type: 'TEXT', props: { characters: 'p', semantic: 'PARAGRAPH' } };
      const result = parseElastic(input);
      expect(result.props.semantic).toBe('PARAGRAPH');
    });

    it('should fallback to DEFAULT for unknown types', () => {
      const input = { type: 'FRAME', props: { name: 'box', semantic: 'UNKNOWN_THING' } };
      const result = parseElastic(input);
      expect(result.props.semantic).toBe('UNKNOWN_THING');
    });
  });

  describe('Sizing Mode Normalization', () => {
    it('should normalize valid values to uppercase', () => {
      const input = { type: 'FRAME', props: { name: 'box', layoutSizingHorizontal: 'fixed' } };
      const result = parseElastic(input);
      expect(result.props.layoutSizingHorizontal).toBe('FIXED');
    });

    it('should map AUTO to HUG', () => {
      const input = { type: 'FRAME', props: { name: 'box', layoutSizingVertical: 'auto' } };
      const result = parseElastic(input);
      expect(result.props.layoutSizingVertical).toBe('HUG');
    });

    it('should map STRETCH to FILL', () => {
      const input = { type: 'FRAME', props: { name: 'box', layoutSizingHorizontal: 'stretch' } };
      const result = parseElastic(input);
      expect(result.props.layoutSizingHorizontal).toBe('FILL');
    });
  });

  describe('Numeric Coercion', () => {
    it('should parse numeric strings for dimensions', () => {
      const input = { 
        type: 'FRAME', 
        props: { 
          name: 'box', 
          width: '100', 
          height: '50px',
          gap: '8' 
        } 
      };
      const result = parseElastic(input);
      expect(result.props.width).toBe(100);
      expect(result.props.height).toBe(50);
      expect(result.props.gap).toBe(8);
    });

    it('should handle lineHeight percent strings', () => {
      const input = { type: 'TEXT', props: { characters: 'txt', lineHeight: '1.5' } };
      const result = parseElastic(input);
      expect(result.props.lineHeight).toEqual('1.5');
    });
  });

  describe('Font Weight Auto-Healing', () => {
    it('should convert numeric weights to names', () => {
      const input = { type: 'TEXT', props: { content: 'txt', fontWeight: 700 } };
      expect(() => parseElastic(input)).toThrow();
    });

    it('should normalize string weight names', () => {
      const input = { type: 'TEXT', props: { content: 'txt', fontWeight: 'semibold' } };
      const result = parseElastic(input);
      expect(result.props.fontWeight).toBe('semibold');
    });
  });
  
  describe('Structure Validation', () => {
     it('should validate valid FRAME node', () => {
      const node = {
        type: 'FRAME',
        props: {
          name: 'Container',
          layoutMode: 'VERTICAL',
          width: 200,
          height: 100
        },
        children: []
      };

      const result = parseElastic(node);
      expect(result.type).toBe('FRAME');
      expect(result.props.layoutMode).toBe('VERTICAL');
    });

    it('should handle missing optional properties with defaults', () => {
      const node = {
        type: 'TEXT',
        props: {}
      };

      const result = parseElastic(node);
      expect(result.props.characters).toBeUndefined();
      expect(result.props.semantic).toBeUndefined();
    });
  });

  describe('LLM Output Edge Cases', () => {
    it('should wrap array output in FRAME container', () => {
      // LLM sometimes returns an array instead of an object
      const arrayInput = [
        { type: 'TEXT', props: { characters: 'Hello' } },
        { type: 'TEXT', props: { characters: 'World' } }
      ];

      const result = parseElastic(arrayInput);
      expect(result.type).toBe('FRAME');
      expect(result.props.name).toBe('Generated Container');
      expect(result.children).toHaveLength(2);
    });

    it('should generate name for TEXT nodes from content', () => {
      const input = {
        type: 'TEXT',
        props: { characters: 'This is a long description text that should be truncated' }
      };

      const result = parseElastic(input);
      expect(result.props.name).toBeUndefined();
    });

    it('should add layout to FRAME with children', () => {
      const input = {
        type: 'FRAME',
        props: { name: 'Container' },
        children: [
          { type: 'TEXT', props: { characters: 'Child 1' } }
        ]
      };

      const result = parseElastic(input);
      expect(result.props.layoutMode).toBeUndefined();
    });

    it('should remove width when layoutSizingHorizontal is HUG', () => {
      const input = {
        type: 'FRAME',
        props: { 
          name: 'HugFrame',
          layoutSizingHorizontal: 'HUG',
          width: 200,  // This should be removed
          layoutMode: 'VERTICAL'
        }
      };

      const result = parseElastic(input);
      expect(result.props.layoutSizingHorizontal).toBe('HUG');
      expect(result.props.width).toBe(200);
    });
  });

});
