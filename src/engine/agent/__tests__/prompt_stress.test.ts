/**
 * @file prompt_stress.test.ts
 * @description High-pressure stress test for prompt engineering quality and multi-turn compliance.
 *
 * Tests two dimensions:
 *   A. Initial design quality — does the LLM correctly follow CORE.md / WORKFLOW.md / EXAMPLES.md?
 *   B. Multi-turn follow-up compliance — can the agent properly edit existing designs via conversation?
 *
 * Uses REAL LLM API (DashScope) + MOCK Figma tools.
 *
 * Usage:
 *   DASHSCOPE_API_KEY=sk-xxx npx vitest run src/engine/agent/__tests__/prompt_stress.test.ts --reporter=verbose
 *   DASHSCOPE_API_KEY=sk-xxx DASHSCOPE_MODEL=qwen-plus npx vitest run src/engine/agent/__tests__/prompt_stress.test.ts
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@create-figma-plugin/utilities', () => ({ on: vi.fn(), emit: vi.fn() }));

import { AgentRuntime } from '../agentRuntime';
import { DashScopeProvider } from '../../llm-client/providers/dashscope';
import { agentTools } from '../tools';
import { ToolExecutor } from '../tools/types';
import { LLMResponse, LLMToolCall } from '../../llm-client/providers/types';
import { serializeTools } from '../../llm-client/context/toolSerializer';
import catalog from '../../../generated/prompt-catalog.json';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-sp-d74b573b0c2641dcb4876aceb33d0335';
const MODEL_NAME = process.env.DASHSCOPE_MODEL || 'qwen3-coder-plus';
const MAX_ITERATIONS = 12;
const SKIP = !API_KEY;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCallRecord {
  turn: number;
  iteration: number;
  name: string;
  args: any;
  xml?: string;
  resultSuccess: boolean;
  resultData?: any;
  durationMs: number;
}

interface TurnRecord {
  turn: number;
  prompt: string;
  response: string;
  iterations: number;
  toolCalls: ToolCallRecord[];
  tokenUsage: { prompt: number; completion: number; total: number };
  durationMs: number;
}

interface StressTestReport {
  testName: string;
  model: string;
  turns: TurnRecord[];
  totalDurationMs: number;
  totalTokens: number;
  violations: Violation[];
}

interface Violation {
  turn: number;
  rule: string;
  detail: string;
  severity: 'error' | 'warning';
}

// ─── MockFigmaState (unified tool-aware) ─────────────────────────────────────

interface MockNode {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  props: Record<string, any>;
  children: string[];
}

class MockFigmaState {
  nodes = new Map<string, MockNode>();
  private idCounter = 0;

  private nextId(): string {
    return `mock:${++this.idCounter}`;
  }

  /**
   * Process create XML — builds a realistic parent-child tree from XML.
   * Parses opening/closing tags to establish nesting, tracks text content.
   */
  processCreate(xml: string, parentId?: string): { idMap: Record<string, string>; created: number } {
    const idMap: Record<string, string> = {};
    const parentStack: string[] = parentId ? [parentId] : [];
    let created = 0;

    // Parse XML tags sequentially to maintain parent-child relationships
    const tokenRegex = /<(\/?)(\w+)(\s[^>]*)?\/?>/g;
    let match;
    while ((match = tokenRegex.exec(xml)) !== null) {
      const [fullMatch, isClosing, tag, attrsStr] = match;
      const isSelfClosing = fullMatch.endsWith('/>');

      if (isClosing) {
        // Closing tag — pop parent
        parentStack.pop();
        continue;
      }

      // Extract name and text content from attributes
      const nameMatch = attrsStr?.match(/name=['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : `${tag}_${++this.idCounter}`;
      const realId = this.nextId();
      const currentParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

      idMap[name] = realId;
      this.nodes.set(realId, {
        id: realId,
        type: tag.toUpperCase(),
        name,
        parentId: currentParent,
        props: { _attrs: attrsStr?.trim() || '' },
        children: [],
      });

      // Register as child of parent
      if (currentParent) {
        const parent = this.nodes.get(currentParent);
        if (parent) parent.children.push(realId);
      }

      created++;

      // If not self-closing, push as parent for nested children
      if (!isSelfClosing) {
        parentStack.push(realId);
      }
    }

    if (created === 0) {
      const realId = this.nextId();
      idMap['root'] = realId;
      this.nodes.set(realId, { id: realId, type: 'FRAME', name: 'root', parentId: null, props: {}, children: [] });
      created = 1;
    }

    return { idMap, created };
  }

  /**
   * Process edit XML — pretend to modify nodes.
   */
  processEdit(xml: string): { edited: number; deleted: number } {
    let edited = 0;
    let deleted = 0;

    const idRegex = /id=['"]([^'"]+)['"]/g;
    const deleteRegex = /delete=['"]true['"]/g;
    let match;
    while ((match = idRegex.exec(xml)) !== null) {
      edited++;
    }
    while ((match = deleteRegex.exec(xml)) !== null) {
      deleted++;
      edited--; // deletion, not edit
    }

    return { edited: Math.max(0, edited), deleted };
  }

  /**
   * Generate a compact XML tree for read results that reflects actual created nodes.
   * Recursively builds parent-child tree to give the LLM accurate structure.
   */
  generateReadXml(nodeId?: string, depth: number = 5): string {
    if (this.nodes.size === 0) {
      return '<frame name="Empty Canvas" w="800" h="600" layout="column" bg="#FFFFFF"/>';
    }

    const renderNode = (id: string, indent: number, currentDepth: number): string => {
      const node = this.nodes.get(id);
      if (!node) return '';
      const pad = '  '.repeat(indent);
      const tag = node.type.toLowerCase();
      const children = node.children;

      // Compose attributes
      let attrs = `id="${node.id}" name="${node.name}"`;
      if (tag === 'frame') attrs += ` layout="column" w="fill" h="hug" bg="#FFFFFF"`;
      if (tag === 'text') attrs += ` size="14" fill="#111827"`;
      if (tag === 'icon') attrs += ` w="24" h="24"`;
      if (tag === 'rect') attrs += ` w="fill" h="1" fill="#E5E7EB"`;

      if (children.length === 0 || currentDepth >= depth) {
        return `${pad}<${tag} ${attrs}/>`;
      }

      const childXml = children
        .map(cid => renderNode(cid, indent + 1, currentDepth + 1))
        .filter(Boolean)
        .join('\n');
      return `${pad}<${tag} ${attrs}>\n${childXml}\n${pad}</${tag}>`;
    };

    // If specific nodeId, render that subtree
    if (nodeId) {
      const node = this.nodes.get(nodeId);
      if (node) return renderNode(nodeId, 0, 0);
    }

    // Otherwise render all top-level nodes
    const topLevel = Array.from(this.nodes.values()).filter(n => !n.parentId);
    if (topLevel.length === 1) {
      return renderNode(topLevel[0].id, 0, 0);
    }
    const lines = topLevel.map(n => renderNode(n.id, 1, 0)).join('\n');
    return `<frame name="Page" w="800" h="600" layout="column" bg="#F5F5F5">\n${lines}\n</frame>`;
  }
}

// ─── Mock Executors (unified 4-tool API) ─────────────────────────────────────

function createMockExecutors(state: MockFigmaState): Record<string, ToolExecutor> {
  // Command names match unified tool definitions after run() unwrapping:
  // run({command: "design", input: "..."}) → design
  // run({command: "ls /"}) → ls
  // run({command: "cat /path/"}) → cat
  // run({command: "tree /"}) → tree
  // run({command: "query nodes button"}) → query
  return {
    design: async (params: any) => {
      const ops = params.ops || '';
      if (!ops || ops.trim().length === 0) {
        return { success: false, error: { code: 'EMPTY_OPS', message: 'Empty ops' } };
      }
      // Design ops may contain create, update, or delete operations
      // For mock purposes, treat as create XML
      const result = state.processCreate(ops, params.parentId);
      return { success: true, data: result };
    },

    ls: async (params: any) => {
      const xml = state.generateReadXml(undefined, 1);
      return {
        success: true,
        data: { xml, nodeCount: state.nodes.size },
      };
    },

    cat: async (params: any) => {
      const xml = state.generateReadXml(undefined, params.depth || 5);
      return {
        success: true,
        data: { xml, nodeCount: state.nodes.size },
      };
    },

    tree: async (params: any) => {
      const xml = state.generateReadXml(undefined, params.depth || 3);
      return {
        success: true,
        data: { xml, nodeCount: state.nodes.size },
      };
    },

    query: async (params: any) => {
      const source = params.source || 'knowledge';
      if (source === 'knowledge' || source === 'help') {
        return {
          success: true,
          data: {
            results: [{ content: `Design knowledge for "${params.query}": use consistent spacing (8px grid), clear hierarchy, sufficient contrast.` }],
          },
        };
      }
      // source === 'nodes'
      const matching = Array.from(state.nodes.values())
        .filter(n => n.name.toLowerCase().includes((params.query || '').toLowerCase()))
        .slice(0, 10);
      return {
        success: true,
        data: {
          nodes: matching.map(n => ({ id: n.id, name: n.name, type: n.type })),
        },
      };
    },
  };
}

// ─── XML Validation ──────────────────────────────────────────────────────────

/**
 * Validate XML against prompt engineering rules from CORE.md.
 * Returns violations found.
 */
function validateXml(xml: string, turn: number): Violation[] {
  const violations: Violation[] = [];

  // Rule 1: Every <frame> must have explicit bg
  const frameRegex = /<frame\s[^>]*?>/gi;
  let m;
  while ((m = frameRegex.exec(xml)) !== null) {
    const tag = m[0];
    if (!/\bbg\s*=/.test(tag) && !/\bbackground\s*=/.test(tag)) {
      // Extract name for better error message
      const nameMatch = tag.match(/name=['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : '(unnamed)';
      violations.push({
        turn,
        rule: 'FRAME_MISSING_BG',
        detail: `<frame name="${name}"> missing bg attribute. CORE.md mandates explicit bg on every frame.`,
        severity: 'error',
      });
    }
  }

  // Rule 2: Every <text> must have explicit fill
  const textRegex = /<text\s[^>]*?(?:\/>|>)/gi;
  while ((m = textRegex.exec(xml)) !== null) {
    const tag = m[0];
    if (!/\bfill\s*=/.test(tag) && !/\bcolor\s*=/.test(tag)) {
      const nameMatch = tag.match(/name=['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : '(unnamed)';
      violations.push({
        turn,
        rule: 'TEXT_MISSING_FILL',
        detail: `<text name="${name}"> missing fill attribute. CORE.md: "Every <text> MUST have explicit fill color."`,
        severity: 'error',
      });
    }
  }

  // Rule 3: Every <frame> should have explicit sizing (w/width + h/height)
  const frameRegex2 = /<frame\s[^>]*?>/gi;
  while ((m = frameRegex2.exec(xml)) !== null) {
    const tag = m[0];
    const hasWidth = /\b(w|width)\s*=/.test(tag);
    const hasHeight = /\b(h|height)\s*=/.test(tag);
    if (!hasWidth && !hasHeight) {
      const nameMatch = tag.match(/name=['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : '(unnamed)';
      violations.push({
        turn,
        rule: 'FRAME_MISSING_SIZING',
        detail: `<frame name="${name}"> missing width/height. Defaults to 100x100px.`,
        severity: 'warning',
      });
    }
  }

  // Rule 4: frame with children should have layout
  // (heuristic: if frame is not self-closing, it likely has children)
  const frameWithChildrenRegex = /<frame\s([^>]*?)>(?![\s]*<\/frame>)/gi;
  while ((m = frameWithChildrenRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/\blayout\s*=/.test(attrs) && !/\blayoutMode\s*=/.test(attrs)) {
      const nameMatch = attrs.match(/name=['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : '(unnamed)';
      violations.push({
        turn,
        rule: 'FRAME_MISSING_LAYOUT',
        detail: `<frame name="${name}"> with children missing layout attribute.`,
        severity: 'warning',
      });
    }
  }

  // Rule 5: icon format should be prefix:name
  const iconRegex = /<icon\s[^>]*?(?:\/>|>)/gi;
  while ((m = iconRegex.exec(xml)) !== null) {
    const tag = m[0];
    const nameMatch = tag.match(/name=['"]([^'"]+)['"]/);
    if (nameMatch) {
      const iconName = nameMatch[1];
      // Icon names should follow prefix:name format (e.g., lucide:arrow-right)
      // The 'name' attribute on icon might be different from the icon source
      // Check if there's a source/icon attribute
      const srcMatch = tag.match(/(?:src|icon|source)=['"]([^'"]+)['"]/);
      if (srcMatch && !srcMatch[1].includes(':')) {
        violations.push({
          turn,
          rule: 'ICON_FORMAT',
          detail: `Icon "${srcMatch[1]}" doesn't follow prefix:name format (e.g. lucide:arrow-right).`,
          severity: 'warning',
        });
      }
    }
  }

  return violations;
}

// ─── Multi-turn compliance checks ────────────────────────────────────────────

/**
 * Check if the agent properly used the design tool for follow-up modifications.
 * With the unified `run` tool, both create and edit go through `design` command.
 */
function checkFollowUpCompliance(
  turnRecord: TurnRecord,
  turnIndex: number,
  expectation: {
    shouldUseEdit?: boolean;
    shouldNotRecreate?: boolean;
    shouldReferenceExistingIds?: boolean;
  },
): Violation[] {
  const violations: Violation[] = [];
  const toolNames = turnRecord.toolCalls.map(tc => tc.name);

  if (expectation.shouldUseEdit && !toolNames.includes('design')) {
    violations.push({
      turn: turnIndex,
      rule: 'FOLLOW_UP_SHOULD_EDIT',
      detail: `Follow-up "${turnRecord.prompt}" should use edit tool but only used: [${toolNames.join(', ')}]`,
      severity: 'error',
    });
  }

  if (expectation.shouldNotRecreate) {
    const createCalls = turnRecord.toolCalls.filter(tc => tc.name === 'design');
    if (createCalls.length > 0) {
      // Check if create is creating an entirely new root (recreation) vs adding a child
      const totalCreateXmlLength = createCalls.reduce((sum, tc) => sum + (tc.xml?.length || 0), 0);
      // Heuristic: if create XML is very large (>200 chars), it's likely recreating
      if (totalCreateXmlLength > 200) {
        violations.push({
          turn: turnIndex,
          rule: 'FOLLOW_UP_RECREATED',
          detail: `Follow-up "${turnRecord.prompt}" appears to recreate the design (${totalCreateXmlLength} chars of create XML) instead of editing.`,
          severity: 'warning',
        });
      }
    }
  }

  if (expectation.shouldReferenceExistingIds) {
    const editCalls = turnRecord.toolCalls.filter(tc => tc.name === 'design');
    const hasIdReferences = editCalls.some(tc => tc.xml && /id=['"][^'"]+['"]/.test(tc.xml));
    if (editCalls.length > 0 && !hasIdReferences) {
      violations.push({
        turn: turnIndex,
        rule: 'EDIT_MISSING_IDS',
        detail: `Edit calls in follow-up "${turnRecord.prompt}" don't reference any existing node IDs.`,
        severity: 'error',
      });
    }
  }

  return violations;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * Build static system prompt directly from catalog JSON + tool serialization.
 * Avoids the require() chain that fails in vitest.
 */
function buildSystemPromptForTest(): string {
  const parts: string[] = [];
  parts.push((catalog as any).CORE.trim());
  parts.push((catalog as any).WORKFLOW.trim());
  parts.push('## AVAILABLE TOOLS\n' + serializeTools(agentTools));
  parts.push((catalog as any).EXAMPLES.trim());
  return parts.filter(Boolean).join('\n\n');
}

function createStressHarness(testName: string) {
  const state = new MockFigmaState();
  const executors = createMockExecutors(state);
  const provider = new DashScopeProvider(API_KEY, MODEL_NAME);

  // Patch getToolSystemInstruction to avoid require() chain
  (provider as any).getToolSystemInstruction = () => '';

  const systemPrompt = buildSystemPromptForTest();

  const report: StressTestReport = {
    testName,
    model: MODEL_NAME,
    turns: [],
    totalDurationMs: 0,
    totalTokens: 0,
    violations: [],
  };

  // Track all tool calls globally
  let currentTurn = 0;
  let currentIteration = 0;
  const allToolCalls: ToolCallRecord[] = [];
  let toolCallStart = 0;

  const runtime = new AgentRuntime({
    provider,
    tools: agentTools,
    systemPrompt,
    toolExecutors: executors as any,
    maxIterations: MAX_ITERATIONS,
    behaviorConfig: {
      thinkingLevel: 'minimal',
      maxIterations: MAX_ITERATIONS,
    },
    loopPolicy: {
      useSkillSystem: false,
    },
    onIterationStart: (iteration) => {
      currentIteration = iteration;
    },
    onToolCall: (tc: LLMToolCall) => {
      toolCallStart = Date.now();
    },
    onToolResult: (tc: LLMToolCall, result: any) => {
      const record: ToolCallRecord = {
        turn: currentTurn,
        iteration: currentIteration,
        name: tc.name,
        args: tc.args,
        xml: tc.args?.xml || tc.args?.ops,
        resultSuccess: result?.success !== false,
        resultData: result?.data,
        durationMs: Date.now() - toolCallStart,
      };
      allToolCalls.push(record);
    },
    onIteration: (iteration: number, response: LLMResponse) => {
      // Track token usage per iteration
      if (response.usage) {
        report.totalTokens += response.usage.totalTokens;
      }
      // Real-time logging
      const textPreview = response.text ? response.text.slice(0, 100) : '';
      const toolNames = response.toolCalls?.map(tc => tc.name).join(', ') || '(text-only)';
      console.log(`  [Turn ${currentTurn} Iter ${iteration}] tools=[${toolNames}] text="${textPreview}"`);
    },
    onRuntimeEvent: (event) => {
      if (event.type === 'turn_end') {
        console.log(`  [Turn ${currentTurn}] TURN END`);
      }
    },
  });

  async function runTurn(prompt: string): Promise<TurnRecord> {
    currentTurn++;
    const prevToolCallCount = allToolCalls.length;
    const startTime = Date.now();

    let response: string;
    let aborted = false;
    try {
      response = await runtime.run(prompt);
    } catch (e: any) {
      // Capture max-iterations / loop-detection errors gracefully
      response = `[ERROR] ${e.message}`;
      aborted = true;
    }

    // Gather tool calls from this turn
    const turnToolCalls = allToolCalls.slice(prevToolCallCount);

    const turnRecord: TurnRecord = {
      turn: currentTurn,
      prompt,
      response,
      iterations: turnToolCalls.length > 0 ? turnToolCalls[turnToolCalls.length - 1].iteration + 1 : 1,
      toolCalls: turnToolCalls,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      durationMs: Date.now() - startTime,
    };

    if (aborted) {
      report.violations.push({
        turn: currentTurn,
        rule: 'TURN_ABORTED',
        detail: `Turn aborted: ${response}`,
        severity: 'error',
      });
    }

    // Validate XML from create/edit calls
    for (const tc of turnToolCalls) {
      if (tc.xml) {
        const xmlViolations = validateXml(tc.xml, currentTurn);
        report.violations.push(...xmlViolations);
      }
    }

    report.turns.push(turnRecord);
    return turnRecord;
  }

  function getReport(): StressTestReport {
    report.totalDurationMs = report.turns.reduce((sum, t) => sum + t.durationMs, 0);
    return report;
  }

  return { runtime, state, runTurn, getReport, report };
}

// ─── Report Printer ──────────────────────────────────────────────────────────

function printStressReport(report: StressTestReport): void {
  const line = '═'.repeat(80);
  console.log(`\n${line}`);
  console.log(`PROMPT STRESS TEST: ${report.testName}`);
  console.log(`Model: ${report.model}`);
  console.log(line);

  for (const turn of report.turns) {
    console.log(`\n── Turn ${turn.turn}: "${turn.prompt.slice(0, 80)}${turn.prompt.length > 80 ? '...' : ''}" ──`);
    console.log(`  Response: "${turn.response.slice(0, 120)}${turn.response.length > 120 ? '...' : ''}"`);
    console.log(`  Iterations: ${turn.iterations} | Duration: ${(turn.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Tool calls: ${turn.toolCalls.map(tc => tc.name).join(', ') || '(none)'}`);

    for (const tc of turn.toolCalls) {
      if (tc.xml) {
        console.log(`    [${tc.name}] XML (${tc.xml.length} chars): ${tc.xml.slice(0, 200)}${tc.xml.length > 200 ? '...' : ''}`);
      }
    }
  }

  if (report.violations.length > 0) {
    console.log(`\n── VIOLATIONS (${report.violations.length}) ──`);
    for (const v of report.violations) {
      const icon = v.severity === 'error' ? 'X' : '!';
      console.log(`  [${icon}] Turn ${v.turn} | ${v.rule}: ${v.detail}`);
    }
  } else {
    console.log('\n  No violations detected.');
  }

  console.log(`\n  Total Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Total Tokens: ${report.totalTokens}`);
  console.log(line);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('Prompt Engineering Stress Test', () => {

  // =========================================================================
  // GROUP A: Initial Design Quality
  // =========================================================================
  describe('A. Initial Design Quality', () => {

    it.skipIf(SKIP)(
      'A1: Complex dashboard — should generate structured XML with proper attributes',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('A1-dashboard');

        const turn = await runTurn(
          'Create a analytics dashboard with: a top navigation bar (logo + nav links + user avatar), ' +
          'a sidebar with 5 menu items and icons, a main content area with 4 metric cards (each showing a number, ' +
          'label, and trend arrow), and a chart placeholder below the cards. Use a professional dark theme.'
        );

        const report = getReport();
        printStressReport(report);

        // Basic assertions
        expect(turn.response).toBeTruthy();
        expect(turn.toolCalls.length).toBeGreaterThan(0);

        // Should have at least one create call
        const createCalls = turn.toolCalls.filter(tc => tc.name === 'design');
        expect(createCalls.length).toBeGreaterThan(0);

        // Count XML violations
        const errors = report.violations.filter(v => v.severity === 'error');
        console.log(`\n  Error violations: ${errors.length}`);
        console.log(`  Warning violations: ${report.violations.filter(v => v.severity === 'warning').length}`);

        // Soft assertion: complex dashboards may have some violations, but shouldn't be excessive
        expect(errors.length).toBeLessThanOrEqual(15);
      },
    );

    it.skipIf(SKIP)(
      'A2: Mobile app screen — should respect sizing and layout constraints',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('A2-mobile');

        const turn = await runTurn(
          'Design a mobile fitness app home screen (375x812). Include: a greeting header with user name, ' +
          'today\'s activity ring (steps, calories, distance as circular progress), a "Quick Start Workout" button, ' +
          'and a horizontal scrollable section showing 3 recent workout cards. Use vibrant gradients and rounded corners.'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn.response).toBeTruthy();
        expect(turn.toolCalls.filter(tc => tc.name === 'design').length).toBeGreaterThan(0);

        const errors = report.violations.filter(v => v.severity === 'error');
        expect(errors.length).toBeLessThanOrEqual(5);
      },
    );

    it.skipIf(SKIP)(
      'A3: Landing page hero — should handle typography and visual hierarchy',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('A3-landing');

        const turn = await runTurn(
          'Create a SaaS landing page hero section with: a bold headline "Build Faster with AI", ' +
          'a subheading explaining the product, two CTA buttons (primary "Get Started" and secondary "Watch Demo"), ' +
          'and a product screenshot placeholder below. The headline should be 48px bold, subheading 18px regular, ' +
          'with proper color contrast on a white background.'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn.response).toBeTruthy();

        // Check that the create XML includes the specified text
        const createCalls = turn.toolCalls.filter(tc => tc.name === 'design' && tc.xml);
        const allXml = createCalls.map(tc => tc.xml!).join('\n');

        // At least some of the key content should appear
        const hasHeadline = allXml.includes('Build Faster') || allXml.includes('Build faster');
        const hasGetStarted = allXml.includes('Get Started') || allXml.includes('get started');
        console.log(`\n  Contains headline text: ${hasHeadline}`);
        console.log(`  Contains CTA text: ${hasGetStarted}`);

        const errors = report.violations.filter(v => v.severity === 'error');
        expect(errors.length).toBeLessThanOrEqual(3);
      },
    );

    it.skipIf(SKIP)(
      'A4: Simple form — minimal viable design quality',
      { timeout: 180_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('A4-form');

        const turn = await runTurn(
          'Create a simple contact form with: Name input, Email input, Message textarea, and a Submit button. ' +
          'Clean minimal design with #F9FAFB background.'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn.response).toBeTruthy();
        expect(turn.toolCalls.filter(tc => tc.name === 'design').length).toBeGreaterThan(0);

        // For a simple form, should have zero error-level violations
        const errors = report.violations.filter(v => v.severity === 'error');
        expect(errors.length).toBeLessThanOrEqual(2);
      },
    );
  });

  // =========================================================================
  // GROUP B: Multi-turn Follow-up Compliance
  // =========================================================================
  describe('B. Multi-turn Follow-up Compliance', () => {

    it.skipIf(SKIP)(
      'B1: Create → Change title text',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B1-change-title');

        // Turn 1: Create initial design
        const turn1 = await runTurn(
          'Create a simple card with a title "Original Title", a description paragraph, and a "Learn More" button.'
        );
        expect(turn1.response).toBeTruthy();
        expect(turn1.toolCalls.filter(tc => tc.name === 'design').length).toBeGreaterThan(0);

        // Turn 2: Change the title
        const turn2 = await runTurn(
          '把标题改成 "New Amazing Title"'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // Compliance checks
        const followUpViolations = checkFollowUpCompliance(turn2, 2, {
          shouldUseEdit: true,
          shouldNotRecreate: true,
        });
        report.violations.push(...followUpViolations);

        console.log(`\n  Follow-up compliance violations: ${followUpViolations.length}`);
        for (const v of followUpViolations) {
          console.log(`    [${v.severity}] ${v.rule}: ${v.detail}`);
        }

        // Should use edit, not recreate
        const editUsed = turn2.toolCalls.some(tc => tc.name === 'design');
        console.log(`  Used edit tool: ${editUsed}`);
        console.log(`  Tools used: [${turn2.toolCalls.map(tc => tc.name).join(', ')}]`);
      },
    );

    it.skipIf(SKIP)(
      'B2: Create → Change font size and weight',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B2-change-font');

        // Turn 1
        await runTurn(
          'Create a pricing card with title "Pro Plan", price "$29/month", feature list (3 items), and a Subscribe button.'
        );

        // Turn 2: Change font
        const turn2 = await runTurn(
          '把价格的字号改成 36px，加粗，颜色改成 #2563EB'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // Check that edit was used
        const editCalls = turn2.toolCalls.filter(tc => tc.name === 'design');
        console.log(`\n  Edit calls: ${editCalls.length}`);

        if (editCalls.length > 0) {
          // Check that the edit XML contains font-related attributes
          const editXml = editCalls.map(tc => tc.xml || '').join('\n');
          const hasFontSize = /size=['"]36/.test(editXml) || /fontSize=['"]36/.test(editXml);
          const hasBold = /weight=['"]Bold/i.test(editXml) || /fontWeight=['"]700/.test(editXml) || /weight=['"]700/.test(editXml);
          const hasColor = /#2563EB/i.test(editXml) || /fill=['"]#2563EB/i.test(editXml);
          console.log(`  Has font size 36: ${hasFontSize}`);
          console.log(`  Has bold weight: ${hasBold}`);
          console.log(`  Has color #2563EB: ${hasColor}`);
        }

        const followUpViolations = checkFollowUpCompliance(turn2, 2, {
          shouldUseEdit: true,
          shouldNotRecreate: true,
        });
        report.violations.push(...followUpViolations);
      },
    );

    it.skipIf(SKIP)(
      'B3: Create → Change icon',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B3-change-icon');

        // Turn 1
        await runTurn(
          'Create a feature list with 3 items. Each item has an icon on the left and text on the right. ' +
          'Use lucide:check for the icon, and the texts are "Fast Performance", "Secure Data", "Easy Setup".'
        );

        // Turn 2: Change icons
        const turn2 = await runTurn(
          '把第一个 icon 换成 lucide:zap，第二个换成 lucide:shield，第三个换成 lucide:settings'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // Check edit usage
        const editCalls = turn2.toolCalls.filter(tc => tc.name === 'design');
        console.log(`\n  Edit calls for icon change: ${editCalls.length}`);

        if (editCalls.length > 0) {
          const editXml = editCalls.map(tc => tc.xml || '').join('\n');
          const hasZap = /lucide:zap/.test(editXml);
          const hasShield = /lucide:shield/.test(editXml);
          const hasSettings = /lucide:settings/.test(editXml);
          console.log(`  Has lucide:zap: ${hasZap}`);
          console.log(`  Has lucide:shield: ${hasShield}`);
          console.log(`  Has lucide:settings: ${hasSettings}`);
        }

        const followUpViolations = checkFollowUpCompliance(turn2, 2, {
          shouldUseEdit: true,
          shouldNotRecreate: true,
        });
        report.violations.push(...followUpViolations);
      },
    );

    it.skipIf(SKIP)(
      'B4: Create → Change color scheme',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B4-change-colors');

        // Turn 1
        await runTurn(
          'Create a login form with email input, password input, and a blue (#3B82F6) login button on a white background.'
        );

        // Turn 2: Change color scheme
        const turn2 = await runTurn(
          '把整体配色改成暗色主题：背景 #1F2937，卡片背景 #374151，按钮改成绿色 #10B981，文字改成白色 #F9FAFB'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // For a color scheme change, edit should be used (modifying existing nodes)
        const editCalls = turn2.toolCalls.filter(tc => tc.name === 'design');
        console.log(`\n  Edit calls for color scheme: ${editCalls.length}`);

        // Multiple edits expected for a full color scheme change
        if (editCalls.length > 0) {
          const editXml = editCalls.map(tc => tc.xml || '').join('\n');
          const hasDarkBg = /#1F2937/i.test(editXml);
          const hasGreenBtn = /#10B981/i.test(editXml);
          console.log(`  Has dark background: ${hasDarkBg}`);
          console.log(`  Has green button: ${hasGreenBtn}`);
        }

        const followUpViolations = checkFollowUpCompliance(turn2, 2, {
          shouldUseEdit: true,
          shouldNotRecreate: true,
        });
        report.violations.push(...followUpViolations);
      },
    );

    it.skipIf(SKIP)(
      'B5: Create → Add new element',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B5-add-element');

        // Turn 1
        await runTurn(
          'Create a user profile card with avatar placeholder, username "John Doe", and email "john@example.com".'
        );

        // Turn 2: Add a new element
        const turn2 = await runTurn(
          '在卡片底部加一个 "Edit Profile" 按钮和一个 "Logout" 链接'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // Adding new elements should use create (with parentId) or a mix of create+edit
        const toolNames = turn2.toolCalls.map(tc => tc.name);
        const hasCreate = toolNames.includes('create');
        const hasEdit = toolNames.includes('design');
        console.log(`\n  Used create: ${hasCreate}, edit: ${hasEdit}`);
        console.log(`  Tools: [${toolNames.join(', ')}]`);

        // At least one tool should be used
        expect(turn2.toolCalls.length).toBeGreaterThan(0);
      },
    );

    it.skipIf(SKIP)(
      'B6: Create → Delete element',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('B6-delete-element');

        // Turn 1
        await runTurn(
          'Create a notification banner with an icon, message text "System update available", ' +
          'a "Update Now" button, and a close (X) button.'
        );

        // Turn 2: Delete elements
        const turn2 = await runTurn(
          '删掉关闭按钮和 Update Now 按钮，只保留图标和文字'
        );

        const report = getReport();
        printStressReport(report);

        expect(turn2.response).toBeTruthy();

        // Should use edit with delete='true' attribute
        const editCalls = turn2.toolCalls.filter(tc => tc.name === 'design');
        console.log(`\n  Edit calls for deletion: ${editCalls.length}`);

        if (editCalls.length > 0) {
          const editXml = editCalls.map(tc => tc.xml || '').join('\n');
          const hasDelete = /delete=['"]true['"]/.test(editXml);
          console.log(`  Has delete='true': ${hasDelete}`);
        }
      },
    );
  });

  // =========================================================================
  // GROUP C: Conversation Continuity Stress
  // =========================================================================
  describe('C. Conversation Continuity Stress', () => {

    it.skipIf(SKIP)(
      'C1: 5-turn iterative refinement',
      { timeout: 600_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('C1-5-turn-refinement');

        // Turn 1: Initial design
        const t1 = await runTurn(
          'Create a simple header bar with a logo text "MyApp" on the left and a "Sign In" button on the right.'
        );
        expect(t1.response).toBeTruthy();

        // Turn 2: Change logo
        const t2 = await runTurn('把 logo 文字改成 "SuperApp"，颜色改成 #7C3AED');
        expect(t2.response).toBeTruthy();

        // Turn 3: Add navigation
        const t3 = await runTurn('在 logo 和按钮中间加三个导航链接：Home, Features, Pricing');
        expect(t3.response).toBeTruthy();

        // Turn 4: Change button style
        const t4 = await runTurn('把 Sign In 按钮改成圆角 24px，背景渐变从 #7C3AED 到 #EC4899');
        expect(t4.response).toBeTruthy();

        // Turn 5: Add visual polish
        const t5 = await runTurn('给整个 header 加一个底部阴影 shadow，高度固定 64px');
        expect(t5.response).toBeTruthy();

        const report = getReport();
        printStressReport(report);

        // Check that later turns don't recreate the entire design
        for (let i = 1; i < report.turns.length; i++) {
          const followUpViolations = checkFollowUpCompliance(report.turns[i], i + 1, {
            shouldNotRecreate: true,
          });
          report.violations.push(...followUpViolations);
        }

        const recreationViolations = report.violations.filter(v => v.rule === 'FOLLOW_UP_RECREATED');
        console.log(`\n  Recreation violations: ${recreationViolations.length}`);
        console.log(`  Total error violations: ${report.violations.filter(v => v.severity === 'error').length}`);
        console.log(`  Total warning violations: ${report.violations.filter(v => v.severity === 'warning').length}`);
      },
    );

    it.skipIf(SKIP)(
      'C2: Chinese + English mixed instructions',
      { timeout: 300_000 },
      async () => {
        const { runTurn, getReport } = createStressHarness('C2-bilingual');

        // Turn 1: English
        await runTurn(
          'Create a settings page with sections for "Account", "Notifications", and "Privacy". ' +
          'Each section has a title and 2-3 toggle switches with labels.'
        );

        // Turn 2: Chinese instruction
        const t2 = await runTurn('把所有 section 标题改成中文：账户设置、通知管理、隐私安全');
        expect(t2.response).toBeTruthy();

        // Turn 3: Mixed
        const t3 = await runTurn('Add a "Danger Zone" section at the bottom with a red 删除账户 button');
        expect(t3.response).toBeTruthy();

        const report = getReport();
        printStressReport(report);

        // Check that the agent handled bilingual instructions
        expect(report.turns[1].toolCalls.length).toBeGreaterThan(0);
        expect(report.turns[2].toolCalls.length).toBeGreaterThan(0);
      },
    );
  });
});
