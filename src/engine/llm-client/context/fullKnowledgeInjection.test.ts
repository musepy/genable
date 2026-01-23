
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from './promptComposer';
import { PromptDependencies } from '../../types/context';

describe('Tier 2 Knowledge Injection (Full UI Pro Max)', () => {
    it('should inject Chart recommendations for data analytics intents', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'Analytics Dashboard with Charts',
                modifiers: {},
                matchedKeywords: ['analytics', 'charts']
            },
            designSystemContext: {
                skillInstructions: '',
                skillName: 'shadcn',
                tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} }
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### CHART RECOMMENDATIONS');
        expect(prompt).toContain('Best Chart Type:');
    });

    it('should inject UX Guidelines for general UI intents', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.8,
                target: 'Web Application User Profile',
                modifiers: {},
                matchedKeywords: ['web', 'profile']
            },
            designSystemContext: {
                skillInstructions: '',
                skillName: 'shadcn',
                tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} }
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### UX & IMPLEMENTATION GUIDELINES');
        expect(prompt).toContain('Do:');
        expect(prompt).toContain('Don\'t:');
    });

    it('should inject Stack-specific constraints when shadcn is used', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'Generic Button',
                modifiers: {},
                matchedKeywords: []
            },
            designSystemContext: {
                skillInstructions: 'Use shadcn components',
                skillName: 'shadcn',
                tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} }
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### TECHNICAL STACK CONSTRAINTS (shadcn)');
        expect(prompt).toContain('Proper Syntax:');
    });

    it('should inject Industry Trends for SaaS intents', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'B2B SaaS Landing Page',
                modifiers: {},
                matchedKeywords: ['saas']
            },
            designSystemContext: {
                skillInstructions: '',
                skillName: 'shadcn',
                tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} }
            },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### INDUSTRY TRENDS & BEST PRACTICES');
        expect(prompt).toContain('Market Segment:');
    });
    it('should inject Color Context for specific industry intents', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'Fintech App',
                modifiers: {},
                matchedKeywords: ['fintech']
            },
            designSystemContext: { skillInstructions: '', skillName: 'vanilla', tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} } },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### PRODUCT COLOR PALETTE');
        // Verify it includes some expected colors from Fintech knowledge base
        expect(prompt).toContain('#'); 
    });

    it('should strip stylistic properties from structural anatomy blueprints', () => {
        const deps: PromptDependencies = {
            ragResults: { prioritizedComponents: [], goldenTemplates: [] },
            intent: {
                type: 'GENERATE_COMPONENT',
                confidence: 0.9,
                target: 'Primary Button',
                modifiers: {},
                matchedKeywords: ['button']
            },
            designSystemContext: { skillInstructions: '', skillName: 'vanilla', tokenSlotSnippet: '', tokens: { name: 'mock', version: '1.0.0', components: {}, spacing: {}, radius: {}, typography: {}, colorRoles: {} } },
            iconAllowlist: [],
            designContextPrompt: null
        };

        const prompt = composeSystemPrompt(deps, {});
        
        expect(prompt).toContain('### STRUCTURAL ANATOMY BLUEPRINT');
        // Ensure 'fills' and 'cornerRadius' are NOT in the baseProps (they were in anatomyRegistry.ts)
        const anatomySection = prompt.split('### STRUCTURAL ANATOMY BLUEPRINT')[1].split('###')[0];
        expect(anatomySection).not.toContain('"fills"');
        expect(anatomySection).not.toContain('"cornerRadius"');
        // But ensure structure content is preserved
        expect(anatomySection).toContain('"layoutMode"');
        expect(anatomySection).toContain('"children"');
    });
});
