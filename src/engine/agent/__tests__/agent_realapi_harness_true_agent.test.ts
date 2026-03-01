/**
 * @file agent_realapi_harness.test.ts
 * @description Diagnostic harness: runs AgentRuntime with REAL Gemini API + MOCK Figma tools.
 *
 * Purpose: measure iteration count, timing, and token usage per phase (PLANNING, EXECUTION, VERIFICATION)
 * to identify why the agent takes too many iterations after generateDesign.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts --reporter=verbose
 *   GEMINI_API_KEY=xxx GEMINI_MODEL=gemini-2.5-flash npx vitest run src/engine/agent/__tests__/agent_realapi_harness.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

// Must mock before any imports that touch ipcBridge
vi.mock('@create-figma-plugin/utilities', () => ({ on: vi.fn(), emit: vi.fn() }));

import { AgentRuntime } from '../agentRuntime';
import { GeminiProvider } from '../../llm-client/providers/gemini';
import { agentTools } from '../tools';
import { ToolExecutor } from '../tools/types';
import { LLMResponse, LLMToolCall } from '../../llm-client/providers/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ToolCallTrace {
  name: string;
  argsPreview: string;
  resultSuccess: boolean;
  resultPreview: string;
  durationMs: number;
}

interface IterationTrace {
  iteration: number;
  phase: string;
  durationMs: number;
  toolCalls: ToolCallTrace[];
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  responseTextLength: number;
  hasThinking: boolean;
  thoughtsPreview?: string;
}

interface HarnessReport {
  prompt: string;
  modelName: string;
  totalIterations: number;
  totalDurationMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  phaseBreakdown: Record<string, { iterations: number; durationMs: number; tokens: number }>;
  iterations: IterationTrace[];
  generateDesignIteration: number | null;
  verificationEntryIteration: number | null;
  anomaliesDetected: string[];
  fixAttempts: number;
}

// ---------------------------------------------------------------------------
// MockFigmaState — stateful mock tracking generateDesign output for inspection
// ---------------------------------------------------------------------------
interface MockNode {
  id: string;
  virtualId: string;
  type: string;
  name: string;
  parentVirtualId: string | null;
  props: Record<string, any>;
}

class MockFigmaState {
  private nodes: Map<string, MockNode> = new Map();
  private virtualToRealId: Map<string, string> = new Map();
  private rootNodeId: string | null = null;
  private inspectCallCount = 0;
  private patchCount = 0;
  private idCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}-${++this.idCounter}`;
  }

  registerNodes(nodesFromLLM: any[]): { rootNodeId: string; totalNodes: number; idMap: Record<string, string> } {
    const idMap: Record<string, string> = {};
    for (const node of nodesFromLLM) {
      const vid = node.id || `anon-${this.idCounter}`;
      const realId = this.nextId('mock');
      idMap[vid] = realId;
      this.virtualToRealId.set(vid, realId);
      this.nodes.set(realId, {
        id: realId,
        virtualId: vid,
        type: node.type || 'FRAME',
        name: node.props?.name || vid,
        parentVirtualId: (!node.parent || node.parent === 'root' || node.parent === '') ? null : node.parent,
        props: node.props || {},
      });
    }
    const rootNode = nodesFromLLM.find(n => !n.parent || n.parent === 'root' || n.parent === '' || n.parent === null);
    this.rootNodeId = rootNode ? idMap[rootNode.id] : Object.values(idMap)[0];
    return { rootNodeId: this.rootNodeId!, totalNodes: nodesFromLLM.length, idMap };
  }

  inspect(mode: string, _nodeId?: string, _depth?: number): any {
    this.inspectCallCount++;
    const dsl = this.buildDSL();
    // First inspection: return minor anomalies. Subsequent: clean.
    const anomalies = this.inspectCallCount === 1 ? this.generateAnomalies() : [];
    return { mode, dsl, anomalies, nodeCount: this.nodes.size };
  }

  recordPatch() { this.patchCount++; }
  getInspectCallCount() { return this.inspectCallCount; }
  getPatchCount() { return this.patchCount; }

  private buildDSL(): any {
    if (!this.rootNodeId || this.nodes.size === 0) {
      return { type: 'FRAME', name: 'Empty', props: {}, children: [] };
    }
    const root = this.nodes.get(this.rootNodeId);
    if (!root) return { type: 'FRAME', name: 'Unknown', props: {} };

    const childrenOf = (parentRealId: string): any[] => {
      return Array.from(this.nodes.values())
        .filter(n => {
          if (!n.parentVirtualId) return false;
          const parentReal = this.virtualToRealId.get(n.parentVirtualId);
          return parentReal === parentRealId;
        })
        .map(n => ({
          id: n.id,
          type: n.type,
          name: n.name,
          props: {
            width: n.props.width || (n.type === 'TEXT' ? undefined : 100),
            height: n.props.height || (n.type === 'TEXT' ? undefined : 40),
            ...(n.type === 'TEXT' ? { characters: n.props.characters || 'Text', fontSize: n.props.fontSize || 14 } : {}),
            ...(n.props.layoutMode ? { layoutMode: n.props.layoutMode } : {}),
          },
          children: childrenOf(n.id),
        }));
    };

    return {
      id: root.id,
      type: root.type,
      name: root.name,
      props: {
        width: root.props.width || 400,
        height: root.props.height || 600,
        layoutMode: root.props.layoutMode || 'VERTICAL',
      },
      children: childrenOf(root.id),
    };
  }

  private generateAnomalies(): any[] {
    const textNodes = Array.from(this.nodes.values()).filter(n => n.type === 'TEXT');
    const anomalies: any[] = [];
    if (textNodes.length > 0) {
      anomalies.push({
        type: 'TEXT_OVERFLOW',
        nodeId: textNodes[0].id,
        nodeName: textNodes[0].name,
        severity: 'warning',
        message: `Text "${textNodes[0].name}" may overflow its container.`,
        suggestedFix: { textAutoResize: 'HEIGHT' },
      });
    }
    return anomalies;
  }
}

// ---------------------------------------------------------------------------
// Mock Executors Factory
// ---------------------------------------------------------------------------
function createMockExecutors(state: MockFigmaState): Record<string, ToolExecutor> {
  return {
    generateDesign: async (params: any) => {
      const nodes = params.nodes || [];
      const result = state.registerNodes(nodes);
      return {
        success: true,
        data: {
          rootNodeId: result.rootNodeId,
          totalNodes: result.totalNodes,
          idMap: result.idMap,
          anomalies: [],
        },
      };
    },

    inspectDesign: async (params: any) => {
      const result = state.inspect(params.mode || 'hierarchy', params.nodeId, params.depth || 3);
      return { success: true, data: result };
    },

    patchNode: async (params: any) => {
      state.recordPatch();
      return {
        success: true,
        data: { propsUpdated: Object.keys(params.props || params.patch || {}) },
      };
    },

    applyDesignPatch: async (params: any) => {
      const patches = params.patches || params.operations || [];
      patches.forEach(() => state.recordPatch());
      return {
        success: true,
        data: {
          results: patches.map((p: any, i: number) => ({
            opId: p.opId || `patch_${i}`,
            action: 'applyDesignPatch',
            success: true,
          })),
        },
      };
    },

    renderSubtree: async (params: any) => {
      const nodes = params.nodes || [];
      const result = state.registerNodes(nodes);
      return { success: true, data: { rootNodeId: result.rootNodeId, idMap: result.idMap } };
    },

    deleteNode: async () => ({ success: true }),

    createIcon: async (params: any) => ({
      success: true,
      data: { nodeId: `mock-icon-${Date.now().toString(36)}` },
    }),

    validateLayout: async () => ({
      success: true,
      data: { valid: true, errors: [], warnings: [], summary: 'All constraints pass' },
    }),

    // Knowledge tools — return minimal mock data
    searchDesignKnowledge: async (params: any) => ({
      success: true,
      data: {
        results: [{ id: 'mock', content: `Design knowledge for "${params.query}"` }],
        totalAvailable: 1,
      },
    }),

    getComponentAnatomy: async (params: any) => ({
      success: true,
      data: {
        found: true,
        blueprint: {
          id: params.componentName || 'component',
          name: params.componentName || 'Component',
          structure: { root: 'FRAME', children: ['TEXT', 'FRAME'] },
          defaultProps: {},
          variants: [],
        },
      },
    }),

    getFigmaLayoutRules: async () => ({
      success: true,
      data: { rules: [] },
    }),
  };
}

// ---------------------------------------------------------------------------
// Phase inference from tool calls
// ---------------------------------------------------------------------------
function inferPhase(toolCalls: Array<{ name: string }>): string {
  const names = new Set(toolCalls.map(tc => tc.name));
  if (names.has('planDesign') || names.has('searchDesignKnowledge') || names.has('getComponentAnatomy') || names.has('getFigmaLayoutRules')) return 'PLANNING';
  if (names.has('build_design') || names.has('renderSubtree')) return 'EXECUTION';
  if (names.has('inspectDesign') || names.has('validateLayout')) return 'VERIFICATION';
  if (names.has('patchNode') || names.has('applyDesignPatch')) return 'VERIFICATION_FIX';
  if (names.has('complete_task')) return 'COMPLETION';
  // Workflow-only
  const workflowNames = ['new_task', 'update_todo_list', 'summarize_progress', 'complete_step'];
  if (toolCalls.every(tc => workflowNames.includes(tc.name))) return 'WORKFLOW';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Report printer
// ---------------------------------------------------------------------------
function printReport(report: HarnessReport): void {
  const line = '='.repeat(80);
  console.log(`\n${line}`);
  console.log('AGENT REAL API DIAGNOSTIC REPORT');
  console.log(line);
  console.log(`Model: ${report.modelName}`);
  console.log(`Prompt: "${report.prompt}"`);
  console.log(`Total Iterations: ${report.totalIterations}`);
  console.log(`Total Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Total Tokens: ${report.totalTokens.total} (prompt: ${report.totalTokens.prompt}, completion: ${report.totalTokens.completion})`);

  console.log('\n--- Phase Breakdown ---');
  for (const [phase, data] of Object.entries(report.phaseBreakdown).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${phase.padEnd(20)} ${String(data.iterations).padStart(3)} iters  ${(data.durationMs / 1000).toFixed(1).padStart(7)}s  ${String(data.tokens).padStart(8)} tokens`);
  }

  console.log('\n--- Key Milestones ---');
  console.log(`  generateDesign called at iteration:  ${report.generateDesignIteration ?? 'NEVER'}`);
  console.log(`  VERIFICATION entered at iteration:   ${report.verificationEntryIteration ?? 'NEVER'}`);
  console.log(`  Anomalies detected:                  ${report.anomaliesDetected.length > 0 ? report.anomaliesDetected.join(', ') : 'none'}`);
  console.log(`  Fix attempts (patch calls):          ${report.fixAttempts}`);

  console.log('\n--- Per-Iteration Timeline ---');
  console.log('  Iter | Phase                | Duration |  Tokens | Tools');
  console.log('  ' + '-'.repeat(75));
  for (const iter of report.iterations) {
    const tools = iter.toolCalls.map(tc => tc.name).join(', ') || '(workflow-only)';
    const tokens = iter.tokenUsage?.totalTokens ?? '?';
    console.log(
      `  ${String(iter.iteration).padStart(4)} | ${iter.phase.padEnd(20)} | ${(iter.durationMs / 1000).toFixed(1).padStart(6)}s | ${String(tokens).padStart(7)} | ${tools}`
    );
    // Show thinking if present
    if (iter.thoughtsPreview) {
      console.log(`       | thoughts: ${iter.thoughtsPreview}`);
    }
  }

  // Verification analysis
  if (report.verificationEntryIteration !== null) {
    const verIters = report.iterations.filter(i => i.iteration >= report.verificationEntryIteration!);
    const verDuration = verIters.reduce((sum, i) => sum + i.durationMs, 0);
    const verTokens = verIters.reduce((sum, i) => sum + (i.tokenUsage?.totalTokens || 0), 0);
    console.log('\n--- VERIFICATION PHASE ANALYSIS ---');
    console.log(`  Iterations in VERIFICATION: ${verIters.length} (out of ${report.totalIterations} total)`);
    console.log(`  Duration: ${(verDuration / 1000).toFixed(1)}s (${Math.round(verDuration / report.totalDurationMs * 100)}% of total)`);
    console.log(`  Tokens: ${verTokens} (${report.totalTokens.total > 0 ? Math.round(verTokens / report.totalTokens.total * 100) : 0}% of total)`);
    console.log(`  Tool sequence: ${verIters.flatMap(i => i.toolCalls.map(tc => tc.name)).join(' → ')}`);
  }

  console.log(`\n${line}\n`);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('Agent Real API Harness', () => {

  function createHarness(prompt: string, maxIterations = 30) {
    const state = new MockFigmaState();
    const executors = createMockExecutors(state);
    const provider = new GeminiProvider(API_KEY, MODEL_NAME);

    // Patch: getToolSystemInstruction uses require() which fails in vitest
    (provider as any).getToolSystemInstruction = (_tools: any[]) => {
      return 'Tool Calling Rules:\n- Always provide all required parameters.\n- Use generateDesign for one-shot creation.\n- Use inspectDesign for verification.\n- Call complete_task when done.';
    };

    const report: HarnessReport = {
      prompt,
      modelName: MODEL_NAME,
      totalIterations: 0,
      totalDurationMs: 0,
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      phaseBreakdown: {},
      iterations: [],
      generateDesignIteration: null,
      verificationEntryIteration: null,
      anomaliesDetected: [],
      fixAttempts: 0,
    };

    // Per-iteration tracking
    let currentIteration = -1;
    let iterationStartMs = 0;
    let currentToolCalls: ToolCallTrace[] = [];
    let toolCallStartMs = 0;

    // ---------------------------------------------------------------------------
    // "True Agent" Optimization
    // ---------------------------------------------------------------------------
    // 1. Give it only the tools it needs to get the job done. No workflow management overhead.
    const trueAgentTools = agentTools.filter(t => 
      ['generateDesign', 'patchNode', 'inspectDesign', 'complete_task'].includes(t.name)
    );

    const runtime = new AgentRuntime({
      provider,
      tools: trueAgentTools, // Inject the restricted toolset
      toolExecutors: executors as any,
      maxIterations,
      behaviorConfig: {
        designStrategy: 'create',
        visualQuality: 'rich',
        thinkingLevel: 'minimal',
        maxIterations,
      },
      loopPolicy: {
        useSkillSystem: false, // Turn off skill injection to reduce prompt bloat
        verificationFixLimit: 3,
      },

      onIterationStart: (iteration) => {
        // Flush previous iteration
        if (currentIteration >= 0) {
          flushIteration(report, currentIteration, iterationStartMs, currentToolCalls, null);
        }
        currentIteration = iteration;
        iterationStartMs = Date.now();
        currentToolCalls = [];

        // ---------------------------------------------------------------------------
        // Hack: Force the runtime to stay in EXECUTION mode to bypass rigid phase switching
        // ---------------------------------------------------------------------------
        if ((runtime as any).mode !== 'EXECUTION') {
           (runtime as any).mode = 'EXECUTION';
           console.log('[TrueAgentHack] Forced mode to EXECUTION');
        }
      },

      onIteration: (iteration, response) => {
        // This fires after LLM response with usage data
        flushIteration(report, iteration, iterationStartMs, currentToolCalls, response);
        // Mark as flushed
        currentIteration = -1;

        if (response.usage) {
          report.totalTokens.prompt += response.usage.promptTokens;
          report.totalTokens.completion += response.usage.completionTokens;
          report.totalTokens.total += response.usage.totalTokens;
        }
      },

      onToolCall: (toolCall: LLMToolCall) => {
        toolCallStartMs = Date.now();
      },

      onToolResult: (toolCall: LLMToolCall, result: any) => {
        const tc: ToolCallTrace = {
          name: toolCall.name,
          argsPreview: JSON.stringify(toolCall.args).slice(0, 150),
          resultSuccess: result?.success !== false,
          resultPreview: JSON.stringify(result).slice(0, 200),
          durationMs: Date.now() - toolCallStartMs,
        };
        currentToolCalls.push(tc);

        // Track milestones
        if (toolCall.name === 'generateDesign' && report.generateDesignIteration === null) {
          report.generateDesignIteration = currentIteration;
        }
        if (toolCall.name === 'inspectDesign' && result?.data?.anomalies?.length > 0) {
          for (const a of result.data.anomalies) {
            report.anomaliesDetected.push(`${a.type}: ${a.nodeName || a.nodeId}`);
          }
        }
        if (toolCall.name === 'patchNode' || toolCall.name === 'applyDesignPatch') {
          report.fixAttempts++;
        }
      },
    });

    function flushIteration(
      rep: HarnessReport,
      iteration: number,
      startMs: number,
      toolCalls: ToolCallTrace[],
      response: LLMResponse | null,
    ) {
      // Avoid duplicate flush
      if (rep.iterations.some(i => i.iteration === iteration)) return;

      const durationMs = Date.now() - startMs;
      const phase = inferPhase(toolCalls);

      // Detect verification entry
      if ((phase === 'VERIFICATION' || phase === 'VERIFICATION_FIX') && rep.verificationEntryIteration === null) {
        rep.verificationEntryIteration = iteration;
      }

      const trace: IterationTrace = {
        iteration,
        phase,
        durationMs,
        toolCalls,
        tokenUsage: response?.usage ? {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
        } : undefined,
        responseTextLength: (response?.text || '').length,
        hasThinking: !!response?.thoughts,
        thoughtsPreview: response?.thoughts ? response.thoughts.slice(0, 120) + (response.thoughts.length > 120 ? '...' : '') : undefined,
      };
      rep.iterations.push(trace);

      // Phase breakdown
      if (!rep.phaseBreakdown[phase]) {
        rep.phaseBreakdown[phase] = { iterations: 0, durationMs: 0, tokens: 0 };
      }
      rep.phaseBreakdown[phase].iterations++;
      rep.phaseBreakdown[phase].durationMs += durationMs;
      rep.phaseBreakdown[phase].tokens += response?.usage?.totalTokens || 0;
    }

    return { runtime, report, state };
  }

  // =========================================================================
  // Test 1: Login Form — full diagnostic trace
  // =========================================================================
  it.skipIf(!API_KEY)(
    'diagnostic: login form — full trace',
    { timeout: 300_000 },
    async () => {
      const prompt = 'Create a modern login form with email input, password input, and a submit button. Use a clean, minimal design with proper spacing.';
      const { runtime, report } = createHarness(prompt, 30);

      const startTime = Date.now();
      const result = await runtime.run(prompt);
      report.totalDurationMs = Date.now() - startTime;
      report.totalIterations = report.iterations.length;

      printReport(report);

      // Sanity checks
      expect(result).toBeDefined();
      expect(report.totalIterations).toBeGreaterThan(0);
      expect(report.totalIterations).toBeLessThan(30);

      // The key diagnostic: how many iterations post-generateDesign?
      if (report.generateDesignIteration !== null) {
        const postGenIterations = report.totalIterations - report.generateDesignIteration - 1;
        console.log(`\n*** POST-GENERATEDESIGN ITERATIONS: ${postGenIterations} ***`);
        console.log(`*** (generateDesign at iter ${report.generateDesignIteration}, total ${report.totalIterations}) ***\n`);
      }
    }
  );

  // =========================================================================
  // Test 2: Simple rectangle — baseline comparison
  // =========================================================================
  it.skipIf(!API_KEY)(
    'diagnostic: simple rectangle — baseline',
    { timeout: 120_000 },
    async () => {
      const prompt = 'Create a blue rectangle with rounded corners and the text "Hello World" centered inside it.';
      const { runtime, report } = createHarness(prompt, 20);

      const startTime = Date.now();
      const result = await runtime.run(prompt);
      report.totalDurationMs = Date.now() - startTime;
      report.totalIterations = report.iterations.length;

      printReport(report);

      expect(result).toBeDefined();
      expect(report.totalIterations).toBeGreaterThan(0);
    }
  );
});
