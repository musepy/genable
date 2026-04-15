/**
 * @file diagnose_gemini_400_multiturn.ts
 * Phase 2: Test multi-turn conversation formats that the agent loop uses.
 * The single-turn tests all passed, so the 400 must be in the message history format.
 *
 * Usage: npx tsx scripts/diagnose_gemini_400_multiturn.ts
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

const client = new GoogleGenAI({ apiKey: API_KEY });

const SIMPLE_TOOL = {
  name: 'createNode',
  description: 'Create a design node',
  parameters: {
    type: 'object' as const,
    properties: {
      type: { type: 'string' as const, description: 'Node type' },
      name: { type: 'string' as const, description: 'Node name' }
    },
    required: ['type', 'name']
  }
};

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n[TEST] ${name} ... `);
  try {
    await fn();
    console.log('✅ PASS');
  } catch (e: any) {
    const msg = e?.message || String(e);
    const is400 = msg.includes('400') || msg.includes('INVALID_ARGUMENT');
    console.log(is400 ? '❌ 400 ERROR' : `❌ ERROR`);
    console.log(`   ${msg.slice(0, 500)}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Gemini 400 Diagnostic Phase 2: Multi-turn Formats');
  console.log('='.repeat(60));

  // ---- Test A: Normal multi-turn with function call + response ----
  await test('A. Standard multi-turn: user → model(functionCall) → user(functionResponse)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a frame called Header' }] },
        { role: 'model', parts: [{ functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true, nodeId: '123:456' } } }] },
        { role: 'user', parts: [{ text: 'Now create a text node inside it' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test B: With systemInstruction ----
  await test('B. With systemInstruction + multi-turn', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a frame called Header' }] },
        { role: 'model', parts: [{ functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true, nodeId: '123:456' } } }] },
        { role: 'user', parts: [{ text: 'Now create a text node' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        systemInstruction: 'You are a Figma design assistant. Use tools to create nodes.',
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test C: With thinkingConfig + multi-turn ----
  await test('C. thinkingConfig + multi-turn + tools', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a frame called Header' }] },
        { role: 'model', parts: [{ functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true } } }] },
        { role: 'user', parts: [{ text: 'Now create a text node' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test D: Model response with text + functionCall (mixed parts) ----
  await test('D. Model response with mixed text + functionCall parts', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header frame' }] },
        { role: 'model', parts: [
          { text: 'I will create a header frame for you.' },
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }
        ]},
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true, nodeId: '1:2' } } }] },
        { role: 'user', parts: [{ text: 'Add text inside it' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test E: thought parts in model response (Gemini 3 thinking) ----
  await test('E. Model response with thought: true + text parts', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: [
          { text: 'Thinking about layout...', thought: true } as any,
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }
        ]},
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true } } }] },
        { role: 'user', parts: [{ text: 'Now add text' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test F: thoughtSignature in model response ----
  await test('F. Model response with fake thoughtSignature (should fail?)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: [
          { text: 'Planning...', thought: true, thoughtSignature: 'AAAA' } as any,
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } }, thoughtSignature: 'AAAA' } as any
        ]},
        { role: 'user', parts: [
          { functionResponse: { name: 'createNode', response: { success: true } }, thoughtSignature: 'AAAA' } as any
        ]},
        { role: 'user', parts: [{ text: 'Now add text' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test G: thought_signature (snake_case) vs thoughtSignature (camelCase) ----
  await test('G. Model response with thought_signature (snake_case)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: [
          { text: 'Planning...', thought: true, thought_signature: 'BBBB' } as any,
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } }, thought_signature: 'BBBB' } as any
        ]},
        { role: 'user', parts: [
          { functionResponse: { name: 'createNode', response: { success: true } }, thought_signature: 'BBBB' } as any
        ]},
        { role: 'user', parts: [{ text: 'Now add text' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test H: Empty text parts (model response with empty text) ----
  await test('H. Model response with empty text part + functionCall', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: [
          { text: '' },
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }
        ]},
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true } } }] },
        { role: 'user', parts: [{ text: 'Add text' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test I: Consecutive user messages (no model response between) ----
  await test('I. Two consecutive user messages (missing model response)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'user', parts: [{ text: 'Actually make it a footer' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test J: functionResponse right after user (no model functionCall) ----
  await test('J. functionResponse without preceding model functionCall', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: [{ text: 'OK creating now' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'createNode', response: { success: true } } }] },
        { role: 'user', parts: [{ text: 'Add text' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test K: Very long system prompt (like the real one) ----
  await test('K. Very long system instruction (~4000 chars)', async () => {
    const longPrompt = `You are an expert Figma design assistant.\n${'Rule: Always use proper layout modes.\n'.repeat(100)}End of instructions.`;
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        systemInstruction: longPrompt,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test L: Real-ish agent loop simulation (2 turns) ----
  await test('L. Simulate real agent loop: system + user + model(tool) + tool_response + model(tool)', async () => {
    // First call
    const result1 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form with email and password fields' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: 'You are a Figma design assistant. Use createNode to create UI elements.',
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });

    // Build the model's response parts (capturing what came back)
    const modelParts: any[] = [];
    const candidate = (result1 as any).candidates?.[0];
    if (candidate?.content?.parts) {
      for (const p of candidate.content.parts) {
        if (p.thought !== undefined) {
          modelParts.push({ text: p.text || '', thought: true, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) });
        } else if (p.functionCall) {
          modelParts.push({ functionCall: p.functionCall, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) });
        } else if (p.text) {
          modelParts.push({ text: p.text });
        }
      }
    }

    console.log(`\n   Turn 1 model parts: ${modelParts.map(p => p.functionCall ? `fc(${p.functionCall.name})` : p.thought ? 'thought' : 'text').join(', ')}`);

    // Build tool response
    const toolResponses: any[] = [];
    for (const p of modelParts) {
      if (p.functionCall) {
        const respPart: any = { functionResponse: { name: p.functionCall.name, response: { success: true, nodeId: '1:2' } } };
        if (p.thoughtSignature) respPart.thoughtSignature = p.thoughtSignature;
        toolResponses.push(respPart);
      }
    }

    if (toolResponses.length === 0) {
      console.log('   (No tool calls in turn 1, skipping turn 2)');
      return;
    }

    // Second call with history
    process.stdout.write('   Turn 2 ... ');
    const result2 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form with email and password' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: 'You are a Figma design assistant. Use createNode to create UI elements.',
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });
    console.log(`(calls: ${result2.functionCalls?.length || 0})`);
  });

  // ---- Test M: Simulate what our code does — use formatResponse mapping ----
  await test('M. Simulate agent code path: mapToGenAIContent format', async () => {
    // This simulates what GeminiProvider.mapToGenAIContent does with model responses
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        // Simulating what our code sends back as model response
        { role: 'model', parts: [
          { functionCall: { name: 'createNode', args: { type: 'FRAME', name: 'Header' } } }
        ]},
        // Simulating what formatToolResults sends
        { role: 'user', parts: [
          { functionResponse: { name: 'createNode', response: { success: true, nodeId: '1:2', message: 'Created FRAME "Header"' } } }
        ]},
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: 'You are a Figma design assistant.',
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Now test with ALL real tools in multi-turn ----
  await test('N. ALL real tools + multi-turn + thinkingConfig', async () => {
    const { agentTools } = await import('../src/engine/agent/tools/index');
    const decls = agentTools.map(t => ({
      name: t.name,
      description: (t.description || '').slice(0, 300),
      parameters: t.parameters
    }));

    // First call
    const result1 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form with email field, password field, and submit button' }] },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: 'You are a Figma design assistant. Plan first with planDesign, then execute with generateDesign or batchOperations.',
        tools: [{ functionDeclarations: decls }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });

    const candidate = (result1 as any).candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const modelParts = parts.map((p: any) => {
      if (p.thought !== undefined) return { text: p.text || '', thought: true, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
      if (p.functionCall) return { functionCall: p.functionCall, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
      if (p.text) return { text: p.text };
      return p;
    });

    const toolCalls = modelParts.filter((p: any) => p.functionCall);
    console.log(`\n   Turn 1: ${toolCalls.length} tool calls: ${toolCalls.map((p: any) => p.functionCall.name).join(', ')}`);

    if (toolCalls.length === 0) {
      console.log('   (No tool calls, done)');
      return;
    }

    const toolResponses = toolCalls.map((p: any) => {
      const resp: any = { functionResponse: { name: p.functionCall.name, response: { success: true, result: 'Mock result' } } };
      if (p.thoughtSignature) resp.thoughtSignature = p.thoughtSignature;
      return resp;
    });

    // Second call
    process.stdout.write('   Turn 2 ... ');
    const result2 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: 'You are a Figma design assistant.',
        tools: [{ functionDeclarations: decls }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });

    const tc2 = result2.functionCalls?.length || 0;
    console.log(`(calls: ${tc2})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Phase 2 Diagnostic complete.');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
