import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';
import { planState } from '../planState';
import { resolveBehavior } from '../agentBehaviorConfig';

describe('Agent Architecture Contract Tests', () => {
    let mockProvider: LLMProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        planState.reset();

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

        // Key: pass planId so run() doesn't call planState.reset()
        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {} } }],
            behaviorConfig,
            planId: 'test-plan'
        });

        // Setup AFTER runtime creation but BEFORE run() — planId prevents reset
        planState.setCurrentPlan([{ title: 'Task 1', stepId: '1' }]);
        planState.startTask('Task 1', undefined, '1');

        await runtime.run('dummy request');

        const generateCall = (mockProvider.generate as Mock).mock.calls[0][0];
        // In EXECUTION mode, toolConfig.mode should be ANY
        expect(generateCall.toolConfig).toEqual({ mode: 'ANY' });
        expect(generateCall.thinkingLevel).toBe('minimal');
    });

    it('should downgrade high thinking to low in EXECUTION mode', async () => {
        const behaviorConfig = resolveBehavior({
            thinkingLevel: 'high',
            promptPolicy: { useSkillSystem: false }
        });

        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'test_tool', description: 'Test', parameters: { type: 'object', properties: {} } }],
            behaviorConfig,
            planId: 'test-plan'
        });

        planState.setCurrentPlan([{ title: 'Task 1', stepId: '1' }]);
        planState.startTask('Task 1', undefined, '1');

        await runtime.run('dummy request');

        const generateCall = (mockProvider.generate as Mock).mock.calls[0][0];
        // Thinking models should avoid ANY mode and use AUTO in execution
        expect(generateCall.toolConfig).toEqual({ mode: 'AUTO' });
        // High is downgraded to low in EXECUTION phase
        expect(generateCall.thinkingLevel).toBe('low');
    });

    it('should include mode-specific guidance in system prompt (Skill System)', async () => {
        const behaviorConfig = resolveBehavior({
            promptPolicy: { useSkillSystem: true }
        });

        // 1. Check PLANNING mode (no plan → defaults to PLANNING)
        const runtime1 = new AgentRuntime({
            provider: mockProvider,
            tools: [],
            behaviorConfig,
            designSystemId: 'test-ds'
        });
        await runtime1.run('planning request');
        const planningCall = (mockProvider.generate as Mock).mock.calls[0][0];
        const planningSys = planningCall.messages.find((m: any) => m.role === 'system')?.content;
        expect(planningSys).toContain('CURRENT PHASE: PLANNING');

        // 2. Check EXECUTION mode
        vi.clearAllMocks();

        // Key: pass planId so run() skips planState.reset(), preserving our setup
        const runtime2 = new AgentRuntime({
            provider: mockProvider,
            tools: [],
            behaviorConfig,
            designSystemId: 'test-ds',
            planId: 'test-plan'
        });

        planState.setCurrentPlan([{ title: 'Task 1', stepId: '1' }]);
        planState.startTask('Task 1', undefined, '1');

        await runtime2.run('execution request');
        const executionCall = (mockProvider.generate as Mock).mock.calls[0][0];
        const executionSys = executionCall.messages.find((m: any) => m.role === 'system')?.content;
        expect(executionSys).toContain('CURRENT PHASE: EXECUTION');
    });
});
