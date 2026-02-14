# 修复 Gemini 3/2.5 Thinking + Function Calling 400 错误

## 背景

在第二次迭代（iteration 1）向 Gemini API 发送包含历史对话的请求时，API 返回 400 INVALID_ARGUMENT。第一次请求（无历史）成功，第二次（包含 model turn + tool results turn 历史）失败。此问题影响所有 thinking 模型：Gemini 3.0 Flash/Pro 和 2.5 Flash。

## 根因分析

通过对照 Gemini API 文档和代码的详细分析，发现 **3 个问题**：

### 问题 1（主因）：`thoughtSignature` 被错误地传播到所有 parts

**文档规则**：对于并行 function calls，`thoughtSignature` **只应在第一个** `functionCall` part 上。后续的 parallel calls 不应有 signature。

**当前行为**：`GeminiResponseAccumulator.finalize()` 将 `sharedSignature` 传播到所有没有 signature 的 parts，导致所有 functionCall parts 和 thought parts 都带上了 signature。当这些 parts 在下一轮请求中被发回 API 时，API 检测到格式不正确，返回 400。

**证据**：用户日志中 model turn 的 3 个 parts 全部带有相同的 `thoughtSignature`：
```
[thought+sig, functionCall("new_task")+sig, functionCall("planDesign")+sig]
```

### 问题 2（次因）：`mapToGenAIContent` 在 text parts 上附加 `thoughtSignature`

普通 text parts（非 thought）不应带 `thoughtSignature`，但 `mapToGenAIContent` 行 388-392 给所有有 `sig` 的 text parts 都加了 `thoughtSignature`。

### 问题 3（风险项）：`includeThoughts` 与 `thinkingLevel` 同时使用

虽然文档说可以同时使用，但为减少表面积，建议 Gemini 3 只用 `thinkingLevel`，不需要 `includeThoughts: true`（因为 thoughts 是通过 signature 机制自动处理的）。

## 修复方案

### 文件：`src/engine/llm-client/providers/gemini/geminiResponseAccumulator.ts`

**修改 `finalize()` 方法**：停止向所有 parts 传播 signature。保持 signature 只在原始位置——即 API 返回时自带 signature 的那些 parts 上。

```typescript
// 之前（错误）：给所有没 sig 的 parts 补上 sig
for (const p of this.fullParts as any[]) {
  if (p.text || p.thought || p.functionCall || p.functionResponse) {
    if (!p.thought_signature && !p.thoughtSignature) {
      p.thought_signature = sharedSignature;  // ← 这行导致问题
    }
    finalFullParts.push(p);
  }
}

// 之后（正确）：只传播 sig 到 toolCalls（内部追踪用），不修改 fullParts
for (const p of this.fullParts as any[]) {
  if (p.text || p.thought || p.functionCall || p.functionResponse) {
    finalFullParts.push(p);  // 保持原样，不补 sig
  }
}
```

仍然需要传播 signature 到 `toolCalls`（用于 agentRuntime 追踪），但 `fullParts` 应保持 API 返回的原始 signature 分布。

### 文件：`src/engine/llm-client/providers/gemini.ts`

**修改 1：`mapToGenAIContent` 方法** — 普通 text parts 不附加 `thoughtSignature`

```typescript
// 行 388-392，修改为：
if (p.text) {
  return { text: p.text };  // 不加 thoughtSignature
}
```

**修改 2：`mapToLLMResponse` 方法** — 不对 text parts 传播 signature

```typescript
// 行 319-324，修改为：
} else if ('text' in part && part.text) {
  text += part.text;
  fullParts.push(part);  // 原样保存，不注入 sig
}
```

**修改 3（可选优化）：`generate` 方法的 thinkingConfig**

对 Gemini 3，移除 `includeThoughts: true`，只保留 `thinkingLevel`：
```typescript
config.thinkingConfig = {
  thinkingLevel: thinkingLevel.toUpperCase()
};
```

### 文件：`src/engine/llm-client/providers/gemini.ts` — `formatResponse`

**修改 4**：移除对 standalone signature parts 的保留（行 238），因为这些 parts 不应出现在 history 中：

```typescript
// 删除这一行：
if (p.thought_signature && !p.text) return true;
```

## 验证步骤

1. **单元测试**：运行 `npx vitest run src/engine/llm-client/providers/gemini/`
2. **集成测试**：在插件中用 `gemini-3-flash-preview` 生成一个简单 login form
3. **日志检查**：确认 iteration 1 的 request contents 中，model turn 的 signature 分布与 API 原始返回一致（仅第一个 functionCall 有 sig）
4. **多模型测试**：分别用 Gemini 3.0 Flash、3.0 Pro、2.5 Flash 测试

## 关键文件

- `src/engine/llm-client/providers/gemini.ts` — 主 provider，4 处修改
- `src/engine/llm-client/providers/gemini/geminiResponseAccumulator.ts` — accumulator，1 处修改
- `src/engine/agent/__tests__/gemini_signature_repro.test.ts` — 测试需更新（移除错误的 sig 传播断言）
