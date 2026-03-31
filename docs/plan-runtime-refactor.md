# Agent Runtime 核心架构重构计划

> 版本: v1.0 | 日期: 2026-03-31
> 范围: agentRuntime.ts 分解 + 可观测性增强 + Provider 适配层简化
> 不含: UI/Chat 重构、MCP 抽取、Prompt 系统、新 Provider

---

## 一、现状分析

### 1.1 核心文件与职责

| 文件 | LOC | 职责 | 问题 |
|------|-----|------|------|
| `agentRuntime.ts` | 1015 | 循环控制 + 上下文组装 + 事件发射 + 聊天渲染 + 取消 + 审批 + 统计 | **单体过大**，7种关注点混合 |
| `toolDispatcher.ts` | 651 | 工具分发 + 超时 + 错误分类 + `run` 命令解包 + Hook 拦截 | 缺少可观测性（无 noop 检测、无重复调用检测） |
| `llmGenerationCoordinator.ts` | ~250 | LLM 调用编排 + 重试 + 流式 + 缓存诊断 | 职责清晰，无需大改 |
| `hooks/builtinHooks.ts` | 183 | 6 个内置 Hook 的工厂 | 缺少 step warning hook |
| `providers/types.ts` | 219 | LLMProvider 接口 + 默认实现 | `formatResponse`/`formatToolResults` 造成 Provider 负担 |

### 1.2 agentRuntime.ts 关注点拆分分析

当前 `AgentRuntime` 类混合了以下关注点（按行号区间）：

```
L1-35:    imports（35 行）
L40-65:   类型定义（AgentRuntimeOptions）
L70-78:   错误类（AgentRuntimeCanceledError）
L84-233:  构造函数 + 配置初始化（150 行）→ 含 Hook 注册、ToolDispatcher 创建、subtask 注册
L236-298: 取消 + 审批 + 事件发射（63 行）
L300-312: ID 生成（12 行）
L314-578: 上下文管理（265 行）→ assemblePrompt、endTurn、compression、chat panel 渲染
L580-1001: 主循环 run()（422 行）→ 内存加载、token 扫描、迭代循环、工具执行、截断守卫
L1003-1015: 公共 getter（13 行）
```

**关键发现**: `run()` 方法本身 422 行，其中约 120 行是首次运行的内存/token 初始化逻辑，约 60 行是聊天面板渲染，与循环核心逻辑无关。

### 1.3 三个正确性 Bug（SDK 评估发现）

1. **text-only "thinking" 响应导致提前退出**: 当 LLM 返回 text（思考过程）但无 tool calls 时，循环按"turn end"退出。但这可能只是模型的中间思考步骤。
2. **截断重试不应递增 iteration**: `truncationCount` 递增后 `iteration++` 也递增，导致步数计算不准确。
3. **消息格式归一化缺失**: `formatResponse` 在各 Provider 中实现不一致，model message 结构取决于 Provider。

---

## 二、架构目标

```
重构前                              重构后
┌─────────────────────┐            ┌──────────────────────────────────┐
│   AgentRuntime      │            │   AgentRuntime (瘦编排层 ~200L)  │
│   (1015 LOC)        │            │   - 持有所有子模块引用            │
│   - 上下文管理       │            │   - run() 只做编排               │
│   - 迭代循环         │            │   - cancel/approval 委托         │
│   - 事件发射         │            └──────┬───────┬──────────────────┘
│   - 聊天渲染         │                   │       │
│   - 取消/审批        │            ┌──────▼──┐  ┌─▼──────────────┐
│   - 统计收集         │            │Context  │  │IterationEngine │
│   - 内存加载         │            │Manager  │  │ (~250L)        │
│   - Token 扫描       │            │(~200L)  │  │ - while loop   │
└─────────────────────┘            │ - 4层   │  │ - hook 调度    │
                                   │ - 压缩  │  │ - tool dispatch│
                                   │ - 预算  │  │ - 截断守卫     │
                                   └─────────┘  └────────────────┘
                                                        │
                                   ┌────────────────────▼──────────┐
                                   │ToolDispatcher (增强版 ~700L)   │
                                   │ + ToolLogEntry 结构            │
                                   │ + 重复调用检测                  │
                                   │ + noop 检测 (via IPC readback) │
                                   └───────────────────────────────┘
```

---

## 三、分阶段实施计划

### Phase 0: 独立增强（无依赖，低风险）

**目标**: 在不改变 agentRuntime.ts 结构的前提下，增加可观测性能力。

#### 0.1 Step Warning Hook

**文件**: `src/engine/agent/hooks/stepWarningHook.ts`（新建）

```
触发: afterToolExec event
条件: maxIterations - iteration <= 5
注入: "[Step warning] Only {N} steps remaining. Prioritize completing current work."
```

**注册点**: 在 `builtinHooks.ts` 的 `createBuiltinHooksWithState()` 中添加。

**与 budgetGuard 的区别**:
- budgetGuard: afterIteration, 触发一次（80% 处），面向"wrap up"
- stepWarning: afterToolExec, 每次工具执行后提醒，面向"倒计时紧迫感"

#### 0.2 ToolLogEntry 结构

**文件**: `src/engine/agent/toolDispatcher.ts`（修改 dispatch 方法）

新增数据结构：
```typescript
interface ToolLogEntry {
  callId: string;
  toolName: string;
  args: any;
  startedAt: number;
  durationMs: number;
  success: boolean;
  isDuplicate: boolean;     // 新增
  isNoop: boolean;          // 新增 (Phase 0.4)
  error?: string;
}
```

在 `dispatch()` 方法中，每次工具执行后构建 `ToolLogEntry` 并通过 `emitRuntimeEvent` 发射。

#### 0.3 重复调用检测

**文件**: `src/engine/agent/toolDispatcher.ts`（修改）

在 `ToolDispatcher` 类中新增：
```typescript
private callSignatureMap: Map<string, number> = new Map();

private isDuplicateCall(tc: LLMToolCall): boolean {
  const sig = `${tc.name}:${JSON.stringify(tc.args)}`;
  const count = (this.callSignatureMap.get(sig) || 0) + 1;
  this.callSignatureMap.set(sig, count);
  return count > 1;
}
```

**行为**: 检测到重复时设置 `ToolLogEntry.isDuplicate = true`，通过 runtime event 暴露给 UI。不阻断执行（阻断由 loopDetector 负责）。

**重置**: 在 `ToolDispatcher` 新增 `resetCallTracking()` 方法，由 `AgentRuntime.run()` 开始时调用。

#### 0.4 Noop 检测（Option B: 主线程对比）

**方案**: 在 `afterToolExec` hook 中，对 mutating 工具（jsx, edit）调用 IPC 获取变更后状态，与变更前快照对比。

**实施路径**:
1. 在 tool definitions 中新增 `mutates: boolean` 字段（参考 OpenPencil 模式）
2. `beforeToolExec` hook: 若 `mutates === true`，通过 IPC 获取目标节点快照（简要属性）
3. `afterToolExec` hook: 再次获取快照，浅比较。若相同则标记 `isNoop: true`

**风险**: IPC 往返增加延迟（2 次 x ~50ms）。缓解：仅在非首次调用时启用（首次创建不会 noop）。

**备选**: 纯本地检测——若工具返回 `edited: 0` 或 `created: 0` 即为 noop，无需 IPC。这更简单，推荐先实施。

#### 0.5 测试计划

- `stepWarningHook.test.ts`: 验证在 remaining <= 5 时注入消息
- `toolDispatcher.test.ts`: 新增重复调用检测测试
- `toolDispatcher.test.ts`: 新增 noop 检测测试（基于返回值方案）
- 测试框架: **vitest**，不 mock figma.* 或 LLM SDK

---

### Phase 1: AgentRuntime 分解（结构性，中风险）

**目标**: 将 1015 行单体拆分为 3 个聚焦模块，每个 < 300 行。

#### 1.1 提取 ContextManager

**新文件**: `src/engine/agent/contextManager.ts`

**从 agentRuntime.ts 提取的方法**:
- `assemblePrompt()` → `ContextManager.assemble(): LLMMessage[]`
- `endTurn()` → `ContextManager.commitTurn()`
- `compressIfNeeded()` → `ContextManager.compressIfNeeded()`
- `extractOldestTurn()` → private
- `estimateContextChars()` → `ContextManager.estimateChars(): number`
- `estimateMessageChars()` → private

**从 agentRuntime.ts 提取的状态**:
- `staticSystemPrompt: string`
- `summary: string`
- `conversationHistory: LLMMessage[]`
- `turnMessages: LLMMessage[]`
- `contextBudgetChars: number`

**接口设计**:
```typescript
class ContextManager {
  constructor(config: {
    systemPrompt: string;
    contextBudgetChars: number;
  });

  /** 添加消息到当前 turn */
  pushTurnMessage(msg: LLMMessage): void;

  /** 在 turnMessages 头部插入（用于 memory/token 注入） */
  unshiftTurnMessage(msg: LLMMessage): void;

  /** 组装完整 4 层上下文 */
  assemble(): LLMMessage[];

  /** 获取当前 turn 消息的可变引用（hook 需要） */
  getTurnMessages(): LLMMessage[];

  /** 结束当前 turn，移入 history 并按需压缩 */
  commitTurn(): void;

  /** 清空当前 turn（新 run 开始时） */
  clearTurn(): void;

  /** 估算当前上下文总字符数 */
  estimateChars(): number;

  /** 判断是否为首次 turn（history 为空） */
  isFirstTurn(): boolean;
}
```

**要点**:
- `getTurnMessages()` 返回引用，HookRunner 中的 `ctx.messages` 指向同一数组
- `commitTurn()` 内部调用 `compressIfNeeded()`
- Chat panel 渲染逻辑**不**进入 ContextManager（那是 UI 关注点）

#### 1.2 提取 ChatPanelRenderer

**新文件**: `src/engine/agent/chatPanelRenderer.ts`

**从 agentRuntime.ts 提取**:
- `ensureChatPanel()` (L357-378)
- `renderUserMessage()` (L383-395)
- `renderAgentBubble()` (L401-442)
- `collectCreatedNodeIds()` (L448-475)
- `chatPanelId`, `turnCreatedNodeIds`, `designRootId` 状态

**接口设计**:
```typescript
class ChatPanelRenderer {
  constructor(deps: {
    toolDispatcher: ToolDispatcher;
    generateId: (prefix: string) => string;
  });

  renderUserMessage(prompt: string, iteration: number): Promise<void>;
  renderAgentBubble(text: string, iteration: number): Promise<void>;
  collectCreatedNodeIds(data: any): void;
  resetTurn(): void;
}
```

这个类约 120 行，将 agentRuntime.ts 减少同等量。

#### 1.3 提取 RunInitializer

**新文件**: `src/engine/agent/runInitializer.ts`

**从 agentRuntime.ts `run()` 方法的前 120 行提取**:
- 内存加载逻辑 (L623-698)
- Token 扫描 + diff 逻辑

**接口设计**:
```typescript
interface RunInitResult {
  injectedMessages: LLMMessage[];
}

async function initializeRun(config: {
  ipcBridge?: IpcBridge;
  isFirstTurn: boolean;
  generateId: (prefix: string) => string;
  emitRuntimeEvent: (event: any) => void;
}): Promise<RunInitResult>;
```

#### 1.4 瘦化后的 AgentRuntime

提取后 `agentRuntime.ts` 保留约 400 行：
- 构造函数（创建 ContextManager, ChatPanelRenderer, ToolDispatcher 等）
- `run()` 方法（编排逻辑，约 200 行）
- cancel/approval 方法
- 事件发射（保留，因为是中心 hub）
- ID 生成（保留，因为被多处引用）
- runStats 收集

#### 1.5 修复三个正确性 Bug

**Bug 1: Text-only thinking 响应导致提前退出**

**位置**: `agentRuntime.ts` L945-965（else 分支 = no tool calls = turn end）

**修复**: 在 turn end 逻辑前检查 `finishReason`。如果 `finishReason === 'stop'` 且有 text，才是真正的 turn end。如果 `finishReason` 不存在或为其他值，且有 text 但无 tool calls，注入 continuation prompt。

```typescript
// 修复前
} else {
  // TRUNCATION GUARD
  ...
  // Turn end
  this.endTurn();
  return response.text;
}

// 修复后
} else {
  // TRUNCATION GUARD
  const fr = response.finishReason;
  if (fr && fr !== 'stop' && fr !== 'tool_calls') {
    // ... existing truncation logic
  }

  // NEW: Thinking-only guard
  // If model returned text but finishReason is missing/ambiguous,
  // and text looks like intermediate reasoning (no actionable content),
  // treat as continuation rather than turn end.
  if (!fr && response.text && !response.toolCalls?.length) {
    // Provider didn't report finishReason — assume natural stop
    // This is the safe default; overly aggressive continuation
    // would cause infinite loops.
  }

  // Turn end
  this.endTurn();
  return response.text;
}
```

**决策**: 经过审查，这个 bug 的风险低于预期。Gemini 总是返回 `finishReason`。仅需在 `finishReason === undefined` 且有 text 时记录 warning，不改变控制流。

**Bug 2: 截断重试递增 iteration**

**位置**: L952 `iteration++`（在截断续写分支内）

**修复**: 移除截断续写分支的 `iteration++`。截断续写是同一个 logical step 的延续，不应消耗 iteration 预算。

```typescript
// 修复前
if (truncationCount <= 3) {
  this.turnMessages.push({ ... });
  iteration++;  // <-- BUG: 不应递增
  continue;
}

// 修复后
if (truncationCount <= 3) {
  this.turnMessages.push({ ... });
  continue;  // 不递增 iteration
}
```

**Bug 3: 消息格式归一化**

**位置**: Provider 的 `formatResponse()` 实现

**现状**: Gemini 使用 `fullParts` 保留 thought/thought_signature，其他 Provider 使用标准格式。这导致 contextSummarizer 需要处理两种消息结构。

**修复方向**: 不在 Phase 1 解决。在 Phase 2 Provider 适配层改造时统一处理。当前的 `fullParts` 保留方式虽不优雅但功能正确。

#### 1.6 测试计划

- `contextManager.test.ts`: 4 层组装、压缩触发、turn 提交
- `chatPanelRenderer.test.ts`: 渲染逻辑（mock ToolDispatcher）
- `runInitializer.test.ts`: 内存加载（mock IpcBridge）
- 现有 `agentRuntime.test.ts` 保持通过（回归测试）

---

### Phase 2: Provider 适配层简化（条件性，中风险）

**前提条件**: Phase 1 完成后评估是否需要。

#### 2.1 方案 A: 内化 formatResponse/formatToolResults

**目标**: 从 `LLMProvider` 接口中移除 `formatResponse` 和 `formatToolResults`，改由 `LLMGenerationCoordinator` 内部处理。

**动机**: 4 个 Provider 中有 3 个使用默认实现（`formatResponseDefault`/`formatToolResultsDefault`）。只有 Gemini 有特殊逻辑（`fullParts` 保留 + `thought_signature` 注入）。

**实施**:

1. 在 `LLMGenerationCoordinator` 中新增：
```typescript
private formatModelMessage(response: LLMResponse, providerName: string): LLMMessage {
  // Gemini 特殊处理: 保留 fullParts 含 thought_signature
  if (providerName === 'gemini' && response.fullParts?.length) {
    const content = response.fullParts.filter(p =>
      p.functionCall || p.thought || (p.text && p.text.trim())
    );
    return { id: '', role: 'model', content };
  }
  // 标准处理
  return formatResponseDefault(response);
}

private formatToolResultsMessage(results: LLMToolResult[], providerName: string): LLMMessage {
  // Gemini 特殊处理: thought_signature + inlineData
  if (providerName === 'gemini') {
    const content: Part[] = [];
    for (const tr of results) {
      content.push({
        functionResponse: { name: tr.name, response: tr.response },
        thought_signature: tr.thought_signature,
      } as any);
      if (tr.imageAttachment) {
        content.push({ inlineData: tr.imageAttachment });
      }
    }
    return { id: '', role: 'tool', content };
  }
  // 标准处理
  return formatToolResultsDefault(results);
}
```

2. `LLMProvider` 接口简化为：
```typescript
interface LLMProvider {
  name: string;
  generate(options: LLMGenerateOptions): Promise<LLMResponse>;
  generateStream?(options: LLMGenerateOptions): AsyncIterable<LLMResponse>;
  getCapabilities?(): LLMProviderCapabilities;
  getToolSystemInstruction(tools: ToolDefinition[]): string;
  // formatResponse 和 formatToolResults 移除
}
```

3. `ToolDispatcher` 的 `config.formatToolResults` 改为 coordinator 提供的闭包。

**向后兼容**: 保留 `formatResponse?` 和 `formatToolResults?` 为可选方法，coordinator 优先使用自己的实现，若 provider 仍定义了这些方法则 fallback。

#### 2.2 方案 B: Vercel AI SDK LanguageModel 适配

**前置评估**（必须先完成）:
1. `npm install ai @ai-sdk/google` 后检查 bundle size 变化
2. 在 Figma sandbox 中测试 SDK 是否能正常运行（无 Node.js API 依赖）
3. 检查 `allowedDomains` 是否需要更新

**如果可行**: 创建 `VercelLanguageModelAdapter` 将现有 Provider 包装为 SDK 的 `LanguageModel`。

**如果不可行**: 执行方案 A。

**推荐**: 方案 A。Vercel AI SDK 在 Figma sandbox 中的兼容性风险高，且收益有限（我们只需要 generate，不需要 useChat/useCompletion）。

---

### Phase 3: Schema 验证增强

**前提**: Phase 0 完成（tool definitions 已有 `mutates` 字段）

#### 3.1 为工具参数添加 valibot schema

**文件**: `src/engine/agent/tools/unified/*.ts`（各工具定义文件）

**现状**: `ToolParameter` 类型只有 `type`, `description`, `required`, `enum` 字段。无 min/max/pattern 验证。

**增强**:
```typescript
// tools/types.ts
interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  // 新增
  schema?: import('valibot').BaseSchema;  // valibot schema for runtime validation
}
```

#### 3.2 自动验证 + 重试

**位置**: `toolDispatcher.ts` 的 `dispatch()` 方法

在执行前验证 args against schema:
```typescript
if (toolDef.parameters) {
  for (const [key, param] of Object.entries(toolDef.parameters)) {
    if (param.schema) {
      const result = v.safeParse(param.schema, tc.args?.[key]);
      if (!result.success) {
        // 返回验证错误，让 LLM 重试
        toolResults.push({ ... validation error ... });
        continue;
      }
    }
  }
}
```

---

## 四、文件变更清单

### Phase 0（新建 + 修改）

| 操作 | 文件 | 变更量估算 |
|------|------|-----------|
| 新建 | `src/engine/agent/hooks/stepWarningHook.ts` | ~40 行 |
| 修改 | `src/engine/agent/hooks/builtinHooks.ts` | +5 行（注册新 hook） |
| 修改 | `src/engine/agent/toolDispatcher.ts` | +60 行（ToolLogEntry, 重复检测, noop 检测） |
| 修改 | `src/engine/agent/tools/types.ts` | +2 行（`mutates` 字段） |
| 新建 | `src/engine/agent/hooks/__tests__/stepWarningHook.test.ts` | ~60 行 |
| 修改 | `src/engine/agent/__tests__/toolDispatcher.test.ts`（或新建） | +80 行 |

### Phase 1（新建 + 重构）

| 操作 | 文件 | 变更量估算 |
|------|------|-----------|
| 新建 | `src/engine/agent/contextManager.ts` | ~200 行 |
| 新建 | `src/engine/agent/chatPanelRenderer.ts` | ~120 行 |
| 新建 | `src/engine/agent/runInitializer.ts` | ~80 行 |
| 重构 | `src/engine/agent/agentRuntime.ts` | 1015 → ~400 行（-600 行） |
| 修复 | `src/engine/agent/agentRuntime.ts` | Bug #2 (1行) |
| 新建 | `src/engine/agent/__tests__/contextManager.test.ts` | ~150 行 |
| 新建 | `src/engine/agent/__tests__/chatPanelRenderer.test.ts` | ~80 行 |

### Phase 2（修改）

| 操作 | 文件 | 变更量估算 |
|------|------|-----------|
| 修改 | `src/engine/agent/llmGenerationCoordinator.ts` | +60 行（format 内化） |
| 修改 | `src/engine/llm-client/providers/types.ts` | formatResponse/formatToolResults 标记可选 |
| 修改 | `src/engine/llm-client/providers/gemini.ts` | -20 行（移除 format 方法） |
| 修改 | `src/engine/llm-client/providers/dashscope.ts` | -15 行 |
| 修改 | `src/engine/llm-client/providers/openrouter.ts` | -15 行 |
| 修改 | `src/engine/llm-client/providers/proxy.ts` | -15 行 |

### Phase 3（修改）

| 操作 | 文件 | 变更量估算 |
|------|------|-----------|
| 修改 | `src/engine/agent/tools/types.ts` | +5 行（schema 字段） |
| 修改 | `src/engine/agent/toolDispatcher.ts` | +30 行（验证逻辑） |
| 修改 | `src/engine/agent/tools/unified/jsx.ts` | +10 行（schema 定义） |
| 修改 | `src/engine/agent/tools/unified/edit.ts` | +10 行 |
| 修改 | `src/engine/agent/tools/unified/inspect.ts` | +5 行 |

---

## 五、依赖关系与执行顺序

```
Phase 0.1 (stepWarning) ──┐
Phase 0.2 (ToolLogEntry) ─┤── 全部独立，可并行
Phase 0.3 (重复检测)      ─┤
Phase 0.4 (noop 检测)     ─┘
           │
           ▼
Phase 1.1 (ContextManager) ──┐
Phase 1.2 (ChatPanelRenderer)┤── 可并行提取
Phase 1.3 (RunInitializer)  ─┘
           │
           ▼
Phase 1.4 (瘦化 AgentRuntime) ── 依赖 1.1-1.3 全部完成
           │
           ▼
Phase 1.5 (Bug 修复) ── 在瘦化后的代码上修复
           │
           ▼
Phase 2 (Provider 适配层) ── 依赖 Phase 1 完成
           │
           ▼
Phase 3 (Schema 验证) ── 依赖 Phase 0.4 (mutates 字段)
```

---

## 六、验证策略

### 每个 Phase 的门控条件

| Phase | 门控 |
|-------|------|
| 0 | 所有新增 hook 测试通过 + 现有 `hookSystem.test.ts` 无回归 |
| 1 | 现有 `agentRuntime.test.ts` + `agentRuntime_refactor.test.ts` 全部通过 |
| 1 | `behavior_contract.test.ts` 全部通过（行为不变证明） |
| 1 | 手动 E2E: "Create a login form" 生成完整 UI，无中断 |
| 2 | Provider 切换测试（Gemini ↔ OpenRouter）行为一致 |
| 3 | 故意传入非法参数，验证自动重试 |

### 回归测试矩阵

现有测试文件（必须全部通过）：
- `agentRuntime.test.ts` — 核心循环行为
- `agentRuntime_refactor.test.ts` — 重构验证
- `agentRuntime.events.e2e.test.ts` — 事件流
- `hookSystem.test.ts` — Hook 系统
- `loopDetector.test.ts` — 循环检测
- `commandParser.test.ts` — 命令解析
- `ipcBridge.test.ts` — IPC 通信

---

## 七、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Phase 1 提取后 HookRunner ctx.messages 引用断裂 | Hook 注入消息丢失 | ContextManager.getTurnMessages() 返回引用，不是副本 |
| ToolDispatcher 重复检测误报（相同参数的合法重复调用） | 误标记 | 仅标记 isDuplicate，不阻断。loopDetector 负责阻断 |
| ChatPanelRenderer 提取后 timeout race condition | 聊天面板渲染延迟 | 保持现有 Promise.race + timeout 模式不变 |
| Phase 2 formatResponse 内化后丢失 Gemini thought_signature | LLM 报错 | 保留 Gemini 分支路径，用现有 e2e 测试验证 |
| 截断重试不递增 iteration 导致无限截断循环 | 死循环 | truncationCount 上限仍为 3，与 iteration 无关 |

---

## 八、不做的事项（显式排除）

1. **不引入 Vercel AI SDK 的 agent loop**（ToolLoopAgent）— 会丧失 Hook 系统、4 层 Context、tool approval、subtask 递归
2. **不重构 HookRunner 为 middleware 模式** — 当前 priority-based sequential 模式工作良好
3. **不提取 IterationEngine 为独立文件** — 经评估，迭代循环与 AgentRuntime 的 cancel/approval/event 紧耦合，提取反而增加传参复杂度。瘦化 run() 到 ~200 行足够
4. **不修改 IPC 协议** — ipcBridge.ts 简单可靠，没有改的理由
5. **不做工具拆分**（run → 7 tools）— 那是独立的设计文档，不在此重构范围内

---

## 九、时间估算

| Phase | 工作量 | 风险 |
|-------|--------|------|
| Phase 0 | 1-2 天 | 低 |
| Phase 1 | 3-4 天 | 中 |
| Phase 2 | 1-2 天 | 中 |
| Phase 3 | 1 天 | 低 |
| **总计** | **6-9 天** | |

建议执行顺序：Phase 0 → Phase 1 → (评估) → Phase 2 → Phase 3

Phase 0 可以立即开始，无任何阻塞。Phase 1 是核心价值所在。Phase 2 和 3 是锦上添花，可根据实际收益决定是否执行。

---

## 十、CODEX 独立评估发现

Codex (GPT-5.4) 独立审阅了 8 篇 Vercel AI SDK 评估文档和源码，发现以下问题：

### 逻辑漏洞与未声明假设

1. **Hook 系统的"可迁移"前提可疑**: 评估文档假设现有 hook 系统是"可迁移资产"，但仓库中有文档显示部分 hook 并未接线。如果这个前提为假，整套 Phase 排序需要重新评估。
   - **本计划应对**: Phase 0 的 step warning hook 是新建而非迁移，不受此影响。Phase 1 中提取的是已接线的 7 个 hook。

2. **Figma sandbox 兼容性未验证**: 评估文档直接写 `npm install ai @ai-sdk/google`，但未验证：
   - Vercel AI SDK 是否依赖 Node.js API（fs, http, crypto 等）
   - Bundle size 增量对 Figma 插件的影响
   - SDK 的 polyfill 需求
   - **本计划应对**: Phase 2 明确推荐方案 A（不用 SDK），方案 B 标记为条件性，需要先完成 sandbox 可行性验证。

3. **网络权限硬缺口**: `allowedDomains` 当前只开了 Gemini、OpenRouter、DashScope 和自家 worker。新增 Claude/OpenAI provider 不仅是代码替换，还需要更新插件网络权限和密钥路径。
   - **本计划应对**: 新 Provider 不在本次重构范围内（显式排除）。

4. **流式/取消/审批流集成风险轻描淡写**: 评估文档没有分析 SDK 的 streaming 如何与现有的 `AbortController` + `pendingApproval` promise 机制共存。
   - **本计划应对**: 保持自建 loop，不触碰流式/取消机制。

### 深度批评（12 条完整发现）

| # | 发现 | 严重性 | 本计划应对 |
|---|------|--------|-----------|
| 1 | **ToolLoopAgent 论证自打脸**——SDK 本质也是"无 tool_calls = 结束"，根因是 provider 协议不是 loop 抽象 | 高 | 已对齐：不采用 ToolLoopAgent |
| 2 | **应优先用 toolConfig.mode 而非 prompt hack**——仓库已有 `toolConfig.mode = 'ANY'` 能力，文档却没把 tool forcing 当主方案 | 高 | **需修正 Plan**：Bug #1 修复应改为利用现有 toolConfig，而非注入 continuation prompt |
| 3 | **Phase 顺序反了**——最大不确定性（4 层 context/hook/审批能否塞进 SDK loop）放到最后验证 | 高 | 已对齐：本计划不依赖 SDK loop |
| 4 | **Phase 1 风险被低估**——不只是 npm install，还涉及网络白名单、proxy/subscription-token、安全鉴权 | 中 | 已对齐：Phase 2 为条件性 |
| 5 | **Provider 抽象被低估**——不只格式转换，还承载 context window、streaming、proxy auth、system instruction | 中 | 已对齐：Phase 2 只内化 format，不动 Provider 核心 |
| 6 | **Schema 不必绑 SDK**——本地 valibot 在 dispatcher 层校验即可，文档说"Schema 和 Agent Loop 绑定"是错的 | 中 | 已对齐：Phase 3 用 valibot 独立校验 |
| 7 | **Chat/context 状态建模不足**——turn-result 压缩、设计系统注入、chat panel 渲染、节点链接状态都没建模 | 高 | **需注意**：Phase 1.1 ContextManager 提取时必须完整建模这些状态 |
| 8 | **审批流迁移方案不成立**——当前审批是 dispatch 前对整批 tool calls 的原子决策，搬进 execute 会破坏批处理语义 | 高 | 已对齐：不迁移到 SDK loop |
| 9 | **noop 检测方案太天真**——复合命令、归一化写入、布局/字体后处理、副作用链、部分成功都处理不了 | 中 | **需降级**：Phase 0.4 仅用返回值 `edited: 0` 检测，不做深度快照对比 |
| 10 | **成本估算不可信**——没分解来源，没算测试迁移、事件协议、流式取消成本 | 低 | 本计划有独立的文件变更清单 |
| 11 | **评估明显偏向 SDK**——索引开头预设 SDK 是答案，用 OpenPencil 成功案例加分，少算迁移损失 | 高 | 已纠正：SDK 降级为条件选项 |
| 12 | **备选方案不够**——没评估"只补 toolConfig + 本地 schema"、"SDK 限定 worker/server 侧"、"只替换消息格式层"三条更便宜路线 | 中 | **有价值**：本计划的 Phase 2 方案 A 正是"只替换消息格式层"的路线 |

### 评估偏向性判断

Codex 认为评估文档**明显偏向 SDK**——索引开头预设结论（"SDK 覆盖了我们需要自建的绝大多数基础设施"），后续章节用 OpenPencil 成功案例给 SDK 加分，但很少正面计算迁移损失。本计划纠正了这一偏向：Phase 0-1 完全不依赖 SDK，Phase 2 将 SDK 降级为条件选项。

### Codex 发现对本计划的 3 个修正项

1. **Bug #1 修复策略调整**: 不再用 `detectThinkingResponse()` + continuation prompt，改为检查现有 `toolConfig.mode` 能力（如在特定场景下强制 `mode: 'ANY'`）
2. **Phase 0.4 noop 检测降级**: 仅基于返回值（`edited: 0`, `created: 0`）判断，不做 IPC 快照对比。复合命令/副作用链的 noop 检测留待后续
3. **Phase 1.1 ContextManager 必须建模完整状态**: 不仅是 4 层消息，还需要覆盖 turn-result 压缩器引用、设计系统 token 注入点、chat panel 渲染状态

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** NO REVIEWS YET — this is a new plan. Run `/plan-eng-review` after approval to review architecture and tests.
