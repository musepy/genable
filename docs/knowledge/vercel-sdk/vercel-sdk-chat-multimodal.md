# Chat 管理 + 多模态输出：SDK 包办 vs 自建

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：SDK 的 `Chat<UIMessage>` 到底管了什么？`toModelOutput` 的图片能力有什么启发？与我们的 4 层 Context 如何共存？

---

## 1. OpenPencil 的 Chat 管理

```typescript
// use-chat.ts — Chat 创建与复用
import { Chat } from '@ai-sdk/vue'

let chat: Chat<UIMessage> | null = null

async function ensureChat(): Promise<Chat<UIMessage> | null> {
  if (!chat || transportDirty) {
    const messages = chat?.messages     // ← 保留历史消息
    const transport = isACPProvider.value 
      ? await createACPTransport() 
      : createTransport()
    chat = new Chat<UIMessage>({ transport, messages })
    transportDirty = false
  }
  return chat
}
```

SDK 的 `Chat` 类做了什么：
- **消息历史管理**：自动维护 `messages` 数组
- **Transport 抽象**：`DirectChatTransport`（本地 Agent）或 `ACPChatTransport`（远程 Agent）
- **热切换**：切换 Provider/模型时，`transportDirty = true`，下次调用重建 transport 但**保留消息**
- **流式渲染**：与 Vue 响应式系统绑定，自动更新 UI

### Transport 的设计值得关注

```typescript
// use-chat.ts — Transport 创建
function createTransport() {
  const tools = createAITools(useEditorStore())
  const agent = new ToolLoopAgent({ model, tools, ... })
  return new DirectChatTransport({ agent })  // ← Agent → Transport → Chat
}
```

`Chat` 不直接和 Agent 交互——它通过 `Transport` 解耦。这使得可以用**相同的 Chat UI** 对接：
- `DirectChatTransport`：本地执行的 Agent
- `ACPChatTransport`：远程 Agent Client Protocol

## 2. 我们的 4 层 Context 管理

```typescript
// agentRuntime.ts — assemblePrompt
private assemblePrompt(): LLMMessage[] {
  const messages: LLMMessage[] = [];
  
  // Layer 1: 静态系统提示
  if (this.staticSystemPrompt) {
    messages.push({ id: 'sys_static', role: 'system', content: this.staticSystemPrompt });
  }
  
  // Layer 2: 压缩摘要（历史对话的精炼）
  if (this.summary) {
    messages.push({ id: 'ctx_summary', role: 'system', content: this.summary });
  }
  
  // Layer 3: 未压缩的对话历史（前几轮完整保留）
  messages.push(...this.conversationHistory);
  
  // Layer 4: 当前轮消息
  messages.push(...this.turnMessages);
  
  return messages;
}
```

以及懒压缩机制：

```typescript
// agentRuntime.ts — endTurn + compressIfNeeded
private endTurn(): void {
  this.conversationHistory.push(...this.turnMessages);
  this.compressIfNeeded();  // ← 只在接近 context budget 时压缩
}
```

**这是 SDK 不提供的能力。** SDK 的 `Chat` 只管消息列表的增删和流式，不做 context window 估算、分层压缩、摘要生成。

## 3. 图片多模态输出：`toModelOutput`

```typescript
// ai-adapter.ts — export_image 工具的特殊处理
if (def.name === 'export_image') {
  toolOpts.toModelOutput = ({ output }) => {
    if (output && typeof output === 'object' && 'base64' in output) {
      const r = output as { base64: string; mimeType: string }
      return {
        type: 'content',
        value: [{ type: 'media', mediaType: r.mimeType, data: r.base64 }]
      }
    }
    return { type: 'json', value: output }
  }
}
```

这段代码让 LLM **看到**工具导出的图片。当 AI agent 调用 `export_image` 截图当前设计时，截图的 base64 通过 `toModelOutput` 转换为 SDK 的多模态内容格式，LLM 接收到的是一张图片而非 JSON。

### 我们的图片处理方式对比

```typescript
// providers/types.ts — 我们通过 Part.inlineData 支持
export interface Part {
  inlineData?: {
    mimeType: string;
    data: string;  // base64
  };
}

// LLMToolResult 中的图片附件
export interface LLMToolResult {
  imageAttachment?: {
    mimeType: string;
    data: string;
  };
}
```

我们已经有图片支持能力，但需要**手动组装**到消息部分。SDK 的 `toModelOutput` 提供了一个更声明式的方式——在工具定义层面指定"这个工具的输出是图片"，SDK 自动处理格式转换。

## 4. SDK Chat vs 我们的 4 层 Context：能共存吗？

核心问题：**SDK 的 `Chat` 管消息列表，但我们的 4 层 Context 需要精细控制消息的生命周期（压缩、标记 hidden、summary 替换）。两者能组合使用吗？**

### 方案：SDK 管通信，我们管 Context

```
SDK Chat 负责:
├── 消息发送和接收的传输层
├── 流式渲染
└── Transport 切换（本地/远程）

我们负责:
├── 4 层 Context 组装 → 作为 SDK 的 messages 输入
├── 懒压缩决策
├── summary 生成
└── context budget 估算
```

实现上，不使用 SDK 的内置消息历史管理，而是**每次调用时传入我们组装好的消息**：

```typescript
// 概念性方案
const agent = new ToolLoopAgent({
  model: createModel(),
  tools: createAITools(),
  // 不用 instructions（我们自己管 system prompt），
  // 而是在每次 prepareCall 中注入完整的 4 层消息
  prepareCall: (options) => ({
    ...options,
    messages: assemblePrompt(),  // ← 我们的 4 层 Context
  }),
})
```

## 5. 决策影响

| 维度 | SDK Chat | 我们现有方案 |
|------|---------|-------------|
| 消息历史 | 自动管理 | 手动 4 层管理 |
| 流式渲染 | 内建 | 自建 onProgress/onThinking |
| Context 压缩 | ❌ 不支持 | ✅ compressIfNeeded |
| Transport 切换 | ✅ 热切换 | N/A（单 Provider） |
| 多模态工具输出 | ✅ toModelOutput | 手动 inlineData 组装 |

**结论**：SDK 的 `Chat` 对我们来说价值有限——它解决的主要是 UI 层的消息渲染和 Transport 切换，而我们的核心需求是 Context 分层管理。但 `toModelOutput` 值得借鉴——可以在工具定义层声明输出类型，减少手动格式转换。
