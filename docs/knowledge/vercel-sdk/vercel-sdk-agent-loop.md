# Agent Loop：SDK 驱动 vs 自建循环

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：为什么 OpenPencil 用 `ToolLoopAgent`？我们的自建循环有什么设计缺陷？

---

## 1. ToolLoopAgent 的设计优势是什么？

`ToolLoopAgent` 是 Vercel AI SDK v6 提供的高层 Agent 抽象。它的核心价值不只是"帮你写 while 循环"——它解决了**循环本身的正确性问题**。

### 1.1 三个正确性问题

**问题 A：终止条件（什么时候停？）**

```typescript
// SDK 的终止语义
const agent = new ToolLoopAgent({
  stopWhen: stepCountIs(50),  // ← 声明式
})
```

SDK 内部实现的是：**LLM 不再发出工具调用 + 未达到步数上限** → 自然终止。这是一个**组合条件**，SDK 确保两者都被正确处理。

对比我们：

```typescript
// agentRuntime.ts L882-L988 — 我们的终止逻辑（简化）
if (toolCallsForExecution.length > 0) {
  // 执行工具...
  iteration++;
  continue;  // ← 继续
} else {
  // 无工具调用...
  // 检查 finishReason 是否 truncation
  if (fr && fr !== 'stop' && fr !== 'tool_calls') {
    truncationCount++;
    if (truncationCount <= 3) { continue; }  // ← 重试
  }
  return response.text;  // ← 退出
}
```

**差异**：我们把"无工具调用"当作终止信号，但这忽略了一种场景——LLM 可能在思考中间生成了纯文本（比如"让我先分析这个设计..."），随后想继续调用工具。我们的实现会**提前退出**。

**问题 B：步数计量（怎么数步？）**

```typescript
// SDK: stepCountIs(n) — 每个 generateText 调用算 1 步
// 包含：LLM 生成 + 工具执行 + 结果回填 = 1 step

// 我们: iteration++ 在工具执行后
// 但 truncation retry 也 iteration++ — 计量口径不一致
```

**问题 C：消息拼装（工具结果怎么回填？）**

SDK 内部处理：LLM 返回 tool_calls → 执行 → 将 tool_result 附加到消息历史 → 再次请求 LLM。整个过程的**消息格式由 SDK 保证符合 Provider 规范**。

我们需要：

```typescript
// agentRuntime.ts L866-868
const modelMessage = this.options.provider.formatResponse(response);
modelMessage.id = this.generateId('mdl');
this.turnMessages.push(modelMessage);
```

以及：

```typescript
// toolDispatcher.ts — 手动构造 tool_result 消息
formatToolResults: (results) => options.provider.formatToolResults(results),
```

每换一个 Provider（Gemini → Claude → GPT），这些消息格式的细节差异都需要我们**手动处理**。SDK 把这个统一了。

### 1.2 OpenPencil 选择 SDK 的原因

回答"为什么用这个"——看它**不需要做什么**就知道了：

```typescript
// use-chat.ts — OpenPencil 的完整 Agent 设置（仅 15 行）
const agent = new ToolLoopAgent({
  model: createModel(),
  instructions: SYSTEM_PROMPT,
  tools: createAITools(store),
  stopWhen: stepCountIs(MAX_AGENT_STEPS),
  maxOutputTokens: maxOutputTokens.value,
  prepareCall: (options) => {
    resetRunSteps()
    return { ...options, maxOutputTokens: maxOutputTokens.value }
  },
  onStepFinish: ({ usage }) => {
    recordStepUsage({...})
  }
})
return new DirectChatTransport({ agent })
```

OpenPencil **没有写**：
- while 循环
- 消息拼装逻辑
- finishReason 检测
- truncation retry
- toolCall 解析和 normalize

这些全部由 SDK 内部处理，OpenPencil 只需要关注**业务逻辑**（工具定义、快照、undo）。

---

## 2. 我们的"无工具调用 = 结束"判断有什么问题？

### 2.1 问题场景

```
用户: "把这个按钮改成圆角 16px，然后给它加一个阴影"

LLM 想法: 我需要先读取节点信息...
LLM 输出: "让我先看看这个按钮的当前状态"  ← 纯文本，没有 tool_call

我们的 AgentRuntime: return response.text  ← 提前退出！
                     （按钮既没改圆角，也没加阴影）
```

### 2.2 SDK 怎么处理

ToolLoopAgent 的内部逻辑更像：

```
while (step < maxSteps) {
  response = await model.generate(messages)
  
  if (response.hasToolCalls) {
    for (tc of response.toolCalls) {
      result = await tools[tc.name].execute(tc.args)
      messages.push(toolResultMessage(tc, result))
    }
  }
  
  if (!response.hasToolCalls) {
    break  // ← 也是无工具调用=结束，但关键区别在于...
  }
  // ...SDK 保证了 LLM 格式规范，减少了"本该调用工具但没调用"的情况
}
```

**重要澄清**：SDK 的终止逻辑本质上也是"无工具调用 = 结束"。但它的优势在于：
1. **消息协议更可靠**：SDK 确保每个 Provider 的 function calling 协议被正确执行，减少因格式问题导致的"LLM 想调工具但没能正确表达"
2. **prepareCall 钩子**：可以在每步之前修改参数（比如强制 toolChoice），这是我们自建循环中用 `toolConfig: { mode: 'AUTO' }` 做的，但灵活度不如 SDK 的 per-step 控制

### 2.3 改进方向

不一定要切 SDK，但可以借鉴：

```typescript
// 方案：在纯文本回复时，检查是否"确实完成"而非"中途思考"
if (toolCallsForExecution.length === 0) {
  // 新增：检查回复内容是否包含"未完成"信号
  const isThinking = detectThinkingResponse(response.text);
  if (isThinking && truncationCount < 3) {
    // 注入"请继续"并重试，而非直接退出
    this.turnMessages.push({
      id: this.generateId('cont'),
      role: 'user',
      content: 'Please proceed with the tool calls to complete the task.',
      synthetic: true,
    });
    iteration++;
    continue;
  }
  return response.text;
}
```

---

## 3. 核心对比表

| 维度 | `ToolLoopAgent` (SDK) | 我们的自建循环 |
|------|----------------------|-------------|
| 循环控制 | `stopWhen: stepCountIs(n)` | `while (iteration < max)` |
| 终止条件 | 无 tool_calls = 结束 (SDK 保证协议正确) | 无 tool_calls = 结束 (但消息格式自己管) |
| 步数计量 | SDK 统一定义"步" | iteration++ 口径不一致 |
| 消息拼装 | SDK 按 Provider 规范自动组装 | `formatResponse` + `formatToolResults` 手动 |
| Truncation | SDK 内部处理 | 3 次重试后强制结束 |
| 代码行数 | ~15 行配置 | ~200 行循环逻辑 |
| Provider 兼容 | 自动 | 需要每个 Provider 实现 format 方法 |

## 4. 决策影响

**如果用 SDK**：删除 ~200 行循环代码，消除消息格式兼容问题，获得更可靠的终止行为。但需要确保 4 层 Context（system + summary + history + turn）能映射到 SDK 的 instructions + messages 模型。

**如果不用 SDK**：保留完全控制权，但需要修复"无工具调用 = 结束"的过早退出问题，并确保步数计量一致性。我们的 Hook 系统（beforeIteration、afterLLMResponse 等）是 SDK 不提供的增值能力。

**混合方案**：用 SDK 的 `ToolLoopAgent` 管循环和消息，但在工具的 `execute` 函数中保留我们的 Hook 系统。
