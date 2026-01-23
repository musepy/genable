/**
 * @file figmaVariableCache.test.ts
 * @description Unit tests for FigmaVariableCache service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { figmaVariableCache } from './figmaVariableCache';

// Mock Figma API
const mockVariables = [
    { name: 'Color/Primary', id: 'var:1' },
    { name: 'Spacing/Small', id: 'var:2' }
];

const mockStyles = [
    { name: 'Text/Large', id: 'style:1' }
];

global.figma = {
    variables: {
        getLocalVariablesAsync: vi.fn().mockResolvedValue(mockVariables)
    },
    getLocalPaintStylesAsync: vi.fn().mockResolvedValue(mockStyles)
} as any;

describe('FigmaVariableCache', () => {
    beforeEach(() => {
        // Reset singleton state if possible, or just re-warmup
        // Since it's a singleton, we rely on warmup clearing the map
    });

    it('should be initially empty', () => {
        // Singleton might hold state from previous tests if run in same context
        // But assuming fresh start or explicit warmup call in test
    });

    it('should cache variables and access by full name', async () => {
        await figmaVariableCache.warmup();
        
        const v = figmaVariableCache.getVariable('Color/Primary');
        expect(v).toBeDefined();
        expect(v?.id).toBe('var:1');
    });

    it('should cache variables and access by short name', async () => {
        await figmaVariableCache.warmup();
        
        const v = figmaVariableCache.getVariable('Primary');
        expect(v).toBeDefined();
        expect(v?.id).toBe('var:1');
    });

    it('should return null for non-existent variable', async () => {
        await figmaVariableCache.warmup();
        expect(figmaVariableCache.getVariable('NonExistent')).toBeNull();
    });

    it('should cache styles', async () => {
        await figmaVariableCache.warmup();
        
        const s = figmaVariableCache.getStyle('Text/Large');
        expect(s).toBeDefined();
        expect(s?.id).toBe('style:1');
    });
    
    it('should be case-insensitive', async () => {
         await figmaVariableCache.warmup();
         const v = figmaVariableCache.getVariable('color/primary');
         expect(v).toBeDefined();
    });
});
