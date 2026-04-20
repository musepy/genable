/**
 * glm-4.7 accepts any max_tokens without error — need to force long output to
 * find the real cap. Ask for massive generation; observe completion_tokens and finish_reason.
 */
const KEY = process.env.DASHSCOPE_CODING_KEY;
if (!KEY) { console.error('DASHSCOPE_CODING_KEY required'); process.exit(1); }
const BASE = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
const UA = 'claude-cli/2.0.57 (external, cli)';

async function probe(prompt: string, maxTokens: number) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'User-Agent': UA },
    body: JSON.stringify({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const parsed = await res.json() as any;
  return {
    status: res.status,
    completion_tokens: parsed?.usage?.completion_tokens,
    finish_reason: parsed?.choices?.[0]?.finish_reason,
    content_sample: parsed?.choices?.[0]?.message?.content?.slice(0, 80),
    error: parsed?.error?.message,
  };
}

async function main() {
  const longPrompt = 'Write the number 1, then 2, then 3, continuing up to 100000. Output ONLY the numbers separated by newlines. Do not stop early. Do not summarize. Continue until you have written all 100000 numbers.';
  console.log('Prompt: enumerate 1..100000 (forces long output)');
  for (const mt of [65536, 131072, 200000]) {
    console.log(`\n=== max_tokens=${mt} ===`);
    const r = await probe(longPrompt, mt);
    console.log(JSON.stringify(r, null, 2));
  }
}

main();
