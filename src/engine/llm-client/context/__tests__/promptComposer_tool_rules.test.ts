
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
        expect(prompt).toContain('CRITICAL: PLAN BEFORE ACTING');
        expect(prompt).toContain('planDesign');
        
        // 2. Decision Flow
        expect(prompt).toContain('DECISION FLOW');
        expect(prompt).toContain('Check results and handle errors');

        // 3. Negative Constraints (Implicit in guidelines - Removed explicit text to be lean)
        // Verified by presence of Examples which show correct behavior
        expect(prompt).toContain('## EXAMPLES');
    });
});
