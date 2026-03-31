# LanguageModel 接口：SDK 代劳 vs 自建 Provider

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：SDK 的 `LanguageModel` 接口能省多少工作？引入它会带来怎样的耦合？

---

## 1. OpenPencil 的 Provider 适配：零额外代码

```typescript
// use-chat.ts — OpenPencil 支持 7+ Provider 的全部代码
function createModel(): LanguageModel {
  switch (providerID.value) {
    case 'openrouter': return createOpenRouter({...})(effectiveModelID)
    case 'anthropic':  return createAnthropic({ apiKey: key })(effectiveModelID)
    case 'openai':     return createOpenAI({ apiKey: key })(effectiveModelID)
    case 'google':     return createGoogleGenerativeAI({ apiKey: key })(effectiveModelID)
    case 'zai':        return createAnthropic({ baseURL: '...' })(effectiveModelID)
    case 'minimax':    return createOpenAI({ baseURL: '...' }).chat(effectiveModelID)
    case 'openai-compatible': return createOpenAI({ apiKey, baseURL }).chat(id)
    case 'anthropic-compatible': return createAnthropic({ apiKey, baseURL })(id)
  }
}
```

每新增一个 Provider？加一个 `case`，一行代码。消息格式、tool calling 协议、streaming 协议——全部由 `@ai-sdk/anthropic`、`@ai-sdk/openai` 等包内部处理。

## 2. 我们的 Provider 接口：自建但实现沉重

```typescript
// providers/types.ts — 我们的 LLMProvider 接口
export interface LLMProvider {
  name: string;
  generate(options: LLMGenerateOptions): Promise<LLMResponse>;
  generateStream?(options: LLMGenerateOptions): AsyncIterable<LLMResponse>;
  getCapabilities?(): LLMProviderCapabilities;
  formatResponse(response: LLMResponse): LLMMessage;      // ← 手动格式转换
  formatToolResults(results: LLMToolResult[]): LLMMessage;  // ← 手动格式转换
  getToolSystemInstruction(tools: ToolDefinition[]): string;
}
```

关键差异在 `formatResponse` 和 `formatToolResults`——这两个方法的存在本身就说明了问题：**我们需要手动处理每个 Provider 的消息格式差异**。

比如 Gemini 的 `thought_signature`：

```typescript
// providers/types.ts L49-51 — Gemini 特有的 thought metadata
export interface Part {
  thought?: boolean;
  thought_signature?: string;  // ← Gemini 3 专有
}
```

如果用 SDK，这些 Provider 特有的协议细节由 `@ai-sdk/google` 内部处理，不需要泄露到我们的接口定义中。

## 3. 我们的接口不仅是接口

这是你提到的关键点。我们的 `LLMProvider` 不只是一个抽象接口——它承载了**业务逻辑**：

```typescript
// LLMProvider 承载的能力
generate()                → 带 abort、timeout、streaming 的底层调用
formatResponse()          → Provider 专属的消息重建（如 Gemini thought signature 回传）
formatToolResults()       → Provider 专属的工具结果封装
getToolSystemInstruction() → Provider 专属的 system prompt 补充
getCapabilities()         → 暴露 contextWindow 给 AgentRuntime 做压缩决策
```

SDK 的 `LanguageModel` 接口处理了 `generate` 和消息格式，但**不处理**：
- `getCapabilities()` 暴露 context window 大小
- 我们的 4 层 Context 压缩依赖 context window
- `getToolSystemInstruction()` 允许 Provider 注入额外指令

## 4. 耦合分析

### 引入 SDK 会带来什么耦合？

```
依赖 SDK 的部分：
├── LanguageModel 接口 ← 工具调用格式由 SDK 定义
├── tool() 函数 ← 工具注册格式由 SDK 定义
├── @ai-sdk/anthropic 等 ← Provider 实现由 SDK 维护
└── Chat / ToolLoopAgent ← Agent 循环由 SDK 驱动

我们仍然控制的部分：
├── 工具业务逻辑 ← execute 函数里写什么，我们说了算
├── system prompt ← SDK 只是传递，不干预
├── 上下文管理 ← 需要自己适配，但可以在 SDK 之上封装
└── 可观测性 ← 在 execute 前后注入（OpenPencil 已验证可行）
```

### 核心权衡

```
自建 LLMProvider:
  ✅ 完全控制消息格式、context window 查询、Provider 特有逻辑
  ✅ 不依赖第三方 SDK 版本更新
  ❌ 每加一个 Provider 需要实现 4 个方法
  ❌ 消息格式兼容需要持续维护（如 Gemini thought_signature）
  ❌ tool calling 协议差异需要手动处理

用 SDK LanguageModel:
  ✅ 零代码加 Provider（createXxx({apiKey})(modelId)）
  ✅ Provider 协议差异由社区维护
  ✅ 新模型支持更快（SDK 更新即可）
  ❌ context window 大小需要从其他途径获取
  ❌ getToolSystemInstruction 需要改为 SDK 的 instructions 参数
  ❌ 升级 SDK 可能引入 breaking changes
```

## 5. 一个可能的中间方案

不是"全用 SDK"或"完全自建"，而是**分层替换**：

```typescript
// 保留我们的高层接口，但底层用 SDK 实现
export interface AgentModelConfig {
  // 高层：我们定义
  contextWindow: number;
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
  
  // 底层：委托给 SDK
  model: LanguageModel;  // ← SDK 的 LanguageModel
}

// 使用时：
const config: AgentModelConfig = {
  contextWindow: 2_000_000,
  thinkingLevel: 'medium',
  model: createGoogleGenerativeAI({ apiKey })(
    'gemini-2.5-pro'
  ),
}
```

这样：
- **Provider 适配**（消息格式、tool calling 协议）交给 SDK
- **业务元数据**（context window、thinking level）我们自己管
- 不需要重写 `formatResponse`、`formatToolResults`——SDK 内部处理
- 保留对 context 管理策略的完全控制权

## 6. 决策结论

| 如果... | 建议 |
|---------|------|
| 只支持 Gemini | 自建 Provider 成本可控，不急着换 |
| 要支持 Claude / GPT / OpenRouter | 用 SDK 的 `LanguageModel` 能省大量工作 |
| 需要 Gemini 特有能力（thought_signature） | SDK `@ai-sdk/google` 已覆盖 |
| 需要精细控制 context budget | 在 SDK 之上封装一层 AgentModelConfig |
