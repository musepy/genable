import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from './promptComposer';
import { PromptDependencies } from '../../types/context';

describe('Knowledge Hub Prompt Injection (UX Pro Max)', () => {
    it('should inject Fintech reasoning, typography, and styles', () => {
        const fintechDeps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.95,
                target: 'Fintech Dashboard',
                modifiers: { variant: 'modern' },
                matchedKeywords: ['fintech']
            },
            designSystemContext: {
                skillInstructions: '',
                skillName: 'shadcn',
                tokenSlotSnippet: ''
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(fintechDeps, {});
        
        expect(prompt).toContain('### DESIGN REASONING');
        expect(prompt).toContain('### TYPOGRAPHY PAIRING');
        expect(prompt).toContain('### VISUAL STYLE GUIDELINES');
    });

    it('should inject Landing Page patterns when intent matches', () => {
        const landingDeps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'SaaS Mobile Landing Page',
                modifiers: {},
                matchedKeywords: ['landing']
            },
            designSystemContext: {
                skillInstructions: '',
                skillName: 'shadcn',
                tokenSlotSnippet: ''
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(landingDeps, {});
        
        expect(prompt).toContain('### LANDING PAGE STRUCTURE');
    });
});
