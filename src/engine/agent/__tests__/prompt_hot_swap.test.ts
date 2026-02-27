import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';

import * as PromptComposer from '../../llm-client/context/promptComposer';

describe('AgentRuntime Dynamic Prompt Hot-Swapping', () => {
    let mockProvider: LLMProvider;

    beforeEach(() => {
        vi.clearAllMocks();

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

    it('should build system prompt with EXECUTION mode', async () => {
        const runtime = new AgentRuntime({
            provider: mockProvider,
            tools: [{ name: 'new_task', description: 'New Task', parameters: { type: 'object', properties: {} } }]
        });

        await (runtime as any).run('dummy'); 
        const executionCall = (mockProvider.generate as any).mock.calls[0][0];
        const executionPrompt = executionCall.messages.find((m: any) => m.role === 'system')?.content || '';
        expect(executionPrompt).toContain('EXECUTION');
    });
});
