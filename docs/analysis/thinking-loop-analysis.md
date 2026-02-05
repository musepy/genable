# 技术分析报告：LLM 思考空转（Thinking Loop）深度剖析

## 1. 现象定义：为何“ANY”模式下依然会崩溃？

在最近的 Figma 插件压力测试中，我们观察到即使开启了 `toolConfig.mode: 'ANY'`（强制工具调用），Gemini 依然在第 13 轮迭代时发生了崩溃。其核心表现为：

- **叙述不断升级**：Agent 在输出工具调用 JSON 之前，先输出了越来越长的叙述前言（Iteration 5: ~5K chars → Iteration 13: ~5.6K chars）。
- **物理崩溃**：冗长的前言导致输出缓冲区可能被提前耗尽，或者导致生成的 JSON 格式被截断，触发 `MALFORMED_FUNCTION_CALL`。
- **Context 爆炸**：由于 `formatResponse()` 保留了全量文本，14 次迭代累积了约 50K-70K tokens 的纯废话。

## 2. 根因分析：认知惯性与 Context 污染

### 2.1 强化学习陷阱
LLM 的行为高度依赖于 Context 中的“模式”。当 Context 中充斥着大量的：
*“我正在创建页眉... 我正在专注于 Email 字段... 我意识到我正在循环但我要继续...”*
这些文本不仅是冗余的，更是在**教导**模型：“这个任务的后续步骤就是写这种文本”。即使我们通过 `toolConfig` 强迫它调用工具，它也会先完成这种“教导模式”下的文学创作，再尝试调用工具。

### 2.2 物理限制下的逻辑溢出
由于系统的 `maxTokens` 配置给了 Gemini 足够的“废话空间”（如 4096 tokens），它在逻辑上认为自己可以先写 5000 字再做事。在这种情况下，工具调用被推挤到了输出的末尾，增加了不稳定性。

## 3. 设计权衡：干预 VS 自由度 (Gemini Workflow 思考)

在 `@/gemini` 工作流中，我们警惕“硬编码”和“孤立配置”。但针对“思考空转”，我们需要引入一种**“不可被 LLM 感知的纠正”**：

### 3.1 叙述剥离 (Step 1)
**设计决策**：在 `EXECUTION` 模式下，当响应同时包含 `text` 和 `toolCalls` 时，剥离 `text` 部分。
- **为什么要这样做？** 叙述文本（"I'm now building..."）由于不包含具体的状态修改或逻辑决策（这些都在 toolCalls 中），它在后续迭代中属于“无信息增量”。
- **风险分析**：这种剥离是不可被 LLM 感知的状态操纵。理论上它破坏了对话的真实性，但在工程实践中，它有效地清除了 LLM 的“认知锚点”，强制其在下一轮迭代中重新从功能性历史中启动。

### 3.2 物理压缩 (Step 2 & 3)
- **减小 maxTokens**：通过缩减物理输出空间，逼迫 LLM 提高输出的“信息密度”，减少前序叙述。
- **VERIFICATION 模式升级**：由 `AUTO` 切换为 `ANY`。验证过程同样需要具体的动作（验证布局、检查节点），而非纯文本感慨。

## 4. 修复实施方案 (3-Step Fix)

### Step 1 — 剥离 model 消息中的叙述文本
在 `src/engine/agent/agentRuntime.ts` 中，优化 `formatResponse` 后的存储逻辑：
```typescript
const modelMessage = this.options.provider.formatResponse(response);
// 仅在 EXECUTION/VERIFICATION 模式且有工具调用时剥离文本
if ((mode === 'EXECUTION' || mode === 'VERIFICATION') && response.toolCalls?.length > 0) {
  modelMessage.content = (modelMessage.content as Part[]).filter(p => !p.text);
}
```

### Step 2 — 调整物理输出阈值
将 `EXECUTION` 模式的 `maxTokens` 从 4096 降至 2048。

### Step 3 — 同步逻辑到 VERIFICATION 模式
确保验证环节同样具备动作执行的确定性。

## 5. 验证与 TDD (测试驱动开发)
为了确保修复有效，我们需要建立以下测试基准：
1. **Context 增长率测试**：模拟 10 次 EXECUTION 迭代，验证 Context 的 Token 增长是否收敛。
2. **工具首位测试**：验证在受限空间下，工具调用相对于文本前缀的物理排序是否更靠前。

## 6. 架构指导原则 (Architectural Principles)

为了防止此类问题再次出现，我们在 Agent 设计中确立了以下原则：

1. **功能性优先原则 (Functionality-First)**：在执行模式下，任何不贡献于系统状态改变（如工具调用）或逻辑推理（如 Thought）的输出都应被视为“噪声”，并在进入长期记忆前被过滤。
2. **负反馈驱动的 Context 治理**：当检测到模型陷入叙述循环时，系统必须通过外部指令（如注入 User Recovery Message）干扰模型的认知连贯性，并裁剪掉被污染的 Context 块。
3. **低熵输出约束**：通过精细化的 `maxTokens` 控制，物理性地限制模型产生幻觉的空间。一个健康的执行周期应该是“快速动作、即时反馈”。

## 7. 未来展望 (Future Outlook)

随着大模型上下文窗口的不断扩大（如 Gemini 2.0 的 200W+），简单地“限制 Token”将不再是唯一手段。未来的方向应当转向：
- **语义去噪层**：在 LLM 与 Context 之间增加一个语义层，自动摘要掉重复的进度描述。
- **元认知监控器**：作为独立的轻量级模型或逻辑，监控主代理的“词云频率”，及时识别循环征兆。

---
*整理于 2026-02-04*
