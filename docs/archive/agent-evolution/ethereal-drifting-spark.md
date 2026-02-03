# Gemini SDK Thought Signature 问题解决方案

## 问题定位

**错误来源:** 外部后端服务 (AgentOrchestrator / Oi)

**错误信息:**
```
[AgentOrchestrator] Failed: Oi: [GoogleGenerativeAI Error]:
Function call is missing a thought_signature in functionCall parts.
function call `default_api:searchDesignKnowledge` , position 2
```

**根本原因:** Gemini 3 系列模型在 function calling 时强制要求 `thoughtSignature`。当模型返回 function call 时，响应中包含 `thoughtSignature` 字段，必须在后续请求中原样返回。

**关键发现:**
- 问题出在后端服务调用 Gemini 3 时的 function calling 流程
- 第二个 function call (`searchDesignKnowledge`, position 2) 缺少 thought signature
- 这可能是因为并行 function calls 中只有第一个有 signature

---

## 解决方案汇总

### 方案 1: 使用官方 SDK 的 Chat 特性 (推荐)

**原理:** 官方 SDK 的 chat 功能会自动处理 thought signature 的保存和传递。

**实现方式:**
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

// 使用 startChat 而不是直接 generateContent
const chat = model.startChat({
  tools: [yourTools],
  history: []
});

// SDK 会自动处理 thoughtSignature
const result = await chat.sendMessage(userPrompt);
```

**关键点:**
- 使用 `startChat()` 创建会话
- 不要手动修改 history
- 让 SDK 自动管理对话历史

---

### 方案 2: 手动保存和传递 thoughtSignature

如果必须手动管理 history，需要完整保留 API 返回的 `thoughtSignature`:

```typescript
// 1. 获取模型响应
const response = await model.generateContent({
  contents: [...],
  tools: [...]
});

// 2. 提取 functionCall 和 thoughtSignature
const part = response.candidates[0].content.parts[0];
// part 结构: { functionCall: {...}, thoughtSignature: "<SIGNATURE>" }

// 3. 执行工具调用
const toolResult = await executeFunction(part.functionCall);

// 4. 构建下一个请求时，必须包含原始的 thoughtSignature
const nextRequest = {
  contents: [
    ...previousHistory,
    {
      role: 'model',
      parts: [{
        functionCall: part.functionCall,
        thoughtSignature: part.thoughtSignature  // 关键: 必须包含
      }]
    },
    {
      role: 'user',
      parts: [{
        functionResponse: {
          name: part.functionCall.name,
          response: toolResult
        }
      }]
    }
  ]
};
```

---

### 方案 3: 使用 Dummy Signature 绕过验证 (应急)

**警告:** 这会降低模型性能，仅在以下情况使用:
- 从其他模型迁移历史记录
- 无法获取原始 signature 的特殊场景

```typescript
// 两个有效的 dummy 值:
const DUMMY_SIGNATURES = [
  'context_engineering_is_the_way_to_go',
  'skip_thought_signature_validator'
];

// 在 functionCall part 中使用:
{
  functionCall: { name: 'xxx', args: {...} },
  thoughtSignature: 'skip_thought_signature_validator'
}
```

---

### 方案 4: 降级到 Gemini 2.5 模型

Gemini 2.5 系列的 thoughtSignature 是可选的，不会因缺失而报 400 错误:

```typescript
// 将模型从 gemini-3-flash-preview 改为 gemini-2.5-flash
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash'  // 或 gemini-2.5-pro
});
```

---

## 针对后端 AgentOrchestrator 服务的修复建议

从错误信息看:
```
[AgentOrchestrator] Failed: Oi: ... function call `default_api:searchDesignKnowledge` , position 2
```

问题出在后端服务的第二个 function call 缺少 signature。

### 后端需要修改的地方:

#### 1. 升级 SDK
旧版 `@google/generative-ai` → 新版 `@google/genai`

```bash
# 移除旧版
npm uninstall @google/generative-ai

# 安装新版
npm install @google/genai@latest
```

#### 2. 修改 function call 处理逻辑

**问题代码模式 (错误示例):**
```typescript
// ❌ 错误: 只提取了 functionCall，丢失了 thoughtSignature
const functionCalls = response.parts.map(p => p.functionCall);

// 构建 history 时丢失了 signature
history.push({
  role: 'model',
  parts: functionCalls.map(fc => ({ functionCall: fc }))
});
```

**正确代码模式:**
```typescript
// ✅ 正确: 保留完整的 part 对象
history.push({
  role: 'model',
  parts: response.parts  // 原样保留，包含 thoughtSignature
});
```

#### 3. 并行 function call 的特殊处理

```typescript
// 模型返回 (并行调用):
// parts[0] = { functionCall: {...}, thoughtSignature: "..." }  // 有 signature
// parts[1] = { functionCall: {...} }  // 无 signature (正常)

// 关键: 必须原样返回，不能改变顺序或拆分
```

#### 4. 临时修复 (如果无法立即修改后端)

在构建请求时，为缺少 signature 的 functionCall 添加 dummy signature:

```typescript
const parts = response.parts.map((part, index) => {
  if (part.functionCall && !part.thoughtSignature && index > 0) {
    return {
      ...part,
      thoughtSignature: 'skip_thought_signature_validator'
    };
  }
  return part;
});
```

**注意:** 这是应急方案，会降低模型性能。

---

## API 请求/响应结构参考

### 模型返回 (单个 function call):
```json
{
  "role": "model",
  "parts": [{
    "functionCall": {
      "name": "searchDesignKnowledge",
      "args": { "query": "..." }
    },
    "thoughtSignature": "<ENCRYPTED_SIGNATURE>"
  }]
}
```

### 模型返回 (并行 function calls):
```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": { "name": "func1", "args": {...} },
      "thoughtSignature": "<SIGNATURE>"  // 只有第一个有
    },
    {
      "functionCall": { "name": "func2", "args": {...} }
      // 无 signature
    }
  ]
}
```

### OpenAI 兼容格式:
```json
{
  "role": "assistant",
  "tool_calls": [{
    "extra_content": {
      "google": {
        "thought_signature": "<SIGNATURE>"
      }
    },
    "function": { "name": "...", "arguments": "..." },
    "id": "...",
    "type": "function"
  }]
}
```

---

## 验证步骤

1. 检查 AgentOrchestrator 代码中 history 的构建方式
2. 确认是否使用了 SDK 的 chat 功能
3. 如果手动管理 history，确保 thoughtSignature 被正确保留
4. 测试时可临时使用 dummy signature 确认问题定位

---

## 完整修复流程 (后端服务)

### Step 1: 定位问题代码
在后端找到 `AgentOrchestrator` 或 `Oi` 服务中处理 Gemini function calling 的代码。

### Step 2: 检查 history 构建
确认是否在以下位置丢失了 `thoughtSignature`:
- 解析 model response 时
- 构建下一次请求的 history 时
- 处理并行 function calls 时

### Step 3: 应用修复
选择以下方案之一:

| 方案 | 工作量 | 效果 |
|------|--------|------|
| A. 使用 SDK chat 功能 | 中 | 最佳 (自动处理) |
| B. 手动保留 signature | 小 | 好 |
| C. Dummy signature | 最小 | 可用但性能降低 |
| D. 降级到 Gemini 2.5 | 最小 | 避免问题 |

### Step 4: 验证
发送包含 function calling 的请求，确认不再出现 400 错误。

---

## 参考资料

- [Thought Signatures 官方文档](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [Gemini 3 开发者指南](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Function Calling 文档](https://ai.google.dev/gemini-api/docs/function-calling)
- [Vertex AI Thought Signatures](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures)
- [LangChain 相关 Issue #1364](https://github.com/langchain-ai/langchain-google/issues/1364) - 升级到 3.1.0+ 解决
