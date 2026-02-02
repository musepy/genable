
/**
 * @file declarativeEngine.test.ts
 * @description Unit tests for the Declarative Context Engine (SSOT Architecture)
 */

import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../promptComposer';
import { PROMPT_SECTION_REGISTRY } from '../sectionRegistry';
import { PromptDependencies } from '../../../../types/context';

// ==========================================
// REGISTRY SSOT TESTS
// ==========================================

describe('Declarative Context Engine', () => {

  describe('Prompt Composer', () => {

/**
 * Mock Dependencies Factory
 */
const createMockDeps = (overrides?: Partial<PromptDependencies>): PromptDependencies => ({
    ragResults: {
        prioritizedComponents: [],
        goldenTemplates: []
    },
    designSystemContext: {
        skillName: 'MOCK_SYSTEM'
    },
    globalContext: {},
    ...overrides
});

    it('should assemble basic prompt details', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps);
    
        // 1. Role Section (Priority 10)
        expect(prompt).toContain('You are an expert Figma UI designer');
        
        expect(prompt).toContain('### OUTPUT CONSTRAINTS');
    });

    it('should handle Modify Mode', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps, { isModifyMode: true });
    
        expect(prompt).toContain('MODE: MODIFY EXISTING DESIGN');
    });

    // REMOVED: Structural Anatomy test (Section logic removed)


    it('should include Icon Semantic Naming section', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps);
        expect(prompt).toContain('ICON USAGE (Semantic Naming)');
    });

    it('should respect Section Priority', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps);
        
        const idxRole = prompt.indexOf('You are an expert Figma UI designer');
        const idxConstraint = prompt.indexOf('### OUTPUT CONSTRAINTS');
        
        expect(idxRole).not.toBe(-1);
        expect(idxConstraint).not.toBe(-1);
        expect(idxRole).toBeLessThan(idxConstraint);
    });

  }); // End Prompt Composer
}); // End Declarative Context Engine

console.log('Tests defined.');
