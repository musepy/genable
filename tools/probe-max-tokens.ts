/**
 * Probe actual max_tokens cap for DashScope-hosted models that don't publish it.
 * Strategy: request a deliberately over-sized max_tokens (200000); observe API response.
 *
 *   - 400 with message → cap mentioned in error text
 *   - silent clamp → response usage.completion_tokens will hit the real cap
 *   - accepted → model's real cap ≥ 200000 (unlikely but record it)
 *
 * Run: DASHSCOPE_API_KEY=sk-xxx npx tsx tools/probe-max-tokens.ts
 */

const KEY = process.env.DASHSCOPE_CODING_KEY || process.env.DASHSCOPE_API_KEY;
if (!KEY) { console.error('DASHSCOPE_CODING_KEY or DASHSCOPE_API_KEY required'); process.exit(1); }

const BASE = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
const UA = 'claude-cli/2.0.57 (external, cli)';
/** For glm-4.7 a single probe at 200000 returned 200 (possibly silent clamp or real cap ≥ 200K).
 *  We hit it with progressively larger values to force a 400 that reveals the range. */
const MODELS = process.env.PROBE_GLM_ONLY
  ? ['glm-4.7', 'glm-4.7', 'glm-4.7', 'glm-4.7']
  : ['kimi-k2.5', 'glm-4.7', 'MiniMax-M2.5', 'qwen3-coder-next'];
const GLM_PROBE_VALUES = [500_000, 1_000_000, 2_000_000, 10_000_000];
let glmIdx = 0;

async function probe(model: string) {
  const maxTokens = (process.env.PROBE_GLM_ONLY && model === 'glm-4.7')
    ? GLM_PROBE_VALUES[glmIdx++] ?? 200_000
    : 200_000;
  const body = {
    model,
    messages: [{ role: 'user', content: 'Write the letter A exactly 50 times, nothing else.' }],
    max_tokens: maxTokens,
    stream: false,
  };
  console.log(`  → requesting max_tokens=${maxTokens}`);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'User-Agent': UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!res.ok) {
    return { model, status: res.status, verdict: '400 / rejected', errorMessage: parsed?.error?.message || text.slice(0, 300) };
  }
  const usage = parsed?.usage || {};
  return {
    model, status: res.status, verdict: 'accepted',
    completion_tokens: usage.completion_tokens, prompt_tokens: usage.prompt_tokens,
    finish_reason: parsed?.choices?.[0]?.finish_reason,
  };
}

async function main() {
  for (const m of MODELS) {
    try {
      console.log(`\n=== ${m} ===`);
      const r = await probe(m);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.log(`ERROR for ${m}:`, (e as Error).message);
    }
  }
}

main();
