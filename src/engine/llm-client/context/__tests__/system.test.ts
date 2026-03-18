import { describe, it, expect } from 'vitest';
import { buildStaticSystemPrompt } from '../system';
import { ToolDefinition } from '../../../agent/tools/types';

describe('buildStaticSystemPrompt', () => {
    const mockTools: ToolDefinition[] = [
        {
            name: 'query',
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
            name: 'create',
            description: 'Create a Figma design via XML markup.',
            parameters: {
                type: 'object',
                properties: {
                    xml: { type: 'string', description: 'XML markup.' }
                },
                required: ['xml']
            }
        }
    ];

    const mockProvider = {
        getToolSystemInstruction: (tools: ToolDefinition[]) => `PROVIDER_TOOLS_${tools.length}`
    };

    it('should include agent identity', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('You are a Figma plugin agent');
        expect(prompt).toContain('DESIGN FREEDOM PRINCIPLE');
    });

    it('should not include legacy phase blocks', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).not.toContain('WHEN IN PLANNING MODE');
        expect(prompt).not.toContain('WHEN IN EXECUTION MODE');
        expect(prompt).not.toContain('WHEN IN VERIFICATION MODE');
        expect(prompt).not.toContain('WHEN IN RECOVERY MODE');
    });

    it('should serialize tools correctly', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('## AVAILABLE TOOLS');
        expect(prompt).toContain('**query**');
        expect(prompt).toContain('Search for design rules.');
        expect(prompt).toContain('**create**');
        expect(prompt).toContain('Create a Figma design via XML markup.');
    });

    it('should include creation protocol (merged from WORKFLOW)', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('CREATION PROTOCOL');
    });

    it('should include turn management (merged from WORKFLOW)', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('TURN MANAGEMENT');
    });

    it('should include provider tool instructions', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('PROVIDER_TOOLS_2');
    });

    it('should handle empty tool list gracefully', () => {
        const prompt = buildStaticSystemPrompt([], mockProvider);
        expect(prompt).toContain('No specific tools are available');
        expect(prompt).toContain('PROVIDER_TOOLS_0');
    });

    it('should include design knowledge (scene graph model)', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('SCENE GRAPH MENTAL MODEL');
    });

    it('should include execution environment rules', () => {
        const prompt = buildStaticSystemPrompt(mockTools, mockProvider);
        expect(prompt).toContain('EXECUTION ENVIRONMENT');
    });

    it('should use phase-based serialization when tools have categories', () => {
        const categorizedTools: ToolDefinition[] = [
            {
                name: 'context',
                description: 'Get canvas overview.',
                category: 'read' as any,
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'create',
                description: 'Create a design.',
                category: 'create' as any,
                parameters: { type: 'object', properties: {} }
            }
        ];
        const prompt = buildStaticSystemPrompt(categorizedTools, mockProvider);
        expect(prompt).toContain('Information Gathering');
        expect(prompt).toContain('Execution');
    });
});
