/**
 * @file diagnose_gemini_400_funcresp_sig.ts
 * Test whether thoughtSignature on functionResponse parts causes 400.
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

const TOOLS = [{
  name: 'getDesignSystemTokens',
  description: 'Get design tokens',
  parameters: { type: 'OBJECT' as any, properties: { tokenType: { type: 'STRING' as any } } }
}, {
  name: 'listProjectComponents',
  description: 'List project components',
  parameters: { type: 'OBJECT' as any, properties: {} }
}];

async function main() {
  const client = new GoogleGenAI({ apiKey: API_KEY });

  // Step 1: Get a real response with signatures
  console.log('=== Step 1: Get real response ===');
  const resp1 = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: 'Get design tokens and list components' }] }],
    config: {
      tools: [{ functionDeclarations: TOOLS }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
      thinkingConfig: { thinkingLevel: 'LOW' as any },
      temperature: 0.4,
      maxOutputTokens: 4096
    }
  });

  const parts1 = resp1.candidates?.[0]?.content?.parts || [];
  console.log('Parts:', parts1.length);

  const functionCallParts = parts1.filter((p: any) => p.functionCall);
  console.log('FunctionCall parts:', functionCallParts.length);

  if (functionCallParts.length === 0) {
    console.log('No function calls returned, aborting');
    return;
  }

  // Extract signature
  const sig = (functionCallParts[0] as any).thoughtSignature;
  console.log('Signature:', sig ? sig.slice(0, 30) + '...' : 'NONE');

  // Build model turn
  const modelParts = functionCallParts.map((p: any) => ({
    functionCall: { name: p.functionCall.name, args: p.functionCall.args },
    ...(sig && { thoughtSignature: sig })
  }));

  // Step 2: Test WITH signature on functionResponse (current code behavior)
  console.log('\n=== Step 2: functionResponse WITH thoughtSignature ===');
  const toolResponseWithSig = functionCallParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: {} }
    },
    ...(sig && { thoughtSignature: sig })
  }));

  try {
    const resp2 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Get design tokens and list components' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponseWithSig }
      ],
      config: {
        tools: [{ functionDeclarations: TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        temperature: 0.4,
        maxOutputTokens: 4096
      }
    });
    console.log('✅ WITH sig on functionResponse: OK');
  } catch (e: any) {
    console.log('❌ WITH sig on functionResponse: FAILED -', e.message?.slice(0, 200));
  }

  // Step 3: Test WITHOUT signature on functionResponse
  console.log('\n=== Step 3: functionResponse WITHOUT thoughtSignature ===');
  const toolResponseNoSig = functionCallParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: {} }
    }
  }));

  try {
    const resp3 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Get design tokens and list components' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponseNoSig }
      ],
      config: {
        tools: [{ functionDeclarations: TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        temperature: 0.4,
        maxOutputTokens: 4096
      }
    });
    console.log('✅ WITHOUT sig on functionResponse: OK');
  } catch (e: any) {
    console.log('❌ WITHOUT sig on functionResponse: FAILED -', e.message?.slice(0, 200));
  }

  // Step 4: Test with 15 tools + AUTO mode (matching the actual failure scenario)
  console.log('\n=== Step 4: 15 tools + AUTO mode + multi-turn with sig ===');
  const manyTools = Array.from({ length: 15 }, (_, i) => ({
    name: `tool_${i}`,
    description: `Tool ${i} description`,
    parameters: { type: 'OBJECT' as any, properties: { arg: { type: 'STRING' as any } } }
  }));
  // Add the real tools at the end
  manyTools.push(...TOOLS as any);

  try {
    const resp4 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Get design tokens and list components' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponseWithSig }
      ],
      config: {
        tools: [{ functionDeclarations: manyTools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    console.log('✅ 15+ tools + AUTO + multi-turn: OK');
  } catch (e: any) {
    console.log('❌ 15+ tools + AUTO + multi-turn: FAILED -', e.message?.slice(0, 200));
  }

  // Step 5: Same but WITHOUT sig on functionResponse
  console.log('\n=== Step 5: 15 tools + AUTO + multi-turn WITHOUT sig on funcResponse ===');
  try {
    const resp5 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Get design tokens and list components' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponseNoSig }
      ],
      config: {
        tools: [{ functionDeclarations: manyTools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    console.log('✅ 15+ tools + AUTO + no funcResp sig: OK');
  } catch (e: any) {
    console.log('❌ 15+ tools + AUTO + no funcResp sig: FAILED -', e.message?.slice(0, 200));
  }

  // Step 6: Test with EXACTLY the full system prompt size (large systemInstruction)
  console.log('\n=== Step 6: Large system prompt + 15 tools + thoughtSignature on funcResponse ===');
  const largeSystemPrompt = 'You are a Figma design agent.\n'.repeat(200); // ~6000 chars

  try {
    const resp6 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Get design tokens and list components' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolResponseWithSig }
      ],
      config: {
        systemInstruction: largeSystemPrompt,
        tools: [{ functionDeclarations: manyTools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    console.log('✅ Large prompt + 15 tools + sig on funcResp: OK');
  } catch (e: any) {
    console.log('❌ Large prompt + 15 tools + sig on funcResp: FAILED -', e.message?.slice(0, 200));
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
