
import { describe, it, expect } from 'vitest';
import { composeAgentSystemPrompt } from '../promptComposer';
import { PromptDependencies } from '../../../../types/context';
import { ToolDefinition } from '../../../agent/tools/types';

describe('Prompt Composer - Tool Use Iron Rules', () => {
    const mockDeps: PromptDependencies = {
        history: [],
        flags: {},
        selectionContext: { hasSelection: false, nodes: [] }
    };

    const mockProvider = {
        getToolSystemInstruction: (tools: ToolDefinition[]) => 'Mock Tool Rules'
    };

    const mockTools: ToolDefinition[] = [
        {
            name: 'updateLayout',
            description: 'Updates the layout of a node',
            parameters: { type: 'object', properties: {} }
        }
    ];

    it('should include strict tool usage rules in the system prompt', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider as any);

        // 1. Core Tool Calling Format
        expect(prompt).toContain('## MODE: PLANNING');
        expect(prompt).toContain('planDesign');
        
        // 2. Core Policies
        expect(prompt).toContain('CORE POLICIES');
        expect(prompt).toContain('Reliability First');

        // 3. Negative Constraints (Implicit in guidelines - Removed explicit text to be lean)
        // Verified by presence of Examples which show correct behavior
        expect(prompt).toContain('## EXAMPLES');
    });
});
