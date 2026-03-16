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
        toolCalls: [{ name: 'get_info', args: { query: 'test' } }]
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

    mockIpcBridge.callTool.mockResolvedValue({ success: true, data: 'Some info' });

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
    expect(mockIpcBridge.callTool).toHaveBeenCalledWith('get_info', { query: 'test' });

    const messages = runtime.getMessages();
    expect(messages).toHaveLength(4); // user, model(thought+call), tool(result), model(text)
    expect(messages[2].role).toBe('tool');
  });

  it('should reject unknown tool names with UNKNOWN_COMMAND error', async () => {
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'start task',
        toolCalls: [{ name: 'task_start', args: { title: 'Legacy call' } }]
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
        { name: 'run', description: 'Run', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
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
    expect(firstResponse.error.code).toBe('UNKNOWN_COMMAND');
    expect(firstResponse.error.message).toContain('Unknown command');
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
      ],
      ipcBridge: mockIpcBridge,
      maxIterations: 15
    });

    await expect(runtime.run('Loop me')).rejects.toThrow();
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
      patchNode: vi.fn().mockResolvedValue({ success: true, data: { nodeId: '1:1', modified: true } }),
    };

    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'Mutate design',
        toolCalls: [{ name: 'patchNode', args: { nodeId: '1:1', props: { width: 100 } } }]
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
