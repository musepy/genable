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
      getCapabilities: vi.fn().mockReturnValue({
        supportsTextStreaming: true,
        supportsReasoningStreaming: true,
      }),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions')
    } as any;
  });

  it('should complete in one iteration if no tool calls', async () => {
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Final result',
      toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Done' } }]
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }],
      systemPrompt: 'System',
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('User prompt');

    expect(result).toBe('Done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
    expect(runtime.getMessages()).toHaveLength(4); // system, dynamic-ctx, user, model(call)
  });

  it('should execute tool calls and loop', async () => {
    // Round 1: Model calls a tool
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Thinking...',
        toolCalls: [{ name: 'get_info', args: { query: 'test' } }]
      })
      // Round 2: Model gives final answer and signal completion
      .mockResolvedValueOnce({
        text: 'Final answer based on info',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Task done' } }]
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;
    
    mockIpcBridge.callTool.mockResolvedValue({ success: true, data: 'Some info' });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'get_info', description: 'Get info', parameters: { type: 'object', properties: {} } },
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      systemPrompt: 'System',
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Tell me something');

    expect(result).toBe('Task done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    expect(mockIpcBridge.callTool).toHaveBeenCalledWith('get_info', { query: 'test' });

    const messages = runtime.getMessages();
    expect(messages).toHaveLength(6); // system, dynamic-ctx, user, model(thought+call), tool(result), model(complete)
    expect(messages[4].role).toBe('tool');
  });

  it('should short-circuit unified validation errors and keep actionable details in tool result history', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'try create',
        toolCalls: [{ name: 'build_design', args: {} }]
      })
      .mockResolvedValueOnce({
        text: 'done',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Recovered' } }]
      });

    const mockIpcBridge = {
      callTool: vi.fn(),
      dispose: vi.fn()
    } as any;

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'build_design', description: 'Create', parameters: { type: 'object', properties: {} } },
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Create something');

    expect(result).toBe('Recovered');
    expect(mockIpcBridge.callTool).not.toHaveBeenCalled();

    const firstToolTurn = (mockProvider.formatToolResults as any).mock.calls[0][0];
    const firstResponse = firstToolTurn[0].response;

    expect(firstResponse.success).toBe(false);
    expect(firstResponse.error.code).toBe('TOOL_VALIDATION_ERROR');
    expect(firstResponse.error.message).toContain('Validation Error: build_design');
    expect(firstResponse.error.message).toContain('operations');
    expect(firstResponse.error.details).toMatchObject({
      tool: 'build_design',
      mode: 'EXECUTION',
      missing: ['operations']
    });
  });

  it('should reject unknown legacy tool names and guide model to signal(type)', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'start task',
        toolCalls: [{ name: 'task_start', args: { title: 'Legacy call' } }]
      })
      .mockResolvedValueOnce({
        text: 'done',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Recovered' } }]
      });

    const mockIpcBridge = {
      callTool: vi.fn(),
      dispose: vi.fn()
    } as any;

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } },
        { name: 'build_design', description: 'Create', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Create something');

    expect(result).toBe('Recovered');
    expect(mockIpcBridge.callTool).not.toHaveBeenCalled();

    const firstToolTurn = (mockProvider.formatToolResults as any).mock.calls[0][0];
    const firstResponse = firstToolTurn[0].response;
    expect(firstResponse.success).toBe(false);
    expect(firstResponse.error.code).toBe('TOOL_VALIDATION_ERROR');
    expect(firstResponse.error.message).toContain('task_start is not an available tool');
    expect(firstResponse.error.message).toContain('signal with type "task_start"');
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

    await expect(runtime.run('Loop me')).rejects.toThrow('Maximum iterations (2) reached.');
  });

  it('should emit reasoning_delta runtime events when provider streams thoughts', async () => {
    const events: any[] = [];

    (mockProvider.generate as any).mockImplementation(({ onProgress: cbP, onThinking: cbT }: any) => {
      cbP?.('Part 1');
      cbT?.('Thinking...');
      return Promise.resolve({ text: 'Final', toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Done' } }] });
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }],
      onRuntimeEvent: (event) => events.push(event)
    });

    await runtime.run('Test');

    expect(events.some(event => event.type === 'reasoning_delta' && event.text === 'Thinking...')).toBe(true);
  });

  it('should detect generic tool call loops (safety guardrail)', async () => {
    // Same tool with same args called repeatedly → loop detector should fire
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Doing same thing...',
      toolCalls: [{ name: 'inspectDesign', args: { mode: 'hierarchy', nodeId: '1:1' } }]
    });

    const mockIpcBridge = {
      callTool: vi.fn().mockResolvedValue({ success: true, data: {} }),
      dispose: vi.fn()
    } as any;

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'inspectDesign', description: 'Inspect', parameters: { type: 'object', properties: {} } },
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      maxIterations: 15
    });

    await expect(runtime.run('Loop me')).rejects.toThrow();
  });

  it('should accept signal complete immediately in autonomous mode', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'I am done',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Finished immediately' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ]
    });

    const result = await runtime.run('Quick task');
    expect(result).toBe('Finished immediately');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
  });

  it('should accept signal complete even after mutation without forced inspect (autonomous)', async () => {
    // In autonomous mode, Runtime does not force inspect after mutation
    const toolExecutors = {
      patchNode: vi.fn().mockResolvedValue({ success: true, data: { nodeId: '1:1', modified: true } }),
    };

    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Mutate design',
        toolCalls: [{ name: 'patchNode', args: { nodeId: '1:1', props: { width: 100 } } }]
      })
      .mockResolvedValueOnce({
        text: 'Done without inspect',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Mutated and done' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ],
      toolExecutors: toolExecutors as any
    });

    const result = await runtime.run('Mutation without inspect');
    expect(result).toBe('Mutated and done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
  });

  it('should allow LLM to self-inspect before completing (autonomous choice)', async () => {
    // LLM autonomously decides to inspect, then complete — not forced by Runtime
    const toolExecutors = {
      patchNode: vi.fn().mockResolvedValue({ success: true, data: { nodeId: '1:1', modified: true } }),
      inspectDesign: vi.fn().mockResolvedValue({ success: true, data: { id: '1:1', type: 'FRAME' } }),
    };

    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Mutate',
        toolCalls: [{ name: 'patchNode', args: { nodeId: '1:1', props: { width: 100 } } }]
      })
      .mockResolvedValueOnce({
        text: 'Let me verify',
        toolCalls: [{ name: 'inspectDesign', args: { mode: 'hierarchy', nodeId: '1:1' } }]
      })
      .mockResolvedValueOnce({
        text: 'Looks good',
        toolCalls: [{ name: 'signal', args: { type: 'complete', summary: 'Verified and done' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
        { name: 'inspectDesign', description: 'Inspect', parameters: { type: 'object', properties: {} } },
        { name: 'signal', description: 'Signal', parameters: { type: 'object', properties: {} } }
      ],
      toolExecutors: toolExecutors as any
    });

    const result = await runtime.run('Autonomous inspect');
    expect(result).toBe('Verified and done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
    expect(toolExecutors.inspectDesign).toHaveBeenCalled();
  });
});
