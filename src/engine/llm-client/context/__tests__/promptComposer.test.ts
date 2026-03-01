import { describe, it, expect } from 'vitest';
import { composeAgentSystemPrompt, composeAgentDynamicContext } from '../promptComposer';
import { PromptDependencies } from '../../../../types/context';
import { ToolDefinition } from '../../../agent/tools/types';
import { PROMPT_HEADERS } from '../../../../constants/prompts';

describe('PromptComposer - Agent Mode', () => {

    const mockTools: ToolDefinition[] = [
        {
            name: 'query_knowledge',
            description: 'Search for design rules.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search term.' }
                },
                required: ['query']
            }
        },
        {
            name: 'build_design',
            description: 'Create a Figma design via DSL instructions.',
            parameters: {
                type: 'object',
                properties: {
                    instructions: { type: 'string', description: 'DSL instructions.' }
                },
                required: ['instructions']
            }
        }
    ];

    const mockDeps: PromptDependencies = {
        ragResults: { prioritizedComponents: [], goldenTemplates: [] },
        designSystemContext: { skillName: 'VANILLA' },
        globalContext: { isModifyMode: false }
    };

    const mockProvider = {
        getToolSystemInstruction: (tools: ToolDefinition[]) => `PROVIDER_TOOLS_${tools.length}`
    };

    it('should include agent core prompt including schema rules', () => {
        // Use EXECUTION mode so execution-protocol (schema rules, naming) gets injected
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider, { mode: 'EXECUTION' });
        expect(prompt).toContain('You are a Figma plugin agent');
        expect(prompt).toContain('CORE POLICIES');
    });

    it('should serialize tools correctly', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider);

        expect(prompt).toContain('## AVAILABLE TOOLS');
        expect(prompt).toContain('**query_knowledge**');
        expect(prompt).toContain('Search for design rules.');
        expect(prompt).toContain('**build_design**');
        expect(prompt).toContain('Create a Figma design via DSL instructions.');
        expect(prompt).toContain('PROVIDER_TOOLS_2');
    });

    it('should include tool examples', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider);
        expect(prompt).toContain('## EXAMPLES');
        expect(prompt).toContain('One-shot `build_design`');
    });

    it('should inject knowledge if intent requires it', () => {
        const depsWithIntent: PromptDependencies = {
            ...mockDeps,
            intent: { requiresLayoutKnowledge: true }
        };
        const prompt = composeAgentSystemPrompt(depsWithIntent, mockTools, mockProvider);
        expect(prompt).toContain('## LAYOUT RULES');
        expect(prompt).toContain('Auto Layout');
    });

    it('should NOT inject knowledge if intent does not require it', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider);
        expect(prompt).not.toContain('## LAYOUT RULES');
    });

    it('should include rich selection context if nodes are provided', () => {
        const depsWithSelection: PromptDependencies = {
            ...mockDeps,
            selectionContext: {
                hasSelection: true,
                nodes: [{
                    id: '1:1', type: 'FRAME', name: 'Header', visible: true, opacity: 1
                } as any],
                serializedDSL: '[]'
            }
        };
        const prompt = composeAgentDynamicContext(depsWithSelection);
        expect(prompt).toContain('## SELECTION CONTEXT');
        expect(prompt).toContain('"type": "FRAME"');
        expect(prompt).toContain('"name": "Header"');
        // Defaults like visible/opacity should be pruned and NOT present in the JSON
        expect(prompt).not.toContain('"visible": true');
        expect(prompt).not.toContain('"opacity": 1');
    });

    it('should skip invalid nodes in selection context', () => {
        const depsWithInvalidSelection: PromptDependencies = {
            ...mockDeps,
            selectionContext: {
                hasSelection: true,
                nodes: [
                    { id: '1:1', type: 'FRAME', name: 'Valid' } as any,
                    null as any,
                    { id: '2:1' } as any // Missing type
                ],
                serializedDSL: '[]'
            }
        };
        const prompt = composeAgentDynamicContext(depsWithInvalidSelection);
        // It should not crash, and should only serialize the valid node
        expect(prompt).toContain('"name": "Valid"');
    });

    it('should handle empty tool list gracefully', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, [], mockProvider);
        expect(prompt).toContain('No specific tools are available');
        expect(prompt).toContain('PROVIDER_TOOLS_0');
    });
});
