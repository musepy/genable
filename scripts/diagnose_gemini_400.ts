/**
 * @file diagnose_gemini_400.ts
 * Diagnostic script to isolate the cause of Gemini API 400 INVALID_ARGUMENT errors.
 *
 * Usage: npx tsx scripts/diagnose_gemini_400.ts
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

const client = new GoogleGenAI({ apiKey: API_KEY });

// ============================================================
// Test helpers
// ============================================================

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n[${'TEST'}] ${name} ... `);
  try {
    await fn();
    console.log('✅ PASS');
  } catch (e: any) {
    const msg = e?.message || String(e);
    // Extract status code
    const is400 = msg.includes('400') || msg.includes('INVALID_ARGUMENT');
    console.log(is400 ? '❌ 400 ERROR' : `❌ ERROR (${msg.slice(0, 120)})`);
    if (is400) {
      console.log(`   Detail: ${msg.slice(0, 300)}`);
    }
  }
}

// ============================================================
// Tool schemas (from the codebase)
// ============================================================

const SIMPLE_TOOL = {
  name: 'greet',
  description: 'Say hello',
  parameters: {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const, description: 'Name to greet' }
    },
    required: ['name']
  }
};

const TOOL_WITH_REQUIRED_IN_ITEMS = {
  name: 'batchOps',
  description: 'Batch operations',
  parameters: {
    type: 'object' as const,
    properties: {
      operations: {
        type: 'array' as const,
        description: 'List of ops',
        items: {
          type: 'object' as const,
          description: 'Single op',
          required: ['opId', 'action'],  // ← This is the suspect
          properties: {
            opId: { type: 'string' as const, description: 'Op ID' },
            action: { type: 'string' as const, description: 'Action', enum: ['create', 'delete'] },
          }
        }
      }
    },
    required: ['operations']
  }
};

const TOOL_WITHOUT_REQUIRED_IN_ITEMS = {
  name: 'batchOps',
  description: 'Batch operations',
  parameters: {
    type: 'object' as const,
    properties: {
      operations: {
        type: 'array' as const,
        description: 'List of ops',
        items: {
          type: 'object' as const,
          description: 'Single op',
          // NO required here
          properties: {
            opId: { type: 'string' as const, description: 'Op ID' },
            action: { type: 'string' as const, description: 'Action', enum: ['create', 'delete'] },
          }
        }
      }
    },
    required: ['operations']
  }
};

const DEEPLY_NESTED_TOOL = {
  name: 'deepTool',
  description: 'Tool with deep nesting',
  parameters: {
    type: 'object' as const,
    properties: {
      level1: {
        type: 'object' as const,
        description: 'L1',
        properties: {
          level2: {
            type: 'object' as const,
            description: 'L2',
            properties: {
              level3: {
                type: 'object' as const,
                description: 'L3',
                properties: {
                  level4: {
                    type: 'object' as const,
                    description: 'L4',
                    properties: {
                      value: { type: 'string' as const, description: 'Deep value' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

// ============================================================
// Import real tool schemas from the project
// ============================================================

async function importRealTools() {
  // Import dynamically to avoid build issues
  const { agentTools } = await import('../src/engine/agent/tools/index');
  return agentTools;
}

// ============================================================
// Run tests
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log(`Gemini 400 Diagnostic — Model: ${MODEL}`);
  console.log('='.repeat(60));

  // ---- Test 1: Bare request (no tools) ----
  await test('1. Bare request (no tools)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Say hello in one word.' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
      }
    });
    console.log(`(got: "${result.text?.slice(0, 50)}")`);
  });

  // ---- Test 2: Bare request with thinkingConfig ----
  await test('2. With thinkingConfig LOW', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingLevel: 'LOW' as any }
      }
    });
    console.log(`(got: "${result.text?.slice(0, 50)}")`);
  });

  // ---- Test 2b: thinkingConfig MINIMAL (invalid?) ----
  await test('2b. With thinkingConfig MINIMAL (potentially invalid)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingLevel: 'MINIMAL' as any }
      }
    });
    console.log(`(got: "${result.text?.slice(0, 50)}")`);
  });

  // ---- Test 3: Simple tool ----
  await test('3. Simple tool (no nested required)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Greet Alice' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(got tool calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test 4: Tool WITH required in items ----
  await test('4. Tool WITH required inside items (suspect!)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a node' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        tools: [{ functionDeclarations: [TOOL_WITH_REQUIRED_IN_ITEMS] }],
      }
    });
    console.log(`(got tool calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test 5: Tool WITHOUT required in items ----
  await test('5. Same tool WITHOUT required in items', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a node' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        tools: [{ functionDeclarations: [TOOL_WITHOUT_REQUIRED_IN_ITEMS] }],
      }
    });
    console.log(`(got tool calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test 6: Deeply nested tool ----
  await test('6. Deeply nested tool (4 levels)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Set value to test' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 256,
        tools: [{ functionDeclarations: [DEEPLY_NESTED_TOOL] }],
      }
    });
    console.log(`(got tool calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test 7: High maxOutputTokens ----
  await test('7. High maxOutputTokens (65536)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 65536,
      }
    });
    console.log(`(got: "${result.text?.slice(0, 50)}")`);
  });

  // ---- Test 8: thinkingConfig + tools ----
  await test('8. thinkingConfig LOW + simple tool', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Greet Bob' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        tools: [{ functionDeclarations: [SIMPLE_TOOL] }],
      }
    });
    console.log(`(got tool calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Test 9: Real project tools, one by one ----
  console.log('\n' + '='.repeat(60));
  console.log('Testing REAL project tool schemas one-by-one...');
  console.log('='.repeat(60));

  let realTools: any[];
  try {
    realTools = await importRealTools();
  } catch (e: any) {
    console.log(`\n⚠️  Could not import real tools: ${e.message?.slice(0, 100)}`);
    console.log('Skipping real tool tests.');
    return;
  }

  for (const tool of realTools) {
    const decl = {
      name: tool.name,
      description: (tool.description || '').slice(0, 200),
      parameters: tool.parameters
    };

    await test(`9-${tool.name}: Real schema`, async () => {
      const result = await client.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `Use the ${tool.name} tool to do something simple.` }] }],
        config: {
          temperature: 0.4,
          maxOutputTokens: 1024,
          tools: [{ functionDeclarations: [decl] }],
        }
      });
      const fc = result.functionCalls?.length || 0;
      const text = result.text?.slice(0, 40) || '';
      console.log(`(calls: ${fc}, text: "${text}")`);
    });
  }

  // ---- Test 10: ALL real tools together ----
  await test('10. ALL real tools together', async () => {
    const decls = realTools.map(t => ({
      name: t.name,
      description: (t.description || '').slice(0, 200),
      parameters: t.parameters
    }));

    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a simple login form with email and password fields.' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        tools: [{ functionDeclarations: decls }],
      }
    });
    const fc = result.functionCalls?.length || 0;
    console.log(`(calls: ${fc})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Diagnostic complete.');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
