/**
 * @file test_multiturn_style.ts
 * 测试代理在连续对话中能否记住和继承前一步的设计风格（多轮对话上下文测试）。
 *
 * Usage: npx tsx scripts/test_multiturn_style.ts
 */

import { GoogleGenAI } from '@google/genai';
import { TokenRecorder } from '../src/engine/dev/TokenRecorder';

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-3-flash-preview';

const client = new GoogleGenAI({ apiKey: API_KEY });

async function main() {
  console.log('='.repeat(60));
  console.log('多轮对话风格继承测试 (Multi-turn Style Inheritance Test)');
  console.log('='.repeat(60));

  // Initialize token recorder
  TokenRecorder.init(undefined, `multiturn_${Date.now().toString(36)}`);


  // 加载真实的工具 schema
  const { agentTools } = await import('../src/engine/agent/tools/index');
  const decls = agentTools.filter(t => t.name === 'generateDesign').map(t => ({
    name: t.name,
    description: (t.description || '').slice(0, 300),
    parameters: t.parameters
  }));

  const systemInstruction = 'You are an expert Figma design assistant. When designing components, strictly use the layout and style conventions provided by the user. If asked to match a previous style, you MUST reuse the exact same colors, corner radii, spacing, and effects from your previous tool calls. Output tool calls using `generateDesign`.';

  // ==========================================
  // TURN 1: Design a Form with specific styling
  // ==========================================
  console.log('\n[Turn 1] 用户: 设计一个表单，使用深色模式背景(#1A1A1A)，大圆角(24px)，并且带有投影风格。');
  
  const turn1Start = Date.now();
  const result1 = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: '设计一个表单，使用深色模式背景(#1A1A1A)，大圆角(24px)，并且带有投影风格。请直接使用 generateDesign 工具生成。' }] },
    ],
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      systemInstruction,
      tools: [{ functionDeclarations: decls }],
      thinkingConfig: { thinkingLevel: 'LOW' as any },
    }
  });
  const turn1LatencyMs = Date.now() - turn1Start;

  // Record turn 1 token usage
  const usage1 = (result1 as any).usageMetadata;
  TokenRecorder.record({
    source: 'multiturn:turn1',
    model: MODEL,
    provider: 'gemini',
    iteration: 1,
    promptTokens: usage1?.promptTokenCount || 0,
    completionTokens: usage1?.candidatesTokenCount || 0,
    totalTokens: usage1?.totalTokenCount || 0,
    latencyMs: turn1LatencyMs,
    config: { testType: 'style-inheritance' },
  });

  const candidate1 = (result1 as any).candidates?.[0];
  const parts1 = candidate1?.content?.parts || [];
  
  const modelParts1 = parts1.map((p: any) => {
    if (p.thought !== undefined) return { text: p.text || '', thought: true, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
    if (p.functionCall) return { functionCall: p.functionCall, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) };
    if (p.text) return { text: p.text };
    return p;
  });

  const toolCalls1 = modelParts1.filter((p: any) => p.functionCall);
  console.log(`[Turn 1] 模型调用了 ${toolCalls1.length} 个工具: ${toolCalls1.map((p: any) => p.functionCall.name).join(', ')}`);
  
  // 打印生成的属性以验证
  if (toolCalls1.length > 0 && toolCalls1[0].functionCall.name === 'generateDesign') {
    const args = toolCalls1[0].functionCall.args;
    console.log('[Turn 1] 核心样式提取:');
    try {
        const rootNode = args.nodes[0];
        console.log(`   - Root Node type: ${rootNode.type}`);
        console.log(`   - Root Node props: ${JSON.stringify(rootNode.props)}`);
        if (rootNode.children && rootNode.children.length > 0) {
            console.log(`   - First Child props: ${JSON.stringify(rootNode.children[0].props)}`);
        }
    } catch(e) {}
  }

  // 构建模拟的工具返回结果
  const toolResponses = toolCalls1.map((p: any) => {
    const resp: any = { functionResponse: { name: p.functionCall.name, response: { success: true, result: 'Form generated successfully' } } };
    if (p.thoughtSignature) resp.thoughtSignature = p.thoughtSignature;
    return resp;
  });

  // ==========================================
  // TURN 2: Design a Login Component matching the style
  // ==========================================
  console.log('\n[Turn 2] 用户: 现在设计一个登录组件，需要跟刚才的表单保持完全相同的风格设计。');
  
  const turn2Start = Date.now();
  const result2 = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: '设计一个表单，使用深色模式背景(#1A1A1A)，大圆角(24px)，并且带有投影风格。请直接使用 generateDesign 工具生成。' }] },
      { role: 'model', parts: modelParts1 },
      { role: 'user', parts: [...toolResponses, { text: '现在设计一个登录组件，包含用户名和密码输入框，需要跟刚才的表单保持完全相同的风格设计。请直接使用 generateDesign 生成。' }] },
    ],
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      systemInstruction,
      tools: [{ functionDeclarations: decls }],
      thinkingConfig: { thinkingLevel: 'LOW' as any },
    }
  });
  const turn2LatencyMs = Date.now() - turn2Start;

  // Record turn 2 token usage
  const usage2 = (result2 as any).usageMetadata;
  TokenRecorder.record({
    source: 'multiturn:turn2',
    model: MODEL,
    provider: 'gemini',
    iteration: 2,
    promptTokens: usage2?.promptTokenCount || 0,
    completionTokens: usage2?.candidatesTokenCount || 0,
    totalTokens: usage2?.totalTokenCount || 0,
    latencyMs: turn2LatencyMs,
    config: { testType: 'style-inheritance' },
  });

  const candidate2 = (result2 as any).candidates?.[0];
  const parts2 = candidate2?.content?.parts || [];
  
  const toolCalls2 = parts2.filter((p: any) => p.functionCall);
  console.log(`[Turn 2] 模型调用了 ${toolCalls2.length} 个工具: ${toolCalls2.map((p: any) => p.functionCall.name).join(', ')}`);

  // 验证登录组件的样式是否继承
  let success = false;
  if (toolCalls2.length > 0 && toolCalls2[0].functionCall.name === 'generateDesign') {
    const args = toolCalls2[0].functionCall.args;
    console.log('[Turn 2] 核心样式提取 (期待 #1A1A1A, cornerRadius 24, effects):');
    try {
        const rootNode = args.nodes[0];
        console.log(`   - Root Node type: ${rootNode.type}`);
        console.log(`   - Root Node props: ${JSON.stringify(rootNode.props)}`);
        
        const propsStr = JSON.stringify(rootNode.props || {});
        if (propsStr.includes('1A1A1A') || propsStr.includes('26, 26, 26') || propsStr.includes('0.102')) {
            success = true;
        }
        if (propsStr.includes('24')) {
            success = true;
        }
    } catch(e) {}
  }

  if (success) {
      console.log('\n✅ 测试通过: Agent 能够听懂并跨多轮继承前一步的设计风格！');
  } else {
      console.log('\n❌ 测试可能失败: 未检测到预期的样式属性。');
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
