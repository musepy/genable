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
      toolCalls: [{ name: 'complete_task', args: { summary: 'Done' } }]
    });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [{ name: 'complete_task', description: 'Complete', parameters: { type: 'object', properties: {} } }],
      systemPrompt: 'System',
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('User prompt');

    expect(result).toBe('Done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
    expect(runtime.getMessages()).toHaveLength(3); // system, user, model(call)
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
        toolCalls: [{ name: 'complete_task', args: { summary: 'Task done' } }]
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
        { name: 'complete_task', description: 'Complete', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      loopPolicy: { useSkillSystem: false } as any
    });

    const result = await runtime.run('Tell me something');

    expect(result).toBe('Task done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    expect(mockIpcBridge.callTool).toHaveBeenCalledWith('get_info', { query: 'test' });
    
    const messages = runtime.getMessages();
    expect(messages).toHaveLength(5); // system, user, model(thought+call), tool(result), model(complete)
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

    await expect(runtime.run('Loop me')).rejects.toThrow('Maximum iterations (2) reached.');
  });

  it('should propagate streaming callbacks to provider', async () => {
    const onProgress = vi.fn();
    const onThinking = vi.fn();
    
    (mockProvider.generate as any).mockImplementation(({ onProgress: cbP, onThinking: cbT }: any) => {
      cbP?.('Part 1');
      cbT?.('Thinking...');
      return Promise.resolve({ text: 'Final', toolCalls: [{ name: 'complete_task', args: { summary: 'Done' } }] });
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
        { name: 'complete_task', description: 'Complete', parameters: { type: 'object', properties: {} } }
      ],
      ipcBridge: mockIpcBridge,
      maxIterations: 15
    });

    await expect(runtime.run('Loop me')).rejects.toThrow();
  });

  it('should accept complete_task immediately in autonomous mode (no plan guard)', async () => {
    // In autonomous mode, complete_task is NEVER blocked — LLM decides when it's done
    (mockProvider.generate as any)
      .mockResolvedValueOnce({
        text: 'I am done',
        toolCalls: [{ name: 'complete_task', args: { summary: 'Finished immediately' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'complete_task', description: 'Complete task', parameters: { type: 'object', properties: {} } }
      ]
    });

    const result = await runtime.run('Quick task');
    expect(result).toBe('Finished immediately');
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);
  });

  it('should accept complete_task even after mutation without forced inspect (autonomous)', async () => {
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
        toolCalls: [{ name: 'complete_task', args: { summary: 'Mutated and done' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
        { name: 'complete_task', description: 'Complete', parameters: { type: 'object', properties: {} } }
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
        toolCalls: [{ name: 'complete_task', args: { summary: 'Verified and done' } }]
      });

    const runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'patchNode', description: 'Patch', parameters: { type: 'object', properties: {} } },
        { name: 'inspectDesign', description: 'Inspect', parameters: { type: 'object', properties: {} } },
        { name: 'complete_task', description: 'Complete', parameters: { type: 'object', properties: {} } }
      ],
      toolExecutors: toolExecutors as any
    });

    const result = await runtime.run('Autonomous inspect');
    expect(result).toBe('Verified and done');
    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
    expect(toolExecutors.inspectDesign).toHaveBeenCalled();
  });
});

