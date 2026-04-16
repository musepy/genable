import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntime } from '../../engine/agent/agentRuntime';
import { LLMProvider } from '../../engine/llm-client/providers/types';

// Mock figma
vi.stubGlobal('figma', {
  getNodeByIdAsync: vi.fn()
});

// Mock getToolsForMode to bypass filtering in tests
vi.mock('../../engine/agent/tools', async () => {
  const actual = await vi.importActual('../../engine/agent/tools') as any;
  return {
    ...actual,
    getToolsForMode: vi.fn().mockImplementation((mode, allTools) => allTools)
  };
});

describe('AgentRuntime Loop Detection', () => {
  let mockProvider: any;
  let runtime: AgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      generate: vi.fn(),
      formatToolResults: vi.fn().mockImplementation((results) => ({ role: 'tool', content: results })),
      getToolSystemInstruction: vi.fn().mockReturnValue('Mock Tool Instructions'),
      formatToolCalls: vi.fn().mockImplementation((calls) => ({ role: 'model', content: Array.isArray(calls) ? calls.map((c: any) => ({ type: 'tool_call', id: c.id || '', name: c.name, input: c.input })) : [{ type: 'tool_call', id: calls.id || '', name: calls.name, input: calls.input }] })),
      formatResponse: vi.fn().mockImplementation((res) => ({ role: 'model', content: res.text || '', toolCalls: res.toolCalls }))
    };
    
    runtime = new AgentRuntime({
      provider: mockProvider as any,
      tools: [
        {
          name: 'createNode',
          description: 'desc',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              parentId: { type: 'string' }
            }
          }
        } as any,
      ],
      toolExecutors: {
        'createNode': vi.fn().mockResolvedValue({ success: true, data: { nodeId: 'new-node-id' } }),
      },
      maxIterations: 10
    });
  });

  it('should distinguish createNode calls with different names (Fix for Table Cells)', async () => {
    // We want to simulate a sequence where the agent creates "Header Cell 1", "Header Cell 2", "Header Cell 3"
    // Previously, 12-char truncation would make them all "Header Cell "
    
    const toolCalls = [
        { type: 'tool_call' as const, id: '1', name: 'createNode', input: { name: 'Header Cell 1', parentId: 'parent-123' } },
        { type: 'tool_call' as const, id: '2', name: 'createNode', input: { name: 'Header Cell 2', parentId: 'parent-123' } },
        { type: 'tool_call' as const, id: '3', name: 'createNode', input: { name: 'Header Cell 3', parentId: 'parent-123' } }
    ];

    // Mock the provider to return these calls in sequence
    mockProvider.generate
      .mockResolvedValueOnce({ 
        text: 'Thinking 1', 
        toolCalls: [toolCalls[0]]
      })
      .mockResolvedValueOnce({ 
        text: 'Thinking 2', 
        toolCalls: [toolCalls[1]]
      })
      .mockResolvedValueOnce({ 
        text: 'Thinking 3', 
        toolCalls: [toolCalls[2]]
      })
      .mockResolvedValue({
        text: 'Done',
        toolCalls: []
      });

    // Run the agent. 
    // If loop detection is BROKEN, it will throw Error: [LOOP DETECTED]
    // If FIXED, it will complete.
    try {
        await runtime.run('Create table headers');
    } catch (e: any) {
        expect(e.message).not.toContain('LOOP DETECTED');
        throw e;
    }
  });

  it('should NOT distinguish truly identical calls (Loop Detection should still work)', async () => {
    const identicalCall = { type: 'tool_call' as const, id: '1', name: 'createNode', input: { name: 'Identical Name', parentId: 'parent-123' } };

    mockProvider.generate.mockResolvedValue({
      text: 'Stuck...',
      toolCalls: [identicalCall]
    });

    // With elastic iterations, the agent exhausts its budget gracefully instead of throwing.
    // Loop detection is non-fatal (hint injection only), so the agent runs until maxIterations.
    const result = await runtime.run('Do something identical');
    expect(result).toContain('used all');
  });
});
