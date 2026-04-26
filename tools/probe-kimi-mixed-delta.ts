/**
 * Probe: does kimi-k2.5 emit delta.content alongside delta.tool_calls?
 *
 * Hits DashScope coding-plan endpoint directly, streams raw SSE, and records
 * every chunk where BOTH delta.content AND delta.tool_calls are present.
 *
 * Goal: understand the root cause, not just the symptom.
 */

const KEY = process.env.DASHSCOPE_CODING_KEY;
const URL = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
if (!KEY) { console.error('Missing DASHSCOPE_CODING_KEY'); process.exit(1); }

const MODEL = process.argv[2] || 'kimi-k2.5';
const RUNS = Number(process.argv[3] || 5);

// A tool schema similar to the plugin's `jsx` tool — enough to make the model
// emit nested JSX-like text inside a tool call argument.
const tools = [
  {
    type: 'function',
    function: {
      name: 'jsx',
      description: 'Create Figma nodes from a JSX-like markup string.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Parent node id or "/" for page root' },
          markup: { type: 'string', description: 'JSX-like markup: <frame layout="vertical">...</frame>' },
        },
        required: ['parent', 'markup'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_node',
      description: 'Delete a node by id.',
      parameters: {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
      },
    },
  },
];

const messages = [
  { role: 'system', content: 'You are a Figma design agent. Use the jsx tool to create nodes. Always prefer tool calls over text.' },
  { role: 'user', content: 'Design a sign-up card with a title, email input, password input, and a submit button. Call jsx with a nested markup string.' },
];

type ChunkSummary = {
  idx: number;
  hasContent: boolean;
  contentSnippet: string;
  hasToolDelta: boolean;
  toolDeltaSnippet: string;
  finishReason: string | null;
  raw: any;
};

async function runOnce(runId: number): Promise<{ mixed: ChunkSummary[]; allContentDeltas: string[] }> {
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
    throw new Error(`HTTP ${res.status}: ${t}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let idx = 0;
  const mixed: ChunkSummary[] = [];
  const allContentDeltas: string[] = [];

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
      const finishReason = parsed.choices?.[0]?.finish_reason ?? null;
      if (!delta) continue;

      const hasContent = typeof delta.content === 'string' && delta.content.length > 0;
      const hasToolDelta = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;

      if (hasContent) allContentDeltas.push(delta.content);

      if (hasContent && hasToolDelta) {
        mixed.push({
          idx,
          hasContent,
          contentSnippet: JSON.stringify(delta.content),
          hasToolDelta,
          toolDeltaSnippet: JSON.stringify(delta.tool_calls).slice(0, 200),
          finishReason,
          raw: delta,
        });
      }
      idx++;
    }
  }
  return { mixed, allContentDeltas };
}

(async () => {
  console.log(`Model=${MODEL}  Runs=${RUNS}  Endpoint=${URL}`);
  let totalMixed = 0;
  for (let i = 0; i < RUNS; i++) {
    try {
      const { mixed, allContentDeltas } = await runOnce(i);
      console.log(`\n── Run ${i + 1} ──`);
      console.log(`  content deltas: ${allContentDeltas.length}  ·  mixed chunks: ${mixed.length}`);
      if (allContentDeltas.length > 0 && allContentDeltas.length <= 20) {
        console.log(`  all content: ${JSON.stringify(allContentDeltas)}`);
      } else if (allContentDeltas.length > 0) {
        console.log(`  first 10 content: ${JSON.stringify(allContentDeltas.slice(0, 10))}`);
      }
      for (const m of mixed) {
        console.log(`  [chunk #${m.idx}] content=${m.contentSnippet}  tool=${m.toolDeltaSnippet}  finish=${m.finishReason}`);
      }
      totalMixed += mixed.length;
    } catch (e: any) {
      console.error(`Run ${i + 1} failed:`, e?.message || e);
    }
  }
  console.log(`\nTotal mixed chunks across ${RUNS} runs: ${totalMixed}`);
})();
