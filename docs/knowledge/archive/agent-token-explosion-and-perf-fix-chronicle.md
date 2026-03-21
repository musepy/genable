# Agent Token 爆炸 & 性能优化修复全历程

> 记录日期：2026-02-06
> 问题线索：4 轮连续修复，从 token 爆炸 → 耗时过长 → MALFORMED 崩溃 → 单工具低效循环
> 涉及文件：agentRuntime.ts, gemini.ts, performance.ts, figmaVariableCache.ts, agentPrompts.ts, rendererTools.ts, planState.ts, promptComposer.ts

---

## 目录

1. [问题总览](#一问题总览)
2. [第一轮：Token 爆炸 & 上下文失控](#二第一轮token-爆炸--上下文失控)
3. [第二轮：生成耗时过长](#三第二轮生成耗时过长)
4. [第三轮：MALFORMED 崩溃 & 计划过细](#四第三轮malformed-崩溃--计划过细)
5. [第四轮：单工具低效循环](#五第四轮单工具低效循环)
6. [修改文件索引](#六修改文件索引)
7. [关键设计决策 & 教训](#七关键设计决策--教训)

---

## 一、问题总览

| 轮次 | 症状 | 根因 | 影响 |
|:---|:---|:---|:---|
| 第一轮 | token 从 4002 跳到 235215，两条并行执行循环 | `manageContext()` 未 await，消息序列截断逻辑缺陷 | Agent 崩溃/无限循环 |
| 第二轮 | 简单 prompt 耗时 5+ 分钟 | thinking 无上限、双重 LLM 调用、超时 Infinity、缓存重复预热 | 用户体验极差 |
| 第三轮 | MALFORMED_FUNCTION_CALL 连续 3 次崩溃，计划 20 步 | Gemini 3 thinkingConfig 参数错误、重试无上下文变化、planDesign 无步数限制 | Agent 终止 |
| 第四轮 | 登录表单 36 次迭代（应 4-6 次）| planDesign schema 将步骤=单工具调用，示例教学顺序模式 | 极度低效 |

---

## 二、第一轮：Token 爆炸 & 上下文失控

### 2.1 日志现象

```
[AgentRuntime] Context Budget: 4002/200000 tokens (2%)
  ... (跳跃)
[AgentRuntime] Context Budget: 235215/200000 tokens (117%)
[AgentRuntime] CRITICAL: Message sequence invalid after truncation
[AgentRuntime] fixInvalidSequence: No repair possible
```

还出现了**两个并行的迭代计数器**（ghost loop），表明有两个循环体在同时跑。

### 2.2 根因分析 & 修复

#### Bug 1：`manageContext()` 未 await（P0 — 主因）

**文件**：`agentRuntime.ts` 第 779 行

```typescript
// 修复前（fire-and-forget，导致并行执行）：
this.manageContext();

// 修复后：
await this.manageContext();
```

**因果链**：`manageContext` 是 async 函数，不 await 意味着它在后台执行 `.hidden = true`，同时主循环继续下一次迭代。两条执行路径同时修改 `this.messages` 数组 → 数据竞争 → token 计数失真 → 上下文爆炸。

#### Bug 2：`groupIntoTurns` 无法识别 model→tool 对（P0）

**文件**：`agentRuntime.ts` 第 354-420 行

```typescript
// 修复前：只识别 user→model→tool 序列
// 在 agentic loop 中，大量 model→tool 对没有前置 user 消息

// 修复后：增加 model-initiated turn 分支
} else if (msg.role === 'model') {
  // Model-initiated turn (agentic continuation): model → tool*
  turnIndices.push(i);
  if (this.hasFunctionCalls(msg)) {
    i++;
    while (i < messages.length && messages[i].role === 'tool' && !messages[i].hidden) {
      turnIndices.push(i); i++;
    }
  } else { i++; }
  const tokens = turnIndices.reduce((sum, idx) => sum + this.estimateTokens(messages[idx].content), 0);
  turns.push({ indices: turnIndices, tokens });
}
```

**影响**：修复前 `truncateByTurns` 只能识别出 1 个 turn，打印 `Not enough turns to truncate (1 <= 3)` → 永远不截断 → token 无限增长。

#### Bug 3：`fixInvalidSequence` 只向后搜索（P1）

**文件**：`agentRuntime.ts` 第 604-650 行

修复为**双向搜索**：
- 向前：为 visible model message 的 function call 取消隐藏对应的 tool response
- 向后：隐藏没有对应 tool response 的 orphaned model message
- 修复后同步 `approximateTokens`

#### Bug 4：无 120% 硬停机制（P1）

**文件**：`agentRuntime.ts` 第 789-793 行

```typescript
if (currentTokens > this.maxContextTokens * 1.2) {
  console.error(`[AgentRuntime] FATAL: Context budget exceeded 120%...`);
  throw new Error(`Agent aborted: context budget exceeded 120%...`);
}
```

#### Bug 5：`approximateTokens` 累计漂移（P2）

**文件**：`agentRuntime.ts` 第 783 行、第 1201 行

- 每次迭代开始时将 `approximateTokens` 同步为实际可见 token 数
- hidden message 不计入 budget

```typescript
// 迭代开始时同步
this.approximateTokens = this.estimateTokens(this.messages.filter(m => !m.hidden));

// model message 添加时条件计数
if (!modelMessage.hidden) {
  this.approximateTokens += modelMessageTokens;
}
```

---

## 三、第二轮：生成耗时过长

### 3.1 日志现象

用户反馈："目前生成的总耗时太长了，用的是项目建议 prompt，很简单，却耗时极长"

### 3.2 根因分析 & 修复

#### Bug 6：Thinking 无 token 预算（P0）

**文件**：`gemini.ts` 第 55-71 行

```typescript
// 修复前：
config.thinkingConfig = { includeThoughts: true };
// 每次响应产出 5000-14000 字符的思考文本

// 修复后（需区分模型版本）：
if (isGemini3) {
  config.thinkingConfig = { includeThoughts: true, thinkingLevel };
} else {
  const budgetTokens = thinkingBudgetByLevel[thinkingLevel] ?? 4096;
  config.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetTokens };
}
```

#### Bug 7：Collection 机制导致双重 LLM 调用（P0）

**文件**：`agentRuntime.ts` 第 1023-1031 行

修复前：当模型只返回 1 个 batchable 工具时，runtime 会发起**额外一次完整 LLM 调用**来"收集"更多操作。实测只能多收集 0-1 个操作，却增加 15-30s 延迟。

```typescript
// 修复后：禁用 collection，直接执行
if (mode === 'EXECUTION' && rawToolCalls.length === 1 &&
    this.AUTO_BATCH_TOOL_NAMES.has(rawToolCalls[0].name)) {
  console.log(`[AgentRuntime] Single batchable tool. Executing directly without collection.`);
}
```

#### Bug 8：超时设为 Infinity（P1）

**文件**：`performance.ts` 第 31-41 行

```typescript
// 修复前：calculateTimeoutMs() 返回 Infinity

// 修复后：基于 profile 计算合理超时
export function calculateTimeoutMs(profile: LLMPerformanceProfile): number {
  const baseMs = (profile.maxOutputTokens / 100) * 1000;
  const thinkingOverhead: Record<string, number> = {
    'minimal': 5000, 'low': 15000, 'high': 30000,
  };
  return baseMs + (thinkingOverhead[profile.thinkingLevel] ?? 15000) + profile.safetyBufferMs;
}
```

当前 `balanced` profile：`(65536/100)*1000 + 15000 + 25000 = 695360ms ≈ 11.6min`

#### Bug 9：FigmaVariableCache 每次调用都预热（P2）

**文件**：`figmaVariableCache.ts` 第 22-26 行

```typescript
// 修复前：isWarmedUp 检查被注释掉了
// 修复后：恢复幂等性
public async warmup(): Promise<void> {
    if (this.isWarmedUp) { return; }
    // ...
}
```

#### Bug 10：系统 prompt 鼓励过度思考（P2）

**文件**：`agentPrompts.ts` 第 68 行

```typescript
// 修复前：
"do it silently in your internal thinking space"

// 修复后：
"Do NOT produce long internal thinking. Keep reasoning brief (under 200 words). Output ONLY the tool call."
```

---

## 四、第三轮：MALFORMED 崩溃 & 计划过细

### 4.1 日志现象

```
[AgentRuntime] planDesign received: { stepsCount: 20 }
[Gemini] MALFORMED_FUNCTION_CALL (attempt 1/2)
[Gemini] MALFORMED_FUNCTION_CALL (attempt 2/2)
[AgentRuntime] Fatal error: MALFORMED_FUNCTION_CALL
```

同时 thinkingBudget 参数对 Gemini 3 不生效（日志仍显示 15 个 thought-text parts）。

### 4.2 根因分析 & 修复

#### Bug 11：Gemini 3 的 thinkingConfig 参数名不同（P0）

**文件**：`gemini.ts` 第 56-71 行

```typescript
// Gemini 3 使用 thinkingLevel（enum: minimal/low/medium/high）
// Gemini 2.5 使用 thinkingBudget（number: token 数量）
// 修复前统一用了 thinkingBudget → Gemini 3 忽略该参数

if (isGemini3) {
  config.thinkingConfig = { includeThoughts: true, thinkingLevel };
} else {
  config.thinkingConfig = { includeThoughts: true, thinkingBudget: budgetTokens };
}
```

#### Bug 12：MALFORMED 重试无上下文变化（P0）

**文件**：`agentRuntime.ts` 第 1060-1069 行

修复前：重试时上下文不变，模型重复产出相同的 malformed output。

```typescript
// 修复后：注入 recovery hint
if (category === AgentErrorCategory.RETRYABLE_MALFORMED) {
  const recoveryHint: LLMMessage = {
    id: this.generateId('mf_hint'),
    role: 'user',
    content: 'Your previous tool call had invalid syntax. Please emit a simpler, single tool call with valid JSON arguments. Use createNode, applyDesignPatch, or batchOperations.'
  };
  this.messages.push(recoveryHint);
}
```

#### Bug 13：planDesign 无步数限制（P1）

**文件**：`rendererTools.ts` 第 17-29 行 + `planState.ts` 第 30 行

- planDesign 描述改为 `"CONCISE, MAX 8 steps"`，加入正反例
- planState 增加硬上限 `MAX_PLAN_STEPS = 10`

```typescript
// planState.ts
private static readonly MAX_PLAN_STEPS = 10;

setCurrentPlan(steps: any[]) {
  const cappedSteps = steps.slice(0, PlanStateManager.MAX_PLAN_STEPS);
  if (steps.length > PlanStateManager.MAX_PLAN_STEPS) {
    console.warn(`[PlanState] Plan had ${steps.length} steps, capped to ${PlanStateManager.MAX_PLAN_STEPS}.`);
  }
  // ...
}
```

---

## 五、第四轮：单工具低效循环

### 5.1 日志现象

```
[PlanState] Task started: createNode (step_1770362811703_0)
[AgentRuntime] --- Iteration 1 --- toolCalls: 1 (createNode)
[PlanState] Task started: setNodeLayout (step_1770362811703_1)
[AgentRuntime] --- Iteration 2 --- toolCalls: 1 (setNodeLayout)
... (重复 36 次)
```

登录表单用了 36 次迭代，每次只 1 个工具调用。

### 5.2 根因分析

**核心问题**：planDesign step schema 将步骤定义为单个工具调用，形成 1:1 映射链条。

```
planDesign schema:
  action = "Tool to call (createNode, setNodeLayout, etc.)"    ← 每步 = 单工具
  description = "A single planned step with tool call details" ← 强化 1:1 映射

→ 模型生成步骤: [{action: "createNode", ...}, {action: "setNodeLayout", ...}]
→ planState.title = step.action = "createNode"
→ 计划确认消息回显: steps: [{action: "createNode"}, ...]
→ 运行时自动激活下一步 → 模型看到步骤名 "createNode" → 执行 1 个 createNode → 标记完成 → 下一步
→ 36 次迭代
```

### 5.3 修复（4 处改动）

#### Fix 1：planDesign 步骤 schema 重构

**文件**：`rendererTools.ts` 第 30-53 行

```typescript
// 修复前：
steps: { description: 'Ordered list of planned actions...',
  items: { description: 'A single planned step with tool call details',
    properties: {
      action: { description: 'Tool to call (createNode, setNodeLayout, etc.)' },
      parameters: { description: 'Parameters for the tool call' },
    }
  }
}

// 修复后：
steps: { description: 'Ordered list of HIGH-LEVEL design milestones (NOT individual tool calls).',
  items: { description: 'A component-level milestone that requires MULTIPLE tool calls to complete',
    properties: {
      action: { description: 'High-level description of what to build (e.g., "Build header section with logo, title, and navigation links"). NOT a tool name.' },
      nodes: { type: 'array', items: { type: 'string' }, description: 'List of nodes/elements this step will create' },
    }
  }
}
```

**效果**：模型不再用工具名命名步骤，而是输出如 `"Build form fields (email input + password input)"` 的组件级描述。

#### Fix 2：计划确认消息引导批量执行

**文件**：`agentRuntime.ts` 第 1242-1248 行

```typescript
// 修复前：
steps: stepsWithIds.map(s => ({ stepId, stepNumber, action })),
message: 'Plan received. Execute steps by referencing stepId.'

// 修复后：
steps: stepsWithIds.map(s => ({ stepId, stepNumber, action, nodes: s.nodes || [] })),
message: 'Plan received. Each step is a COMPONENT CHUNK — use batchOperations to create ALL nodes listed in each step in ONE call. Do NOT use one tool call per step.'
```

#### Fix 3：单工具调用反馈注入

**文件**：`agentRuntime.ts` 第 1527-1540 行

```typescript
// 当模型在 EXECUTION 模式只输出 1 个工具调用时（排除 complete_task/summarize_progress），
// 注入 user 角色提示，引导下次迭代批量操作
if (mode === 'EXECUTION' && allToolCalls.length === 1 &&
    allToolCalls[0].name !== 'complete_task' && allToolCalls[0].name !== 'summarize_progress') {
  const batchHint: LLMMessage = {
    id: this.generateId('batch_hint'),
    role: 'user',
    content: `⚠️ You used only 1 tool call this turn. BATCH RULE: use batchOperations to combine 3-5+ operations per call. Create ALL remaining nodes for the current step in ONE batchOperations call.`
  };
  this.messages.push(batchHint);
}
```

**设计决策**：比旧的 "collection" 方案（额外一次完整 LLM 调用，+15-30s）成本低得多——只增加一条短文本消息（~50 tokens）。

#### Fix 4：工具示例全面替换

**文件**：`promptComposer.ts` 第 268-320 行

- **旧示例**：展示逐步顺序模式（创建父节点 → 创建子节点 → 设置布局，各 1 步 1 工具）
- **新示例 1**：用 `batchOperations` 一次调用创建完整组件（3 节点 + 布局 + 样式，使用 opId/parentRef 链接）
- **新示例 2**：整个登录表单在 1 次迭代内用 2 个工具调用完成（`batchOperations` + `summarize_progress`）
- 删除了旧的顺序创建示例（Example 2 和 Example 4）

#### Fix 5：BATCH EXECUTION RULE 强化

**文件**：`agentPrompts.ts` 第 76-89 行

```typescript
// 修复前：
"SHOULD contain at MINIMUM 2-3 operations"

// 修复后：
"## BATCH EXECUTION RULE (MANDATORY - VIOLATION = FAILURE)
- **EVERY response MUST contain 2+ tool calls.** Single-tool responses waste an entire LLM round-trip.
  - The ONLY exception: the final `complete_task` call.
- **Think in COMPONENT CHUNKS, not individual nodes**:
  - ✅ CORRECT: ONE batchOperations = [create form container, create email input, create password input, create submit button, set layout on container] (5 ops in 1 call)
  - ❌ WRONG: 5 separate iterations creating one node each"
```

---

## 六、修改文件索引

### 按文件汇总

| 文件 | 轮次 | 修改点 |
|:---|:---|:---|
| **agentRuntime.ts** | R1 | await manageContext, groupIntoTurns 重写, fixInvalidSequence 双向搜索, 120% 硬停, approximateTokens 同步, hidden 条件计数 |
| | R2 | 禁用 collection 机制 |
| | R3 | MALFORMED recovery hint 注入 |
| | R4 | 计划确认消息重写, 单工具调用反馈注入 |
| **gemini.ts** | R2 | 添加 thinkingBudget |
| | R3 | 修正为 isGemini3 分支（thinkingLevel vs thinkingBudget）|
| **performance.ts** | R2 | calculateTimeoutMs 从 Infinity 改为公式计算 |
| **figmaVariableCache.ts** | R2 | 恢复 isWarmedUp 幂等检查 |
| **agentPrompts.ts** | R2 | 减少 thinking 邀请 |
| | R4 | BATCH EXECUTION RULE 从 SHOULD 改为 MUST |
| **rendererTools.ts** | R3 | planDesign 描述加 "MAX 8 steps" + 反例 |
| | R4 | 步骤 schema 从单工具改为组件级里程碑 |
| **planState.ts** | R3 | MAX_PLAN_STEPS = 10 硬上限 |
| **promptComposer.ts** | R4 | TOOL_EXAMPLES 从顺序模式改为 batchOperations 示例 |

### 按修复优先级

| 优先级 | 修复 | 影响 |
|:---|:---|:---|
| P0 | await manageContext | 消除并行执行/ghost loop/token 爆炸 |
| P0 | groupIntoTurns 支持 model→tool 对 | 上下文截断恢复正常工作 |
| P0 | thinking 预算 + Gemini 3 参数修正 | 每次响应减少 ~10000 字符思考文本 |
| P0 | 禁用 collection 双重 LLM 调用 | 每次迭代减少 15-30s |
| P0 | MALFORMED recovery hint | 打破重复 malformed 输出的死循环 |
| P0 | planDesign schema 重构 | 迭代次数从 36 降至 4-6（预期）|
| P1 | 120% 硬停 | 防止 token 失控时的无限循环 |
| P1 | calculateTimeoutMs | 防止请求无限挂起 |
| P1 | MAX_PLAN_STEPS = 10 | 防止过细计划 |
| P1 | 单工具调用反馈注入 | 引导模型批量操作 |
| P2 | approximateTokens 同步 | 计数准确性 |
| P2 | FigmaVariableCache 幂等 | 减少重复 API 调用 |
| P2 | prompt 减少 thinking 邀请 | 减少废话 |

---

## 七、关键设计决策 & 教训

### 7.1 async 函数的 await 必须显式

`manageContext()` 是整个修复历程中最致命的 bug——一个遗漏的 `await` 导致了并行执行、数据竞争、token 爆炸、ghost loop。

**教训**：对任何修改 `this.messages` 的 async 函数，**必须 await**。可以考虑在 lint 规则中禁止对特定方法的 fire-and-forget 调用。

### 7.2 消息序列验证是 Gemini 的生命线

Gemini API 对消息序列有严格要求：`user → model → tool → user → ...`。任何违反都会导致 API 拒绝或返回乱码。

**关键机制**：
- `groupIntoTurns` 必须识别所有合法序列模式（包括 agentic 模式的 model→tool 对）
- `fixInvalidSequence` 必须能修复截断后的 orphan（双向搜索）
- 120% 硬停是最后防线

### 7.3 Schema 即行为

planDesign 的步骤 schema 直接决定了模型的执行粒度。当 `action` 被描述为 "Tool to call" 时，模型字面解读为每步 = 1 工具。改为 "High-level description of what to build" 后，模型理解为每步 = 1 组件块。

**教训**：工具 schema 的 `description` 字段是最强的行为引导——比 system prompt 中的规则更有效，因为 LLM 在构造工具参数时会直接参考 schema。

### 7.4 示例教学 > 规则指令

即使 BATCH EXECUTION RULE 用了 "MUST" + "VIOLATION = FAILURE"，模型仍然倾向于遵循 TOOL_EXAMPLES 中展示的模式。将示例从顺序模式换成 batchOperations 模式后，行为引导效果更强。

**教训**：对 LLM 来说，**一个好的示例胜过十条规则**。在 prompt 工程中优先投入示例质量。

### 7.5 Collection 反模式

旧的 "collection" 机制试图在运行时层面解决"模型只返回 1 个工具"的问题，方法是额外发一次 LLM 调用来"收集"更多操作。这是**反模式**：
- 增加了 15-30s 延迟
- 通常只收集到 0-1 个额外操作
- 治标不治本

正确做法是通过 schema + 示例 + 轻量级反馈（单工具调用 hint）引导模型在一次响应中输出多个工具调用。

### 7.6 Gemini 版本差异的 API 陷阱

Gemini 3 和 Gemini 2.5 的 thinkingConfig 参数**名称不同**：
- Gemini 3：`thinkingLevel` (enum: minimal/low/medium/high)
- Gemini 2.5：`thinkingBudget` (number: token 数)

传错参数不报错，只是静默忽略 → thinking 无上限。

**教训**：对于不同模型版本的 API 差异，必须显式 branching + 日志确认参数生效。

---

## 附录：预期性能对比

| 指标 | 修复前（第一轮日志）| 修复后（预期）|
|:---|:---|:---|
| Token 增长 | 4K → 235K（爆炸）| 4K → ~80K（线性增长）|
| 迭代次数（登录表单）| 36 | 4-6 |
| 每迭代工具调用数 | 1 | 2-5 |
| 每迭代 thinking 字符 | 5000-14000 | ~1000 |
| 总耗时（简单 prompt）| 5+ 分钟 | ~1 分钟 |
| 计划步骤数 | 20 | 4-8 |
| MALFORMED 崩溃率 | 高（连续 3 次）| 低（recovery hint 打破循环）|
| 上下文截断成功率 | 0%（无法识别 turns）| ~100% |
