import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';
import { planState } from '../planState';
import * as PromptComposer from '../../llm-client/context/promptComposer';

describe('AgentRuntime Dynamic Prompt Hot-Swapping', () => {
    let mockProvider: LLMProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        planState.reset();

        // Bypass real PromptComposer to isolate AgentRuntime logic
        vi.spyOn(PromptComposer, 'composeAgentSystemPrompt').mockImplementation((_c, _t, _p, options) => {
            return `STUBBED PROMPT FOR MODE: ${options?.mode || 'PLANNING'}`;
        });

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

    it('should update system prompt correctly for different modes', async () => {
        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'new_task', description: 'New Task', parameters: { type: 'object', properties: {} } }],
            planId: 'test-plan' // Prevent planState.reset() indoors run()
        });

        // 1. Manually check PLANNING MODE (empty plan)
        planState.reset();
        await (runtime as any).run('dummy'); 
        const planningCall = (mockProvider.generate as any).mock.calls[0][0];
        const planningPrompt = planningCall.messages.find((m: any) => m.role === 'system')?.content || '';
        expect(planningPrompt).toContain('PLANNING');

        // 2. Manually check EXECUTION MODE (plan with active step)
        vi.clearAllMocks();
        planState.reset();
        planState.setCurrentPlan([{ title: 'Task 1', stepId: '1' }]);
        planState.startTask('Task 1', undefined, '1');

        await (runtime as any).run('dummy');
        const executionCall = (mockProvider.generate as any).mock.calls[0][0];
        const executionPrompt = executionCall.messages.find((m: any) => m.role === 'system')?.content || '';
        expect(executionPrompt).toContain('EXECUTION');
    });
});
