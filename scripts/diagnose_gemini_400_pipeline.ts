/**
 * @file diagnose_gemini_400_pipeline.ts
 * Phase 4: Simulate the EXACT code pipeline to find where signature is lost.
 *
 * Flow: Gemini API → mapToLLMResponse → formatResponse → context → mapToGenAIContent → Gemini API
 */

import { GoogleGenAI } from '@google/genai';
import { GeminiProvider } from '../src/engine/llm-client/providers/gemini';

const API_KEY = 'AIzaSyCSgvgKRD8zF0Wm9nGRVXriSzS4mMxvM9I';
const MODEL = 'gemini-3-flash-preview';

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
  },
  executionStrategy: 'sequential' as const,
  category: 'create' as const,
  dependencies: [] as string[]
};

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 4: Pipeline Simulation');
  console.log('='.repeat(60));

  const provider = new GeminiProvider(API_KEY, MODEL);

  // ---- Turn 1: Get real response from API via our provider ----
  console.log('\n--- Turn 1: Call API via GeminiProvider ---');

  let response1;
  try {
    response1 = await provider.generate({
      messages: [
        { id: 'sys', role: 'system', content: 'You are a Figma design assistant. Use tools to create nodes.' },
        { id: 'usr1', role: 'user', content: 'Create a header frame' }
      ],
      tools: [TOOL],
      thinkingLevel: 'low',
      onProgress: () => {},
      onThinking: () => {},
    });
  } catch (e: any) {
    console.error('Turn 1 FAILED:', e.message);
    return;
  }

  console.log('\nTurn 1 LLMResponse:');
  console.log('  text:', response1.text?.slice(0, 50));
  console.log('  thoughts:', response1.thoughts?.slice(0, 50));
  console.log('  toolCalls:', response1.toolCalls?.length);
  console.log('  fullParts:', response1.fullParts?.length);

  if (response1.fullParts) {
    for (const [i, p] of response1.fullParts.entries()) {
      const keys = Object.keys(p);
      const hasSig = (p as any).thought_signature || (p as any).thoughtSignature;
      console.log(`  part[${i}]: keys=[${keys.join(',')}] sig=${hasSig ? String(hasSig).slice(0, 15) + '...' : 'NONE'}`);
    }
  }

  // ---- formatResponse: Convert to LLMMessage ----
  console.log('\n--- formatResponse ---');
  const modelMessage = provider.formatResponse(response1);
  console.log('  role:', modelMessage.role);
  console.log('  content type:', typeof modelMessage.content === 'string' ? 'string' : 'array');

  if (Array.isArray(modelMessage.content)) {
    for (const [i, p] of (modelMessage.content as any[]).entries()) {
      const keys = Object.keys(p);
      const hasSig = p.thought_signature || p.thoughtSignature;
      console.log(`  content[${i}]: keys=[${keys.join(',')}] sig=${hasSig ? String(hasSig).slice(0, 15) + '...' : 'NONE'}`);
    }
  }

  // ---- Simulate stripping text parts (like agentRuntime line 785-787) ----
  console.log('\n--- Simulate EXECUTION mode text stripping ---');
  if (Array.isArray(modelMessage.content)) {
    const before = (modelMessage.content as any[]).length;
    const stripped = (modelMessage.content as any[]).filter(
      (part: any) => part.functionCall || part.thought
    );
    console.log(`  Before: ${before} parts, After: ${stripped.length} parts`);

    for (const [i, p] of stripped.entries()) {
      const keys = Object.keys(p);
      const hasSig = p.thought_signature || p.thoughtSignature;
      console.log(`  stripped[${i}]: keys=[${keys.join(',')}] sig=${hasSig ? String(hasSig).slice(0, 15) + '...' : 'NONE'}`);
    }

    // Use stripped content for Turn 2
    modelMessage.content = stripped;
  }

  // ---- formatToolResults: Create tool response ----
  console.log('\n--- formatToolResults ---');
  const toolResults = (response1.toolCalls || []).map(tc => ({
    name: tc.name,
    id: tc.id,
    response: { success: true, nodeId: '1:2' },
    thought_signature: tc.thought_signature
  }));

  const toolMessage = provider.formatToolResults(toolResults);
  console.log('  role:', toolMessage.role);
  if (Array.isArray(toolMessage.content)) {
    for (const [i, p] of (toolMessage.content as any[]).entries()) {
      const keys = Object.keys(p);
      const hasSig = (p as any).thought_signature || (p as any).thoughtSignature;
      console.log(`  toolContent[${i}]: keys=[${keys.join(',')}] sig=${hasSig ? String(hasSig).slice(0, 15) + '...' : 'NONE'}`);
    }
  }

  // ---- Turn 2: Send back to API ----
  console.log('\n--- Turn 2: Send history back to API ---');

  const messages = [
    { id: 'sys', role: 'system' as const, content: 'You are a Figma design assistant.' },
    { id: 'usr1', role: 'user' as const, content: 'Create a header frame' },
    modelMessage,
    toolMessage,
  ];

  // Debug: What mapToGenAIContent will produce
  // Access private method via prototype
  const mapFn = (provider as any).mapToGenAIContent.bind(provider);

  console.log('\nmapToGenAIContent output for each message:');
  for (const msg of messages.filter(m => m.role !== 'system')) {
    const mapped = mapFn(msg);
    console.log(`  [${msg.role}] parts:`);
    for (const [i, p] of mapped.parts.entries()) {
      const keys = Object.keys(p);
      const hasSig = p.thoughtSignature || p.thought_signature;
      console.log(`    part[${i}]: keys=[${keys.join(',')}] ${p.functionCall ? `fc(${p.functionCall.name})` : ''} sig=${hasSig ? String(hasSig).slice(0, 15) + '...' : 'NONE'}`);
    }
  }

  // Actually try the API call
  try {
    const response2 = await provider.generate({
      messages,
      tools: [TOOL],
      thinkingLevel: 'low',
      onProgress: () => {},
      onThinking: () => {},
    });
    console.log('\n✅ Turn 2 SUCCEEDED!');
    console.log('  toolCalls:', response2.toolCalls?.length);
    console.log('  text:', response2.text?.slice(0, 50));
  } catch (e: any) {
    console.log('\n❌ Turn 2 FAILED!');
    console.log('  Error:', e.message?.slice(0, 300));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Phase 4 complete.');
  console.log('='.repeat(60));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
