/**
 * @file diagnose_gemini_400_exact.ts
 * Reproduce the EXACT failure: use real tool schemas, real system prompt size,
 * streaming mode, thinkingLevel HIGH, 15 EXECUTION tools.
 */

import { GoogleGenAI } from '@google/genai';
// Import the actual tool definitions
import { agentTools, getToolsForMode } from '../src/engine/agent/tools/index';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

async function main() {
  const client = new GoogleGenAI({ apiKey: API_KEY });

  // Get the EXACT 15 EXECUTION tools
  const execTools = getToolsForMode('EXECUTION', agentTools);
  console.log(`EXECUTION tools: ${execTools.length}`);
  console.log('Tool names:', execTools.map(t => t.name).join(', '));

  const functionDeclarations = execTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));

  // Use a system prompt similar in size to the real one (~5600 tokens)
  const systemPrompt = `You are a Figma design agent. You accomplish tasks by calling tools.
You don't just "arrange nodes"; you create experiences with intent.

## CORE POLICIES
- Reliability First: Strictly follow Figma API constraints.
- Precision: Use exact nodeIds from responses, never guess.
- Visual Integrity: Ensure designs are aesthetically pleasing.

## OUTPUT FORMAT: JSON FlatNode Array
Each node: { id, parent, type, props }
Types: FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON
Props: name, layoutMode, gap, padding, fills, cornerRadius, width, height, etc.

## THINKING PROTOCOL
- Observe: Read previous tool results.
- Action First: Call tools immediately.
- Step Tracking: Include stepId in tool calls.
`.repeat(3); // ~3x to match real prompt size

  // Step 1: First turn - get function calls
  console.log('\n=== Step 1: PLANNING turn (get function calls) ===');
  const planningTools = getToolsForMode('PLANNING', agentTools);
  console.log(`PLANNING tools: ${planningTools.length}`);

  let resp1;
  try {
    resp1 = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'A clean login form with email and password fields' }] }],
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: planningTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'LOW' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
  } catch (e: any) {
    console.log('❌ Planning turn FAILED:', e.message?.slice(0, 300));
    return;
  }

  const parts1 = resp1.candidates?.[0]?.content?.parts || [];
  const fcParts = parts1.filter((p: any) => p.functionCall);
  console.log(`Got ${fcParts.length} function calls`);

  if (fcParts.length === 0) {
    console.log('No function calls, aborting');
    return;
  }

  const sig = (fcParts[0] as any).thoughtSignature;
  console.log('Signature:', sig ? sig.slice(0, 30) + '...' : 'NONE');

  // Build model turn (matching real code behavior)
  const modelParts = fcParts.map((p: any) => ({
    functionCall: { name: p.functionCall.name, args: p.functionCall.args },
    ...(sig && { thoughtSignature: sig })
  }));

  // Build tool response turn (matching real code behavior - WITH sig on functionResponse)
  const toolRespPartsWithSig = fcParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: { _truncated: true } }
    },
    ...(sig && { thoughtSignature: sig })
  }));

  const toolRespPartsNoSig = fcParts.map((p: any) => ({
    functionResponse: {
      name: p.functionCall.name,
      response: { success: true, data: { _truncated: true } }
    }
  }));

  // Step 2: EXECUTION turn with streaming (matching real code)
  console.log('\n=== Step 2a: EXECUTION streaming + WITH sig on funcResponse ===');
  try {
    const stream2a = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'A clean login form with email and password fields' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespPartsWithSig }
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const chunk of stream2a) {
      chunks++;
    }
    console.log(`✅ Streaming + sig on funcResponse: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Streaming + sig on funcResponse: FAILED -', e.message?.slice(0, 300));
  }

  // Step 2b: Same but WITHOUT sig on functionResponse
  console.log('\n=== Step 2b: EXECUTION streaming + WITHOUT sig on funcResponse ===');
  try {
    const stream2b = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'A clean login form with email and password fields' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespPartsNoSig }
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const chunk of stream2b) {
      chunks++;
    }
    console.log(`✅ Streaming + no sig on funcResponse: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ Streaming + no sig on funcResponse: FAILED -', e.message?.slice(0, 300));
  }

  // Step 3: Test with ANY mode (before my fix would downgrade it)
  console.log('\n=== Step 3: EXECUTION streaming + ANY mode + 15 tools ===');
  try {
    const stream3 = await client.models.generateContentStream({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'A clean login form with email and password fields' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespPartsWithSig }
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    let chunks = 0;
    for await (const chunk of stream3) {
      chunks++;
    }
    console.log(`✅ ANY mode + 15 tools: OK (${chunks} chunks)`);
  } catch (e: any) {
    console.log('❌ ANY mode + 15 tools: FAILED -', e.message?.slice(0, 300));
  }

  // Step 4: Test non-streaming with same params
  console.log('\n=== Step 4: Non-streaming equivalent ===');
  try {
    const resp4 = await client.models.generateContent({
      model: MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'A clean login form with email and password fields' }] },
        { role: 'model', parts: modelParts },
        { role: 'user', parts: toolRespPartsWithSig }
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' as any } },
        thinkingConfig: { thinkingLevel: 'HIGH' as any },
        temperature: 0.4,
        maxOutputTokens: 65536
      }
    });
    console.log('✅ Non-streaming ANY + 15 tools: OK');
  } catch (e: any) {
    console.log('❌ Non-streaming ANY + 15 tools: FAILED -', e.message?.slice(0, 300));
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
