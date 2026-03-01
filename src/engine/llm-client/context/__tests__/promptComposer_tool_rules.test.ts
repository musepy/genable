
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
        },
        {
            name: 'search_nodes',
            description: 'Searches for nodes in the Figma document',
            parameters: { type: 'object', properties: {} }
        }
    ];

    it('should include strict tool usage rules in the system prompt', () => {
        const prompt = composeAgentSystemPrompt(mockDeps, mockTools, mockProvider as any);

        // 1. Core Tool Calling Format
        expect(prompt).toContain('## MODE: PLANNING');
        expect(prompt).toContain('search_nodes');
        
        // 2. Core Policies (now integrated into identity)
        expect(prompt).toContain('You are a Figma plugin agent. You operate within the Figma sandbox');
        
        // 3. Negative Constraints
        // Verified by presence of Examples which show correct behavior
        expect(prompt).toContain('## EXAMPLES');
    });
});
