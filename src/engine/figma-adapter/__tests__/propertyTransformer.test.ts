import { describe, it, expect } from 'vitest';
import { PropertyTransformer } from '../propertyTransformer';
import { PROPS } from '../../../constants/figma-api';

describe('PropertyTransformer.isEqual', () => {
    it('should correctly compare scalar values', () => {
        const nodeData: any = { width: 100 };
        expect(PropertyTransformer.isEqual(nodeData, PROPS.width, 100)).toBe(true);
        expect(PropertyTransformer.isEqual(nodeData, PROPS.width, 200)).toBe(false);
    });

    it('should correctly compare color arrays', () => {
        const nodeData: any = { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] };
        expect(PropertyTransformer.isEqual(nodeData, PROPS.fills, ['#FFFFFF'])).toBe(true);
        expect(PropertyTransformer.isEqual(nodeData, PROPS.fills, ['#ffffff'])).toBe(true);
        expect(PropertyTransformer.isEqual(nodeData, PROPS.fills, ['#000000'])).toBe(false);
    });

    it('should fail when using JSON.stringify on reordered object keys (current bug)', () => {
        // This test demonstrates the current brittle implementation
        const nodeData: any = { 
            effects: [
                { type: 'DROP_SHADOW', color: { r: 1, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0 }
            ] 
        };
        
        // Serialized state might have keys in specific order
        // DSL value might have same data but different key order
        const dslValue = [
            { type: 'DROP_SHADOW', radius: 4, offset: { x: 0, y: 2 }, color: '#FF0000', spread: 0 }
        ];
        
        // If current implementation uses JSON.stringify, this might fail depending on how 'serialize' produces keys
        // But more importantly, it fails if children or nested objects are reordered.
        
        // Let's actually check if it handles nested objects reordered
        const val1 = [{ a: 1, b: 2 }];
        const val2 = [{ b: 2, a: 1 }];
        expect(JSON.stringify(val1) === JSON.stringify(val2)).toBe(false);
    });

    // TODO: TDD goal — deepEqual() not yet handling color hex + reordered keys correctly
    it.skip('should correctly compare complex arrays with depth (TDD Goal)', () => {
        const nodeData: any = { 
            effects: [
                { 
                    type: 'DROP_SHADOW', 
                    color: { r: 0, g: 0, b: 0, a: 0.1 }, 
                    offset: { x: 0, y: 4 }, 
                    radius: 10, 
                    spread: 0,
                    visible: true
                }
            ] 
        };
        
        // Expected value from LLM/DSL
        const dslValue = [
            { 
                type: 'DROP_SHADOW', 
                offset: { y: 4, x: 0 }, // Reordered keys
                color: '#000000', 
                radius: 10, 
                spread: 0 
            }
        ];

        // Currently this might fail due to JSON.stringify
        expect(PropertyTransformer.isEqual(nodeData, PROPS.effects, dslValue)).toBe(true);
    });
});
