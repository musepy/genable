import { describe, it, expect } from 'vitest';
import { composeAgentSystemPrompt } from '../promptComposer';
import { PromptDependencies } from '../../../../types/context';
import { ToolDefinition } from '../../../agent/tools/types';

describe('Design Agent Prompt Optimization (TDD)', () => {
    const mockTools: ToolDefinition[] = [
        {
            name: 'createNode',
            description: 'Create a node.',
            parameters: { type: 'object', properties: {} }
        }
    ];

    const mockDeps: PromptDependencies = {
        ragResults: { prioritizedComponents: [], goldenTemplates: [] },
        designSystemContext: { skillName: 'VANILLA' },
        globalContext: { isModifyMode: false }
    };

    const mockProvider = {
        getToolSystemInstruction: (tools: ToolDefinition[]) => 'Mock Tool Rules'
    };

    it('should include the core Figma design agent persona', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider as any);
        
        // Use new persona definition
        expect(prompt).toContain('You are a Figma design agent');
        expect(prompt).toContain('accomplish tasks by calling tools');
    });

    it('should use standardized headers', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider as any);
        
        // Assert new headers
        expect(prompt).toContain('## MODE: PLANNING');
        expect(prompt).toContain('CORE POLICIES');
        expect(prompt).toContain('## AVAILABLE TOOLS');
        expect(prompt).toContain('## EXAMPLES');
    });
});
