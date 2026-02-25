import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider, LLMResponse } from '../../llm-client/providers/types';


describe('AgentRuntime', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      name: 'mock',
      generate: vi.fn(),
      formatResponse: vi.fn().mockImplementation(res => ({
        role: 'model',
        content: res.toolCalls?.length ? res.toolCalls.map((tc: any) => ({
          functionCall: { name: tc.name, args: tc.args },
          thought_signature: tc.thought_signature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.response },
          thought_signature: tr.thought_signature
        }))
      })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions')
    } as any;
  });

  it('should complete in one iteration if no tool calls', async () => {
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Final result',
      toolCalls: []
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'System'
    });

    const result = await runtime.run('User prompt');

    expect(result).toBe('Final result');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
    expect(runtime.getMessages()).toHaveLength(3); // system, user, model
  });

  it('should execute tool calls and loop', async () => {
    // Round 1: Model calls a tool
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Thinking...',
        toolCalls: [{ name: 'get_info', args: { query: 'test' } }]
      })
      // Round 2: Model gives final answer
      .mockResolvedValueOnce({
        text: 'Final answer based on info',
        toolCalls: []
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;
    
    mockIpcBridge.callTool.mockResolvedValue({ success: true, data: 'Some info' });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'get_info', description: 'Get info', parameters: { type: 'object', properties: {} } }],
      ipcBridge: mockIpcBridge
    });

    const result = await runtime.run('Tell me something');

    expect(result).toBe('Final answer based on info');
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    expect(mockIpcBridge.callTool).toHaveBeenCalledWith('get_info', { query: 'test' });
    
    const messages = runtime.getMessages();
    expect(messages).toHaveLength(5); // system, user, model(thought+call), tool(result), model(final)
    expect(messages[3].role).toBe('tool');
  });

  it('should throw error if max iterations reached', async () => {
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Thinking...',
      toolCalls: [{ name: 'loop', args: {} }]
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'loop', description: 'Loop', parameters: { type: 'object', properties: {} } }],
      maxIterations: 2
    });

    await expect(runtime.run('Loop me')).rejects.toThrow('Agent reached maximum iterations (2)');
  });

  it('should propagate streaming callbacks to provider', async () => {
    const onProgress = vi.fn();
    const onThinking = vi.fn();
    
    (mockProvider.generate as any).mockImplementation(({ onProgress: cbP, onThinking: cbT }: any) => {
      cbP?.('Part 1');
      cbT?.('Thinking...');
      return Promise.resolve({ text: 'Final', toolCalls: [] });
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [],
      onProgress,
      onThinking
    });

    await runtime.run('Test');

    expect(onProgress).toHaveBeenCalledWith('Part 1');
    expect(onThinking).toHaveBeenCalledWith('Thinking...');
  });

  it('should throw error if stuck in planning loop (3+ planDesign calls)', async () => {
    let callCount = 0;
    (mockProvider.generate as any).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        text: 'Planning...',
        toolCalls: [{ name: 'planDesign', args: { analysis: `test ${callCount}`, steps: [] } }]
      });
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'planDesign', description: 'Plan', parameters: { type: 'object', properties: {} } }],
      maxIterations: 10
    });

    await expect(runtime.run('Loop me')).rejects.toThrow('Agent stuck in planning loop');
  });

  it('should auto-activate next step and allow complete_step when over-achieving', async () => {
    // Round 1: Plan design with 2 steps
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Planning...',
        toolCalls: [{
          name: 'planDesign',
          args: {
            analysis: 'Test',
            steps: [
              { title: 'Step 1', description: 'desc 1', nodes: [] },
              { title: 'Step 2', description: 'desc 2', nodes: [] }
            ]
          }
        }]
      })
      // Round 2: Complete step 1
      .mockResolvedValueOnce({
        text: 'Completed step 1',
        toolCalls: [{ name: 'summarize_progress', args: { summary: 'Done with 1', isComplete: true } }]
      })
      // Round 3: Notice Step 2 is active but work is done, use complete_step
      .mockResolvedValueOnce({
        text: 'Step 2 was already done',
        toolCalls: [{ name: 'complete_step', args: { summary: 'Already done', reason: 'already_done' } }]
      })
      // Round 4: complete_task — gets NO_VERIFICATION rejection (no inspectDesign was called)
      .mockResolvedValueOnce({
        text: 'All done',
        toolCalls: [{ name: 'complete_task', args: { summary: 'All finished' } }]
      })
      // Round 5: Retry complete_task — passes via noVerificationRejectionCount safety valve
      .mockResolvedValueOnce({
        text: 'Really done',
        toolCalls: [{ name: 'complete_task', args: { summary: 'All finished' } }]
      })
      .mockResolvedValue({
        text: 'Fallback',
        toolCalls: []
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'planDesign', description: 'Plan', parameters: { type: 'object', properties: {} } },
        { name: 'summarize_progress', description: 'Progress', parameters: { type: 'object', properties: {} } },
        { name: 'complete_step', description: 'Complete step', parameters: { type: 'object', properties: {} } },
        { name: 'complete_task', description: 'Complete task', parameters: { type: 'object', properties: {} } }
      ]
    });

    const result = await runtime.run('Overachieve test');
    expect(result).toBe('All finished');
    
    // Check that we got the injection message for step_advance
    const messages = runtime.getMessages();
    const userMessages = messages.filter(m => m.role === 'user');
    expect(userMessages.some(m => typeof m.content === 'string' && m.content.includes('call complete_step'))).toBe(true);
  });

  it('should auto-complete remaining steps if complete_task is rejected twice (safety valve)', async () => {
    // Round 1: Plan design with 2 steps
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Planning...',
        toolCalls: [{
          name: 'planDesign',
          args: {
            analysis: 'Test',
            steps: [
              { title: 'Step 1', description: 'desc 1', nodes: [] },
              { title: 'Step 2', description: 'desc 2', nodes: [] }
            ]
          }
        }]
      })
      // Round 2: Try to call complete_task immediately (1st rejection)
      .mockResolvedValueOnce({
        text: 'I am done already',
        toolCalls: [{ name: 'complete_task', args: { summary: 'Premature finish' } }]
      })
      // Round 3: Try to call complete_task again (2nd rejection -> safety valve triggers -> success)
      .mockResolvedValueOnce({
        text: 'I said I am done',
        toolCalls: [{ name: 'complete_task', args: { summary: 'Really finished' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'planDesign', description: 'Plan', parameters: { type: 'object', properties: {} } },
        { name: 'complete_task', description: 'Complete task', parameters: { type: 'object', properties: {} } }
      ]
    });

    (runtime as any).hasPerformedVerificationInspect = true;

    const result = await runtime.run('Safety valve test');
    expect(result).toBe('Really finished');
    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
  });
});
