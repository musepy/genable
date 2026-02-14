/**
 * @file diagnose_gemini_400_signature.ts
 * Phase 3: Pinpoint the thought_signature requirement.
 *
 * Key finding: Gemini 3 Flash Preview REQUIRES thought_signature on functionCall parts
 * when replaying conversation history. We need to understand exactly when.
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL_G3 = 'gemini-3-flash-preview';
const MODEL_G25 = 'gemini-2.5-flash';

const client = new GoogleGenAI({ apiKey: API_KEY });

const TOOL = {
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
    console.log('❌ FAIL');
    console.log(`   ${msg.slice(0, 500)}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 3: thought_signature requirement analysis');
  console.log('='.repeat(60));

  // ---- Step 1: Make a real call to get a real thought_signature ----
  console.log('\nStep 1: Get real response from Gemini 3 to capture thought_signature...');

  const realResult = await client.models.generateContent({
    model: MODEL_G3,
    contents: [{ role: 'user', parts: [{ text: 'Create a header frame' }] }],
    config: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      tools: [{ functionDeclarations: [TOOL] }],
      thinkingConfig: { thinkingLevel: 'LOW' as any },
    }
  });

  const candidate = (realResult as any).candidates?.[0];
  const realParts = candidate?.content?.parts || [];

  console.log('Real response parts:');
  for (const p of realParts) {
    const keys = Object.keys(p);
    const hasSig = p.thoughtSignature || p.thought_signature;
    console.log(`  - keys: [${keys.join(', ')}] ${p.functionCall ? `fc(${p.functionCall.name})` : ''} ${p.thought !== undefined ? 'thought' : ''} sig: ${hasSig ? hasSig.slice(0, 20) + '...' : 'NONE'}`);
  }

  // Extract the real signature
  const sigPart = realParts.find((p: any) => p.thoughtSignature || p.thought_signature);
  const realSig = sigPart?.thoughtSignature || sigPart?.thought_signature;
  console.log(`\nReal signature: ${realSig ? realSig.slice(0, 30) + '...' : 'NONE FOUND'}`);

  // ---- Step 2: Replay with correct signature ----
  await test('2a. Replay with REAL thoughtSignature → should PASS', async () => {
    // Reconstruct model parts faithfully
    const modelParts = realParts.map((p: any) => {
      if (p.thought !== undefined) {
        return { text: p.text || '', thought: true, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
      }
      if (p.functionCall) {
        return { functionCall: p.functionCall, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
      }
      if (p.text) return { text: p.text };
      return p;
    });

    const toolResponses = modelParts.filter((p: any) => p.functionCall).map((p: any) => {
      const resp: any = { functionResponse: { name: p.functionCall.name, response: { success: true, nodeId: '1:2' } } };
      if (p.thoughtSignature) resp.thoughtSignature = p.thoughtSignature;
      return resp;
    });

    const result = await client.models.generateContent({
      model: MODEL_G3,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header frame' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Step 3: Replay WITHOUT signature (this is what the code does wrong) ----
  await test('2b. Replay WITHOUT thoughtSignature → should FAIL with 400', async () => {
    // Strip signatures from model parts
    const modelParts = realParts.map((p: any) => {
      if (p.thought !== undefined) {
        return { text: p.text || '', thought: true };  // NO signature
      }
      if (p.functionCall) {
        return { functionCall: p.functionCall };  // NO signature
      }
      if (p.text) return { text: p.text };
      return p;
    });

    const toolResponses = modelParts.filter((p: any) => p.functionCall).map((p: any) => ({
      functionResponse: { name: p.functionCall.name, response: { success: true } }
      // NO signature
    }));

    const result = await client.models.generateContent({
      model: MODEL_G3,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header frame' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
        thinkingConfig: { thinkingLevel: 'LOW' as any },
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // ---- Step 4: Same test WITHOUT thinkingConfig ----
  await test('3a. No thinkingConfig + replay WITHOUT sig → Gemini 3', async () => {
    // First call without thinkingConfig
    const r1 = await client.models.generateContent({
      model: MODEL_G3,
      contents: [{ role: 'user', parts: [{ text: 'Create a header frame' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
        // NO thinkingConfig
      }
    });

    const c1 = (r1 as any).candidates?.[0];
    const parts1 = c1?.content?.parts || [];
    console.log(`\n   Turn 1 parts: ${JSON.stringify(parts1.map((p: any) => ({ ...p, text: p.text?.slice(0, 30), thoughtSignature: p.thoughtSignature?.slice(0, 10) })))}`);

    const hasSig = parts1.some((p: any) => p.thoughtSignature || p.thought_signature);
    console.log(`   Has signature even without thinkingConfig: ${hasSig}`);

    if (!parts1.some((p: any) => p.functionCall)) {
      console.log('   (No tool calls, done)');
      return;
    }

    // Replay WITHOUT signatures
    const modelParts = parts1.map((p: any) => {
      if (p.thought !== undefined) return { text: p.text || '', thought: true };
      if (p.functionCall) return { functionCall: p.functionCall };
      if (p.text) return { text: p.text };
      return p;
    });

    const toolResponses = parts1.filter((p: any) => p.functionCall).map((p: any) => ({
      functionResponse: { name: p.functionCall.name, response: { success: true } }
    }));

    const r2 = await client.models.generateContent({
      model: MODEL_G3,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
      }
    });
    console.log(`   (calls: ${r2.functionCalls?.length || 0})`);
  });

  // ---- Step 5: Same test with Gemini 2.5 (should not need signatures) ----
  await test('4. Gemini 2.5-flash: replay WITHOUT sig → should PASS', async () => {
    const r1 = await client.models.generateContent({
      model: MODEL_G25,
      contents: [{ role: 'user', parts: [{ text: 'Create a header frame' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
      }
    });

    const c1 = (r1 as any).candidates?.[0];
    const parts1 = c1?.content?.parts || [];

    if (!parts1.some((p: any) => p.functionCall)) {
      console.log('(No tool calls from 2.5, done)');
      return;
    }

    const modelParts = parts1.map((p: any) => {
      if (p.functionCall) return { functionCall: p.functionCall };
      if (p.text) return { text: p.text };
      return p;
    });

    const toolResponses = parts1.filter((p: any) => p.functionCall).map((p: any) => ({
      functionResponse: { name: p.functionCall.name, response: { success: true } }
    }));

    const r2 = await client.models.generateContent({
      model: MODEL_G25,
      contents: [
        { role: 'user', parts: [{ text: 'Create a header' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponses },
      ],
      config: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [TOOL] }],
      }
    });
    console.log(`(calls: ${r2.functionCalls?.length || 0})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Phase 3 complete.');
  console.log('='.repeat(60));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
