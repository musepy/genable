/**
 * Probe v2: expand scenarios and log EVERY content delta (not just mixed).
 *
 * Scenarios:
 *   A. First-turn, simple
 *   B. First-turn, complex (many sibling nodes → longer markup)
 *   C. Multi-turn with injected stray-text assistant message (mimicry test)
 *   D. Multi-turn with real tool_result returned
 */

const KEY = process.env.DASHSCOPE_CODING_KEY;
const URL = process.env.DASHSCOPE_CODING_URL || 'https://coding.dashscope.aliyuncs.com/v1';
if (!KEY) { console.error('Missing DASHSCOPE_CODING_KEY'); process.exit(1); }

const MODEL = process.argv[2] || 'kimi-k2.5';
const RUNS_PER_SCENARIO = Number(process.argv[3] || 3);

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
          markup: { type: 'string', description: '<frame layout="vertical">...</frame>' },
        },
        required: ['parent', 'markup'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_node',
      description: 'Delete a node.',
      parameters: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect',
      description: 'Inspect a node tree.',
      parameters: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] },
    },
  },
];

const systemPrompt = 'You are a Figma design agent. Prefer tool calls. Never explain, never add preamble text.';

const scenarios: Record<string, any[]> = {
  A_simple: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Design a sign-up card with title, email input, password input, submit button.' },
  ],

  B_complex: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Design a full dashboard page: left sidebar with 8 nav items, top header with search + 3 icons, main area with 4 KPI cards and a large chart frame. All auto-layout.' },
  ],

  C_polluted_history: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Design a sign-up card.' },
    // This is the critical setup: prior assistant message has stray "=" content alongside tool_calls,
    // simulating the exact malformed state that enters history after a prior mixed-delta incident.
    {
      role: 'assistant',
      content: '=',
      tool_calls: [{
        id: 'call_prev1',
        type: 'function',
        function: { name: 'jsx', arguments: JSON.stringify({ parent: '/', markup: '<frame layout="vertical"><text>Sign up</text></frame>' }) },
      }],
    },
    { role: 'tool', tool_call_id: 'call_prev1', content: JSON.stringify({ id: '1:2', children: [{ id: '1:3' }] }) },
    { role: 'user', content: 'Now add an email input and a submit button inside.' },
  ],

  D_real_toolresult: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Design a sign-up card.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_prev2',
        type: 'function',
        function: { name: 'jsx', arguments: JSON.stringify({ parent: '/', markup: '<frame layout="vertical"><text>Sign up</text></frame>' }) },
      }],
    },
    { role: 'tool', tool_call_id: 'call_prev2', content: JSON.stringify({ id: '1:2', children: [{ id: '1:3' }] }) },
    { role: 'user', content: 'Now add an email input and a submit button inside node 1:2.' },
  ],
};

async function runOnce(scenario: string): Promise<{ contentDeltas: string[]; mixedCount: number; totalChunks: number }> {
  const body = {
    model: MODEL,
    messages: scenarios[scenario],
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
  let buf = '';
  const contentDeltas: string[] = [];
  let mixedCount = 0;
  let totalChunks = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      totalChunks++;

      const hasC = typeof delta.content === 'string' && delta.content.length > 0;
      const hasT = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
      if (hasC) contentDeltas.push(delta.content);
      if (hasC && hasT) mixedCount++;
    }
  }
  return { contentDeltas, mixedCount, totalChunks };
}

(async () => {
  console.log(`Model=${MODEL}  Runs/scenario=${RUNS_PER_SCENARIO}\n`);
  for (const name of Object.keys(scenarios)) {
    console.log(`\n══ Scenario ${name} ══`);
    for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
      try {
        const r = await runOnce(name);
        const preview = r.contentDeltas.length <= 15
          ? JSON.stringify(r.contentDeltas)
          : JSON.stringify(r.contentDeltas.slice(0, 8)) + ` …+${r.contentDeltas.length - 8}`;
        console.log(`  Run ${i+1}: chunks=${r.totalChunks}  content_deltas=${r.contentDeltas.length}  mixed=${r.mixedCount}  preview=${preview}`);
      } catch (e: any) {
        console.error(`  Run ${i+1} failed:`, e?.message || e);
      }
    }
  }
})();
