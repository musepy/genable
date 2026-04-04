# Agent Loop Bug 全景解剖

> 日期: 2026-04-01
> 覆盖: 截断循环 (TRUNC-001) + finishReason 误触发 + 空响应死循环 + 上下文断裂 + 输入压力分析
> E2E 证据: trigger-1775033988681, trigger-1775034233063, trigger-1775034313666 (GLM-5)
> 成功对照: trigger-1775035854928 (Kimi K2.5) — [完整 API 交互日志](e2e-api-trace-1775035854928.txt)

---

## 一、全部实体清单与通俗解释

### 1. Agent Runtime（主循环引擎）

**文件**: `src/engine/agent/agentRuntime.ts`

Agent 的"大脑"——一个 while 循环，每次迭代做同一件事：组装 prompt → 调 LLM → 处理响应 → 执行工具 → 下一轮。用户说一句话到 agent 回复文字，整个过程叫一个 **turn**（轮次），一个 turn 内可以有多次迭代。

**关键方法**:
- `run(prompt)` — 一个 turn 的入口
- `assemblePrompt()` — 拼装发给 LLM 的完整消息列表
- `estimateMessageChars(msg)` — 估算一条消息有多少字符
- `estimateContextChars()` — 估算全部上下文的总字符数
- `compressIfNeeded()` — 上下文超预算时压缩最老的对话

**在 bug 中的角色**: 截断守卫、turn 结束逻辑、iteration 计数都在这里，三个 bug 的核心代码都在此文件。

---

### 2. turnMessages（当前轮消息缓冲区）

**位置**: `agentRuntime.ts` 实例属性

当前 turn 内所有来回消息的列表。每次迭代追加：
- 模型消息（LLM 说了什么 + tool calls）
- 工具执行结果（成功/失败）
- 系统注入的合成消息（continuation、hint 等）

**生命周期**: `run()` 开始时清空 → turn 内不断追加 → turn 结束时移入 `conversationHistory`

**Bug 关联**:
- 截断循环时每次失败追加 ~16K chars 的模型消息，10 次 = ~160K，无人清理（压缩只在 turn 结束时触发）
- 误触发 continuation 时，`cont_` 消息被追加到这里，下次 LLM 调用会看到

---

### 3. conversationHistory（历史对话存档）

**位置**: `agentRuntime.ts` 实例属性

前几个 turn 的完整消息。turn 结束时 turnMessages 移入此处。`compressIfNeeded()` 在此基础上做压缩。

**Bug 关联**:
- trigger-3 能看到 trigger-2 的对话历史，就是因为 trigger-2 的 turnMessages 在 turn_end 时被移入了 conversationHistory
- trigger-1 和 trigger-2 是不同 session（plugin 重载），conversationHistory 清空，所以 trigger-2 看不到 trigger-1

---

### 4. assemblePrompt()（4 层上下文组装）

**位置**: `agentRuntime.ts:319`

每次调 LLM 前，把 4 层上下文拼成一个消息数组：

```
Layer 1: staticSystemPrompt    — 系统 prompt，固定不变（~25K chars）
Layer 2: summary               — 被压缩的旧对话摘要
Layer 3: conversationHistory   — 前几个 turn 的完整消息
Layer 4: turnMessages          — 当前 turn 的消息
```

**Bug 关联**: Layer 4 在截断循环时无限膨胀，但 Layer 2 的压缩机制不会在 turn 内触发。

---

### 5. fullParts（LLM 原始输出零件）— 仅 Gemini/Proxy provider

**来源**: Gemini API 返回的 `response.candidates[0].content.parts`（Gemini 格式专有）

> **注意**: GLM-5 和 Kimi K2.5 走的是 **DashScope provider**（OpenAI 兼容格式），没有 fullParts。
> DashScope 的响应结构是 `choices[0].message`，由 `mapOpenAIToLLMResponse()` 转换为 `LLMResponse`。
> 本节描述的 fullParts 机制**仅适用于 Gemini / Proxy provider**。

LLM 的一次输出不是纯文本，而是多个"零件"拼在一起（Gemini 格式）：

```
[
  { thought: "让我想想怎么设计..." },          // thinking（不展示给用户）
  { text: "我来为您创建产品页。" },            // 可见文本
  { functionCall: { name: "jsx", args: { markup: "16K的JSX" } } }  // 工具调用
]
```

**Bug 关联（Gemini/Proxy only）**: fullParts 里的 functionCall.args 保留了**完整的原始参数**，包括截断的 16K JSX。sanitize 改的是 `response.toolCalls` 的副本，不影响 fullParts。而 `formatResponseGemini()` 存的是 fullParts → turnMessages 里存的是未瘦身的完整数据。

**DashScope 不受此影响**: `formatResponseDefault()` 从 `response.toolCalls`（已 sanitize）重建 content，瘦身是生效的。

---

### 6. formatResponse — 两种实现，行为不同

模型输出 → 聊天消息的转换由 provider 的 `formatResponse()` 负责，**两种实现对 sanitize 的兼容性不同**：

#### 6a. formatResponseGemini()（Gemini / Proxy provider）

**文件**: `src/engine/llm-client/providers/gemini/geminiFormat.ts:113`

```typescript
// 有 tool calls 时：用 fullParts（未瘦身），不是 response.toolCalls（已瘦身）
return { role: 'model', content: response.fullParts }
```

**Bug 关联**: 这是"瘦身白做"问题的源头。`sanitizeToolCallsForHistory()` 截短了 `response.toolCalls`，但 `formatResponseGemini()` 用的是 `fullParts`，两份数据不一致。

#### 6b. formatResponseDefault()（DashScope / OpenRouter provider）

**文件**: `src/engine/llm-client/providers/types.ts:171`

```typescript
// 从 response.toolCalls（已瘦身）重建 content
content.push(...response.toolCalls.map(tc => ({
  functionCall: { name: tc.name, args: tc.args }
})));
return { role: 'model', content };
```

**DashScope 不受"瘦身白做"影响**: `formatResponseDefault()` 读取的是 `response.toolCalls`（sanitize 的目标），所以瘦身后的数据**确实进入了** turnMessages。本文档 E2E 证据（GLM-5、Kimi K2.5）都走此路径。

---

### 7. sanitizeToolCallsForHistory()（工具参数瘦身）

**文件**: `src/engine/agent/context/toolResultCleaner.ts:24`

防止历史记录太大。把工具参数截短：string → 200 chars，array → 最多 20 项，edit 的 xml > 500 chars 直接删除。

**Bug 关联**:
- **Gemini/Proxy**: 它只改了 `response.toolCalls`（在 `llmGenerationCoordinator.ts:249`），而 `formatResponseGemini()` 用的是 `response.fullParts`。所以瘦身后的数据没进入 turnMessages。
- **DashScope/OpenRouter**: `formatResponseDefault()` 从 `response.toolCalls` 构建 content，sanitize 生效。本文档 E2E 证据（GLM-5）走此路径，不受"瘦身白做"影响。

---

### 8. LLMGenerationCoordinator（LLM 调用协调器）

**文件**: `src/engine/agent/llmGenerationCoordinator.ts`

AgentRuntime 不直接调 LLM，而是通过这个协调器。它负责：
- 调用 provider 的 `generate()` 方法
- sanitize tool calls for history
- 发射 `llm_request` / `llm_response` 运行时事件
- 计算 KV cache 诊断信息

**关键方法**:
- `generate(request)` — 核心调用
- `computeCacheDiagnostics(messages)` — KV cache 命中率估算

---

### 9. computeCacheDiagnostics()（KV cache 日志）

**文件**: `llmGenerationCoordinator.ts:300`

比较"这次发给 LLM 的消息"和"上次的"，找出**前面有多少条一样的**（可以复用 KV cache 的部分）。

```
[KVCache] 80/84 msgs cacheable (~14180 tokens)
```

含义：84 条消息中前 80 条跟上次相同，这 80 条约 14180 tokens。

**注意**: 14180 **不是总量**，只是可缓存的前缀。后面 4 条新消息（可能每条 16K）不在此统计内。

**估算方式**: `chars / 4`（1 token ≈ 4 chars），对结构化数据（JSON、JSX）误差较大。

---

### 10. estimateMessageChars() + contextBudgetChars（上下文预算系统）

**文件**: `agentRuntime.ts:481` / `agentRuntime.ts:132`

- `contextBudgetChars = contextWindow × 70% × 4` — 上下文字符预算（留 30% 给输出）
- `estimateMessageChars()` — 遍历消息零件，累加文本 + 工具名 + args JSON 的字符长度

**Bug 关联**: 估算器读的是 turnMessages 里的消息内容（Gemini provider 下是 fullParts 完整数据；DashScope 下是 sanitize 后重建的 content），所以估算值本身是合理的。问题是 `compressIfNeeded()` 只在 turn 结束时调用，turn 内的膨胀无人管理。

---

### 11. compressIfNeeded()（惰性压缩）

**文件**: `agentRuntime.ts:507`

检查 `estimateContextChars()` 是否超过 `contextBudgetChars`。超了就把 `conversationHistory` 里最老的 turn 压缩成摘要（移入 `summary`）。

**调用时机**: 仅在 `endTurn()` 时调用。

**Bug 关联**: 截断循环全在同一个 turn 内发生，turn 从未结束 → `compressIfNeeded()` 从未被调用 → turnMessages 无限膨胀。

---

### 12. maxOutputTokens（单次输出上限）

**值**: 16384（`agentLoopPolicy.ts:28`）

LLM 每次调用的输出 token 上限。包括可见文本 + thinking + tool call 参数。超出时 API 强制截断，返回 `finishReason: 'length'`。

**Bug 关联**: 复杂设计的 JSX 可能超过 10K tokens，加上 thinking 就超 16384 → 截断 → 但截断守卫在错误分支。

---

### 13. finishReason（LLM 停止原因）

**来源**: LLM API 响应字段。`LLMResponse.finishReason`（`types.ts:90`）

| 值 | 含义 |
|---|---|
| `'stop'` | 正常完成 |
| `'length'` | 达到 maxOutputTokens 上限，输出被截断 |
| `'tool_calls'` | 因为要调用工具而停止 |
| 其他（provider 特有）| 如 GLM 的 `'normal'`、`'sensitive'` 等 |

**Bug 关联**: 截断守卫用黑名单判断（"不是 stop 且不是 tool_calls = 截断"），但不同 provider 的正常完成值不一定是 `'stop'`。GLM-5 的正常完成值很可能不是 `'stop'`，导致被误判为截断。

---

### 14. 截断守卫（Truncation Guard）

**位置**: `agentRuntime.ts` 主循环的两个位置

**守卫 A（新增，tool calls 分支前）**: 当 `finishReason === 'length'` 且有 tool calls 时，丢弃截断的 tool calls，注入"拆小重试"提示。

**守卫 B（原有，else 分支）**: 当无 tool calls 且 `finishReason` 不是 `'stop'`/`'tool_calls'` 时，注入 continuation 提示。

**Bug 1 — 守卫 B 的位置错误（已修复）**: 截断的 tool calls 走 if 分支，守卫 B 在 else 分支 → 永远走不到 → 截断的 JSX 直接送去解析。

**Bug 2 — 守卫 B 的条件过宽（待修复）**: `if (fr && fr !== 'stop' && fr !== 'tool_calls')` 是黑名单。任何非标准 finishReason 都会触发。GLM-5 的正常文本回复被误判为截断，注入了错误的 continuation 消息。

---

### 15. emptyResponseHook（空响应守卫）

**文件**: `src/engine/agent/hooks/builtinHooks.ts:70`

检测 LLM 返回"无文本 + 无 tool calls"的响应。允许重试 2 次（`action: 'skip'`），第 3 次 abort。

**Skip 的效果**: `iteration = Math.max(0, iteration - 1)` → 回退 iteration 计数，重新调 LLM。不添加任何消息到 turnMessages。

**Bug 关联**: 被截断守卫误触发 continuation 后，LLM 陷入只 thinking 不行动 → 空响应 → emptyResponseHook 重试 2 次 → abort。但 abort 的错误信息是"empty response"，没有体现真正的根因（finishReason 误触发）。

---

### 16. loopDetectionHook（循环检测守卫）

**文件**: `builtinHooks.ts:103` + `src/engine/agent/loopDetector.ts`

检测 LLM 是否反复调用相同的 tool call 模式。用 FNV-1a hash 做 tool call 签名指纹，相同签名出现 ≥ 4 次（`LOOP_DETECTION_THRESHOLD`）触发。

**行为**: 非致命 → 注入 hint 提示（"你在重复相同的操作"）；致命 → abort。

**Bug 关联**: 截断循环中，每次 JSX 不同（hash 不同，因为截断位置可能微变），循环检测可能认不出来。即使认出来，也只是注入 hint，LLM 可能忽略继续重试。

---

### 17. DashScopeProvider（OpenAI 兼容 provider）

**文件**: `src/engine/llm-client/providers/dashscope.ts`

支持所有走 OpenAI Chat Completions 格式的模型：Kimi K2.5、GLM-5、GLM-4.7、Qwen 等。通过 Cloudflare Worker proxy 中转。

**finishReason 来源**: `choice?.finish_reason`（OpenAI 格式，line 364）

**Bug 关联**: GLM-5 的 `finish_reason` 值可能不是标准的 `'stop'`，但代码中只认 `'stop'` 和 `'tool_calls'`，其他值一律当截断处理。

---

### 18. compileJsx() / templateCompiler（JSX 解析器）

**文件**: `src/engine/jsx/templateCompiler.ts`

用 **sucrase** 把 JSX 字符串编译成 JavaScript，再执行生成虚拟节点树。语法不完整 → 抛 SyntaxError → 返回 `COMPILE_ERROR`。

**Bug 关联**: 截断的 JSX 送到这里 → 必定报 "Unterminated JSX contents" → 错误返回给 LLM → LLM 重试 → 循环。

---

### 19. knowledge 工具（设计知识检索）

**文件**: `src/engine/agent/tools/` 中的 knowledge 工具定义

返回设计指南（landing-page、dashboard 等），内容约 **9K chars**。LLM 用这些知识来规划设计。

**Bug 关联**: 不是直接原因，但 9K 的指南内容让 LLM 倾向于先说"我来做什么"（text-only 回复），而不是直接调 jsx 工具。这个 text-only 回复本应触发 turn end，但被 finishReason 误判拦截。

---

### 20. inspect 工具（画布状态检查）

**文件**: `src/engine/agent/tools/` 中的 inspect 工具定义

读取当前 Figma 画布上的节点状态。参数 `node: "/"` 表示读取根页面。

**Bug 关联**: 三次 E2E 中 inspect 都返回空画布 `{ children: [] }`。工具本身正常，但 LLM 看完空画布后走了"先说计划"的路线，而不是直接创建。

---

### 21. Session / Run（会话与运行）

**概念关系**:
- **Session**: 用户打开插件到点击"New Design"为一个 session，`conversationHistory` 在 session 内持久
- **Run**: 每次 `run(prompt)` 调用是一个 run（= 一个 turn），有唯一的 `runId`
- **Iteration**: 一个 run 内的循环次数，每次 LLM 调用 + 工具执行 = 一次迭代

**Bug 关联**: trigger-1 和 trigger-2 是不同 session（runId 不同、消息 ID 不同），所以 trigger-2 看不到 trigger-1 的历史。trigger-3 和 trigger-2 是同一 session 的不同 run，trigger-3 能看到 trigger-2 的对话历史。

---

### 22. Dev Bridge（E2E 测试桥）

**文件**: `tools/dev-bridge/server.ts`（服务端）、`src/dev/useDevBridge.ts`（插件端）

```
Claude Code → POST /trigger → dev-bridge server → /tmp/figma-bridge/ → Figma 插件轮询 → 执行
```

每次 trigger 创建一个独立目录，保存：`meta.json`、`runtime-events.json`、`tool-calls.json`、`tree.json`、`logs.txt`。

**Bug 关联**: trigger 本身不管 session 状态。如果 Figma 插件在 trigger 之间重载了，session 就断了（trigger-1 → trigger-2）。如果没重载，session 延续（trigger-2 → trigger-3）。

---

## 二、实体关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentRuntime (主循环)                      │
│                                                                   │
│  assemblePrompt()                                                 │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ Layer 1: staticSystemPrompt (25K chars, 固定)            │     │
│  │ Layer 2: summary (压缩的旧对话)                          │     │
│  │ Layer 3: conversationHistory (前几轮完整消息)            │     │
│  │ Layer 4: turnMessages (当前轮，每次迭代追加)             │     │
│  └─────────────────────────────────────────────────────────┘     │
│         │                                                         │
│         ▼                                                         │
│  LLMGenerationCoordinator.generate()                              │
│  ┌──────────────────────────────────┐                             │
│  │ computeCacheDiagnostics() → 日志  │                             │
│  │ sanitizeToolCallsForHistory()     │← 只改 response.toolCalls   │
│  │ provider.generate() → LLMResponse │                             │
│  └──────────────────────────────────┘                             │
│         │                                                         │
│         ▼                                                         │
│  LLMResponse                                                      │
│  ┌──────────────────────────────────────────────────┐             │
│  │ .text          — 可见文本                         │             │
│  │ .thoughts      — thinking 内容                   │             │
│  │ .toolCalls     — 工具调用列表（已被 sanitize 截短）│             │
│  │ .fullParts     — 原始零件（未截短！）              │             │
│  │ .finishReason  — 'stop'/'length'/'tool_calls'/... │             │
│  │ .usage         — token 用量统计                   │             │
│  └──────────────────────────────────────────────────┘             │
│         │                                                         │
│         ▼                                                         │
│  afterLLMResponse hooks (优先级排序)                               │
│  ┌────────────────────────────────────────────┐                   │
│  │ [P10] emptyResponseHook — 空响应？重试/abort │                   │
│  │ [P30] loopDetectionHook — 循环？hint/abort  │                   │
│  └────────────────────────────────────────────┘                   │
│         │                                                         │
│         ▼                                                         │
│  formatResponseGemini(response)                                   │
│  → 用 response.fullParts（未截短）→ 存入 turnMessages              │
│         │                                                         │
│         ▼                                                         │
│  ┌─ if (有 tool calls) ─────────────────────┐                     │
│  │  [守卫A] finishReason=='length'?          │                     │
│  │    → 丢弃截断 calls, 注入拆分提示        │                     │
│  │  执行工具 → 结果追加到 turnMessages       │                     │
│  │  afterIteration hooks                    │                     │
│  │  iteration++ → continue                  │                     │
│  ├─ else (无 tool calls) ───────────────────┤                     │
│  │  [守卫B] finishReason != 'stop'?         │                     │
│  │    → 注入 continuation 消息 → continue    │  ← Bug: 条件过宽   │
│  │  有 text → turn end (结束本轮)            │                     │
│  │  无 text → 也 turn end                    │                     │
│  └──────────────────────────────────────────┘                     │
│                                                                   │
│  endTurn() → turnMessages → conversationHistory                   │
│           → compressIfNeeded() (此时才压缩)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、三个 Bug 及其关联

### Bug 1: 截断守卫在错误分支（已修复）

**现象**: LLM 输出 JSX 被截断 → "Unterminated JSX contents" 循环 10+ 次

**根因链**:
```
maxOutputTokens=16384 → JSX 太长 → finishReason='length'
  → 但有 tool calls → 走 if 分支
  → 守卫 B 在 else 分支 → 不触发
  → 截断 JSX 送 compileJsx() → 必定报错
  → 错误返回 LLM → 重试同样大小的 JSX → 同一位置截断
  → 循环
```

**涉及实体**: maxOutputTokens, finishReason, 截断守卫, compileJsx, turnMessages, fullParts

**修复**: 在 tool dispatch 前加守卫 A，检测 `finishReason === 'length'` 时丢弃 tool calls。

**附带问题**:
- turnMessages 膨胀（fullParts 未瘦身，每次 +16K）→ compressIfNeeded 不触发（turn 未结束）→ 恶性循环
- sanitizeToolCallsForHistory 改了 toolCalls 但没改 fullParts → 瘦身白做

---

### Bug 2: finishReason 条件过宽（待修复）

**现象**: GLM-5 正常的 text-only 回复被误判为截断 → 注入错误 continuation → LLM 卡死

**根因链**:
```
GLM-5 返回 text=34 的完整回复（"我来创建安克充电宝产品页"）
  → finishReason ≠ 'stop'（GLM 可能用 'normal' 或其他值）
  → 守卫 B: if (fr && fr !== 'stop' && fr !== 'tool_calls') → 触发!
  → 注入 "Your previous response was truncated. Continue where you left off."
  → LLM 困惑（它说完了，但被告知"你被截断了"）
  → 只输出 thinking，不产出文本或 tool call → 空响应
  → emptyResponseHook: skip (重试 1/2), skip (2/2), abort
  → "LLM Provider returned an empty response"
```

**涉及实体**: finishReason, DashScopeProvider, 截断守卫 B, emptyResponseHook, turnMessages

**E2E 证据**:
- trigger-88681: iter2 text=34 → cont_ 注入 → 3 次空响应 → abort
- trigger-33063: 同上
- trigger-13666: 带了 trigger-33063 的历史，但走了完全相同的死路

**修复方向**: 守卫 B 改为白名单——只在 `finishReason === 'length'` 时触发：
```typescript
// 之前（黑名单，任何非标准值都触发）:
if (fr && fr !== 'stop' && fr !== 'tool_calls')
// 之后（白名单，只有确认截断才触发）:
if (fr === 'length')
```

---

### Bug 3: 上下文断裂的错觉

**现象**: 三次 E2E 用同一 prompt，LLM 每次都从头查 knowledge + inspect，看起来没有上下文

**实际情况**:
- trigger-1 和 trigger-2 是不同 session（plugin 可能重载了）→ 确实没有上下文
- trigger-3 继承了 trigger-2 的完整历史（6 条消息 vs trigger-2 的 2 条）→ 有上下文
- 但继承的历史是"查了指南 + 说要做但没做"的状态（因为 Bug 2 导致 abort）
- LLM 看到这个历史后再次走 knowledge → inspect → "我来创建" → 同一位置卡死

**不是 bug，而是 Bug 2 的连锁效应**: 上下文在 session 内正确传递，但每次都在 finishReason 误触发处卡死，产出为零，所以下一轮 LLM 别无选择只能重来。

**涉及实体**: conversationHistory, turnMessages, run/session, assemblePrompt

---

## 四、knowledge + inspect 预查流程分析

三次 E2E 都展示了同一个模式：

```
迭代 1: knowledge("landing-page") + inspect("/") → 成功
迭代 2: 纯文本 "我来创建..." → 被守卫 B 拦截 → 死循环
```

**这个流程本身不是 bug 的直接原因**，但它有两个效应：

1. **knowledge 返回 9K chars 的指南** → LLM 花大量 thinking 消化 → 倾向于先"说计划"再行动。这个"先说再做"的 text-only 回复是正常的 turn end 信号，但被 Bug 2 拦截。

2. **inspect 返回空画布** → LLM 没有现有设计可参考 → 需要从零创建 → 任务复杂度最高 → 如果 LLM 能力不足（GLM-5），更容易陷入"规划但不执行"。

**潜在改进**: 如果 LLM 在迭代 1 就直接调 jsx 工具（而不是先说"我来做"），Bug 2 就不会触发（因为有 tool calls → 走 if 分支而不是 else 分支）。可以在 prompt 中强化"不要回复计划文字，直接调用工具"。

---

## 五、数据流中的不一致点

```
LLM API 返回
  │
  ├─→ response.fullParts = [原始完整数据, 包含 16K JSX]
  │
  ├─→ sanitizeToolCallsForHistory() → response.toolCalls 截短到 200 chars
  │     （改了 toolCalls，没改 fullParts）
  │
  ├─→ formatResponseGemini() → 用 fullParts → 存入 turnMessages
  │     （turnMessages 里存的是完整 16K 数据）
  │
  ├─→ estimateMessageChars() → 读 turnMessages.content → 能看到完整 16K
  │     （估算值正确反映了膨胀）
  │
  ├─→ computeCacheDiagnostics() → 只统计 cacheable 前缀
  │     （日志只报前缀 token 数，掩盖了总量膨胀）
  │
  └─→ compressIfNeeded() → 只在 turn end 调用
        （turn 内截断循环时不触发，turnMessages 无限增长）
```

---

## 六、修复状态总结

| # | Bug | 状态 | 修复内容 |
|---|---|---|---|
| 1 | 截断守卫在错误分支 | **已修复** | 在 tool dispatch 前加守卫 A，`finishReason==='length'` 时丢弃截断 calls |
| 2 | finishReason 条件过宽 | **待修复** | 守卫 B 改为 `fr === 'length'`（白名单） |
| 3 | fullParts 未瘦身 | **待修复** | formatResponse 前对 fullParts 的 functionCall.args 也做 sanitize |
| 4 | Turn 内无压缩 | **待修复** | 在 turn 内也检测 turnMessages 膨胀，触发 intra-turn 压缩 |
| 5 | KV cache 日志误导 | **低优** | 同时报总 token 估算，不只是 cacheable 前缀 |
| 6 | llm_response event 缺 finishReason | **低优** | event 中加 finishReason 字段，方便调试 |

---

## 七、相关文件索引

| 文件 | 关键函数/概念 | 涉及 Bug |
|---|---|---|
| `src/engine/agent/agentRuntime.ts` | 主循环、截断守卫 A/B、assemblePrompt、compressIfNeeded、turnMessages | 1, 2, 4 |
| `src/engine/agent/llmGenerationCoordinator.ts` | generate、sanitize 调用点、computeCacheDiagnostics | 3, 5 |
| `src/engine/llm-client/providers/gemini/geminiFormat.ts` | formatResponseGemini（用 fullParts） | 3 |
| `src/engine/agent/context/toolResultCleaner.ts` | sanitizeToolCallsForHistory（只改 toolCalls） | 3 |
| `src/engine/agent/hooks/builtinHooks.ts` | emptyResponseHook、loopDetectionHook | 2 |
| `src/engine/agent/loopDetector.ts` | LoopDetector.detect（签名指纹） | 1 |
| `src/engine/agent/agentLoopPolicy.ts` | maxOutputTokens: 16384 | 1 |
| `src/engine/llm-client/providers/dashscope.ts` | GLM-5 的 finishReason 来源 | 2 |
| `src/engine/llm-client/providers/types.ts` | LLMResponse 类型定义 | 1, 2 |
| `src/engine/jsx/templateCompiler.ts` | compileJsx（截断 JSX 报错点） | 1 |
| `src/engine/agent/constants.ts` | LOOP_DETECTION_THRESHOLD: 4 | 1 |

---

## 八、成功 Run 的输入压力分析 (trigger-1775035854928, Kimi K2.5)

> 完整 API 交互日志: [e2e-api-trace-1775035854928.txt](e2e-api-trace-1775035854928.txt)

### 每次迭代的 Input/Output 对比

```
iter  input chars  input tok  最大 tool result       LLM 输出                耗时
────────────────────────────────────────────────────────────────────────────────
1       29,839     ~7.5K     -                       2 tool calls (kn+find)  12s
2       39,801     ~10K      9,725c (knowledge)      78c text + jsx call     188s
3       31,239     ~7.8K     603c (inspect简略)      31c text + inspect      13s
4       35,096     ~8.8K     3,745c (inspect)        18c text + describe     14s
5       39,547     ~9.9K     4,352c (describe)       23c text + inspect      4s
6      104,827     ~26K      65,404c (detail!)       588c text (总结)        62s
```

### 关键观察

**1. intra-turn 压缩在起作用**

iter 2 的 tool result 是 9,725c（knowledge 指南），但到 iter 3 变成了 180c。`turnResultCompressor.ts` 把 LLM 已消费过的结果压缩成了摘要。这就是为什么 iter 3 的总 input (31K) 反而比 iter 2 (39K) 小。

**2. detail inspect 是 input 爆炸点**

iter 5 → iter 6：input 从 39K 跳到 **104K chars**。原因是 iter 5 的 `inspect(mode='detail', screenshot=true)` 返回了 65,404 chars（整个设计树的完整属性）。截图中显示的 155,138 chars 是原始 inspect detail 数据，存入 turnMessages 时可能经过了部分清理但仍有 65K。

**3. 输出耗时与 input 大小正相关**

| input 规模 | LLM 耗时 |
|---|---|
| ~7-10K tok | 4-14s |
| ~10K tok (含 JSX 生成) | 188s（生成大 JSX 是计算密集型） |
| ~26K tok (含 65K detail) | 62s（处理大 input 的延迟膨胀） |

**4. JSX 生成是真正的 output 大户**

iter 2 的 jsx tool call 参数是 **23,898 chars**（完整的 landing page JSX）。这是 LLM 一次输出中最大的 payload，耗时 188s。对照 maxOutputTokens=16384——23K chars ÷ 4 ≈ 6K tokens，加上 thinking 和 text，总 output 约 6-8K tokens，没超上限。但如果设计更复杂，就可能触发 Bug 1（截断）。

### LLM 的"输出压力"定义

不是 output token 上限的问题（16384 对大多数单次调用够用）。真正的压力是：

1. **注意力稀释**: input 越大，LLM 对每个 token 的注意力越分散。26K tokens 的 input 里，LLM 要从 65K chars 的 JSON 属性树里提取有用信息
2. **延迟膨胀**: 大 input → 长耗时 → 用户等待体验差。iter 6 的 62s 大部分花在 prefill 阶段
3. **成本**: input tokens 按量计费。65K chars = ~16K tokens，单次 inspect detail 就很贵
4. **累积效应**: detail inspect 的 65K 留在 turnMessages 里，如果后续还有 edit/jsx 操作，每次 LLM 调用都带着它。一个 turn 内多次 inspect detail → input 轻松超 100K tokens
5. **挤压 output 空间**: 虽然 maxOutputTokens 是独立的 16384，但部分 provider 的实际行为是 `input + output ≤ context_window`。大 input 可能间接导致 output 提前截断

### 与 Bug 关联

- **Bug 1（截断）**: JSX 生成时 output ~6K tokens。如果设计更复杂（如 dashboard），output 可能超 16384 → 触发截断。而之前的 tool results 在 input 中占空间，进一步加剧了 output 被挤压的风险
- **Bug 4（turn 内无压缩）**: detail inspect 的 65K 在最后一次调用中是"新鲜的"，不会被 turnResultCompressor 压缩。如果 LLM 在此之后再做操作，这 65K 就一直挂在 turnMessages 里
