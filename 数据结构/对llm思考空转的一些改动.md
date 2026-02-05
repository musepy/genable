前两轮修复已经解决了工具链断裂、Token 预算、温度等基础问题。第三轮添加了 toolConfig.mode='ANY' + 禁用 EXECUTION 模式流式中断 + maxTokens 4096。

问题 1：巨量文本前言导致 Context 爆炸
每个 EXECUTION iteration 产生 3000-5500 chars 的重复叙述文本（"I'm now focused on..."），这些文本全量保留在 context 中。

formatResponse() 将 response.fullParts（包含所有 text parts + functionCall parts）全部存入 LLMMessage.content
14 次迭代的叙述文本累计约 50K-70K tokens
Context 从 7K → 176K tokens（88%），接近 200K 上限
这不仅浪费 context 空间，还会加剧 Gemini 的叙述倾向（context 中充满了叙述文本，模型学习了这个模式）

问题 2：ANY 模式下叙述不断升级
Gemini 在 ANY 模式下确实最终会产出 tool calls，但它先输出越来越长的"前言"文本（iteration 5: ~5K chars → iteration 10: ~5.2K chars → iteration 13: ~5.6K chars）。这些文本内容是自我意识型叙述，Gemini 甚至写出 "I'm stuck in a loop" 但依然继续循环。
根因分析

formatResponse() 不过滤文本：Line 201-203 的 filter 是 part.text || part.functionCall || part.thought，保留了所有文本 parts
文本叙述污染 context：model 消息中的叙述文本成为 context 的一部分，Gemini 在后续迭代中"学习"了这个叙述模式，产生更多叙述
maxTokens 4096 不够小：4096 tokens ≈ 16K chars 的输出空间，足够 Gemini 写 5K chars 的废话后再产出 tool calls

修复方案（3 步，2 个文件）

Step 1 — 从 model 消息中剥离叙述文本，只保留 tool calls
文件: src/engine/agent/agentRuntime.ts（约 line 709 附近，formatResponse 调用后）
原理: 当 response 同时包含 text 和 tool calls 时，text 部分是纯粹的叙述废话（"I'm now building..."），对后续迭代没有任何信息价值。我们应该在存入 context 之前将其剥离。
修改: 在 const modelMessage = this.options.provider.formatResponse(response); 之后，添加文本剥离逻辑：
typescriptconst modelMessage = this.options.provider.formatResponse(response);
modelMessage.id = this.generateId('mdl');

// [FIX] Strip narration text from EXECUTION mode responses that contain tool calls.
// Gemini produces ~3000-5000 chars of repetitive narration BEFORE tool calls.
// This text pollutes context and reinforces the narration pattern.
// Only keep functionCall/functionResponse/thought parts.
if (mode === 'EXECUTION' && response.toolCalls && response.toolCalls.length > 0) {
  if (Array.isArray(modelMessage.content)) {
    const originalLength = modelMessage.content.length;
    modelMessage.content = (modelMessage.content as Part[]).filter(
      (part: Part) => part.functionCall || part.thought
    );
    const stripped = originalLength - modelMessage.content.length;
    if (stripped > 0) {
      console.log(`[AgentRuntime] 🧹 Stripped ${stripped} narration text parts from EXECUTION response. Kept ${modelMessage.content.length} functional parts.`);
    }
  }
}
影响: 每个 EXECUTION iteration 节省 ~750-1200 tokens 的 context 空间。14 次迭代累计节省 ~10K-17K tokens。更重要的是，消除了 context 中的叙述文本模式，减少 Gemini 的叙述倾向。

Step 2 — 进一步降低 EXECUTION 模式的 maxTokens
文件: src/engine/agent/agentRuntime.ts（约 line 597 附近）
原理: 当前 maxTokens: 4096（≈16K chars 输出空间）仍然给了 Gemini 太多空间来写废话。EXECUTION 模式每次迭代通常只需 1-4 个 tool calls，每个 tool call 约 100-300 tokens。2048 tokens 已经足够。
修改:
typescript// 之前:
const executionMaxTokens = mode === 'EXECUTION' ? 4096 : undefined;
// 之后:
const executionMaxTokens = mode === 'EXECUTION' ? 2048 : undefined;
影响: 将前言文本的物理空间从 ~16K chars 压缩到 ~8K chars。配合 Step 1 的文本剥离，即使 Gemini 写了废话也不会进入 context。

Step 3 — 优化 VERIFICATION 模式的 toolConfig
文件: src/engine/agent/agentRuntime.ts（约 line 589 附近）
原理: 当前 VERIFICATION 模式使用 AUTO，但 VERIFICATION 模式也需要工具调用（inspectDesign、validateLayout）来实际验证设计。如果 Gemini 在 VERIFICATION 模式也开始纯文本叙述，会在设计完成后卡住。
修改:
typescript// 之前:
const toolConfig = mode === 'EXECUTION'
  ? { mode: 'ANY' as const }
  : { mode: 'AUTO' as const };
// 之后:
const toolConfig = (mode === 'EXECUTION' || mode === 'VERIFICATION')
  ? { mode: 'ANY' as const }
  : { mode: 'AUTO' as const };
同时，对 VERIFICATION 模式也应用 maxTokens 限制和文本剥离（复用 Step 1 和 Step 2 的逻辑）。