# Agent 认知循环修复全历程

> 记录日期：2026-02-04
> 问题：Figma 设计生成插件的 Agent 在 EXECUTION 模式下进入"认知循环"，产出大量重复叙述文本而不调用工具，导致无法完成用户的设计任务。

---

## 一、问题现象

用户输入设计 prompt（如"创建一个登录表单"），Agent 能够：
- 正确进入 PLANNING 模式，调用 `planDesign` 生成步骤
- 前 4-5 个 EXECUTION iteration 正常调用 `createNode`、`setNodeLayout` 等工具

**但在 iteration 5 左右**，Agent 进入"认知循环"：
- 连续产出数千字符的重复叙述文本（"I'm now focused on building the email label..."）
- 零工具调用
- Gemini 甚至写出 "I'm stuck in a loop" 但依然继续循环
- Runtime 检测到 RAMBLING/THINKING-ONLY，最终终止任务

---

## 二、修复历程（4 轮迭代）

### 第 1 轮：基础链路修复

**发现**：通过代码审计发现多个基础问题叠加导致 Agent 能力受限。

| 修复 | 文件 | 内容 |
|:---|:---|:---|
| P0 | `toolCallHandler.ts` | `inspectDesign` 工具已定义但无 IPC handler → 添加 `case 'inspectDesign'` |
| P0 | `useChat.ts` | `validateLayout` 未注册为 local executor → 添加到 `localExecutors` |
| P0 | `AgentOrchestrator.ts` + `skillPromptComposer.ts` | Token 预算 4000 → 8000（工具定义被过度压缩） |
| P1 | `gemini.ts` | Temperature 0.7 → 0.4（减少工具调用的随机性） |
| P1 | `constants.ts` | `RAMBLING_TEXT_THRESHOLD` 1000 → 1500 |
| P1 | `agentRuntime.ts` | `summarize_progress` 循环检测加入绝对次数限制 |

**结果**：Agent 仍在 iteration 5 进入认知循环。

### 第 2 轮：流式中断策略调整（失败尝试）

**假设**：Gemini 流式输出时 text 先于 tool calls 到达，流式中断在 tool calls 到达前杀掉了流。

| 修复 | 内容 |
|:---|:---|
| 将流式中断限制为 PLANNING-only | `if (mode === 'PLANNING' && accumulatedChars > ramblingThreshold)` |
| 强化 recovery injection | system prompt 追加具体工具名称 |
| EXECUTION mode prompt 强化 | "response MUST start with tool call" |

**结果**：❌ **反效果**。日志显示 Gemini 产出 6171 chars 纯文本（比之前的 3103 更长），**0 tool calls**。证明问题不是 tool calls 被截断——Gemini 根本没有产出 tool calls。

**教训**：
> 取消流式中断让 Gemini 有了更多空间来生成废话。Prompt 工程（更强措辞、更严指令）对已进入"叙述模式"的 Gemini 效果有限。

### 第 3 轮：API 层强制工具调用（突破性进展）

**核心发现**：项目已有 `LLMToolConfig` 基础设施（`mode: 'ANY'` 强制工具调用），但 `agentRuntime.ts` 从未传递 `toolConfig` 参数。

| 修复 | 内容 |
|:---|:---|
| `toolConfig.mode = 'ANY'` | EXECUTION 模式下通过 Gemini API 强制至少一个工具调用 |
| 禁用 EXECUTION 流式中断 | `if (mode !== 'EXECUTION' && ...)` — 让 ANY 模式有时间产出 tool calls |
| maxTokens 限制 | EXECUTION 模式 65536 → 4096 → **2048**（限制前言文本空间） |
| user 角色恢复消息 | 检测到循环后注入 user 消息（比 system prompt 追加有更高优先级） |

**结果**：✅ **巨大进步**。Agent 从 iteration 5 死循环 → 推进到 **iteration 14**，成功创建 17 个节点 + 完整样式补丁（`applyDesignPatch` 批量更新 17 个节点）。

**但暴露新问题**：每个 EXECUTION iteration 产出 3000-5500 chars 叙述前言，全量进入 context → Context 从 7K → 176K tokens（88%）。

### 第 4 轮：Context 污染治理

**根因**：`formatResponse()` 将 Gemini 的 `fullParts`（text parts + functionCall parts）全部存入消息历史。叙述文本污染 context，形成正反馈：context 中有叙述 → Gemini 学习叙述模式 → 产出更多叙述。

| 修复 | 内容 |
|:---|:---|
| 文本剥离 | `formatResponse` 后过滤掉 text parts，只保留 functionCall + thought |
| maxTokens 进一步降低 | 4096 → 2048 |
| VERIFICATION 也用 ANY | 防止验证阶段也陷入纯文本叙述 |

**预期效果**：Context 增长从 ~12K tokens/iteration 降至 ~2K tokens/iteration，叙述自我强化链路被打破。

---

## 三、最终修改文件清单

| 文件 | 改动摘要 |
|:---|:---|
| `src/engine/agent/agentRuntime.ts` | toolConfig ANY、maxTokens 2048、文本剥离、user 恢复消息、流式中断策略、循环检测增强 |
| `src/engine/agent/agentPrompts.ts` | EXECUTION 模式 prompt 强化、DEEP_NODE_PROCESSING_PROTOCOL、DESIGN_FREEDOM |
| `src/engine/agent/constants.ts` | RAMBLING_TEXT_THRESHOLD 1000→1500、压缩因子调整 |
| `src/engine/llm-client/providers/gemini.ts` | temperature 0.7→0.4 |
| `src/engine/services/AgentOrchestrator.ts` | token budget 4000→8000、skills 异步初始化 |
| `src/engine/agent/skills/skillPromptComposer.ts` | DEFAULT_BUDGET 4000→8000 |
| `src/ipc/handlers/toolCallHandler.ts` | 添加 inspectDesign IPC handler |
| `src/features/chat/useChat.ts` | validateLayout 注册为 local executor |

---

## 四、沉淀知识

### 4.1 Gemini 工具调用行为模型

```
Gemini 流式输出顺序:
  [thinking] → [text parts] → [functionCall parts]
              ↑                ↑
              叙述前言           实际工具调用
              (先到达)          (后到达)
```

**关键特性**：
1. **Text 先于 Tool Calls**：Gemini 在流式输出中总是先发送 text 部分，再发送 functionCall 部分。这意味着流式中断如果基于文本长度，会在 tool calls 到达前杀掉流。
2. **`functionCallingConfig.mode: 'ANY'`**：Gemini API 支持强制工具调用，保证至少产出一个 functionCall。但模型仍会先产出大量 text 前言。
3. **叙述模式自我强化**：如果 context 中包含叙述文本，Gemini 会"学习"这个模式，在后续迭代中产出更多叙述。剥离叙述文本是打破循环的关键。
4. **Prompt 工程对"叙述模式"效果有限**：一旦 Gemini 进入叙述模式，即使 system prompt 说"不要描述你在做什么"，模型也会忽略。API 级别的约束（`ANY` 模式）远比 prompt 措辞有效。

### 4.2 `toolConfig.mode` 与流式中断的交互

| 场景 | toolConfig | 流式中断 | 结果 |
|:---|:---|:---|:---|
| EXECUTION + AUTO + 中断 | AUTO | 2500 chars 中断 | ❌ 中断后 0 tool calls，视为 thinking-only |
| EXECUTION + ANY + 中断 | ANY | 2500 chars 中断 | ❌ ANY 保证 tool calls 但中断先杀掉了流 |
| EXECUTION + ANY + 不中断 | ANY | 不中断 | ✅ Tool calls 最终到达，但前言文本进入 context |
| EXECUTION + ANY + 不中断 + 文本剥离 | ANY | 不中断 | ✅✅ Tool calls 到达 + 叙述不进入 context |

**结论**：`ANY` 模式 + 禁用 EXECUTION 流式中断 + 文本剥离是最优组合。

### 4.3 Context 膨胀的数学模型

```
每个 EXECUTION iteration 的 context 增量:
  不剥离: ~3000-5000 chars text + ~500-1500 chars tool calls = ~1000-1500 tokens
  剥离后: ~500-1500 chars tool calls only = ~125-375 tokens

14 次迭代累计:
  不剥离: ~14K-21K tokens (仅 model 消息部分)
  剥离后: ~1.75K-5.25K tokens

context 中还有 tool result 消息 (每次 ~500-2000 tokens):
  ~7K-28K tokens

总计 14 次迭代:
  不剥离: context ~150K-180K / 200K (75-90%)
  剥离后: context ~30K-50K / 200K (15-25%)
```

### 4.4 User 消息 vs System Prompt 的优先级

Gemini 对不同角色消息的响应优先级：
1. **User 消息**（最高优先级）：最新的 user 消息对 Gemini 的行为影响最大
2. **System 消息开头**：system prompt 的开头部分权重较高
3. **System 消息末尾追加**：权重最低，容易被忽略

**实践**：当需要紧急干预 Gemini 的行为时（如打破认知循环），注入 user 角色消息比修改 system prompt 更有效。

### 4.5 maxOutputTokens 的战略意义

`maxOutputTokens` 不仅影响输出长度，还间接影响 Gemini 的**输出策略**：
- 65536 tokens：Gemini 有充足空间，倾向于先"思考"（产出大量文本），再"行动"（产出 tool calls）
- 2048 tokens：空间有限，Gemini 被迫更快转向 tool calls 生成
- 过小（<1024）：可能导致复杂 tool call 参数被截断

**建议值**：EXECUTION 模式 2048 tokens，PLANNING 模式不限制。

### 4.6 循环检测的多层防御

| 层 | 检测手段 | 触发条件 | 响应 |
|:---|:---|:---|:---|
| 流式层 | 字符数阈值 | text > 1500 chars (非 EXECUTION) | 中断流 |
| 响应层 | thinking-only 计数 | 连续 4 次无 tool calls | 终止任务 |
| 工具层 | summarize_progress 计数 | 相同 3 次 或 总计 5 次 | 返回 LOOP_DETECTED 错误 |
| 签名层 | tool call 签名去重 | 连续 3 次相同签名 | 返回 LOOP_DETECTED 错误 |
| Context 层 | 文本剥离 | EXECUTION/VERIFICATION 有 tool calls | 删除 text parts |
| API 层 | toolConfig.mode | EXECUTION/VERIFICATION | 强制至少一个 tool call |
| Token 层 | maxOutputTokens | EXECUTION/VERIFICATION | 限制为 2048 |
| 恢复层 | user 角色消息注入 | thinking-only > 0 | 注入强制指令 |

### 4.7 失败的尝试（反模式记录）

1. **单纯的 Prompt 强化**：在 system prompt 中加入 "MUST start with tool call"、"NO text chatter" 等措辞，对已进入叙述模式的 Gemini 无效。
2. **取消所有流式中断**：让 Gemini 跑完全程反而浪费更多时间和 tokens（从 3103 chars → 6171 chars），因为没有 ANY 模式时 Gemini 根本不会产出 tool calls。
3. **仅依赖 `toolConfig.mode: 'ANY'` 而不做文本剥离**：Tool calls 到达了，但 context 以每次 ~1000-1500 tokens 的速度膨胀，14 次迭代后接近上限。

---

## 五、架构改进建议（未实施）

1. **Gemini 流式输出中检测 functionCall 部分开始**：而非仅基于字符数中断。当检测到第一个 functionCall chunk 时停止 text 累积。
2. **模式自适应 maxTokens**：根据当前 plan 步骤的复杂度动态调整（简单步骤 1024，复杂步骤 4096）。
3. **Context 滑动窗口**：只保留最近 N 个 iteration 的完整消息，更早的 iteration 压缩为摘要。
4. **Tool Call 批处理提示**：在 system prompt 中明确鼓励单次 iteration 产出多个 tool calls（当前 Gemini 倾向于每次只产出 1-2 个）。
