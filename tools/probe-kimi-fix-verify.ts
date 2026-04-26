/**
 * Probe v3+: end-to-end fix verification + leak classification.
 *
 * Beyond v3:
 *   - Reports whether accumulated tool_call.arguments parses as JSON
 *     (SCENARIO B = "stolen" leak: the leaked char is missing from args)
 *   - Reports whether leak token also appears inside args JSON
 *     (SCENARIO A = "duplicated" leak: char is in both places)
 *   - Dumps the raw argument string when broken
 */

import { stripLeakedToolCallTokens } from '../src/engine/llm-client/providers/dashscope';
import type { LLMResponse, ToolCallBlock } from '../src/engine/llm-client/providers/types';

const KEY = process.env.DASHSCOPE_CODING_KEY;
const URL = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
if (!KEY) { console.error('Missing DASHSCOPE_CODING_KEY'); process.exit(1); }

const MODEL = process.argv[2] || 'kimi-k2.5';
const RUNS = Number(process.argv[3] || 5);

const tools = [
  {
    type: 'function',
    function: {
      name: 'jsx',
      description: 'Create Figma nodes from JSX-like markup.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string' },
          markup: { type: 'string' },
        },
        required: ['parent', 'markup'],
      },
    },
  },
];

const messages = [
  { role: 'system', content: 'You are a Figma design agent. Prefer tool calls. Never explain, never add preamble text.' },
  { role: 'user', content: 'Design a full dashboard page: left sidebar with 8 nav items, top header with search + 3 icons, main area with 4 KPI cards and a large chart frame. All auto-layout.' },
];

type Scenario = 'no-leak' | 'duplicated' | 'stolen-parse-fail' | 'stolen-in-args' | 'real-preamble' | 'unknown';

async function runOnce(runId: number): Promise<{
  rawText: string;
  cleanedText: string;
  argsRaw: string;
  argsParseOk: boolean;
  leakInArgs: boolean;
  classification: Scenario;
}> {
  const body = {
    model: MODEL,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0.7,
    stream: true,
  };

  const res = await fetch(`${URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'claude-cli/2.0.57 (external, cli)',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string') accumulatedText += delta.content;

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const existing = toolCallAcc.get(idx);
          if (!existing) {
            toolCallAcc.set(idx, {
              id: tc.id || `call_${idx}`,
              name: tc.function?.name || '',
              args: tc.function?.arguments || '',
            });
          } else {
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }
        }
      }
    }
  }

  const firstTc = toolCallAcc.values().next().value;
  const argsRaw = firstTc?.args ?? '';
  let argsParseOk = true;
  let parsedArgs: any = argsRaw;
  try { parsedArgs = JSON.parse(argsRaw); } catch { argsParseOk = false; }

  const toolCalls: ToolCallBlock[] = [];
  if (firstTc) {
    toolCalls.push({
      type: 'tool_call' as const,
      id: firstTc.id,
      name: firstTc.name,
      input: parsedArgs,
    });
  }
  const rawResponse: LLMResponse = {
    text: accumulatedText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };

  const cleaned = stripLeakedToolCallTokens(rawResponse);

  // Classify
  const leakInArgsRaw = accumulatedText !== '' && argsRaw.includes(accumulatedText);
  const leakDetectedByFix = accumulatedText !== '' && cleaned.text === '';

  let classification: Scenario = 'unknown';
  if (accumulatedText === '') classification = 'no-leak';
  else if (leakDetectedByFix && argsParseOk && leakInArgsRaw) classification = 'duplicated';
  else if (leakDetectedByFix && !argsParseOk) classification = 'stolen-parse-fail';
  else if (leakDetectedByFix && argsParseOk && !leakInArgsRaw) classification = 'stolen-in-args'; // shouldn't happen
  else if (!leakDetectedByFix) classification = 'real-preamble';

  return {
    rawText: accumulatedText,
    cleanedText: cleaned.text,
    argsRaw,
    argsParseOk,
    leakInArgs: leakInArgsRaw,
    classification,
  };
}

(async () => {
  console.log(`Model=${MODEL}  Runs=${RUNS}\n`);
  const counts: Record<string, number> = {};
  for (let i = 0; i < RUNS; i++) {
    try {
      const r = await runOnce(i);
      counts[r.classification] = (counts[r.classification] ?? 0) + 1;
      const argPreview = r.argsRaw.length > 180
        ? r.argsRaw.slice(0, 80) + ` ... [${r.argsRaw.length} total] ... ` + r.argsRaw.slice(-80)
        : r.argsRaw;
      console.log(`Run ${i + 1}: ${r.classification.toUpperCase()}`);
      console.log(`  rawText: ${JSON.stringify(r.rawText)}`);
      console.log(`  argsParseOk: ${r.argsParseOk}  leakInArgs: ${r.leakInArgs}`);
      if (!r.argsParseOk) {
        console.log(`  argsRaw (first 200): ${JSON.stringify(r.argsRaw.slice(0, 200))}`);
        console.log(`  argsRaw (last 200):  ${JSON.stringify(r.argsRaw.slice(-200))}`);
      } else if (r.rawText) {
        console.log(`  argsRaw: ${argPreview.slice(0, 300)}`);
      }
      console.log();
    } catch (e: any) {
      console.error(`Run ${i + 1} failed:`, e?.message || e);
    }
  }
  console.log('\nClassification summary:', counts);
})();
