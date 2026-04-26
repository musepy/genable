/**
 * Probe: is a DashScope model id accepted by the coding endpoint?
 *
 * Usage: npx tsx tools/probe-dashscope-model.ts <model-id>
 *
 * Sends a tiny non-stream chat completion and prints status / body snippet.
 */

const KEY = process.env.DASHSCOPE_CODING_KEY;
const URL = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
if (!KEY) { console.error('Missing DASHSCOPE_CODING_KEY'); process.exit(1); }

const MODELS = process.argv.slice(2);
if (MODELS.length === 0) {
  console.error('Usage: tsx probe-dashscope-model.ts <model-id> [<model-id>...]');
  process.exit(1);
}

async function probe(model: string) {
  const t0 = Date.now();
  const res = await fetch(`${URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'reply with the single word OK' }],
      max_tokens: 16,
      stream: false,
    }),
  });
  const dt = Date.now() - t0;
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { /* keep as text */ }
  const content = parsed?.choices?.[0]?.message?.content;
  const usage = parsed?.usage;
  const errorCode = parsed?.error?.code || parsed?.code;
  const errorMessage = parsed?.error?.message || parsed?.message;

  console.log(`── ${model} ──`);
  console.log(`  HTTP ${res.status}  (${dt}ms)`);
  if (content) console.log(`  content: ${JSON.stringify(content).slice(0, 120)}`);
  if (usage) console.log(`  usage: ${JSON.stringify(usage)}`);
  if (errorCode || errorMessage) console.log(`  error: ${errorCode ?? ''} ${errorMessage ?? ''}`.trim());
  if (!content && !errorCode && !errorMessage) console.log(`  raw: ${text.slice(0, 300)}`);
  console.log();
}

(async () => {
  for (const m of MODELS) {
    try { await probe(m); } catch (e: any) { console.error(`${m} threw:`, e?.message || e); }
  }
})();
