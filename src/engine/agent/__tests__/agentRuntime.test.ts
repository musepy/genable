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
          type: 'tool_call',
          id: tc.id || 'call_' + Math.random().toString(36).slice(2, 7),
          name: tc.name,
          input: tc.input,
          thoughtSignature: tc.thoughtSignature
        })) : res.text
      })),
      formatToolResults: vi.fn().mockImplementation(results => ({
        role: 'tool',
        content: results.map((tr: any) => ({
          type: 'tool_result',
          id: tr.id || '',
          name: tr.name,
          data: tr.response,
          thoughtSignature: tr.thoughtSignature
        }))
      })),
      getCapabilities: vi.fn().mockReturnValue({
        supportsTextStreaming: true,
        supportsReasoningStreaming: true,
      }),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions')
    } as any;
  });

  it('should complete in one iteration if no tool calls (implicit completion)', async () => {
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Done — task completed.',
      toolCalls: []
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [],
      systemPrompt: 'System',
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('User prompt');

    expect(result).toBe('Done — task completed.');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
  });

  it('should execute tool calls and loop until text-only response', async () => {
    // Round 1: Model calls a tool
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Thinking...',
        toolCalls: [{ type: 'tool_call', id: 'tc_1', name: 'get_info', input: { query: 'test' } }]
      })
      // Round 2: Model gives final answer (no tool calls = implicit completion)
      .mockResolvedValueOnce({
        text: 'Task done',
        toolCalls: []
      });

    // Mock IPC Bridge
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;

    mockIpcBridge.callTool.mockResolvedValue({ data: 'Some info' });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'get_info', description: 'Get info', parameters: { type: 'object', properties: {} } },
      ],
      ipcBridge: mockIpcBridge,
      systemPrompt: 'System',
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Tell me something');

    expect(result).toBe('Task done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    // The third arg is the runtime context (RYOW snapshot) threaded
    // sandbox→main. Older callers ignore it; we assert on the first two
    // positional args only.
    expect(mockIpcBridge.callTool).toHaveBeenCalledWith(
      'get_info',
      { query: 'test' },
      expect.objectContaining({ ryowCreatedThisTurnIds: expect.any(Array) }),
    );

    const messages = runtime.getMessages();
    expect(messages).toHaveLength(4); // user, model(thought+call), tool(result), model(text)
    expect(messages[2].role).toBe('tool');
  });

  it('should reject unknown tool names with UNKNOWN_TOOL error', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'start task',
        toolCalls: [{ type: 'tool_call', id: 'tc_2', name: 'task_start', input: { title: 'Legacy call' } }]
      })
      .mockResolvedValueOnce({
        text: 'Recovered',
        toolCalls: []
      });

    const mockIpcBridge = {
      callTool: vi.fn(),
      dispose: vi.fn()
    } as any;

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'jsx', description: 'Create', parameters: { type: 'object', properties: { markup: { type: 'string' } }, required: ['markup'] } },
      ],
      ipcBridge: mockIpcBridge,
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Create something');

    expect(result).toBe('Recovered');
    // task_start should be rejected locally — NOT forwarded to IPC
    expect(mockIpcBridge.callTool).not.toHaveBeenCalledWith('task_start', expect.anything());

    const firstToolTurn = (mockProvider.formatToolResults as any).mock.calls[0][0];
    const firstResponse = firstToolTurn[0].response;
    // presentForLLM flattens errors — check for the error string in the response
    const responseStr = JSON.stringify(firstResponse);
    expect(responseStr).toContain('Unknown tool');
  });

  it('should return graceful message when max iterations reached', async () => {
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Thinking...',
      toolCalls: [{ type: 'tool_call', id: 'tc_3', name: 'loop', input: {} }]
    });

    const events: any[] = [];
    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'loop', description: 'Loop', parameters: { type: 'object', properties: {} } }],
      maxIterations: 2,
      onRuntimeEvent: (event) => events.push(event),
    });

    const result = await runtime.run('Loop me');
    expect(result).toContain('used all 2 iterations');
    expect(events.some(e => e.type === 'budget_exhausted')).toBe(true);
  });

  it('should emit reasoning_delta runtime events when provider streams thoughts', async () => {
    const events: any[] = [];

    (mockProvider.generate as any).mockImplementation(({ onProgress: cbP, onThinking: cbT }: any) => {
      cbP?.('Part 1');
      cbT?.('Thinking...');
      return Promise.resolve({ text: 'Done', toolCalls: [] });
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [],
      onRuntimeEvent: (event) => events.push(event)
    });

    await runtime.run('Test');

    expect(events.some(event => event.type === 'reasoning_delta' && event.text === 'Thinking...')).toBe(true);
  });

  it('should detect generic tool call loops (safety guardrail)', async () => {
    // Same tool with same args called repeatedly → loop detector should fire
    // With elastic iterations, the agent returns gracefully instead of throwing
    (mockProvider.generate as any).mockResolvedValue({
      text: 'Doing same thing...',
      toolCalls: [{ type: 'tool_call', id: 'tc_4', name: 'inspectDesign', input: { mode: 'hierarchy', nodeId: '1:1' } }]
    });

    const mockIpcBridge = {
      callTool: vi.fn().mockResolvedValue({ data: {} }),
      dispose: vi.fn()
    } as any;

    const events: any[] = [];
    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'inspectDesign', description: 'Inspect', parameters: { type: 'object', properties: {} } },
      ],
      ipcBridge: mockIpcBridge,
      maxIterations: 15,
      onRuntimeEvent: (event) => events.push(event),
    });

    const result = await runtime.run('Loop me');
    expect(result).toContain('used all 15 iterations');
    expect(events.some(e => e.type === 'budget_exhausted')).toBe(true);
  });

  it('should complete immediately with text-only response (implicit completion)', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Finished immediately',
        toolCalls: []
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: []
    });

    const result = await runtime.run('Quick task');
    expect(result).toBe('Finished immediately');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
  });

  it('should complete after mutation with text-only response (implicit completion)', async () => {
    const toolExecutors = {
      patchNode: vi.fn().mockResolvedValue({ data: { nodeId: '1:1', modified: true } }),
    };

    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Mutate design',
        toolCalls: [{ type: 'tool_call', id: 'tc_5', name: 'patchNode', input: { nodeId: '1:1', props: { width: 100 } } }]
      })
      .mockResolvedValueOnce({
        text: 'Mutated and done',
        toolCalls: []
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
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
      patchNode: vi.fn().mockResolvedValue({ data: { nodeId: '1:1', modified: true } }),
      inspectDesign: vi.fn().mockResolvedValue({ data: { id: '1:1', type: 'FRAME' } }),
    };

    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Mutate',
        toolCalls: [{ type: 'tool_call', id: 'tc_5', name: 'patchNode', input: { nodeId: '1:1', props: { width: 100 } } }]
      })
      .mockResolvedValueOnce({
        text: 'Let me verify',
        toolCalls: [{ type: 'tool_call', id: 'tc_4', name: 'inspectDesign', input: { mode: 'hierarchy', nodeId: '1:1' } }]
      })
      .mockResolvedValueOnce({
        text: 'Verified and done',
        toolCalls: []
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
        { name: 'inspectDesign', description: 'Inspect', parameters: { type: 'object', properties: {} } },
      ],
      toolExecutors: toolExecutors as any
    });

    const result = await runtime.run('Autonomous inspect');
    expect(result).toBe('Verified and done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
    expect(toolExecutors.inspectDesign).toHaveBeenCalled();
  });
});
