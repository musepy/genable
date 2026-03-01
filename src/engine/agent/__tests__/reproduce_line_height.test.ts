/**
 * @file reproduce_line_height.test.ts
 * @description Reproduction harness for line-height issue with REAL Gemini API + MOCK Figma tools.
 */

import { describe, it, expect, vi } from 'vitest';

// Must mock before any imports that touch ipcBridge
vi.mock('@create-figma-plugin/utilities', () => ({ on: vi.fn(), emit: vi.fn() }));

import { AgentRuntime } from '../agentRuntime';
import { GeminiProvider } from '../../llm-client/providers/gemini';
import { agentTools } from '../tools';
import { ToolExecutor } from '../tools/types';
import { LLMToolCall } from '../../llm-client/providers/types';

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

class MockFigmaState {
  private nodes: Map<string, any> = new Map();
  private idCounter = 0;

  registerNodes(nodes: any[]) {
    const idMap: Record<string, string> = {};
    for (const node of nodes) {
      const vid = node.id || node.props?.id || `anon-${++this.idCounter}`;
      idMap[vid] = vid; // Use same ID to avoid mapping issues in test
      this.nodes.set(vid, { ...node, realId: vid, props: { ...node.props } });
    }
    console.log(`[REPRO] Registered ${this.nodes.size} nodes. IDs: ${Array.from(this.nodes.keys()).join(', ')}`);
    return { idMap, totalNodes: nodes.length };
  }

  inspect(mode: string) {
    const dsl = Array.from(this.nodes.values());
    const anomalies: any[] = [];
    
    console.log(`[REPRO] Inspecting ${dsl.length} nodes...`);
    for (const node of dsl) {
      if (node.type === 'TEXT') {
        const lh = node.props?.lineHeight;
        console.log(`[REPRO] Checking node ${node.props?.name || node.realId}: lineHeight=${lh}`);
        if (lh !== undefined) {
          if (typeof lh === 'number' && lh < 2) {
             console.log(`[REPRO] Found anomaly on ${node.props?.name || node.realId}: lineHeight=${lh}`);
             anomalies.push({
               type: 'STRANGE_PROPS',
               nodeId: node.realId,
               nodeName: node.props?.name || 'Text',
               severity: 'error',
               message: `Suspiciously small line-height: ${lh}px. This will make text illegible. Expected 1.2-1.6x of font size.`,
               suggestedFix: { lineHeight: 1.4 }
             });
          }
        }
      }
    }

    const result = { mode, dsl, anomalies, nodeCount: this.nodes.size };
    console.log(`[REPRO_INTERNAL] inspectDesign raw output: ${JSON.stringify(result, null, 2)}`);
    return result;
  }

  patch(nodeId: string, props: any) {
    const node = this.nodes.get(nodeId);
    if (node) {
      console.log(`[REPRO] Patching node ${nodeId} with props:`, props);
      node.props = { ...node.props, ...props };
      return true;
    }
    console.log(`[REPRO] FAILED to patch node ${nodeId} (not found)`);
    return false;
  }
}

function createMockExecutors(state: MockFigmaState): Record<string, ToolExecutor> {
  return {
    generateDesign: async (params: any) => {
      console.log('[REPRO] generateDesign start');
      const result = state.registerNodes(params.nodes || []);
      // Inject the bug directly into state nodes
      const nodesMap = state['nodes'];
      for (const [id, node] of nodesMap.entries()) {
        if (node.type === 'TEXT') {
           node.props.lineHeight = (node.props.name || '').includes('Title') ? 1.1 : 1.6;
           console.log(`[REPRO] Injected faulty lineHeight for ${node.props.name} (${id}): ${node.props.lineHeight}`);
        }
      }
      return { success: true, data: { ...result, rootNodeId: Array.from(nodesMap.keys())[0] } };
    },
    inspectDesign: async (params: any) => {
      const result = state.inspect(params.mode || 'hierarchy');
      return { success: true, data: result };
    },
    patchNode: async (params: any) => {
      const success = state.patch(params.nodeId, params.props || {});
      return { success, data: { propsUpdated: Object.keys(params.props || {}) } };
    },
    applyDesignPatch: async (params: any) => {
      const patches = params.patches || [];
      patches.forEach((p: any) => state.patch(p.nodeId, p.props || {}));
      return { success: true, data: { results: patches.map(() => ({ success: true })) } };
    }
  };
}

describe('Reproduction: Line-Height Issue', () => {
  it.skip('should catch and fix small line-height', { timeout: 120_000 }, async () => {
    const prompt = 'Create a hero section with a large title "Experience Evolution" and a short description. Use modern typography.';
    const state = new MockFigmaState();
    const executors = createMockExecutors(state);
    const provider = new GeminiProvider(API_KEY, MODEL_NAME);

    // USE REAL SYSTEM PROMPT (via promptComposer)
    // NO HARDCODED OVERRIDES HERE to see why real agent fails.
    (provider as any).getToolSystemInstruction = (tools: any[]) => {
       // Return realistic basic instruction or leave empty to use default
       return 'You are a Figma UI expert. Use the provided tools to generate and verify designs.';
    };

    const toolHistory: string[] = [];
    const runtime = new AgentRuntime({
      provider,
      tools: agentTools.filter(t => ['generateDesign', 'patchNode', 'applyDesignPatch', 'inspectDesign', 'complete_task'].includes(t.name)),
      toolExecutors: executors as any,
      maxIterations: 10,
      behaviorConfig: { 
        thinkingLevel: 'medium', // Enable reasoning
      },
      loopPolicy: { useSkillSystem: false }
    });

    // Capture tool calls and THOUGHTS
    (runtime as any).options.onIteration = (iteration: number, response: any) => {
      if (response.thoughts) {
        console.log(`\n[AGENT THOUGHTS Iteration ${iteration}]:\n${response.thoughts}\n`);
      }
    };
    (runtime as any).options.onToolCall = (tc: LLMToolCall) => {
      toolHistory.push(tc.name);
      console.log(`[REPRO] Tool called: ${tc.name} with params: ${JSON.stringify(tc.arguments)}`);
    };

    // PART 1: Generate initial design
    console.log('\n--- PHASE 1: GENERATION ---');
    await runtime.run('Create a hero section with a large title "Experience Evolution" and a short description.');
    
    expect(toolHistory).toContain('generateDesign');
    
    // Check injected anomalies
    const intermediateNodes = Array.from((state as any).nodes.values()).filter((n: any) => n.type === 'TEXT');
    console.log('Intermediate Text Nodes (with injected bugs):');
    intermediateNodes.forEach((n: any) => {
      console.log(`- ${n.props.name}: lineHeight=${n.props.lineHeight}`);
    });

    // PART 2: Force verification on existing state
    console.log('\n--- PHASE 2: FORCED VERIFICATION ---');
    // We use a prompt that specifically asks to inspect the existing screen
    const result = await runtime.run('Now, MANDATORILY run inspectDesign on the screen you just created. Look for property anomalies (especially lineHeight) and FIX them using applyDesignPatch if they look suspicious. Do not call complete_task until you have fixed all anomalies.');
    
    console.log('\nFinal Tool Sequence:', toolHistory.join(' -> '));
    
    const finalNodes = Array.from((state as any).nodes.values()).filter((n: any) => n.type === 'TEXT');
    console.log('Final Text Nodes Properties:');
    finalNodes.forEach((n: any) => {
      console.log(`- ${n.props.name}: lineHeight=${n.props.lineHeight}, fontSize=${n.props.fontSize}`);
    });

    expect(toolHistory).toContain('inspectDesign');
    expect(toolHistory.some(n => n === 'patchNode' || n === 'applyDesignPatch')).toBe(true);

    expect(result).toBeDefined();
  });
});
