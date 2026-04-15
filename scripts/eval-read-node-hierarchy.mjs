#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    model: 'mistral-nemo:12b',
    out: '',
    noOllama: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === '--model' && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (cur === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (cur === '--no-ollama') {
      args.noOllama = true;
      continue;
    }
  }
  return args;
}

function readFile(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function pickBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : -1;
  if (end < 0) return source.slice(start);
  return source.slice(start, end);
}

function countRegex(source, regex) {
  const m = source.match(regex);
  return m ? m.length : 0;
}

function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

function toNumber(source, pattern) {
  const m = source.match(pattern);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildMetrics() {
  const toolCallPath = 'src/ipc/handlers/toolCallHandler.ts';
  const serializerPath = 'src/engine/figma-adapter/nodeSerializer.ts';
  const cleanerPath = 'src/engine/agent/context/toolResultCleaner.ts';
  const validatorPath = 'src/engine/validation/postOpValidator.ts';
  const constantsPath = 'src/engine/agent/context/constants.ts';

  const toolCallSource = readFile(toolCallPath);
  const serializerSource = readFile(serializerPath);
  const cleanerSource = readFile(cleanerPath);
  const validatorSource = readFile(validatorPath);
  const constantsSource = readFile(constantsPath);

  const readNodeCase = pickBlock(toolCallSource, "case 'read_node':", "case 'create_node':");
  const hierarchyCase = pickBlock(readNodeCase, "case 'hierarchy':", "case 'node':");
  const nodeCase = pickBlock(readNodeCase, "case 'node':", "case 'variables':");
  const inspectExtract = pickBlock(cleanerSource, 'private extractInspectNode', 'public sanitizeToolCallsForHistory');

  const maxInspectDepth = toNumber(inspectExtract, /MAX_INSPECT_DEPTH\s*=\s*(\d+)/);
  const maxInspectChildren = toNumber(inspectExtract, /MAX_INSPECT_CHILDREN\s*=\s*(\d+)/);

  const toolResultMaxChars = toNumber(constantsSource, /TOOL_RESULT_MAX_DATA_CHARS:\s*(\d+)/);
  const maxHistoryArgsChars = toNumber(constantsSource, /MAX_HISTORY_ARGS_CHARS:\s*(\d+)/);

  const readNodeLoc = readNodeCase.trim().split('\n').length;
  const hierarchyLoc = hierarchyCase.trim().split('\n').length;
  const branchCount = countRegex(readNodeCase, /\b(if|else if|switch|case|for|while)\b/g);
  const awaitCount = countRegex(readNodeCase, /\bawait\b/g);

  const usesDepthCap = /Math\.min\(readDepth \|\| 5,\s*10\)/.test(hierarchyCase);
  const usesChildrenCap = /maxChildrenPerLevel/.test(hierarchyCase);
  const usesTotalNodeCap = /maxTotalNodes/.test(hierarchyCase);
  const pruneDefaultsFalse = /pruneDefaults:\s*false/.test(hierarchyCase);

  const callsTreeAnomalies = /collectTreeAnomalies\(/.test(hierarchyCase);
  const anomaliesShareDepth = /collectTreeAnomalies\(\s*hNode,\s*Math\.min\(readDepth \|\| 5,\s*10\)\s*\)/.test(hierarchyCase);
  const nodeModeIsUncompressed = /NodeSerializer\.serialize\(/.test(nodeCase);

  const hasSerializerBudgetFeatures =
    /maxChildrenPerLevel\?:/.test(serializerSource) &&
    /maxTotalNodes\?:/.test(serializerSource);

  const treeAnomalyMaxDepthDefault = toNumber(validatorSource, /maxDepth:\s*number\s*=\s*(\d+)/);
  const treeAnomalyMaxAnomaliesDefault = toNumber(validatorSource, /maxAnomalies:\s*number\s*=\s*(\d+)/);

  const sampleWorstVisibleNodes =
    maxInspectDepth !== null && maxInspectChildren !== null
      ? Array.from({ length: maxInspectDepth + 1 })
        .reduce((acc, _, i) => acc + (maxInspectChildren ** i), 0)
      : null;

  const readNodeChars = readNodeCase.length;
  const hierarchyChars = hierarchyCase.length;

  const riskFlags = [];
  if (!usesChildrenCap) riskFlags.push('hierarchy path does not set maxChildrenPerLevel');
  if (!usesTotalNodeCap) riskFlags.push('hierarchy path does not set maxTotalNodes');
  if (pruneDefaultsFalse) riskFlags.push('hierarchy path keeps default props (higher payload)');
  if (callsTreeAnomalies) riskFlags.push('hierarchy path performs second tree traversal for anomalies');
  if (nodeModeIsUncompressed) riskFlags.push('node mode uses uncompressed serialization');

  const score =
    (usesChildrenCap ? 0 : 25) +
    (usesTotalNodeCap ? 0 : 25) +
    (pruneDefaultsFalse ? 10 : 0) +
    (callsTreeAnomalies ? 15 : 0) +
    (nodeModeIsUncompressed ? 10 : 0) +
    (branchCount > 22 ? 8 : 0) +
    (awaitCount > 3 ? 7 : 0);

  return {
    files: {
      toolCallPath,
      serializerPath,
      cleanerPath,
      validatorPath,
      constantsPath,
    },
    metrics: {
      readNodeLoc,
      hierarchyLoc,
      branchCount,
      awaitCount,
      readNodeChars,
      hierarchyChars,
      readNodeEstimatedTokens: estimateTokens(readNodeChars),
      hierarchyEstimatedTokens: estimateTokens(hierarchyChars),
      usesDepthCap,
      usesChildrenCap,
      usesTotalNodeCap,
      pruneDefaultsFalse,
      callsTreeAnomalies,
      anomaliesShareDepth,
      nodeModeIsUncompressed,
      hasSerializerBudgetFeatures,
      maxInspectDepth,
      maxInspectChildren,
      sampleWorstVisibleNodes,
      toolResultMaxChars,
      maxHistoryArgsChars,
      treeAnomalyMaxDepthDefault,
      treeAnomalyMaxAnomaliesDefault,
      riskScore: Math.min(score, 100),
      riskFlags,
    },
    snippets: {
      hierarchyCase: hierarchyCase.trim(),
      inspectExtract: inspectExtract.trim(),
    },
  };
}

function buildPrompt(payload) {
  const compact = {
    files: payload.files,
    metrics: payload.metrics,
    hierarchySnippet: payload.snippets.hierarchyCase.slice(0, 2600),
    cleanerSnippet: payload.snippets.inspectExtract.slice(0, 1800),
  };

  return [
    'You are a strict software architect reviewing a TypeScript Figma plugin.',
    'Focus ONLY on read_node(hierarchy) complexity, traversal overhead, and token waste risk.',
    'Return concise Markdown with the exact sections:',
    '1) Overall verdict (PASS/CONCERN/FAIL)',
    '2) Findings (P1/P2/P3) with evidence from metrics/snippets',
    '3) Minimal patch plan (3-7 concrete code edits)',
    '4) Experiment matrix (at least 4 experiments, each with metric target)',
    '5) Suggested default thresholds for depth/children/total nodes',
    '',
    'Constraints:',
    '- Prioritize high ROI changes that keep behavior stable.',
    '- Mention migration risk if read fidelity may regress.',
    '- Do not propose broad rewrites.',
    '',
    'Audit payload:',
    '```json',
    JSON.stringify(compact, null, 2),
    '```',
  ].join('\n');
}

function runOllama(model, prompt, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ollama', ['run', model], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`ollama timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`ollama exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function formatTable(metrics) {
  const rows = [
    ['riskScore', metrics.riskScore],
    ['readNodeLoc', metrics.readNodeLoc],
    ['hierarchyLoc', metrics.hierarchyLoc],
    ['branchCount', metrics.branchCount],
    ['awaitCount', metrics.awaitCount],
    ['readNodeEstimatedTokens', metrics.readNodeEstimatedTokens],
    ['hierarchyEstimatedTokens', metrics.hierarchyEstimatedTokens],
    ['usesDepthCap', metrics.usesDepthCap],
    ['usesChildrenCap', metrics.usesChildrenCap],
    ['usesTotalNodeCap', metrics.usesTotalNodeCap],
    ['pruneDefaultsFalse', metrics.pruneDefaultsFalse],
    ['callsTreeAnomalies', metrics.callsTreeAnomalies],
    ['nodeModeIsUncompressed', metrics.nodeModeIsUncompressed],
    ['maxInspectDepth', metrics.maxInspectDepth],
    ['maxInspectChildren', metrics.maxInspectChildren],
    ['sampleWorstVisibleNodes', metrics.sampleWorstVisibleNodes],
    ['toolResultMaxChars', metrics.toolResultMaxChars],
    ['maxHistoryArgsChars', metrics.maxHistoryArgsChars],
    ['treeAnomalyMaxDepthDefault', metrics.treeAnomalyMaxDepthDefault],
    ['treeAnomalyMaxAnomaliesDefault', metrics.treeAnomalyMaxAnomaliesDefault],
  ];

  const body = rows.map(([k, v]) => `| ${k} | ${String(v)} |`).join('\n');
  return ['| Metric | Value |', '| --- | --- |', body].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildMetrics();
  const prompt = buildPrompt(payload);

  let reviewText = '';
  let reviewError = '';
  if (!args.noOllama) {
    try {
      reviewText = await runOllama(args.model, prompt);
    } catch (err) {
      reviewError = err instanceof Error ? err.message : String(err);
    }
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  const defaultOut = path.resolve(
    process.cwd(),
    `docs/reports/read-node-hierarchy-eval/read-node-hierarchy-eval-${stamp}.md`,
  );
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const report = [
    '# Read Node Hierarchy Evaluation',
    '',
    `- Date: ${now.toISOString()}`,
    `- Model: ${args.model}`,
    `- OLLAMA_ENABLED: ${args.noOllama ? 'false' : 'true'}`,
    '',
    '## Static Metrics',
    '',
    formatTable(payload.metrics),
    '',
    '### Risk Flags',
    '',
    ...(payload.metrics.riskFlags.length > 0
      ? payload.metrics.riskFlags.map((f) => `- ${f}`)
      : ['- none']),
    '',
    '## Key Snippet: read_node(hierarchy)',
    '',
    '```ts',
    payload.snippets.hierarchyCase.slice(0, 3500),
    '```',
    '',
    '## Key Snippet: inspect cleaner',
    '',
    '```ts',
    payload.snippets.inspectExtract.slice(0, 2500),
    '```',
    '',
    '## Mistral Review',
    '',
    reviewText ? reviewText : '_No review text._',
    '',
    reviewError ? `## Mistral Error\n\n- ${reviewError}` : '',
  ].filter(Boolean).join('\n');

  fs.writeFileSync(outPath, report, 'utf8');

  const metricsOut = outPath.replace(/\.md$/i, '.metrics.json');
  fs.writeFileSync(
    metricsOut,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        model: args.model,
        files: payload.files,
        metrics: payload.metrics,
        reviewError: reviewError || null,
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(`Report written: ${outPath}\n`);
  process.stdout.write(`Metrics written: ${metricsOut}\n`);
  if (reviewError) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exit(1);
});
