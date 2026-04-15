# JSX 截断循环 Bug 分析 (TRUNC-001)

> 日期: 2026-04-01
> 状态: 已修复（截断守卫）+ 待修复（intra-turn context 膨胀）

## 现象

LLM 反复输出 "Unterminated JSX contents" 错误，同样的截断模式重复 10+ 次，直到 iteration 上限或手动取消。

## 根因链

### 1. 单次输出被截断

LLM 每次调用有 `maxOutputTokens: 16384` 的输出上限。当设计复杂时，JSX 工具调用的参数太长，写到一半 token 用完，API 强制停止，返回 `finishReason: 'length'`。

```jsx
<Frame layout="vertical" padding="16">
  <Text>Hello</Text>
  <Frame layout="horizontal">
    <Button>Sign in</Bu   ← token 用完，直接断了
```

触发场景：dashboard、pricing table、多卡片布局等复杂页面。Kimi K2.5 尤其容易触发。

### 2. 截断守卫在错误的代码分支

`agentRuntime.ts` 中有截断检测（检查 `finishReason === 'length'`），但写在了 **无 tool call** 的 else 分支里：

```typescript
if (toolCallsForExecution.length > 0) {
  // → 直接执行 tool calls   ← 截断的 JSX 从这走，没人拦
} else {
  // → 截断检测在这里         ← 永远走不到，因为截断时通常有 tool calls
}
```

截断发生时 LLM 通常已经输出了 tool call 结构（只是参数不完整），所以走的是 if 分支，截断守卫从不触发。

### 3. 不完整 JSX 直接送解析 → 必定失败

截断的 JSX 交给 `compileJsx()`（sucrase 编译器），语法不完整 → 报 "Unterminated JSX contents" → 错误返回给 LLM。

### 4. LLM 重试同样的 JSX → 同一位置截断

LLM 看到错误后重新生成 JSX，但设计没变、token 上限没变，所以几乎在同一个位置再次截断。

### 5. 循环检测太温和

`loopDetector.ts` 在第 4 次重复时触发，但只注入 hint（非致命），LLM 读到 hint 后继续重试。

### 6. Context 膨胀加剧截断（恶性循环）

每次失败的迭代都把完整的截断输出（~16K chars）存入 `turnMessages`。10 次 = ~160K chars 的上下文膨胀。输入越大 → 输出空间越少 → 更容易截断。

---

## 关键实体通俗解释

### `turnMessages`（当前轮的聊天记录）

用户说一句话到 agent 回复文字，这个过程叫一个 turn。`turnMessages` 是这一轮里所有来回消息的列表。每次迭代往里追加：模型消息、工具结果、系统提示。

**在此 bug 中**：截断循环的每次失败都往里塞 ~16K，10 次就是 ~160K，全堆在里面无人清理。

### `fullParts`（LLM 原始输出的完整零件）

LLM 一次输出由多个零件拼成：`[思考过程, 文字回复, 工具调用(name, args)]`。这些零件合在一起就是 `fullParts`。**里面的 JSX 参数原封不动保存**，即使是被截断的残缺 JSX 也照存。

### `sanitizeToolCallsForHistory()`（工具参数瘦身）

把工具调用的参数截短（string → 200 chars），防止历史记录太大。

**在此 bug 中**：它只改了 `response.toolCalls`，没改 `fullParts`。而 `formatResponseGemini()` 用的是 `fullParts`，所以瘦身白做了——存进 turnMessages 的还是完整 16K。

### `formatResponseGemini()`（打包 LLM 输出为聊天消息）

把 LLM 的 `fullParts`（未瘦身）包装成 `{ role: 'model', content: fullParts }` 存入 turnMessages。

### `estimateMessageChars()`（估算消息大小）

遍历消息零件，累加文本长度 + 工具名长度 + 参数 JSON 长度。用于判断上下文是否需要压缩。

### `computeCacheDiagnostics()`（KV cache 日志）

比较本次和上次发给 LLM 的消息，找出前面有多少条相同（可复用缓存的部分）。

日志 `[KVCache] 80/84 msgs cacheable (~14180 tokens)` 含义：
- 84 条消息中前 80 条跟上次相同（可缓存）
- 这 80 条约 14180 tokens
- **14180 不是总量**，只是可缓存的前缀。后面 4 条新消息（可能每条 16K）不在此统计内

### `compressIfNeeded()`（自动压缩上下文）

检查所有消息总大小，超预算就把最老的对话压缩成摘要。

**在此 bug 中**：只在 turn 结束时调用。截断循环全在同一个 turn 内，turn 没结束，压缩永远不触发。

### `contextBudgetChars`（上下文空间预算）

`模型上下文窗口 × 70% × 4`。留 30% 给输出，用 `chars ÷ 4 ≈ tokens` 粗估。

---

## 实体关系与数据流

```
LLM 输出 (finishReason='length', 输出被截断)
  │
  ├─→ response.fullParts = [{ functionCall: { args: { markup: "16K截断JSX" } } }]
  │
  ├─→ sanitizeToolCallsForHistory() → response.toolCalls.args 截短到 200 chars
  │     （但 fullParts 没动，瘦身白做）
  │
  ├─→ formatResponseGemini(response) → 用 fullParts（16K）→ 存入 turnMessages
  │
  ├─→ 截断守卫在 else 分支 → 有 tool calls 时不触发 → 不拦截
  │
  └─→ 截断 JSX 送去执行 → compileJsx() 报错 → 错误也加入 turnMessages
        │
        └─→ 下一次迭代：turnMessages 更大 → 输入更多 → 输出空间更小 → 更容易截断
```

## 问题总结表

| 实体 | 正常作用 | 在此 bug 中的角色 |
|---|---|---|
| `fullParts` | 保存 LLM 完整原始输出 | 16K 截断 JSX 原封不动保存 |
| `sanitizeToolCallsForHistory` | 工具参数瘦身防膨胀 | 只改了 toolCalls，没改 fullParts，存的不是它的结果 |
| `formatResponseGemini` | 打包成聊天消息 | 用了未瘦身的 fullParts，每条 ~16K |
| `turnMessages` | 当前轮所有消息 | 膨胀的容器，每次失败 +16K |
| `compressIfNeeded` | 自动压缩 | turn 内不触发，形同虚设 |
| `computeCacheDiagnostics` | KV cache 命中率日志 | 只报可缓存前缀，掩盖了总量膨胀 |
| 截断守卫 | 检测 finishReason='length' | 在 else 分支，有 tool calls 时永远走不到 |

---

## 已完成修复

### 截断守卫位置修复 (`agentRuntime.ts`)

在 tool dispatch **之前**增加截断检查：

```typescript
if (toolCallsForExecution.length > 0 && response.finishReason === 'length') {
  truncationCount++;
  // 前 3 次：丢弃截断 tool calls，注入提示让 LLM 拆分
  // 第 4 次：放行，走 loop detection 兜底
}
```

效果：
- 截断的 tool calls 不再执行（不产生 parse 错误）
- 注入明确指引让 LLM 拆分为更小的调用
- 丢弃后只添加小的 synthetic 消息，不把 16K fullParts 塞进 turnMessages

## 待修复

### 1. fullParts 瘦身不一致

`sanitizeToolCallsForHistory()` 只改 `response.toolCalls`，不影响 `response.fullParts`。而 `formatResponseGemini()` 用的是 fullParts。应该在 formatResponse 之前对 fullParts 中的 functionCall.args 也做瘦身。

### 2. Intra-turn context 膨胀无管理

`compressIfNeeded()` 只在 turn 结束时调用。当 turn 内迭代次数多（截断循环、复杂设计），turnMessages 会无限膨胀。需要 intra-turn 的压缩或清理机制。

### 3. KV cache 日志误导

`computeCacheDiagnostics` 只报 cacheable 前缀的 token 数，容易误以为是总量。应同时报总 token 估算。

---

## 相关文件

| 文件 | 关键函数 | 作用 |
|---|---|---|
| `src/engine/agent/agentRuntime.ts` | `assemblePrompt()`, `estimateMessageChars()`, `compressIfNeeded()` | Agent 主循环、上下文管理 |
| `src/engine/agent/llmGenerationCoordinator.ts` | `generate()`, `computeCacheDiagnostics()` | LLM 调用协调、KV cache 日志 |
| `src/engine/llm-client/providers/gemini/geminiFormat.ts` | `formatResponseGemini()` | 模型响应 → 聊天消息转换 |
| `src/engine/agent/context/toolResultCleaner.ts` | `sanitizeToolCallsForHistory()` | 工具参数瘦身 |
| `src/engine/jsx/templateCompiler.ts` | `compileJsx()` | JSX 解析（报错点） |
| `src/engine/agent/loopDetector.ts` | `LoopDetector.detect()` | 循环检测（阈值 4） |
| `src/engine/agent/hooks/builtinHooks.ts` | `createLoopDetectionHook()` | 循环检测 hook（非致命 hint） |
| `src/engine/agent/constants.ts` | `LOOP_DETECTION_THRESHOLD: 4` | 循环检测阈值 |
