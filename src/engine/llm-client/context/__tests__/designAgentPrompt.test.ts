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
        
        expect(prompt).toContain('You are a Figma plugin agent. You operate within the Figma sandbox');
    });

    it('should use standardized headers', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider as any);
        
        expect(prompt).toContain('You are a Figma plugin agent. You operate within the Figma sandbox');
        expect(prompt).toContain('## AVAILABLE TOOLS');
        expect(prompt).toContain('## EXAMPLES');
    });
});
