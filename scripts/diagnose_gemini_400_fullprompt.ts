/**
 * @file diagnose_gemini_400_fullprompt.ts
 * Phase 5: Test with the FULL system prompt + all tools + behavior config
 * to reproduce the exact first-turn call the plugin makes.
 */

import { GoogleGenAI } from '@google/genai';
import { agentTools } from '../src/engine/agent/tools/index';
import { composeAgentSystemPrompt } from '../src/engine/llm-client/context/promptComposer';
import { inferBehavior } from '../src/engine/agent/agentBehaviorConfig';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

const client = new GoogleGenAI({ apiKey: API_KEY });

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
  console.log('Phase 5: Full System Prompt + All Tools');
  console.log('='.repeat(60));

  // Build the real system prompt
  const behavior = inferBehavior('Create a login form with email and password', undefined);
  console.log('Behavior config:', { thinkingLevel: behavior.thinkingLevel, designStrategy: behavior.designStrategy });

  let systemPrompt: string;
  try {
    systemPrompt = await composeAgentSystemPrompt(
      {
        ragResults: { prioritizedComponents: [], goldenTemplates: [] },
        designSystemContext: { skillName: 'vanilla' },
        intent: { originalRequest: 'Create a login form', requiresLayoutKnowledge: true },
        selectionContext: undefined,
        behaviorConfig: behavior,
        operationLog: [],
        activeStep: undefined
      },
      agentTools,
      { name: 'gemini', getToolSystemInstruction: () => '' } as any,
      { totalBudget: 128000, mode: 'PLANNING' }
    );
    console.log(`\nSystem prompt length: ${systemPrompt.length} chars (~${Math.round(systemPrompt.length/4)} tokens)`);
  } catch (e: any) {
    console.log(`Could not compose system prompt: ${e.message}`);
    systemPrompt = 'You are a Figma design assistant.';
  }

  const toolDecls = agentTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));

  console.log(`Total tools: ${toolDecls.length}`);
  console.log(`Total tool schema size: ${JSON.stringify(toolDecls).length} chars`);

  // Test A: Full prompt, all tools, no thinking
  await test('A. Full prompt + all tools (no thinkingConfig)', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a login form' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDecls }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0}, text: ${result.text?.slice(0, 50)})`);
  });

  // Test B: Full prompt, all tools, with thinking LOW
  await test('B. Full prompt + all tools + thinkingConfig LOW', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a login form' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDecls }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        thinkingConfig: { thinkingLevel: 'LOW' as any }
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // Test C: Full prompt, all tools, streaming
  await test('C. Full prompt + all tools + streaming', async () => {
    const result = await (client as any).models.generateContentStream({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a login form' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDecls }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        thinkingConfig: { thinkingLevel: 'LOW' as any }
      }
    });

    let text = '';
    let toolCallCount = 0;
    for await (const chunk of result) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.text) text += p.text;
        if (p.functionCall) toolCallCount++;
      }
    }
    console.log(`(calls: ${toolCallCount}, text: ${text.slice(0, 50)})`);
  });

  // Test D: maxOutputTokens 65536 + full prompt
  await test('D. Full prompt + maxOutputTokens 65536', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a simple button' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 65536,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDecls }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        thinkingConfig: { thinkingLevel: 'LOW' as any }
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  // Test E: toolConfig mode ANY
  await test('E. Full prompt + toolConfig mode ANY', async () => {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Create a login form' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDecls }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        thinkingConfig: { thinkingLevel: 'LOW' as any }
      }
    });
    console.log(`(calls: ${result.functionCalls?.length || 0})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Phase 5 complete.');
  console.log('='.repeat(60));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
