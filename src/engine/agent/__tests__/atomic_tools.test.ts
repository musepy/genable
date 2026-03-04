
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime } from '../agentRuntime';
import { LLMProvider } from '../../llm-client/providers/types';

// Mock dependencies BEFORE imports
vi.mock('@create-figma-plugin/utilities', () => ({
  on: vi.fn(),
  emit: vi.fn()
}));



describe('Atomic Tools Interactions', () => {
  let runtime: AgentRuntime;
  let mockProvider: LLMProvider;
  
  // Simulated State for the mock IPC
  let figmaState: Record<string, any> = {};
  let nodeIdCounter: number = 100;

  beforeEach(() => {
    vi.clearAllMocks();
    figmaState = {};
    nodeIdCounter = 100;

    // Setup mock provider to simulate the "Smart Agent" flow
    // CRITICAL: This test now properly simulates real Figma behavior where:
    // 1. createNode generates its own ID (not using args.id)
    // 2. LLM must use the returned ID in subsequent calls
    mockProvider = {
        name: 'mock',
        generate: vi.fn()
          // Turn 1: Create Parent and Child (sequential - wait for IDs)
          .mockResolvedValueOnce({
            text: 'Creating structure...',
            toolCalls: [
                { name: 'createNode', args: { type: 'FRAME', name: 'Parent' } }
            ]
          })
          // Turn 2: Create child using returned parent ID
          .mockResolvedValueOnce({
            text: 'Creating child...',
            toolCalls: [
                { name: 'createNode', args: { type: 'FRAME', name: 'Child', parentId: '1:0' } }
            ]
          })
          // Turn 3: Try to set Child to HUG (Fail expected - no Auto Layout context)
          .mockResolvedValueOnce({
            text: 'Setting layout...',
            toolCalls: [
                { name: 'setNodeLayout', args: { nodeId: '1:1', sizing: 'HUG' } }
            ]
          })
          // Turn 4: Fix Parent + Retry Child (Success expected)
          .mockResolvedValueOnce({
            text: 'Fixing parent and retrying...',
            toolCalls: [
                { name: 'setNodeLayout', args: { nodeId: '1:0', layoutMode: 'HORIZONTAL' } },
                { name: 'setNodeLayout', args: { nodeId: '1:1', sizing: 'HUG' } }
            ]
          })
          .mockResolvedValueOnce({
            text: 'Done',
            toolCalls: [] 
          })
          .mockResolvedValueOnce({
            text: 'Really done',
            toolCalls: [] 
          })
          .mockResolvedValue({
            text: 'Absolutely done',
            toolCalls: []
          }),
        generateStream: vi.fn(),
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
        getToolSystemInstruction: vi.fn().mockReturnValue('')
    };

    // Mock IPC Logic to simulate Figma constraints
    const mockIpcBridge = {
        callTool: vi.fn(),
        dispose: vi.fn()
    } as any;

    runtime = new AgentRuntime({
      provider: mockProvider,
      tools: [
        { name: 'createNode', description: 'Create node', parameters: { type: 'object', properties: {} } },
        { name: 'setNodeLayout', description: 'Set layout', parameters: { type: 'object', properties: {} } },
      ],
      ipcBridge: mockIpcBridge
    });

    // Mock IPC Logic to simulate Figma constraints
    // CRITICAL: This mock simulates real Figma behavior where createNode generates its own ID
    mockIpcBridge.callTool.mockImplementation(async (name: string, args: any) => {
        if (name === 'createNode') {
            // Simulate Figma's real behavior: generate a unique ID (not using args.id)
            const generatedId = `${Math.floor(nodeIdCounter / 100)}:${nodeIdCounter % 100}`;
            nodeIdCounter = nodeIdCounter + 1;
            
            figmaState[generatedId] = { 
                id: generatedId, 
                type: args.type, 
                parentId: args.parentId,
                layoutMode: 'NONE', // Default
                sizing: 'FIXED'      // Default
            };
            return { success: true, data: { nodeId: generatedId } };
        }
        
        if (name === 'setNodeLayout') {
            const node = figmaState[args.nodeId];
            if (!node) return { success: false, error: { message: 'Node not found' } };

            // Logic: Setting HUG requires Auto Layout context (parent OR self)
            if (args.sizing === 'HUG') {
                const parent = figmaState[node.parentId];
                const isParentAutoLayout = parent && parent.layoutMode !== 'NONE';
                const isSelfAutoLayout = args.layoutMode !== undefined
                    ? args.layoutMode !== 'NONE'
                    : node.layoutMode !== 'NONE';
                
                // HUG is valid if: (1) self is Auto Layout, OR (2) parent is Auto Layout
                if (!isSelfAutoLayout && !isParentAutoLayout) {
                    return {
                        success: false,
                        error: { message: `HUG sizing requires Auto Layout context. Either set layoutMode to VERTICAL/HORIZONTAL, or ensure parent has Auto Layout.` }
                    };
                }
            }

            // Logic: Setting layoutMode on self
            if (args.layoutMode) {
                node.layoutMode = args.layoutMode;
            }
             // Logic: Setting sizing on self
             if (args.sizing) {
                node.sizing = args.sizing;
            }

            return { success: true, data: { nodeId: node.id } };
        }
        
        return { success: false, error: { message: 'Unknown tool' } };
    });
  });

  it('should successfully recover from a logic error using atomic tools', async () => {
    await runtime.run('Build a hug button');
    
    // Verify State using the generated IDs (1:0 for parent, 1:1 for child)
    const parent = figmaState['1:0'];
    const child = figmaState['1:1'];

    // 1. Parent should be upgraded to AutoLayout
    expect(parent.layoutMode).toBe('HORIZONTAL');
    
    // 2. Child should be HUG
    expect(child.sizing).toBe('HUG');

    // 3. Verify that the "failure" happened in the middle (calls count)
    // createNode x2, setNodeLayout(fail) x1, setNodeLayout(fix) x1, setNodeLayout(retry) x1
    // Total setNodeLayout calls = 3
    // We access the mock from the runtime options since we injected it
    const mockCallTool = (runtime as any).options.ipcBridge.callTool;
    const setLayoutCalls = mockCallTool.mock.calls.filter((c: any) => c[0] === 'setNodeLayout');
    expect(setLayoutCalls.length).toBe(3);
    
    // The first one should have failed (we can't check return value directly here easily as it's async, 
    // but the state logic ensures the final state is only reachable if the fix was applied)
  });

  it('should fail when using guessed nodeId instead of returned nodeId', async () => {
    // Reset state
    figmaState = {};
    nodeIdCounter = 100; // Reset counter for this test
    
    // Create a new runtime with a provider that tries to guess IDs
    const guessingProvider = {
        name: 'mock-guessing',
        generate: vi.fn()
          // Turn 1: Create a node
          .mockResolvedValueOnce({
            text: 'Creating node...',
            toolCalls: [
                { name: 'createNode', args: { type: 'FRAME', name: 'Test Frame' } }
            ]
          })
          // Turn 2: Try to use a guessed ID (simulating LLM hallucination)
          .mockResolvedValueOnce({
            text: 'Setting layout with guessed ID...',
            toolCalls: [
                { name: 'setNodeLayout', args: { nodeId: 'guessed-123', layoutMode: 'VERTICAL' } }
            ]
          })
          .mockResolvedValueOnce({
            text: 'Done',
            toolCalls: [] 
          })
          .mockResolvedValueOnce({
            text: 'Really done',
            toolCalls: [] 
          })
          .mockResolvedValue({
            text: 'Absolutely done',
            toolCalls: []
          }),
        generateStream: vi.fn(),
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
        getToolSystemInstruction: vi.fn().mockReturnValue('')
    };

    const testRuntime = new AgentRuntime({
      provider: guessingProvider,
      tools: [
        { name: 'createNode', description: 'Create node', parameters: { type: 'object', properties: {} } },
        { name: 'setNodeLayout', description: 'Set layout', parameters: { type: 'object', properties: {} } },
      ],
      ipcBridge: (runtime as any).options.ipcBridge
    });

    try {
      await testRuntime.run('Test guessed ID');
    } catch (e) {
      // Ignore: Agent reaches loop detector and fails, which is expected since it never fixes the 'guessed-123' error
      expect(e).toBeDefined();
    }
    
    // Verify that setNodeLayout was called with the guessed ID and failed
    const mockCallTool = (testRuntime as any).options.ipcBridge.callTool;
    const setLayoutCalls = mockCallTool.mock.calls.filter((c: any) => c[0] === 'setNodeLayout' && c[1].nodeId === 'guessed-123');
    expect(setLayoutCalls.length).toBeGreaterThan(0);
  });
});
