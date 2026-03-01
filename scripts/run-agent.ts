/**
 * @file run-agent.ts
 * @description CLI entry point for headless agent runner.
 *
 * Runs the AgentRuntime with a real Gemini API + virtual Figma layer,
 * outputs structured JSON report for coding agent consumption.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx npx tsx --require ./scripts/shims/mock-figma.cjs scripts/run-agent.ts "design a login form"
 *   GEMINI_API_KEY=xxx npx tsx --require ./scripts/shims/mock-figma.cjs scripts/run-agent.ts --prompt "design a dashboard" --model gemini-2.5-pro --max-iters 20
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgentRuntime } from '../src/engine/agent/agentRuntime';
import { GeminiProvider } from '../src/engine/llm-client/providers/gemini';
import { agentTools } from '../src/engine/agent/tools';
import { LLMResponse, LLMToolCall } from '../src/engine/llm-client/providers/types';

import { VirtualFigmaContext } from '../src/engine/agent/headless/VirtualFigmaContext';
import { TelemetryCollector } from '../src/engine/agent/headless/TelemetryCollector';
import { createHeadlessExecutors } from '../src/engine/agent/headless/HeadlessExecutors';
import { HeadlessRunConfig, HeadlessReport } from '../src/engine/agent/headless/types';

// ---------------------------------------------------------------------------
// OAuth token helper
// ---------------------------------------------------------------------------

function loadGeminiOAuthToken(): string {
  const oauthPath = path.join(process.env.HOME || '~', '.gemini', 'oauth_creds.json');
  try {
    const data = JSON.parse(fs.readFileSync(oauthPath, 'utf-8'));
    if (!data.access_token) {
      throw new Error('No access_token found in oauth_creds.json');
    }
    // Check expiry (rough - token might need refresh)
    if (data.expiry_date && Date.now() > data.expiry_date) {
      console.warn('[OAuth] Warning: access token may be expired. Run `gemini` once to refresh.');
    }
    return data.access_token;
  } catch (err: any) {
    console.error(`ERROR: Could not load OAuth credentials from ${oauthPath}: ${err.message}`);
    console.error('Make sure Gemini CLI is installed and authenticated: gemini --version');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): HeadlessRunConfig & { authMode: 'apikey' | 'oauth'; accessToken?: string } {
  const args = process.argv.slice(2);
  let prompt = '';
  let modelName = 'gemini-2.5-pro';
  let maxIterations = 30;
  let outputPath = '.agent-runs/latest.json';
  let verbose = false;
  let useSkillSystem = true;
  let designStrategy: 'create' | 'refine' = 'create';
  let authMode: 'apikey' | 'oauth' = 'apikey';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--prompt' && args[i + 1]) {
      prompt = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      modelName = args[++i];
    } else if (arg === '--max-iters' && args[i + 1]) {
      maxIterations = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--no-skills') {
      useSkillSystem = false;
    } else if (arg === '--refine') {
      designStrategy = 'refine';
    } else if (arg === '--auth' && args[i + 1]) {
      authMode = args[++i] as 'apikey' | 'oauth';
    } else if (!arg.startsWith('--') && !prompt) {
      prompt = arg;
    }
  }

  if (!prompt) {
    console.error('Usage: npx tsx --require ./scripts/shims/mock-figma.cjs scripts/run-agent.ts "your prompt"');
    console.error('Options:');
    console.error('  --prompt "..."      Design prompt');
    console.error('  --model NAME        Model name (default: gemini-2.5-pro)');
    console.error('  --max-iters N       Max iterations (default: 30)');
    console.error('  --output PATH       Output JSON path (default: .agent-runs/latest.json)');
    console.error('  --verbose           Print progress to stdout');
    console.error('  --no-skills         Disable skill system');
    console.error('  --refine            Use refine strategy instead of create');
    console.error('  --auth MODE         Auth mode: apikey (default) or oauth (uses Gemini CLI creds)');
    process.exit(1);
  }

  let apiKey = '';
  let accessToken: string | undefined;

  if (authMode === 'oauth') {
    accessToken = loadGeminiOAuthToken();
    apiKey = 'oauth-mode'; // placeholder
    console.log('[Auth] Using Gemini CLI OAuth credentials');
  } else {
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      console.error('ERROR: GEMINI_API_KEY environment variable is required (or use --auth oauth)');
      process.exit(1);
    }
  }

  return { prompt, apiKey, modelName, maxIterations, outputPath, verbose, useSkillSystem, designStrategy, authMode, accessToken };
}

// ---------------------------------------------------------------------------
// Report printer (human-readable summary)
// ---------------------------------------------------------------------------

function printSummary(report: HeadlessReport): void {
  const line = '='.repeat(80);
  console.log(`\n${line}`);
  console.log('HEADLESS AGENT RUN REPORT');
  console.log(line);
  console.log(`Model: ${report.modelName}`);
  console.log(`Prompt: "${report.prompt}"`);
  console.log(`Success: ${report.success}`);
  console.log(`Total Iterations: ${report.totalIterations}`);
  console.log(`Total Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Total Tokens: ${report.totalTokens.total} (prompt: ${report.totalTokens.prompt}, completion: ${report.totalTokens.completion})`);

  console.log('\n--- Phase Breakdown ---');
  for (const [phase, data] of Object.entries(report.phaseBreakdown).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${phase.padEnd(20)} ${String(data.iterations).padStart(3)} iters  ${(data.durationMs / 1000).toFixed(1).padStart(7)}s  ${String(data.tokens).padStart(8)} tokens`);
  }

  console.log('\n--- Milestones ---');
  console.log(`  generateDesign at iteration:  ${report.milestones.generateDesignIteration ?? 'NEVER'}`);
  console.log(`  Verification entered at:      ${report.milestones.verificationEntryIteration ?? 'NEVER'}`);
  console.log(`  Post-generate iterations:     ${report.milestones.postGenerateIterations}`);

  console.log('\n--- Virtual Figma ---');
  console.log(`  Nodes created: ${report.nodeCount}`);
  console.log(`  Root node: ${report.rootNodeId || 'none'}`);

  if (report.anomalies.length > 0) {
    console.log(`\n--- Anomalies ---`);
    for (const a of report.anomalies) console.log(`  ${a}`);
  }
  if (report.errors.length > 0) {
    console.log(`\n--- Errors ---`);
    for (const e of report.errors) console.log(`  [iter ${e.iteration}] ${e.message}`);
  }

  console.log(`\n--- Tool Usage ---`);
  for (const [tool, data] of Object.entries(report.toolUsage).sort((a, b) => b[1].callCount - a[1].callCount)) {
    console.log(`  ${tool.padEnd(25)} ${String(data.callCount).padStart(3)}x  ${data.failureCount > 0 ? `(${data.failureCount} failed)` : ''}`);
  }

  console.log(`\nJSON report: ${report.config.outputPath}`);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgs();

  console.log(`\n[Headless Runner] Starting...`);
  console.log(`  Prompt:     "${config.prompt}"`);
  console.log(`  Model:      ${config.modelName}`);
  console.log(`  Max iters:  ${config.maxIterations}`);
  console.log(`  Output:     ${config.outputPath}`);
  console.log('');

  // Initialize dependencies
  const ctx = new VirtualFigmaContext();
  const telemetry = new TelemetryCollector();
  const executors = createHeadlessExecutors(ctx, telemetry);
  const provider = new GeminiProvider(config.apiKey, config.modelName,
    config.accessToken ? { accessToken: config.accessToken, vertexProject: 'gen-lang-client-0675319305', vertexLocation: 'us-central1' } : undefined
  );

  // Patch getToolSystemInstruction to avoid require() issues in CLI context
  (provider as any).getToolSystemInstruction = (_tools: any[]) => {
    try {
      const { TOOL_CALLING_PROTOCOL } = require('../src/engine/prompt/promptRegistry');
      return TOOL_CALLING_PROTOCOL;
    } catch {
      return 'Tool Calling Rules:\n- Always provide all required parameters.\n- Use generateDesign for one-shot creation.\n- Use inspectDesign for verification.\n- Call complete_task when done.';
    }
  };

  // Create AgentRuntime
  const runtime = new AgentRuntime({
    provider,
    tools: agentTools,
    toolExecutors: executors as any,
    maxIterations: config.maxIterations,
    behaviorConfig: {
      designStrategy: config.designStrategy,
      visualQuality: 'rich',
      thinkingLevel: 'minimal',
      maxIterations: config.maxIterations,
    },
    loopPolicy: {
      useSkillSystem: config.useSkillSystem,
      verificationFixLimit: 3,
    },

    onIterationStart: (iteration: number) => {
      telemetry.startIteration(iteration);
      if (config.verbose) {
        process.stdout.write(`  [iter ${iteration}] `);
      }
    },

    onIteration: (iteration: number, response: LLMResponse) => {
      telemetry.endIteration(response);
      if (config.verbose) {
        const tokens = response.usage?.totalTokens || '?';
        process.stdout.write(`${tokens} tokens\n`);
      }
    },

    onToolCall: (toolCall: LLMToolCall) => {
      telemetry.startToolCall(toolCall);
      if (config.verbose) {
        process.stdout.write(`${toolCall.name} `);
      }
    },

    onToolResult: (toolCall: LLMToolCall, result: any) => {
      telemetry.endToolCall(toolCall, result);
    },

    onThinking: (thought: string) => {
      telemetry.recordThinking(thought);
    },

    onProgress: (step: string) => {
      if (config.verbose) {
        process.stdout.write(`[progress: ${step}] `);
      }
    },
  });

  // Run the agent
  telemetry.startRun(config.prompt, config);
  let finalResult = '';
  let success = false;

  try {
    finalResult = await runtime.run(config.prompt);
    success = true;
  } catch (error: any) {
    finalResult = `ERROR: ${error.message}`;
    telemetry.recordError(error.message);
    console.error(`\n[Headless Runner] Agent error: ${error.message}`);
  }

  // Build and write report
  const report = telemetry.buildReport(ctx, finalResult, success);

  const outputDir = path.dirname(config.outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(config.outputPath, JSON.stringify(report, null, 2));

  printSummary(report);
}

main().catch((err) => {
  console.error('[Headless Runner] Fatal error:', err);
  process.exit(1);
});
