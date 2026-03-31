# 可观测性层：第一性原理驱动的目标能力

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：noop 检测、快照、步数警告——这些不是"同进程快照"才能做的事，第一性原理是什么？我们跨 IPC 能实现吗？

---

## 1. 先定义目标能力，不定义实现方式

OpenPencil 的可观测性层提供了 4 个**目标能力**：

| # | 目标能力 | 目的 |
|---|---------|------|
| 1 | **知道工具是否真的改了东西** | 避免 LLM 反复调用无效操作浪费步数 |
| 2 | **知道 LLM 是否在重复调用** | 检测循环行为，提前干预 |
| 3 | **在步数耗尽前警告 LLM** | 引导 LLM 收尾，而非硬截断 |
| 4 | **记录每次工具调用的完整上下文** | Debug 和事后分析 |

OpenPencil 用**同进程 SceneGraph 快照**来实现这些能力。但这是**实现方式，不是目标本身**。

## 2. 目标 1：知道工具是否真的改了东西（noop 检测）

### OpenPencil 的实现

```typescript
// ai-adapter.ts — captureNodeSnapshot
function captureNodeSnapshot(figma, args) {
  const targetId = args.id as string
  const raw = figma.graph.getNode(targetId)
  return structuredClone(raw)  // ← 同进程，微秒级
}

// ai-adapter.ts — detectUnchangedProps
function detectUnchangedProps(toolName, args, before, after) {
  for (const [argKey, argVal] of Object.entries(args)) {
    if (argKey === 'id') continue
    const nodeProp = ARG_TO_NODE_PROP[argKey] ?? argKey
    const bStr = JSON.stringify(before[nodeProp])
    const aStr = JSON.stringify(after[nodeProp])
    if (bStr === aStr) unchanged.push(nodeProp)  // ← 值没变 = noop
  }
  return unchanged
}
```

### 我们的 IPC 架构下怎么实现？

我们不能 `structuredClone(graph.getNode(id))`——节点数据在 Figma Main Thread，需要 IPC 往返。但**目标能力**不要求快照本身，而是要求**知道是否有变化**。

**方案 A：基于工具返回值的 noop 推断**

```typescript
// 不需要快照，看工具自己报告的结果
async function executeWithNoopDetection(toolCall, executor) {
  const result = await executor(toolCall.args);
  
  // 如果工具返回了 "already set" 或值相同的信号
  if (result.data?.noChange || result.data?.skipped) {
    logEntry.noop = true;
  }
  
  // 或者：对比 args 中的期望值和返回值中的实际值
  if (toolCall.name === 'set_fill' && result.data?.fills) {
    if (toolCall.args.color === extractColor(result.data.fills)) {
      logEntry.noop = true;
    }
  }
  return result;
}
```

**方案 B：在 Main Thread 端做对比（不多一次 IPC）**

```typescript
// Main Thread 的工具实现中，执行前后对比
// ipc/commands/writeHandlers.ts（概念性）
async function handleSetFill(args) {
  const node = figma.getNodeById(args.id);
  const before = JSON.stringify(node.fills);
  
  node.fills = [{ type: 'SOLID', color: parseColor(args.color) }];
  
  const after = JSON.stringify(node.fills);
  return {
    data: nodeToJSON(node),
    _meta: { noop: before === after }  // ← Main Thread 内部对比
  };
}
```

方案 B 的优势：**零额外 IPC 开销**。在执行操作的同一个进程中做前后对比，结果随正常返回值一起回传。

**方案 C：统计学推断**

不对比具体值，而是看操作模式：

```typescript
// ToolDispatcher 层
const callHistory = new Map<string, number>();

function detectDuplicate(toolCall) {
  const key = `${toolCall.name}:${JSON.stringify(toolCall.args)}`;
  const count = (callHistory.get(key) || 0) + 1;
  callHistory.set(key, count);
  return count > 1;  // ← 相同工具+参数调用了多次=可能 noop
}
```

这就是目标能力 2（重复调用检测），实际上已经能覆盖大部分 noop 场景。

## 3. 目标 2：知道 LLM 是否在重复调用

### OpenPencil 的实现

```typescript
// ai-adapter.ts — buildDebugLog
export function buildDebugLog(entries: ToolLogEntry[]): ToolDebugLog {
  const callCounts = new Map<string, { count: number }>()
  
  for (const entry of entries) {
    const key = `${entry.tool}:${JSON.stringify(entry.args)}`
    const existing = callCounts.get(key)
    if (existing) {
      existing.count++
      if (entry.mutates) entry.isDuplicate = true  // ← 标记
    } else {
      callCounts.set(key, { count: 1 })
    }
  }
  
  // 汇总
  const duplicates = [...callCounts]
    .filter(([, v]) => v.count > 1 && v.mutates)
    .map(([key, v]) => ({ tool: key.split(':')[0], count: v.count }))
  
  return { entries, duplicates, noopMutations, totalResultBytes }
}
```

### 我们已有类似机制

我们的 Hook 系统中有循环检测：

```typescript
// agentRuntime.ts L836-860 — afterLLMResponse hook 做循环检测
const hookResult = await this.hookRunner.run('afterLLMResponse', hookCtx);
if (hookResult.injectMessage?.includes('repeated') || 
    hookResult.injectMessage?.includes('consecutive iterations')) {
  this.runStats.loopDetected = true;
}
```

但区别在于：我们是在 **Hook 层面** 检测循环模式，OpenPencil 是在 **工具日志层面** 做精确的重复检测。两者互补——Hook 检测行为模式，日志检测精确重复。

## 4. 目标 3：步数警告

### OpenPencil 的实现

```typescript
// ai-adapter.ts — appendStepWarning
function appendStepWarning(result, budget) {
  const remaining = budget.max - budget.current
  if (remaining > 5) return result  // ← 阈值：剩余 5 步
  
  const warning = `⚠ ${remaining} steps remaining out of ${budget.max}. 
    Wrap up: finish critical fixes, skip polish.
    User can send "continue" for more steps.`
  
  return { ...result, _warning: warning }  // ← 注入到工具返回值
}
```

### 我们可以直接做

这个能力**不依赖任何运行环境差异**，纯逻辑：

```typescript
// 在 ToolDispatcher.dispatch 后处理
if (this.currentIteration >= this.maxIterations - 5) {
  const remaining = this.maxIterations - this.currentIteration;
  const warning = `⚠ ${remaining} iterations remaining. Prioritize completing the current task.`;
  // 注入到工具返回值
  result.data._warning = warning;
}
```

实现成本极低，效果很直接。**建议立即实现**，不需要等 SDK 迁移决策。

## 5. 目标 4：工具调用日志

### OpenPencil 的 ToolLogEntry

```typescript
// ai-adapter.ts
interface ToolLogEntry {
  tool: string
  args: Record<string, unknown>
  result: unknown
  error?: string
  timestamp: number
  durationMs: number
  mutates: boolean
  nodeBefore?: Record<string, unknown>
  nodeAfter?: Record<string, unknown>
  unchangedProps?: string[]
  isDuplicate?: boolean
}
```

### 我们现有的日志

```typescript
// agentRuntime.ts — runtime event
this.emitRuntimeEvent({
  type: 'tool_call',
  toolCall: { name, args },
});
this.emitRuntimeEvent({
  type: 'tool_result',
  toolResult: { name, durationMs, error },
});
```

差距：我们有 `tool_call` 和 `tool_result` 事件，但**缺少**：
- `mutates` 标记（不知道是否为写操作）
- `nodeBefore/nodeAfter`（不跟踪变化）
- `unchangedProps`（不检测 noop）
- `isDuplicate`（不检测重复）

**补全很直接**——在 `ToolDispatcher` 中构建 `ToolLogEntry` 结构，不需要改 Agent 循环。

## 6. 总结：不依赖 SDK 可以做什么

```
目标能力          | 是否依赖 SDK | 实现成本 | 建议
─────────────────|─────────────|────────|──────
步数警告          | ❌           | 极低    | 立即实现
重复调用检测       | ❌           | 低      | 立即实现（callHistory Map）
工具日志结构       | ❌           | 低      | 立即实现（ToolLogEntry）
noop 检测        | ❌           | 中      | 方案 B（Main Thread 内对比）
```

**关键认知**：这 4 个能力都不需要 SDK，也不需要"同进程快照"。它们是**工具执行层面的增强**，可以在任何架构下实现。OpenPencil 恰好在 `ai-adapter.ts` 中集中实现了它们，但这个"adapter"模式本身不依赖 Vercel AI SDK——它依赖的是"在 execute 前后注入逻辑"的能力，我们的 `beforeToolExec`/`afterToolExec` Hook 已经提供了这个能力。
