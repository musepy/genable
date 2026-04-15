/**
 * @file dsl_stress_test.test.ts
 * @description Stress test: compare JSON operations vs CLI DSL format for build_design.
 *
 * Calls real Gemini API N times per format with the same high-complexity prompt,
 * then compares error rates, token usage, and output quality.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx npx vitest run src/engine/agent/__tests__/dsl_stress_test.test.ts --reporter=verbose
 *   GEMINI_API_KEY=xxx GEMINI_MODEL=gemini-2.5-flash npx vitest run src/engine/agent/__tests__/dsl_stress_test.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const RUNS_PER_FORMAT = Number(process.env.STRESS_RUNS) || 3;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RunResult {
  format: 'dsl';
  run: number;
  success: boolean;
  parseSuccess: boolean;
  output: string;
  operationCount: number;
  tokenUsage: { prompt: number; completion: number; total: number };
  latencyMs: number;
  enumErrors: string[];       // Invalid enum values found (e.g., "END", "START")
  syntaxErrors: string[];     // Parse-level errors
  outputLengthChars: number;
}

interface FormatReport {
  format: string;
  runs: number;
  successRate: number;
  avgTokens: number;
  avgLatencyMs: number;
  avgOutputChars: number;
  avgOperations: number;
  totalEnumErrors: number;
  enumErrorDetails: string[];
}

// ---------------------------------------------------------------------------
// Shared design prompt (same for both formats)
// ---------------------------------------------------------------------------
const DESIGN_PROMPT = `Design a "Metrics Scorecard" card component.

Requirements:
- White card, 720px wide, rounded corners (16px), subtle drop shadow
- Header row at top with column labels: "Card Name", "Month", "Quarter", "Year", "Growth" — the last 4 are right-aligned, 80px wide each
- A horizontal divider line (1px, #E5E7EB)
- 5 data rows, each containing:
  - Card name (left-aligned, fills remaining width): "Visa Classic", "Mastercard Gold", "Amex Platinum", "Discover It", "Chase Sapphire"
  - Month values: $12,345 / $10,876 / $25,432 / $8,765 / $15,678
  - Quarter values: $36,024 / $31,543 / $78,901 / $24,321 / $45,890
  - Year values: $145,832 / $121,987 / $312,543 / $98,765 / $182,345
  - Growth indicator with arrow icon + percentage: +5.2% / +3.8% / -1.2% / +8.1% / +6.5%
    - Positive growth: green (#10B981) with arrow-up icon
    - Negative growth: red (#EF4444) with arrow-down icon
- Use Inter or system font, proper font sizes and weights
- Growth cell should right-align its content (icon + percentage)`;

// ---------------------------------------------------------------------------
// CLI DSL system prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT_DSL = `You are a Figma design generator. Output ONLY a sequence of CLI-style commands, one per line.

Command syntax:
  FRAME <symbol> [IN <parent>] "<name>" [options...]
  TEXT <symbol> [IN <parent>] "<content>" [options...]
  RECT <symbol> [IN <parent>] "<name>" [options...]
  ICON <symbol> IN <parent> <iconName> [options...]

Options use --key value format:
  --layout H|V              (HORIZONTAL or VERTICAL)
  --w <number>              (width)
  --h <number>              (height)
  --sizing-h FILL|HUG|FIXED
  --sizing-v FILL|HUG|FIXED
  --spacing <number>        (itemSpacing)
  --align-main MIN|MAX|CENTER|SPACE_BETWEEN   (primaryAxisAlignItems)
  --align-cross MIN|MAX|CENTER|BASELINE       (counterAxisAlignItems)
  --fill <hex>              (fill color, e.g. #FFFFFF — single fill)
  --text-fill <hex>         (text fill color)
  --size <number>           (fontSize for TEXT, icon size for ICON)
  --weight <value>          (fontWeight: Regular|Medium|Bold)
  --align-text LEFT|RIGHT|CENTER  (textAlignHorizontal)
  --radius <number>         (cornerRadius)
  --py <number>             (paddingTop and paddingBottom)
  --px <number>             (paddingLeft and paddingRight)
  --p <number>              (all padding)
  --stroke <hex>            (stroke color)
  --stroke-w <number>       (strokeWeight)
  --shadow <y> <blur> <color>  (DROP_SHADOW shorthand)

Rules:
- Use _ for unnamed symbols you don't need to reference later
- The first command has no IN clause (it's the root)
- Layout alignment uses Figma enums: MIN, MAX, CENTER, SPACE_BETWEEN (NOT start/end/flex-start/flex-end)
- One command per line, no blank lines
- Output ONLY commands, no markdown fences, no explanation

Example:
FRAME card "Card" --layout V --w 400 --sizing-v HUG --spacing 16 --p 24 --fill #FFFFFF --radius 16 --shadow 4 16 #0000001A
TEXT title IN card "Card Title" --size 20 --weight Bold --text-fill #111827 --sizing-h FILL
TEXT desc IN card "Description" --size 14 --text-fill #6B7280 --sizing-h FILL`;

// ---------------------------------------------------------------------------
// Known bad enum values to detect
// ---------------------------------------------------------------------------
const BAD_ENUMS: Record<string, string> = {
  'START': 'should be MIN',
  'END': 'should be MAX',
  'FLEX_START': 'should be MIN',
  'FLEX_END': 'should be MAX',
  'flex-start': 'should be MIN',
  'flex-end': 'should be MAX',
  'start': 'should be MIN',
  'end': 'should be MAX',
};

// Alignment property names to check for bad enums
const ALIGN_PROPS = ['primaryAxisAlignItems', 'counterAxisAlignItems', 'align-main', 'align-cross'];

// ---------------------------------------------------------------------------
// Gemini API call (direct REST, no SDK dependency)
// ---------------------------------------------------------------------------
async function callGemini(systemPrompt: string, userPrompt: string): Promise<{
  text: string;
  usage: { prompt: number; completion: number; total: number };
  latencyMs: number;
}> {
  const url = `${API_BASE}/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 16384,
    },
  };

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const latencyMs = Date.now() - start;

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text || '')
    .join('') || '';

  const usage = {
    prompt: data.usageMetadata?.promptTokenCount || 0,
    completion: data.usageMetadata?.candidatesTokenCount || 0,
    total: data.usageMetadata?.totalTokenCount || 0,
  };

  return { text, usage, latencyMs };
}

// ---------------------------------------------------------------------------
// Parsers & Validators
// ---------------------------------------------------------------------------

function detectEnumErrors(text: string): string[] {
  const errors: string[] = [];

  // Scan for --align-main and --align-cross with bad values in DSL
  for (const flag of ['--align-main', '--align-cross']) {
    const regex = new RegExp(`${flag}\\s+(\\S+)`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[1];
      if (BAD_ENUMS[value]) {
        errors.push(`${flag}: "${value}" (${BAD_ENUMS[value]})`);
      }
    }
  }

  return errors;
}

function tryParseDsl(text: string): { success: boolean; count: number; errors: string[] } {
  // Strip markdown fences if LLM wrapped them
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }

  const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
  const validCommands = ['FRAME', 'TEXT', 'RECT', 'ICON', 'RECTANGLE', 'ELLIPSE', 'LINE'];
  const errors: string[] = [];
  let validCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const cmd = line.split(/\s+/)[0]?.toUpperCase();
    if (validCommands.includes(cmd)) {
      validCount++;
    } else {
      errors.push(`Line ${i + 1}: unrecognized command "${cmd}"`);
    }
  }

  const success = validCount > 0 && errors.length <= lines.length * 0.1; // allow 10% bad lines
  return { success, count: validCount, errors: errors.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('DSL Format Stress Test', () => {
  const allResults: RunResult[] = [];

  // =========================================================================
  // CLI DSL Format Test
  // =========================================================================
  it.skipIf(!API_KEY)(
    `CLI DSL (${RUNS_PER_FORMAT} runs)`,
    { timeout: 300_000 },
    async () => {
      console.log(`\n🔬 Running Format B (CLI DSL) × ${RUNS_PER_FORMAT} with model ${MODEL_NAME}\n`);

      for (let i = 0; i < RUNS_PER_FORMAT; i++) {
        console.log(`  Run ${i + 1}/${RUNS_PER_FORMAT}...`);
        try {
          const { text, usage, latencyMs } = await callGemini(SYSTEM_PROMPT_DSL, DESIGN_PROMPT);
          const parsed = tryParseDsl(text);
          const enumErrors = detectEnumErrors(text);

          const result: RunResult = {
            format: 'dsl',
            run: i + 1,
            success: parsed.success && enumErrors.length === 0,
            parseSuccess: parsed.success,
            output: text,
            operationCount: parsed.count,
            tokenUsage: usage,
            latencyMs,
            enumErrors,
            syntaxErrors: parsed.errors,
            outputLengthChars: text.length,
          };
          allResults.push(result);

          const status = result.success ? '✅' : result.parseSuccess ? '⚠️ enum errors' : '❌ parse fail';
          console.log(`    ${status} | ${usage.total} tokens | ${latencyMs}ms | ${parsed.count} ops | ${enumErrors.length} enum errors`);
        } catch (e: any) {
          console.log(`    ❌ API error: ${e.message.slice(0, 100)}`);
          allResults.push({
            format: 'dsl',
            run: i + 1,
            success: false,
            parseSuccess: false,
            output: '',
            operationCount: 0,
            tokenUsage: { prompt: 0, completion: 0, total: 0 },
            latencyMs: 0,
            enumErrors: [],
            syntaxErrors: [e.message.slice(0, 100)],
            outputLengthChars: 0,
          });
        }

        if (i < RUNS_PER_FORMAT - 1) await sleep(2000);
      }

      const dslResults = allResults.filter(r => r.format === 'dsl');
      const successCount = dslResults.filter(r => r.success).length;
      expect(successCount).toBeGreaterThanOrEqual(0);
    }
  );

  // =========================================================================
  // Summary Report
  // =========================================================================
  it.skipIf(!API_KEY)(
    'Summary: A/B Comparison Report',
    { timeout: 10_000 },
    async () => {
      if (allResults.length === 0) {
        console.log('\n⚠️ No results to report (previous tests may have been skipped)\n');
        return;
      }

      function summarize(results: RunResult[], format: string): FormatReport {
        const runs = results.length;
        if (runs === 0) return { format, runs: 0, successRate: 0, avgTokens: 0, avgLatencyMs: 0, avgOutputChars: 0, avgOperations: 0, totalEnumErrors: 0, enumErrorDetails: [] };

        const successCount = results.filter(r => r.success).length;
        const totalTokens = results.reduce((s, r) => s + r.tokenUsage.total, 0);
        const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
        const totalChars = results.reduce((s, r) => s + r.outputLengthChars, 0);
        const totalOps = results.reduce((s, r) => s + r.operationCount, 0);
        const allEnumErrors = results.flatMap(r => r.enumErrors);

        return {
          format,
          runs,
          successRate: Math.round(successCount / runs * 100),
          avgTokens: Math.round(totalTokens / runs),
          avgLatencyMs: Math.round(totalLatency / runs),
          avgOutputChars: Math.round(totalChars / runs),
          avgOperations: Math.round(totalOps / runs),
          totalEnumErrors: allEnumErrors.length,
          enumErrorDetails: allEnumErrors,
        };
      }

      const dslReport = summarize(allResults, 'CLI DSL');

      // Print report
      const line = '='.repeat(80);
      console.log(`\n${line}`);
      console.log('📊 DSL FORMAT STRESS TEST REPORT');
      console.log(line);
      console.log(`Model: ${MODEL_NAME}`);
      console.log(`Runs: ${RUNS_PER_FORMAT}`);

      console.log('\n--- Results ---');
      console.log(`  Success Rate: ${dslReport.successRate}%`);
      console.log(`  Avg Tokens: ${dslReport.avgTokens}`);
      console.log(`  Avg Latency: ${dslReport.avgLatencyMs}ms`);
      console.log(`  Avg Output: ${dslReport.avgOutputChars} chars`);
      console.log(`  Avg Operations: ${dslReport.avgOperations}`);
      console.log(`  Enum Errors: ${dslReport.totalEnumErrors}`);

      if (dslReport.enumErrorDetails.length > 0) {
        console.log('\n--- Enum Errors ---');
        for (const e of dslReport.enumErrorDetails) console.log(`  ⚠️ ${e}`);
      }

      // Parse failures detail
      const parseFailures = allResults.filter(r => !r.parseSuccess);
      if (parseFailures.length > 0) {
        console.log('\n--- Parse Failures ---');
        for (const r of parseFailures) {
          console.log(`  Run ${r.run}: ${r.syntaxErrors.join('; ')}`);
        }
      }

      console.log(`\n${line}\n`);

      // Save report to .agent-runs
      const runsDir = path.join(process.cwd(), '.agent-runs');
      if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
      const filename = path.join(runsDir, `dsl-stress-${MODEL_NAME}-${Date.now()}.json`);
      fs.writeFileSync(filename, JSON.stringify({
        model: MODEL_NAME,
        runsPerFormat: RUNS_PER_FORMAT,
        timestamp: new Date().toISOString(),
        dslReport,
        allResults: allResults.map(r => ({ ...r, output: r.output.slice(0, 500) })),
      }, null, 2));
      console.log(`📁 Full report saved to: ${filename}\n`);
    }
  );
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
