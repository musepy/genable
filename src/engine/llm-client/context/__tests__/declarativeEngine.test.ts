
/**
 * @file declarativeEngine.test.ts
 * @description Unit tests for the Declarative Context Engine (SSOT Architecture)
 */

import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../promptComposer';
import { PROMPT_SECTION_REGISTRY } from '../sectionRegistry';
import { PromptDependencies } from '../../../types/context';

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
    intent: {
        type: 'GENERAL',
        target: null,
        confidence: 0,
        modifiers: {}
    },
    designSystemContext: {
        skillInstructions: 'MOCK_SKILL_INSTRUCTIONS',
        skillName: 'MOCK_SYSTEM',
        tokenSlotSnippet: '',
        tokens: {
            colorRoles: { text: { primary: 'foreground' } },
            spacing: { base: 4 }
        } as any
    },
    iconAllowlist: [],
    designContextPrompt: null,
    globalContext: {},
    ...overrides
});

    it('should assemble basic prompt details', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps);
    
        // 1. Role Section (Priority 10)
        expect(prompt).toContain('You are an expert Figma UI designer');
        
        // 2. Design System (Priority 20)
        expect(prompt).toContain('DESIGN SYSTEM: MOCK_SYSTEM');
        expect(prompt).toContain('MOCK_SKILL_INSTRUCTIONS');
    });

    it('should handle Modify Mode', () => {
        const deps = createMockDeps();
        const prompt = composeSystemPrompt(deps, { isModifyMode: true });
    
        expect(prompt).toContain('MODE: MODIFY EXISTING DESIGN');
    });

    it('should inject Structural Anatomy for recognized components', () => {
        const deps = createMockDeps({
            intent: {
                 type: 'GENERATE_COMPONENT',
                 target: 'Button', // Now uses ANATOMY_REGISTRY
                 confidence: 0.9,
                 modifiers: {}
            }
        });
        
        const prompt = composeSystemPrompt(deps);
        
        // structural-anatomy section is now used instead of deprecated knowledge-base
        expect(prompt).toContain('STRUCTURAL ANATOMY BLUEPRINT');
    });

    it('should inject Token Slots', () => {
        const deps = createMockDeps({
            designSystemContext: {
                skillInstructions: '',
                skillName: 'M3',
                tokenSlotSnippet: 'AVAILABLE_SLOTS: [Action, Surface]'
            }
        });
    
        const prompt = composeSystemPrompt(deps);
        expect(prompt).toContain('AVAILABLE_SLOTS: [Action, Surface]');
    });

    it('should handle Icon Allowlist modes', () => {
        // Case A: Strict List
        const depsStrict = createMockDeps({
            iconAllowlist: ['lucide:home', 'lucide:user']
        });
        const promptStrict = composeSystemPrompt(depsStrict);
        expect(promptStrict).toContain('ICON ALLOWLIST (STRICT');
        expect(promptStrict).toContain('lucide:home');
    
        // Case B: Semantic (Empty List)
        const depsSemantic = createMockDeps({
            iconAllowlist: []
        });
        const promptSemantic = composeSystemPrompt(depsSemantic);
        expect(promptSemantic).toContain('ICON USAGE (Semantic Naming)');
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
