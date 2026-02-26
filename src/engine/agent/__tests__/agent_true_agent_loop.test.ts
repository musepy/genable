/**
 * @file agent_true_agent_loop.test.ts
 * @description True Agent Diagnostic: Runs AgentRuntime with REAL Gemini API + MOCK Figma tools.
 *
 * Purpose: Prove that by removing legacy PLAN/EXECUTE/VERIFY workflows, the model
 * (especially Gemini 3.1 Pro/2.5 Flash) can complete a design task purely via 
 * execution tools in a single continuous thought loop.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx GEMINI_MODEL=gemini-3.1-pro-preview npx vitest run src/engine/agent/__tests__/agent_true_agent_loop.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// Must mock before any imports that touch ipcBridge
vi.mock('@create-figma-plugin/utilities', () => ({ on: vi.fn(), emit: vi.fn() }));

import { AgentRuntime } from '../agentRuntime';
import { GeminiProvider } from '../../llm-client/providers/gemini';
import { agentTools } from '../tools';
import { ToolExecutor } from '../tools/types';
import { LLMToolCall } from '../../llm-client/providers/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

// ---------------------------------------------------------------------------
// MockFigmaState — Minimal state for structural tracking
// ---------------------------------------------------------------------------
class MockFigmaState {
  private idCounter = 0;
  private patchCount = 0;

  private nextId(prefix: string): string {
    return `${prefix}-${++this.idCounter}`;
  }

  registerNodes(nodesFromLLM: any[]): { rootNodeId: string; totalNodes: number; idMap: Record<string, string> } {
    const idMap: Record<string, string> = {};
    for (const node of nodesFromLLM) {
      const vid = node.id || `anon-${this.idCounter}`;
      idMap[vid] = this.nextId('mock');
    }
    const rootNode = nodesFromLLM.find(n => !n.parent || n.parent === 'root' || n.parent === '');
    const rootId = rootNode ? idMap[rootNode.id] : Object.values(idMap)[0];
    return { rootNodeId: rootId, totalNodes: nodesFromLLM.length, idMap };
  }

  inspect(mode: string): any {
    // True Agent: If we are calling inspect, just say it's fine for this test to avoid infinite loops
    return { mode, dsl: { type: 'FRAME', name: 'Valid Tree' }, anomalies: [], nodeCount: 1 };
  }

  recordPatch() { this.patchCount++; }
}

function createMockExecutors(state: MockFigmaState): Record<string, ToolExecutor> {
  return {
    generateDesign: async (params: any) => {
      const nodes = params.nodes || [];
      const result = state.registerNodes(nodes);
      return { success: true, data: { rootNodeId: result.rootNodeId, totalNodes: result.totalNodes, idMap: result.idMap, anomalies: [] } };
    },
    inspectDesign: async (params: any) => {
      const result = state.inspect(params.mode || 'hierarchy');
      return { success: true, data: result };
    },
    patchNode: async (params: any) => {
      state.recordPatch();
      return { success: true, data: { propsUpdated: Object.keys(params.props || params.patch || {}) } };
    },
  };
}

describe('Agent True Agent Loop', () => {

  function createHarness(prompt: string, maxIterations = 30) {
    const state = new MockFigmaState();
    const executors = createMockExecutors(state);
    const provider = new GeminiProvider(API_KEY, MODEL_NAME);

    // Patch: getToolSystemInstruction uses require() which fails in vitest
    // We override it with the True Agent rules
    (provider as any).getToolSystemInstruction = (_tools: any[]) => {
      return `YOU ARE A PURE EXECUTION AGENT.
You DO NOT need to plan or breakdown tasks.
Your goal is to complete the user's request immediately using the tools provided.
1. Use \`generateDesign\` to generate the full UI structure in one shot.
2. If necessary, use \`inspectDesign\` to verify your work.
3. If necessary, use \`patchNode\` to fix errors.
4. IMPORTANT: Once you believe the task is complete, use \`complete_task\` immediately. Do not loop endlessly.`;
    };

    const toolHistory: string[] = [];
    const trueAgentTools = agentTools
      .filter(t => ['generateDesign', 'patchNode', 'inspectDesign', 'complete_task'].includes(t.name))
      .map(t => ({ ...t, modes: undefined })); // Strip modes so they are always available

    const runtime = new AgentRuntime({
      provider,
      tools: trueAgentTools, // ONLY 4 Tools
      toolExecutors: executors as any,
      maxIterations,
      behaviorConfig: { designStrategy: 'create', visualQuality: 'rich', thinkingLevel: 'low', maxIterations },
      loopPolicy: { useSkillSystem: false, verificationFixLimit: 3 },

      onIterationStart: () => {
        // Force AgentRuntime into EXECUTION mode so it doesn't trigger Phase constraints
        if ((runtime as any).mode !== 'EXECUTION') (runtime as any).mode = 'EXECUTION';
      },
      onToolCall: (toolCall: LLMToolCall) => {
        toolHistory.push(toolCall.name);
        console.log(`[Tool Called] -> ${toolCall.name}`);
      },
    });

    return { runtime, toolHistory };
  }

  it.skipIf(!API_KEY)('diagnostic: simple rectangle — should finish in 1-2 steps without planning', { timeout: 60_000 }, async () => {
    const prompt = 'Create a blue rectangle with rounded corners and the text "Hello World" centered inside it.';
    const { runtime, toolHistory } = createHarness(prompt, 10);
    
    console.log(`=== Starting Run: ${MODEL_NAME} ===`);
    const startTime = Date.now();
    let result = '';
    try {
      result = await runtime.run(prompt);
      console.log('Run result:', result);
    } catch (e) {
      console.error('Run failed:', e);
    }
    
    console.log(`=== Finished in ${Date.now() - startTime}ms ===`);
    console.log('Tool Sequence:', toolHistory.join(' -> '));
    
    expect(toolHistory.length).toBeGreaterThan(0);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Hello World'); // Make sure it includes the summary
  });

  it.skipIf(!API_KEY)('diagnostic: login form — should finish in few steps without planning', { timeout: 120_000 }, async () => {
    const prompt = 'Create a modern login form with email input, password input, and a submit button. Use a clean, minimal design with proper spacing.';
    const { runtime, toolHistory } = createHarness(prompt, 15);

    console.log(`=== Starting Run: ${MODEL_NAME} ===`);
    const startTime = Date.now();
    let result = '';
    try {
      result = await runtime.run(prompt);
      console.log('Run result:', result);
    } catch (e) {
      console.error('Run failed:', e);
    }
    
    console.log(`=== Finished in ${Date.now() - startTime}ms ===`);
    console.log('Tool Sequence:', toolHistory.join(' -> '));
    
    expect(toolHistory.length).toBeGreaterThan(0);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('login');
  });
});
