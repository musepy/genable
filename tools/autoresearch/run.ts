#!/usr/bin/env npx tsx
/**
 * Autoresearch Runner — automated prompt quality benchmarking.
 *
 * Runs a suite of test prompts through the dev bridge, evaluates each result,
 * and produces a benchmark report with aggregate scores.
 *
 * Usage:
 *   npx tsx tools/autoresearch/run.ts                    # Run all prompts
 *   npx tsx tools/autoresearch/run.ts --prompts login    # Run specific prompt
 *   npx tsx tools/autoresearch/run.ts --save baseline    # Save as named baseline
 *   npx tsx tools/autoresearch/run.ts --compare baseline # Compare against baseline
 *   npx tsx tools/autoresearch/run.ts --build            # Build before running
 *
 * Requires:
 *   - Dev bridge server running (auto-starts if not)
 *   - Figma desktop with plugin loaded and connected
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, type EvalResult } from './evaluate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_URL = `http://localhost:${process.env.PORT || 3456}`;
const BRIDGE_DIR = process.env.BRIDGE_DIR || '/tmp/figma-bridge';
const DATA_DIR = join(__dirname, 'data');
const WAIT_SEC = 180; // 3 min per prompt

// ─── Types ───────────────────────────────────────────────────────

interface TestPrompt {
  id: string;
  prompt: string;
  expectedMinNodes: number;
  tags: string[];
}

interface BenchmarkResult {
  timestamp: string;
  gitCommit: string;
  gitBranch: string;
  model: string;
  results: Array<{
    promptId: string;
    eval: EvalResult;
  }>;
  aggregate: {
    meanScore: number;
    minScore: number;
    maxScore: number;
    totalDurationSec: number;
    totalNodes: number;
    totalIssues: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function triggerPrompt(prompt: string, reset: boolean): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, reset }),
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Trigger failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function waitForResult(triggerId: string): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/result/${triggerId}?wait=${WAIT_SEC}`);
  const data = await res.json() as any;
  if (data.status === 'pending') {
    throw new Error(`Timed out after ${WAIT_SEC}s for ${triggerId}`);
  }
  // Return the result directory path
  const sanitized = triggerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(BRIDGE_DIR, 'results', sanitized);
}

async function getGitInfo(): Promise<{ commit: string; branch: string }> {
  const { execSync } = await import('node:child_process');
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

async function loadBaseline(name: string): Promise<BenchmarkResult | null> {
  try {
    const raw = await readFile(join(DATA_DIR, `${name}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doBuild = args.includes('--build');
  const saveName = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;
  const compareName = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;
  const promptFilter = args.includes('--prompts') ? args[args.indexOf('--prompts') + 1]?.split(',') : null;

  // Load test prompts
  const promptsRaw = await readFile(join(__dirname, 'prompts.json'), 'utf-8');
  const { prompts: allPrompts } = JSON.parse(promptsRaw) as { prompts: TestPrompt[] };
  const prompts = promptFilter
    ? allPrompts.filter(p => promptFilter.includes(p.id))
    : allPrompts;

  if (prompts.length === 0) {
    console.error('No matching prompts found');
    process.exit(1);
  }

  // Check dev bridge
  if (!await checkHealth()) {
    console.error('Dev bridge not running. Start it: npx tsx tools/dev-bridge/server.ts');
    process.exit(1);
  }
  console.log('✓ Dev bridge connected\n');

  // Build if requested
  if (doBuild) {
    console.log('Building plugin...');
    const { execSync } = await import('node:child_process');
    execSync('node build.js', { stdio: 'inherit' });
    console.log('✓ Build complete\n');
    // Wait for Figma to reload
    await sleep(3000);
  }

  const git = await getGitInfo();
  console.log(`Git: ${git.branch} @ ${git.commit}`);
  console.log(`Running ${prompts.length} test prompts...\n`);

  // Run each prompt
  const results: Array<{ promptId: string; eval: EvalResult }> = [];

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const label = `[${i + 1}/${prompts.length}] ${p.id}`;
    console.log(`${label}: triggering...`);

    try {
      // Reset session before each prompt for isolation
      const triggerId = await triggerPrompt(p.prompt, true);
      console.log(`${label}: waiting for result (${triggerId})...`);

      const resultDir = await waitForResult(triggerId);
      const evalResult = await evaluate(resultDir);
      results.push({ promptId: p.id, eval: evalResult });

      const scoreStr = evalResult.score.toFixed(1).padStart(5);
      const nodeStr = String(evalResult.metrics.nodeCount).padStart(3);
      const durStr = evalResult.metrics.durationSec.toFixed(1).padStart(5);
      console.log(`${label}: score=${scoreStr}  nodes=${nodeStr}  dur=${durStr}s  issues=${evalResult.issues.length}`);

      // Brief pause between prompts
      if (i < prompts.length - 1) await sleep(2000);
    } catch (err: any) {
      console.error(`${label}: FAILED — ${err.message}`);
      results.push({
        promptId: p.id,
        eval: {
          triggerId: 'error',
          model: 'unknown',
          metrics: {
            layoutCompleteness: 0, fillCompleteness: 0, textCompleteness: 0,
            sizingCompleteness: 0, spacingCompleteness: 0, toolEfficiency: 0,
            errorFreeRate: 0, nodeCount: 0, maxDepth: 0, durationSec: 0,
          },
          score: 0,
          issues: [err.message],
        },
      });
    }
  }

  // Aggregate
  const scores = results.map(r => r.eval.score);
  const aggregate = {
    meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    totalDurationSec: results.reduce((a, r) => a + r.eval.metrics.durationSec, 0),
    totalNodes: results.reduce((a, r) => a + r.eval.metrics.nodeCount, 0),
    totalIssues: results.reduce((a, r) => a + r.eval.issues.length, 0),
  };

  const benchmark: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    gitCommit: git.commit,
    gitBranch: git.branch,
    model: results[0]?.eval.model ?? 'unknown',
    results,
    aggregate,
  };

  // Print report
  console.log('\n' + '═'.repeat(60));
  console.log('  BENCHMARK REPORT');
  console.log('═'.repeat(60));
  console.log(`  Mean Score:  ${aggregate.meanScore.toFixed(1)} / 100`);
  console.log(`  Range:       ${aggregate.minScore.toFixed(1)} — ${aggregate.maxScore.toFixed(1)}`);
  console.log(`  Total Time:  ${aggregate.totalDurationSec.toFixed(1)}s`);
  console.log(`  Total Nodes: ${aggregate.totalNodes}`);
  console.log(`  Total Issues: ${aggregate.totalIssues}`);
  console.log('─'.repeat(60));

  // Per-prompt breakdown
  for (const r of results) {
    const m = r.eval.metrics;
    console.log(
      `  ${r.promptId.padEnd(12)} ` +
      `score:${r.eval.score.toFixed(1).padStart(5)}  ` +
      `layout:${(m.layoutCompleteness * 100).toFixed(0).padStart(3)}%  ` +
      `text:${(m.textCompleteness * 100).toFixed(0).padStart(3)}%  ` +
      `sizing:${(m.sizingCompleteness * 100).toFixed(0).padStart(3)}%`
    );
  }
  console.log('═'.repeat(60));

  // Compare against baseline
  if (compareName) {
    const baseline = await loadBaseline(compareName);
    if (baseline) {
      const diff = aggregate.meanScore - baseline.aggregate.meanScore;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      console.log(`\n  vs "${compareName}" baseline:`);
      console.log(`  Mean Score: ${baseline.aggregate.meanScore.toFixed(1)} → ${aggregate.meanScore.toFixed(1)} (${arrow} ${Math.abs(diff).toFixed(1)})`);
      console.log(`  Issues:     ${baseline.aggregate.totalIssues} → ${aggregate.totalIssues}`);

      // Per-prompt comparison
      for (const r of results) {
        const baseResult = baseline.results.find(b => b.promptId === r.promptId);
        if (baseResult) {
          const d = r.eval.score - baseResult.eval.score;
          const a = d > 0 ? '↑' : d < 0 ? '↓' : '→';
          console.log(`    ${r.promptId.padEnd(12)} ${baseResult.eval.score.toFixed(1)} → ${r.eval.score.toFixed(1)} (${a} ${Math.abs(d).toFixed(1)})`);
        }
      }
    } else {
      console.log(`\n  Baseline "${compareName}" not found. Save one first with --save.`);
    }
  }

  // Save baseline
  if (saveName) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(join(DATA_DIR, `${saveName}.json`), JSON.stringify(benchmark, null, 2));
    console.log(`\n  ✓ Saved as baseline "${saveName}"`);
  }

  // Always save latest
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, 'latest.json'), JSON.stringify(benchmark, null, 2));
  console.log(`  ✓ Saved as "latest"\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
