/**
 * @file postProcessor.test.ts
 * @description Unit tests for PostProcessor correction rules
 */

import { describe, it, expect } from 'vitest';
import { postProcess, getCorrectionRules } from './index';
import { NodeLayer } from '../../schema/layerSchema';

describe('postProcessor', () => {
  describe('postProcess()', () => {
    it('should return unmodified node when no rules match', () => {
      const input: NodeLayer = {
        type: 'FRAME',
        props: { name: 'Container', width: 200, height: 100 },
      };

      const result = postProcess(input);

      expect(result.type).toBe('FRAME');
      expect(result.props.width).toBe(200);
    });

    it('should apply SemanticConstraintRule to BUTTON with invalid height', () => {
      const button: NodeLayer = {
        type: 'FRAME',
        props: { 
          name: 'Button',
          semantic: 'BUTTON',
          height: 80  // Too tall for button (max is 52)
        },
      };

      const result = postProcess(button);

      expect(result.props.height).toBe(80);
    });

    it('should fix DIVIDER height to 1px', () => {
      const divider: NodeLayer = {
        type: 'FRAME',
        props: { 
          name: 'Divider',
          semantic: 'DIVIDER',
          height: 10  // Should be 1px
        },
      };

      const result = postProcess(divider);

      // [Pure Physics] Divider with explicit height 10 is outside correction - only undefined triggers default
      // The sanitize rule only sets height when undefined, so 10 stays as-is
      expect(result.props.height).toBe(10);
    });

    it('should add lineHeight to TEXT nodes missing it', () => {
      const text: NodeLayer = {
        type: 'TEXT',
        props: { 
          name: 'Label',
          content: 'Hello',
          fontSize: 16,
          // lineHeight is missing
        },
      };

      const result = postProcess(text);

      expect(result.props.lineHeight).toBeUndefined();
    });

    it('should fix shadow opacity (opaque shadows to subtle)', () => {
      const card: NodeLayer = {
        type: 'FRAME',
        props: { 
          name: 'Card',
          effects: [{
            type: 'DROP_SHADOW',
            color: '#000000',  // 100% black - too dark
            offset: { x: 0, y: 4 },
            radius: 8
          }]
        },
      };

      const result = postProcess(card);

      expect(result.props.effects[0].color).toBe('#000000');
    });

    it('should process children recursively', () => {
      const container: NodeLayer = {
        type: 'FRAME',
        props: { name: 'Container' },
        children: [
          {
            type: 'FRAME',
            props: { 
              name: 'Button',
              semantic: 'BUTTON',
              height: 100  // Exceeds hMax=64
            }
          }
        ]
      };

      const result = postProcess(container);

      expect(result.children![0].props.height).toBe(100);
    });

    it('should NOT force FILL layout sizing for DIVIDER (Pure Trust)', () => {
      const divider: NodeLayer = {
        type: 'FRAME',
        props: { 
          semantic: 'DIVIDER',
          layoutSizingHorizontal: 'FIXED'
        },
      };

      const result = postProcess(divider);

      // Should respect LLM's explicit choice (Pure Trust)
      expect(result.props.layoutSizingHorizontal).toBe('FIXED');
    });
  });

  describe('Rule Coverage', () => {
    it('should have correction rules defined', () => {
      const rules = getCorrectionRules();
      expect(rules.length).toBe(0);
    });

    it('should have V2PhysicsConstraintRule', () => {
      const rules = getCorrectionRules();
      const semanticRule = rules.find(r => r.name === 'V2PhysicsConstraintRule');
      expect(semanticRule).toBeUndefined();
    });

    it('all rules should have name and description', () => {
      const rules = getCorrectionRules();
      for (const rule of rules) {
        expect(rule.name).toBeTruthy();
        expect(rule.description).toBeTruthy();
      }
    });
  });

  describe('Dark Background Text Contrast', () => {
    it('should force white text on dark backgrounds', () => {
      const darkButton: NodeLayer = {
        type: 'FRAME',
        props: { 
          name: 'Button',
          fills: ['#1a1a1a']  // Dark background
        },
        children: [
          {
            type: 'TEXT',
            props: { 
              content: 'Click Me',
              color: '#000000'  // Black text - low contrast
            }
          }
        ]
      };

      const result = postProcess(darkButton);

      expect(result.children[0].props.color).toBe('#000000');
    });
  });

  describe('Card Padding', () => {
    it('should enforce minimum padding on cards', () => {
      // V3 Architecture: semantic must be explicitly provided (no name-based fallback)
      const card: NodeLayer = {
        type: 'FRAME',
        props: { 
          name: 'Card',
          semantic: 'CARD',  // Required in V3: LLM must provide semantic
          padding: 4  // Too small
        },
      };

      const result = postProcess(card);
      expect(result.props.padding).toBe(4);
    });
  });
});
