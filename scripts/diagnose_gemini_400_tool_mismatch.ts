/**
 * @file diagnose_gemini_400_tool_mismatch.ts
 * Test: Does Gemini 400 when history contains functionCalls to tools
 * that are NOT in the current functionDeclarations?
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

// Planning tools (used in turn 1)
const PLANNING_TOOLS = [
  { name: 'getDesignSystemTokens', description: 'Get design tokens', parameters: { type: 'OBJECT' as any, properties: { tokenType: { type: 'STRING' as any } } } },
  { name: 'listProjectComponents', description: 'List project components', parameters: { type: 'OBJECT' as any, properties: {} } },
  { name: 'planDesign', description: 'Create a design plan', parameters: { type: 'OBJECT' as any, properties: { analysis: { type: 'STRING' as any }, steps: { type: 'ARRAY' as any, items: { type: 'OBJECT' as any, properties: { title: { type: 'STRING' as any } } } } } } },
];

// Execution tools (used in turn 2) - completely different set
const EXECUTION_TOOLS = [
  { name: 'createNode', description: 'Create a node', parameters: { type: 'OBJECT' as any, properties: { type: { type: 'STRING' as any }, name: { type: 'STRING' as any } } } },
  { name: 'batchOperations', description: 'Batch operations', parameters: { type: 'OBJECT' as any, properties: { ops: { type: 'ARRAY' as any, items: { type: 'STRING' as any } } } } },
  { name: 'deleteNode', description: 'Delete a node', parameters: { type: 'OBJECT' as any, properties: { nodeId: { type: 'STRING' as any } } } },
  { name: 'complete_task', description: 'Complete task', parameters: { type: 'OBJECT' as any, properties: { summary: { type: 'STRING' as any } } } },
];

async function main() {
  const client = new GoogleGenAI({ apiKey: API_KEY });

  // Step 1: Get real response with PLANNING tools
  console.log('=== Step 1: Planning turn ===');
  const resp1 = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: 'Create a login form' }] }],
    config: {
      tools: [{ functionDeclarations: PLANNING_TOOLS }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
      thinkingConfig: { thinkingLevel: 'LOW' as any },
      maxOutputTokens: 4096
    }
  });

  const parts1 = resp1.candidates?.[0]?.content?.parts || [];
  const fcParts = parts1.filter((p: any) => p.functionCall);
  console.log('Function calls:', fcParts.map((p: any) => p.functionCall.name));
  const sig = (fcParts[0] as any)?.thoughtSignature;
  console.log('Signature:', sig ? sig.slice(0, 20) + '...' : 'NONE');

  if (fcParts.length === 0) { console.log('No function calls, aborting'); return; }

  // Build history
  const modelParts = fcParts.map((p: any) => ({
    functionCall: { name: p.functionCall.name, args: p.functionCall.args },
    ...(sig && { thoughtSignature: sig })
  }));

  const toolRespParts = fcParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: {} }
    },
    ...(sig && { thoughtSignature: sig })
  }));

  // Test A: Send history with EXECUTION tools (different from what history used)
  console.log('\n=== Test A: History has planning tool calls, but EXECUTION tools provided ===');
  try {
    const respA = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespParts },
      ],
      config: {
        tools: [{ functionDeclarations: EXECUTION_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const c of respA) { chunks++; }
    console.log(`✅ Mismatched tools: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Mismatched tools: FAILED -', e.message?.slice(0, 300));
  }

  // Test B: Same but with COMBINED tools (all planning + execution)
  console.log('\n=== Test B: Combined tools (planning + execution) ===');
  try {
    const respB = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespParts },
      ],
      config: {
        tools: [{ functionDeclarations: [...PLANNING_TOOLS, ...EXECUTION_TOOLS] }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const c of respB) { chunks++; }
    console.log(`✅ Combined tools: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Combined tools: FAILED -', e.message?.slice(0, 300));
  }

  // Test C: Mismatched + ANY mode
  console.log('\n=== Test C: Mismatched tools + ANY mode ===');
  try {
    const respC = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespParts },
      ],
      config: {
        tools: [{ functionDeclarations: EXECUTION_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const c of respC) { chunks++; }
    console.log(`✅ Mismatched + ANY: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Mismatched + ANY: FAILED -', e.message?.slice(0, 300));
  }

  // Test D: Mismatched + ANY + WITHOUT sig on functionResponse
  console.log('\n=== Test D: Mismatched + ANY + no sig on funcResponse ===');
  const toolRespNoSig = fcParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: {} }
    }
  }));
  try {
    const respD = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Create a login form' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespNoSig },
      ],
      config: {
        tools: [{ functionDeclarations: EXECUTION_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const c of respD) { chunks++; }
    console.log(`✅ Mismatched + ANY + no funcResp sig: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Mismatched + ANY + no funcResp sig: FAILED -', e.message?.slice(0, 300));
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
