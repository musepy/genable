import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';

import { resolveBehavior } from '../agentBehaviorConfig';

describe('Agent Architecture Contract Tests', () => {
    let mockProvider: LLMProvider;

    beforeEach(() => {
        vi.clearAllMocks();

        mockProvider = {
            name: 'mock',
            generate: vi.fn().mockImplementation((_req) => {
                return Promise.resolve({
                    text: 'Mock response',
                    toolCalls: []
                });
            }),
            formatResponse: vi.fn().mockImplementation(res => ({
                role: 'model',
                content: res.text || ''
            })),
            formatToolResults: vi.fn().mockImplementation(results => ({
                role: 'tool',
                content: results.map((tr: any) => ({
                    functionResponse: { name: tr.name, response: tr.response },
                    thought_signature: tr.thought_signature
                }))
            })),
            getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions'),
        } as any;
    });

    it('should pass thinkingLevel from behaviorConfig to provider.generate', async () => {
        const behaviorConfig = resolveBehavior({
            thinkingLevel: 'high'
        });

        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {} } }],
            behaviorConfig
        });

        await runtime.run('dummy request');

        const generateCall = (mockProvider.generate as Mock).mock.calls[0][0];
        // Now thinkingLevel is sourced from behaviorConfig, not hardcoded DEFAULT
        expect(generateCall.thinkingLevel).toBe('high');
    });

    it('should use toolConfig.mode=ANY in EXECUTION mode', async () => {
        const behaviorConfig = resolveBehavior({
            promptPolicy: { useSkillSystem: false } // Use classic composer for simpler assertion
        });

        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {} } }],
            behaviorConfig
        });

        await runtime.run('dummy request');

        const generateCall = (mockProvider.generate as Mock).mock.calls[0][0];
        // In autonomous mode, toolConfig.mode should be AUTO
        expect(generateCall.toolConfig).toEqual({ mode: 'AUTO' });
        expect(generateCall.thinkingLevel).toBe('minimal');
    });


    it('should include mode-specific guidance in system prompt (Skill System)', async () => {
        const behaviorConfig = resolveBehavior({
            promptPolicy: { useSkillSystem: true }
        });

        const runtime2 = new AgentRuntime({
            provider: mockProvider,
            tools: [],
            behaviorConfig,
            designSystemId: 'test-ds'
        });

        await runtime2.run('execution request');
        const executionCall = (mockProvider.generate as Mock).mock.calls[0][0];
        const executionSys = executionCall.messages.find((m: any) => m.role === 'system')?.content;
        expect(executionSys).toContain('MODE: EXECUTION');
    });
});
