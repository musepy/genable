/**
 * @file constraintValidator.test.ts
 * @description Unit tests for formal layout constraint validation
 */

import { describe, it, expect } from 'vitest';
import { validateLayoutConstraints } from './constraintValidator';
import { NodeLayer } from '../../schema/layerSchema';

describe('constraintValidator', () => {
  describe('validateLayoutConstraints', () => {
    
    describe('Rule 1: SizingDimensionConflict', () => {
      it('should warn when HUG sizing has explicit width', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'TestFrame',
            layoutSizingHorizontal: 'HUG',
            width: 200,  // This conflicts with HUG
            layout: 'VERTICAL'
          }
        };

        const result = validateLayoutConstraints(node);
        
        expect(result.warnings.length).toBeGreaterThan(0);
        const conflict = result.warnings.find(w => w.rule === 'SizingDimensionConflict');
        expect(conflict).toBeDefined();
        expect(conflict?.machineReadable.field).toBe('props.width');
      });

      it('should warn when FILL sizing has explicit width', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'TestFrame',
            layoutSizingHorizontal: 'FILL',
            width: 200,  // This conflicts with FILL
            layout: 'VERTICAL'
          }
        };

        const result = validateLayoutConstraints(node);
        
        const conflict = result.warnings.find(w => w.rule === 'SizingDimensionConflict');
        expect(conflict).toBeDefined();
      });

      it('should NOT warn when FIXED sizing has explicit width', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'TestFrame',
            layoutSizingHorizontal: 'FIXED',
            width: 200,  // This is correct for FIXED
            layout: 'VERTICAL'
          }
        };

        const result = validateLayoutConstraints(node);
        
        const conflict = result.warnings.find(w => 
          w.rule === 'SizingDimensionConflict' && 
          w.machineReadable.field === 'props.width'
        );
        expect(conflict).toBeUndefined();
      });
    });

    describe('Rule 2: ParentChildDependencyCycle', () => {
      it('should error when FILL child is in HUG parent', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'Parent',
            layout: 'VERTICAL',
            layoutSizingHorizontal: 'HUG'  // Parent is HUG
          },
          children: [{
            type: 'FRAME',
            props: {
              name: 'Child',
              layoutSizingHorizontal: 'FILL'  // Child is FILL - creates cycle!
            }
          }]
        };

        const result = validateLayoutConstraints(node);
        
        expect(result.hasErrors).toBe(true);
        const cycle = result.warnings.find(w => w.rule === 'ParentChildDependencyCycle');
        expect(cycle).toBeDefined();
        expect(cycle?.severity).toBe('error');
      });

      it('should NOT error when FILL child is in FIXED parent', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'Parent',
            layout: 'VERTICAL',
            layoutSizingHorizontal: 'FIXED',  // Parent is FIXED
            width: 300
          },
          children: [{
            type: 'FRAME',
            props: {
              name: 'Child',
              layoutSizingHorizontal: 'FILL'  // Child is FILL - OK!
            }
          }]
        };

        const result = validateLayoutConstraints(node);
        
        const cycle = result.warnings.find(w => w.rule === 'ParentChildDependencyCycle');
        expect(cycle).toBeUndefined();
      });
    });

    describe('Rule 3: AutoLayoutRequired', () => {
      it('should error when HUG sizing but no layout', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'NoLayoutFrame',
            layoutSizingHorizontal: 'HUG'
            // Missing: layout: 'VERTICAL' or 'HORIZONTAL'
          }
        };

        const result = validateLayoutConstraints(node);
        
        expect(result.hasErrors).toBe(true);
        const autoLayout = result.warnings.find(w => w.rule === 'AutoLayoutRequired');
        expect(autoLayout).toBeDefined();
      });

      it('should NOT error when HUG sizing with layout', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'WithLayoutFrame',
            layoutSizingHorizontal: 'HUG',
            layout: 'VERTICAL'  // Has required layout!
          }
        };

        const result = validateLayoutConstraints(node);
        
        const autoLayout = result.warnings.find(w => w.rule === 'AutoLayoutRequired');
        expect(autoLayout).toBeUndefined();
      });
    });

    describe('Rule 4: FixedSizingMissingDimension', () => {
      it('should warn when FIXED sizing but no dimension', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'FixedNoWidth',
            layoutSizingHorizontal: 'FIXED',
            layout: 'VERTICAL'
            // Missing: width
          }
        };

        const result = validateLayoutConstraints(node);
        
        const missing = result.warnings.find(w => w.rule === 'FixedSizingMissingDimension');
        expect(missing).toBeDefined();
        expect(missing?.machineReadable.field).toBe('props.width');
      });

      it('should NOT warn when FIXED sizing has dimension', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'FixedWithWidth',
            layoutSizingHorizontal: 'FIXED',
            width: 200,  // Has required dimension
            layout: 'VERTICAL'
          }
        };

        const result = validateLayoutConstraints(node);
        
        const missing = result.warnings.find(w => 
          w.rule === 'FixedSizingMissingDimension' &&
          w.machineReadable.field === 'props.width'
        );
        expect(missing).toBeUndefined();
      });
    });

    describe('Complex nested tree', () => {
      it('should validate entire tree recursively', () => {
        const node: NodeLayer = {
          type: 'FRAME',
          props: {
            name: 'Root',
            layout: 'VERTICAL',
            layoutSizingHorizontal: 'FIXED',
            width: 400
          },
          children: [
            {
              type: 'FRAME',
              props: {
                name: 'ValidChild',
                layoutSizingHorizontal: 'FILL',
                layout: 'HORIZONTAL'
              },
              children: [
                {
                  type: 'FRAME',
                  props: {
                    name: 'InvalidGrandchild',
                    layoutSizingHorizontal: 'HUG',
                    width: 100  // Conflict!
                  }
                }
              ]
            }
          ]
        };

        const result = validateLayoutConstraints(node);
        
        // Should find the grandchild's conflict
        const grandchildWarning = result.warnings.find(w => 
          w.nodeName === 'InvalidGrandchild' && 
          w.rule === 'SizingDimensionConflict'
        );
        expect(grandchildWarning).toBeDefined();
      });
    });
  });
});
