#!/usr/bin/env npx tsx
/**
 * Autoresearch Engine — autonomous prompt evolution via oracle-guided LLM.
 *
 * Loop: read scores → identify weakness → LLM proposes edit → apply to CORE.md
 *       → build → benchmark → keep/revert → log → repeat.
 *
 * Usage:
 *   npx tsx tools/autoresearch/engine.ts                     # Run until stopped
 *   npx tsx tools/autoresearch/engine.ts --rounds 10         # Run N rounds
 *   npx tsx tools/autoresearch/engine.ts --calibrate         # Run baseline 3x to measure variance
 *   npx tsx tools/autoresearch/engine.ts --resume            # Resume from last checkpoint
 *
 * Env:
 *   LLM_API_KEY         — API key for the analysis LLM (required)
 *   LLM_BASE_URL        — OpenAI-compatible API base (default: https://coding.dashscope.aliyuncs.com/v1)
 *   ANALYSIS_MODEL      — model for prompt analysis (default: kimi-k2.5, alt: glm-4-plus)
 *   PORT                — dev bridge port (default 3456)
 *
 * Requires:
 *   - Dev bridge server running
 *   - Figma desktop with plugin loaded and connected
 */

import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Config ──────────────────────────────────────────────────────

const EXPERIMENTS_DIR = join(__dirname, 'experiments');
const DATA_DIR = join(__dirname, 'data');
const CORE_MD_PATH = join(__dirname, '..', '..', 'src', 'prompts', 'CORE.md');
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'kimi-k2.5';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1';
const KEEP_THRESHOLD = 2.0;      // target dimension must improve by ≥ this
const REGRESS_THRESHOLD = 2.0;   // other dimensions must not drop by ≥ this
const CHECKPOINT_INTERVAL = 10;  // pause every N rounds for human review
const MAX_ROUNDS = 100;          // safety limit

// ─── Types ───────────────────────────────────────────────────────

interface PromptEdit {
  op: 'add_rule' | 'modify_rule' | 'remove_rule';
  section: string;       // markdown ## header text
  rule?: string;         // for add_rule
  old_pattern?: string;  // for modify_rule / remove_rule
  new_rule?: string;     // for modify_rule
}

interface AnalysisResult {
  target_dimension: string;
  hypothesis: string;
  edits: PromptEdit[];
  reasoning: string;
}

interface ExperimentLog {
  round: number;
  timestamp: string;
  target_dimension: string;
  hypothesis: string;
  edits: PromptEdit[];
  baseline_scores: Record<string, number>;
  result_scores: Record<string, number>;
  deltas: Record<string, number>;
  decision: 'KEEP' | 'REVERT' | 'BUILD_FAIL' | 'INVALID_EDIT' | 'BENCHMARK_FAIL';
  reasoning: string;
  prompt_diff?: string;
}

// ─── LLM Client ─────────────────────────────────────────────────

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!LLM_API_KEY) {
    throw new Error('LLM_API_KEY is required. Set it in your environment.');
  }

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'User-Agent': 'claude-cli/2.0.57 (external, cli)',
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
}

// ─── Score Extraction ───────────────────────────────────────────

interface BenchmarkResult {
  results: Array<{
    promptId: string;
    eval: {
      metrics: Record<string, number>;
      score: number;
      issues: string[];
    };
  }>;
  aggregate: {
    meanScore: number;
  };
}

/** Extract per-dimension average scores from benchmark results (excludes failed prompts with score=0) */
function extractDimensionScores(benchmark: BenchmarkResult): Record<string, number> {
  const dims = [
    'layoutCompleteness', 'fillCompleteness', 'textCompleteness',
    'sizingCompleteness', 'spacingCompleteness', 'toolEfficiency', 'errorFreeRate',
  ];

  // Filter out failed prompts (score=0) and timeouts (nodes=0) to avoid skewing results
  const validResults = benchmark.results.filter(r => r.eval.score > 0 && r.eval.metrics.nodeCount > 0);
  if (validResults.length === 0) return Object.fromEntries(dims.map(d => [d, 0]));

  const scores: Record<string, number> = {};
  for (const dim of dims) {
    const values = validResults
      .map(r => r.eval.metrics[dim])
      .filter(v => typeof v === 'number');
    scores[dim] = values.length > 0
      ? (values.reduce((a, b) => a + b, 0) / values.length) * 100
      : 0;
  }
  // Recompute composite from valid results only
  const validScores = validResults.map(r => r.eval.score);
  scores['composite'] = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  return scores;
}

// Process metrics — not design quality, excluded from keep/revert regression checks
const PROCESS_METRICS = new Set(['toolEfficiency', 'errorFreeRate', 'composite']);

/** Find the weakest dimensions (lowest scores, excluding process metrics) */
function findWeakestDimensions(scores: Record<string, number>, n: number = 2): string[] {
  return Object.entries(scores)
    .filter(([k]) => !PROCESS_METRICS.has(k))
    .sort(([, a], [, b]) => a - b)
    .slice(0, n)
    .map(([k]) => k);
}

/** Collect top issues from benchmark for a specific dimension */
function collectIssues(benchmark: BenchmarkResult, dimension: string): string[] {
  const dimKeywords: Record<string, string[]> = {
    layoutCompleteness: ['layout', 'auto-layout', 'layoutMode'],
    fillCompleteness: ['fill', 'background', 'transparent'],
    textCompleteness: ['font', 'fontSize', 'fontName', 'text'],
    sizingCompleteness: ['sizing', 'layoutSizing', 'FILL', 'HUG'],
    spacingCompleteness: ['spacing', 'padding', 'itemSpacing', 'gap'],
  };

  const keywords = dimKeywords[dimension] || [];
  const issues: string[] = [];

  for (const r of benchmark.results) {
    for (const issue of r.eval.issues) {
      if (keywords.some(kw => issue.toLowerCase().includes(kw.toLowerCase()))) {
        issues.push(`[${r.promptId}] ${issue}`);
      }
    }
  }

  return issues.slice(0, 15); // cap at 15 most relevant
}

// ─── CORE.md Section Operations ─────────────────────────────────

function parseSections(content: string): Map<string, { start: number; end: number }> {
  const lines = content.split('\n');
  const sections = new Map<string, { start: number; end: number }>();
  let currentHeader: string | null = null;
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{2,3})\s+(.+)/);
    if (match) {
      if (currentHeader !== null) {
        sections.set(currentHeader, { start: currentStart, end: i });
      }
      currentHeader = match[2].trim();
      currentStart = i;
    }
  }
  if (currentHeader !== null) {
    sections.set(currentHeader, { start: currentStart, end: lines.length });
  }

  return sections;
}

function applyEdits(content: string, edits: PromptEdit[]): { content: string; applied: number; errors: string[] } {
  let result = content;
  let applied = 0;
  const errors: string[] = [];

  for (const edit of edits) {
    const sections = parseSections(result);
    const section = sections.get(edit.section);

    if (!section) {
      errors.push(`Section not found: "${edit.section}"`);
      continue;
    }

    const lines = result.split('\n');
    const sectionContent = lines.slice(section.start, section.end).join('\n');

    switch (edit.op) {
      case 'add_rule': {
        if (!edit.rule) { errors.push('add_rule missing rule'); continue; }
        // Insert rule before section end
        lines.splice(section.end, 0, `- ${edit.rule}`);
        result = lines.join('\n');
        applied++;
        break;
      }
      case 'modify_rule': {
        if (!edit.old_pattern || !edit.new_rule) {
          errors.push('modify_rule missing old_pattern or new_rule');
          continue;
        }
        const idx = sectionContent.indexOf(edit.old_pattern);
        if (idx === -1) {
          errors.push(`old_pattern not found in "${edit.section}": "${edit.old_pattern.slice(0, 50)}..."`);
          continue;
        }
        // Check uniqueness
        const secondIdx = sectionContent.indexOf(edit.old_pattern, idx + 1);
        if (secondIdx !== -1) {
          errors.push(`old_pattern matches multiple locations in "${edit.section}"`);
          continue;
        }
        result = result.replace(edit.old_pattern, edit.new_rule);
        applied++;
        break;
      }
      case 'remove_rule': {
        if (!edit.old_pattern) { errors.push('remove_rule missing old_pattern'); continue; }
        const removeIdx = sectionContent.indexOf(edit.old_pattern);
        if (removeIdx === -1) {
          errors.push(`Pattern not found for removal in "${edit.section}": "${edit.old_pattern.slice(0, 50)}..."`);
          continue;
        }
        result = result.replace(edit.old_pattern, '');
        // Clean up double blank lines
        result = result.replace(/\n{3,}/g, '\n\n');
        applied++;
        break;
      }
    }
  }

  return { content: result, applied, errors };
}

// ─── Analysis Prompt ────────────────────────────────────────────

function buildAnalysisPrompt(
  scores: Record<string, number>,
  weakest: string[],
  issues: string[],
  coreContent: string,
): string {
  const scoreTable = Object.entries(scores)
    .map(([k, v]) => `- ${k}: ${v.toFixed(1)}${weakest.includes(k) ? ' ← WEAKEST' : ''}`)
    .join('\n');

  const issueList = issues.length > 0
    ? issues.map(i => `- ${i}`).join('\n')
    : '(no specific issues captured)';

  return `You are a prompt engineering researcher analyzing a Figma AI agent's design quality.

## Task
Analyze why the weakest dimension(s) score low, and propose exactly 1-2 structured edits to CORE.md that would improve them.

## Current Oracle Scores (0-100, average across 5 test prompts)
${scoreTable}

## Weakest Dimensions: ${weakest.join(', ')}

## Specific Issues from Benchmark
${issueList}

## Current CORE.md Content
\`\`\`markdown
${coreContent}
\`\`\`

## Available Sections (## or ### headers)
${Array.from(parseSections(coreContent).keys()).map(s => `- "${s}"`).join('\n')}

## Rules
1. Output ONLY valid JSON — no markdown fences, no explanation outside JSON.
2. Propose 1-2 edits max. One focused change > many scattered changes.
3. **STRONGLY PREFER add_rule** — it's simpler and less error-prone. Only use modify_rule when you need to REPLACE existing text that is actively misleading.
4. Each edit targets a SPECIFIC section by its exact header text from the list above.
5. For modify_rule: "old_pattern" = EXACT substring copy-pasted from section content. "new_rule" = the replacement text. BOTH fields are REQUIRED.
6. New rules should be concise (1-2 lines). Token budget: CORE.md is ~4K tokens.
7. Focus on the WEAKEST dimension only. Don't try to improve everything.
8. Think about WHY the LLM fails — missing mental model, vague convention, or missing explicit instruction?

## Output Format (follow EXACTLY)
{
  "target_dimension": "spacingCompleteness",
  "hypothesis": "one sentence explaining why this dimension is weak",
  "reasoning": "2-3 sentences with evidence from the issues list",
  "edits": [
    {
      "op": "add_rule",
      "section": "DESIGN THINKING",
      "rule": "Dimensions 1-3 (LAYOUT, SIZING, SPACING) are ALWAYS required for frames with children."
    }
  ]
}

## modify_rule format (only if truly needed):
{
  "op": "modify_rule",
  "section": "The quality ladder",
  "old_pattern": "- **Functional** (dimensions 1–2): wireframe",
  "new_rule": "- **Functional** (dimensions 1–3): wireframe"
}`;
}

// ─── Build & Benchmark ──────────────────────────────────────────

function buildPlugin(): boolean {
  try {
    execSync('node build.js', {
      cwd: join(__dirname, '..', '..'),
      stdio: 'pipe',
      timeout: 60_000,
    });
    return true;
  } catch (err: any) {
    console.error('  Build failed:', err.stderr?.toString().slice(0, 200));
    return false;
  }
}

async function runBenchmark(): Promise<BenchmarkResult | null> {
  try {
    execSync(
      `npx tsx "${join(__dirname, 'run.ts')}"`,
      {
        cwd: join(__dirname, '..', '..'),
        stdio: 'inherit',
        timeout: 20 * 60_000, // 20 min max for full suite
        env: { ...process.env },
      }
    );
    // Read the latest result
    const raw = await readFile(join(DATA_DIR, 'latest.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err: any) {
    console.error('  Benchmark failed:', err.message?.slice(0, 200));
    return null;
  }
}

// ─── Experiment Logging ─────────────────────────────────────────

async function logExperiment(log: ExperimentLog): Promise<void> {
  const roundDir = join(EXPERIMENTS_DIR, `round-${String(log.round).padStart(3, '0')}`);
  await mkdir(roundDir, { recursive: true });

  // Write full log
  await writeFile(
    join(roundDir, 'result.json'),
    JSON.stringify(log, null, 2),
  );

  // Write human-readable summary
  const deltaStr = Object.entries(log.deltas)
    .filter(([k]) => k !== 'composite')
    .map(([k, v]) => `  ${k}: ${v > 0 ? '+' : ''}${v.toFixed(1)}`)
    .join('\n');

  const summary = `# Round ${log.round} — ${log.decision}

**Target:** ${log.target_dimension}
**Hypothesis:** ${log.hypothesis}
**Decision:** ${log.decision}

## Score Deltas
${deltaStr}
  composite: ${log.deltas['composite'] > 0 ? '+' : ''}${log.deltas['composite']?.toFixed(1)}

## Edits Applied
${log.edits.map(e => `- ${e.op} in "${e.section}": ${e.rule || e.new_rule || e.old_pattern}`).join('\n')}

## Reasoning
${log.reasoning}

${log.prompt_diff ? `## Prompt Diff\n\`\`\`\n${log.prompt_diff}\n\`\`\`` : ''}
`;

  await writeFile(join(roundDir, 'summary.md'), summary);
}

async function writeCheckpoint(round: number, logs: ExperimentLog[]): Promise<void> {
  const keeps = logs.filter(l => l.decision === 'KEEP');
  const reverts = logs.filter(l => l.decision === 'REVERT');
  const fails = logs.filter(l => l.decision !== 'KEEP' && l.decision !== 'REVERT');

  const summary = `# Checkpoint — Round ${round}

**Generated:** ${new Date().toISOString()}
**Rounds:** ${logs.length}
**Kept:** ${keeps.length} | **Reverted:** ${reverts.length} | **Failed:** ${fails.length}

## Kept Changes
${keeps.map(l => `- Round ${l.round}: ${l.hypothesis} (${l.target_dimension} ${l.deltas[l.target_dimension] > 0 ? '+' : ''}${l.deltas[l.target_dimension]?.toFixed(1)})`).join('\n') || '(none)'}

## Biggest Improvements
${keeps
  .sort((a, b) => (b.deltas[b.target_dimension] || 0) - (a.deltas[a.target_dimension] || 0))
  .slice(0, 5)
  .map(l => `- **${l.target_dimension}**: ${l.deltas[l.target_dimension] > 0 ? '+' : ''}${l.deltas[l.target_dimension]?.toFixed(1)} — "${l.hypothesis}"`)
  .join('\n') || '(none)'}

## Common Failure Patterns
${Object.entries(
  reverts.reduce((acc, l) => {
    acc[l.target_dimension] = (acc[l.target_dimension] || 0) + 1;
    return acc;
  }, {} as Record<string, number>)
).sort(([, a], [, b]) => b - a).map(([k, v]) => `- ${k}: ${v} failed attempts`).join('\n')}

---
**ACTION REQUIRED:** Review this checkpoint. Re-run to continue: \`npx tsx tools/autoresearch/engine.ts --resume\`
`;

  await writeFile(join(EXPERIMENTS_DIR, `checkpoint-${round}.md`), summary);
}

// ─── Calibration ────────────────────────────────────────────────

async function calibrate(): Promise<{ mean: Record<string, number>; stddev: Record<string, number> }> {
  console.log('═══ CALIBRATION MODE — Running baseline 3x to measure variance ═══\n');

  const runs: Record<string, number[]>[] = [];

  for (let i = 0; i < 3; i++) {
    console.log(`\nCalibration run ${i + 1}/3...`);
    const result = await runBenchmark();
    if (!result) {
      console.error('Calibration run failed, aborting');
      process.exit(1);
    }
    runs.push(extractDimensionScores(result));
  }

  const dims = Object.keys(runs[0]);
  const mean: Record<string, number> = {};
  const stddev: Record<string, number> = {};

  for (const dim of dims) {
    const values = runs.map(r => r[dim]);
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
    mean[dim] = m;
    stddev[dim] = Math.sqrt(variance);
  }

  console.log('\n═══ CALIBRATION RESULTS ═══');
  for (const dim of dims) {
    console.log(`  ${dim.padEnd(22)} mean: ${mean[dim].toFixed(1)}  stddev: ${stddev[dim].toFixed(1)}`);
  }

  const calibrationResult = { mean, stddev, runs, timestamp: new Date().toISOString() };
  await mkdir(EXPERIMENTS_DIR, { recursive: true });
  await writeFile(
    join(EXPERIMENTS_DIR, 'calibration.json'),
    JSON.stringify(calibrationResult, null, 2),
  );
  console.log('\n✓ Saved to experiments/calibration.json');

  // Warn if variance is too high
  const highVariance = Object.entries(stddev).filter(([k, v]) => k !== 'composite' && v > 3.0);
  if (highVariance.length > 0) {
    console.log('\n⚠ HIGH VARIANCE detected on:');
    for (const [k, v] of highVariance) {
      console.log(`  ${k}: stddev ${v.toFixed(1)} — consider increasing prompt count`);
    }
  }

  return { mean, stddev };
}

// ─── Main Loop ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const maxRounds = args.includes('--rounds')
    ? parseInt(args[args.indexOf('--rounds') + 1]) || MAX_ROUNDS
    : MAX_ROUNDS;
  const doCalibrate = args.includes('--calibrate');
  const doResume = args.includes('--resume');

  if (!LLM_API_KEY) {
    console.error('Error: LLM_API_KEY is required');
    console.error('Set it: export LLM_API_KEY=your-key-here');
    process.exit(1);
  }

  await mkdir(EXPERIMENTS_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  // ─── Calibration mode ───
  if (doCalibrate) {
    await calibrate();
    return;
  }

  // ─── Determine starting round ───
  let startRound = 1;
  if (doResume) {
    const existing = await readdir(EXPERIMENTS_DIR).catch(() => []);
    const roundDirs = existing.filter(d => d.startsWith('round-'));
    if (roundDirs.length > 0) {
      const lastRound = Math.max(...roundDirs.map(d => parseInt(d.replace('round-', '')) || 0));
      startRound = lastRound + 1;
      console.log(`Resuming from round ${startRound}`);
    }
  }

  // ─── Load or create baseline ───
  let baselinePath = join(DATA_DIR, 'baseline.json');
  if (!existsSync(baselinePath)) {
    console.log('No baseline found. Running initial benchmark...\n');
    if (!buildPlugin()) {
      console.error('Initial build failed');
      process.exit(1);
    }
    const result = await runBenchmark();
    if (!result) {
      console.error('Initial benchmark failed');
      process.exit(1);
    }
    await writeFile(baselinePath, JSON.stringify(result, null, 2));
    console.log('\n✓ Baseline saved\n');
  }

  const baseline: BenchmarkResult = JSON.parse(await readFile(baselinePath, 'utf-8'));
  let baselineScores = extractDimensionScores(baseline);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  AUTORESEARCH ENGINE — Autonomous Prompt Evolution');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Model:     ${ANALYSIS_MODEL}`);
  console.log(`  Rounds:    ${startRound} → ${startRound + maxRounds - 1}`);
  console.log(`  Threshold: keep if target ↑ ≥ ${KEEP_THRESHOLD}, revert if others ↓ ≥ ${REGRESS_THRESHOLD}`);
  console.log(`  Baseline:  composite ${baselineScores['composite']?.toFixed(1)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const experimentLogs: ExperimentLog[] = [];

  for (let round = startRound; round < startRound + maxRounds; round++) {
    console.log(`\n───── Round ${round} ─────────────────────────────────────────`);

    // 1. Identify weakest dimensions
    const weakest = findWeakestDimensions(baselineScores);
    console.log(`  Weakest: ${weakest.map(w => `${w} (${baselineScores[w]?.toFixed(1)})`).join(', ')}`);

    // 2. Collect issues for context
    const issues = collectIssues(baseline, weakest[0]);

    // 3. Read current CORE.md
    const coreContent = await readFile(CORE_MD_PATH, 'utf-8');

    // 4. Backup CORE.md
    const roundDir = join(EXPERIMENTS_DIR, `round-${String(round).padStart(3, '0')}`);
    await mkdir(roundDir, { recursive: true });
    await writeFile(join(roundDir, 'CORE.md.bak'), coreContent);

    // 5. Ask LLM for analysis
    console.log(`  Analyzing with ${ANALYSIS_MODEL}...`);
    let analysis: AnalysisResult;
    try {
      const prompt = buildAnalysisPrompt(baselineScores, weakest, issues, coreContent);
      const response = await callLLM(
        'You are an expert prompt engineer. Output only valid JSON, no markdown fences.',
        prompt,
      );

      // Extract JSON from response (handle markdown fences)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`No JSON found in LLM response: ${response.slice(0, 200)}`);
      }
      analysis = JSON.parse(jsonMatch[0]);

      // Normalize LLM output — fix common field name variations
      for (const edit of analysis.edits) {
        // Some LLMs use "pattern" instead of "old_pattern", "replacement" instead of "new_rule"
        if (!edit.old_pattern && (edit as any).pattern) edit.old_pattern = (edit as any).pattern;
        if (!edit.old_pattern && (edit as any).old) edit.old_pattern = (edit as any).old;
        if (!edit.old_pattern && (edit as any).find) edit.old_pattern = (edit as any).find;
        if (!edit.new_rule && (edit as any).replacement) edit.new_rule = (edit as any).replacement;
        if (!edit.new_rule && (edit as any).new) edit.new_rule = (edit as any).new;
        if (!edit.new_rule && (edit as any).replace) edit.new_rule = (edit as any).replace;
        if (!edit.rule && (edit as any).content) edit.rule = (edit as any).content;
        if (!edit.rule && (edit as any).text) edit.rule = (edit as any).text;
      }
      console.log(`  Hypothesis: ${analysis.hypothesis}`);
      console.log(`  Edits: ${analysis.edits.length} proposed`);
    } catch (err: any) {
      console.error(`  LLM analysis failed: ${err.message}`);
      experimentLogs.push({
        round,
        timestamp: new Date().toISOString(),
        target_dimension: weakest[0],
        hypothesis: 'LLM analysis failed',
        edits: [],
        baseline_scores: baselineScores,
        result_scores: baselineScores,
        deltas: {},
        decision: 'INVALID_EDIT',
        reasoning: err.message,
      });
      continue;
    }

    // 6. Apply edits
    const { content: newContent, applied, errors } = applyEdits(coreContent, analysis.edits);

    if (applied === 0) {
      console.error(`  No edits applied. Errors: ${errors.join('; ')}`);
      experimentLogs.push({
        round,
        timestamp: new Date().toISOString(),
        target_dimension: analysis.target_dimension,
        hypothesis: analysis.hypothesis,
        edits: analysis.edits,
        baseline_scores: baselineScores,
        result_scores: baselineScores,
        deltas: {},
        decision: 'INVALID_EDIT',
        reasoning: `Edit application failed: ${errors.join('; ')}`,
      });
      continue;
    }

    // Write modified CORE.md
    await writeFile(CORE_MD_PATH, newContent);
    console.log(`  Applied ${applied}/${analysis.edits.length} edits${errors.length ? ` (${errors.length} errors: ${errors.join('; ')})` : ''}`);

    // Save diff
    let promptDiff = '';
    try {
      promptDiff = execSync('git diff src/prompts/CORE.md', {
        cwd: join(__dirname, '..', '..'),
        encoding: 'utf-8',
      });
      await writeFile(join(roundDir, 'diff.patch'), promptDiff);
    } catch { /* ignore */ }

    // 7. Build
    console.log('  Building...');
    if (!buildPlugin()) {
      console.error('  Build failed — reverting');
      await writeFile(CORE_MD_PATH, coreContent);
      experimentLogs.push({
        round,
        timestamp: new Date().toISOString(),
        target_dimension: analysis.target_dimension,
        hypothesis: analysis.hypothesis,
        edits: analysis.edits,
        baseline_scores: baselineScores,
        result_scores: baselineScores,
        deltas: {},
        decision: 'BUILD_FAIL',
        reasoning: 'Build failed after applying edits',
        prompt_diff: promptDiff,
      });
      continue;
    }

    // Wait for Figma to pick up new build
    await new Promise(r => setTimeout(r, 3000));

    // 8. Benchmark
    console.log('  Benchmarking...');
    const result = await runBenchmark();
    if (!result) {
      console.error('  Benchmark failed — reverting');
      await writeFile(CORE_MD_PATH, coreContent);
      buildPlugin(); // rebuild with original
      experimentLogs.push({
        round,
        timestamp: new Date().toISOString(),
        target_dimension: analysis.target_dimension,
        hypothesis: analysis.hypothesis,
        edits: analysis.edits,
        baseline_scores: baselineScores,
        result_scores: baselineScores,
        deltas: {},
        decision: 'BENCHMARK_FAIL',
        reasoning: 'Benchmark run failed',
        prompt_diff: promptDiff,
      });
      continue;
    }

    // 9. Compare scores
    const resultScores = extractDimensionScores(result);
    const deltas: Record<string, number> = {};
    for (const key of Object.keys(baselineScores)) {
      deltas[key] = (resultScores[key] || 0) - (baselineScores[key] || 0);
    }

    const targetDelta = deltas[analysis.target_dimension] || 0;
    const otherRegressions = Object.entries(deltas)
      .filter(([k]) => k !== analysis.target_dimension && !PROCESS_METRICS.has(k))
      .filter(([, v]) => v < -REGRESS_THRESHOLD);

    // 10. Keep/Revert decision
    let decision: ExperimentLog['decision'];
    let reason: string;

    if (targetDelta >= KEEP_THRESHOLD && otherRegressions.length === 0) {
      decision = 'KEEP';
      reason = `Target ${analysis.target_dimension} improved by +${targetDelta.toFixed(1)} with no regressions`;
      baselineScores = resultScores; // update running baseline
      // Save as new baseline
      await writeFile(baselinePath, JSON.stringify(result, null, 2));
      console.log(`  ✓ KEEP — ${analysis.target_dimension} +${targetDelta.toFixed(1)}`);
    } else if (otherRegressions.length > 0) {
      decision = 'REVERT';
      reason = `Regressions on: ${otherRegressions.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`;
      await writeFile(CORE_MD_PATH, coreContent);
      buildPlugin();
      console.log(`  ✗ REVERT — regressions: ${otherRegressions.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
    } else {
      decision = 'REVERT';
      reason = `Target change +${targetDelta.toFixed(1)} below threshold ${KEEP_THRESHOLD}`;
      await writeFile(CORE_MD_PATH, coreContent);
      buildPlugin();
      console.log(`  ✗ REVERT — ${analysis.target_dimension} only +${targetDelta.toFixed(1)} (need ≥${KEEP_THRESHOLD})`);
    }

    // 11. Log experiment
    const log: ExperimentLog = {
      round,
      timestamp: new Date().toISOString(),
      target_dimension: analysis.target_dimension,
      hypothesis: analysis.hypothesis,
      edits: analysis.edits,
      baseline_scores: baselineScores,
      result_scores: resultScores,
      deltas,
      decision,
      reasoning: reason,
      prompt_diff: promptDiff,
    };
    experimentLogs.push(log);
    await logExperiment(log);

    // Print score delta summary
    const scoreStr = Object.entries(deltas)
      .filter(([k]) => k !== 'composite')
      .map(([k, v]) => `${k.replace('Completeness', '')}: ${v > 0 ? '+' : ''}${v.toFixed(1)}`)
      .join('  ');
    console.log(`  Δ ${scoreStr}`);
    console.log(`  Δ composite: ${deltas['composite'] > 0 ? '+' : ''}${deltas['composite']?.toFixed(1)}`);

    // 12. Checkpoint
    if (round > 0 && round % CHECKPOINT_INTERVAL === 0) {
      console.log(`\n═══ CHECKPOINT at round ${round} ═══`);
      await writeCheckpoint(round, experimentLogs);
      console.log(`  Written to experiments/checkpoint-${round}.md`);
      console.log('  Review and re-run with --resume to continue.');
      console.log('═══════════════════════════════════════\n');
      break;
    }
  }

  // Final summary
  const keeps = experimentLogs.filter(l => l.decision === 'KEEP');
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ENGINE COMPLETE');
  console.log(`  Rounds: ${experimentLogs.length}`);
  console.log(`  Kept: ${keeps.length}`);
  console.log(`  Final composite: ${baselineScores['composite']?.toFixed(1)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
