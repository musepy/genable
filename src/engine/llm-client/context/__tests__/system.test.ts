import { describe, it, expect } from 'vitest';
import { buildStaticSystemPrompt } from '../system';
import { ToolDefinition } from '../../../agent/tools/types';

describe('buildStaticSystemPrompt', () => {
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

    const mockProvider = {
        getToolSystemInstruction: (tools: ToolDefinition[]) => `PROVIDER_TOOLS_${tools.length}`
    };

    it('should include agent identity', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('You are a Figma plugin agent');
        expect(prompt).toContain('CORE POLICIES');
    });

    it('should include autonomous behavior rules (not legacy phase blocks)', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('AUTONOMOUS BEHAVIOR');
        // Legacy phase-specific blocks should NOT be present
        expect(prompt).not.toContain('WHEN IN PLANNING MODE');
        expect(prompt).not.toContain('WHEN IN EXECUTION MODE');
        expect(prompt).not.toContain('WHEN IN VERIFICATION MODE');
        expect(prompt).not.toContain('WHEN IN RECOVERY MODE');
    });

    it('should serialize tools correctly', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('## AVAILABLE TOOLS');
        expect(prompt).toContain('**query_knowledge**');
        expect(prompt).toContain('Search for design rules.');
        expect(prompt).toContain('**build_design**');
        expect(prompt).toContain('Create a Figma design via DSL instructions.');
    });

    it('should include tool examples', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('## EXAMPLES');
    });

    it('should include error recovery', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('ERROR RECOVERY');
    });

    it('should include provider tool instructions', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('PROVIDER_TOOLS_2');
    });

    it('should include skill bodies when provided', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, [
            '## SKILL: Design System\nUse tokens from the design system.',
            '## SKILL: Layout\nFollow responsive layout patterns.'
        ]);
        expect(prompt).toContain('SKILL: Design System');
        expect(prompt).toContain('SKILL: Layout');
    });

    it('should handle empty tool list gracefully', () => {
        const prompt = buildStaticSystemPrompt([], mockProvider, []);
        expect(prompt).toContain('No specific tools are available');
        expect(prompt).toContain('PROVIDER_TOOLS_0');
    });

    it('should include design knowledge (scene graph model)', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('SCENE GRAPH MENTAL MODEL');
    });

    it('should include workflow rules', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider, []);
        expect(prompt).toContain('TOOL CALLING PROTOCOL');
    });

    it('should use phase-based serialization when tools have categories', () => {
        const categorizedTools: ToolDefinition[] = [
            {
                name: 'read_node',
                description: 'Read a node.',
                category: 'read' as any,
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'build_design',
                description: 'Create a design.',
                category: 'create' as any,
                parameters: { type: 'object', properties: {} }
            }
        ];
        const prompt = buildStaticSystemPrompt(categorizedTools, mockProvider, []);
        expect(prompt).toContain('Phase 1: Information Gathering');
        expect(prompt).toContain('Phase 3: Execution');
    });
});
