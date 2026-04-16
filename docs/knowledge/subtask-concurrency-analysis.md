# 子 Agent 并发可行性分析

> 日期: 2026-04-10
> 状态: 已验证（基于官方文档 + 源码 + 搜索引擎确认）

## 核心事实：你的架构是双线程的

这是最关键的发现 —— 你的插件**不是单线程的**，而是双线程架构：

```
┌─────────────────────────────────────────────────────────────┐
│  UI iframe (浏览器环境 — 有 fetch, setTimeout, Web Workers)  │
│                                                             │
│  useChat.ts → new AgentOrchestrator() → AgentRuntime        │
│  ├── LLM Provider (fetch API 调用)                          │
│  ├── ToolDispatcher (本地工具 + IPC 分发)                    │
│  ├── IpcBridge (requestId 多路复用)                          │
│  │   emit('TOOL_CALL') = parent.postMessage(...)            │
│  │   on('TOOL_RESULT') = window.addEventListener(...)       │
│  └── subtask/executor.ts → 子 AgentRuntime                  │
│                                                             │
│  ✅ 有 setTimeout    ✅ 有 fetch    ✅ 有 DOM                │
│  ✅ 可以 Promise.all  ✅ 可以跑多个并发 async 任务            │
└────────────────────────┬────────────────────────────────────┘
                         │ postMessage (异步, 非阻塞)
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Main Thread (Plugin Sandbox — 有 figma.* API)              │
│                                                             │
│  main.ts → on('TOOL_CALL', async handler)                   │
│  ├── handleToolCall() → dispatchCommand()                   │
│  │   ├── handleJsx() → figma.createFrame(), ...             │
│  │   ├── handleInspect() → node.findAll(), ...              │
│  │   └── handleEdit() → node.x = ..., ...                  │
│  └── emit('TOOL_RESULT') = figma.ui.postMessage(...)        │
│                                                             │
│  ✅ 有 setTimeout    ❌ 无 fetch    ❌ 无 DOM                │
│  ✅ 有 figma.*       ✅ 有 async/await    ✅ 有 Promise      │
└─────────────────────────────────────────────────────────────┘
```

### 来源确认

| 事实 | 来源 |
|------|------|
| Plugin Sandbox 运行在 Main Thread | [Figma 官方文档: How Plugins Run](https://www.figma.com/plugin-docs/how-plugins-run/) |
| Sandbox 不暴露 `fetch`, DOM（但 **`setTimeout` 可用**） | [Figma 官方文档](https://www.figma.com/plugin-docs/how-plugins-run/) 列出 setTimeout 为不可用，但**实际可用**。源码证据：`main.ts` L52 `await new Promise(r => setTimeout(r, durationMs / steps))`，`jsHandler.ts` L240 `await new Promise(r => setTimeout(r, 0))`。Figma 的 `closePlugin()` 会自动清理 timers，侧面确认 setTimeout 是支持的。 |
| UI iframe 有完整浏览器 API | Figma 官方文档：iframe 内"you can write any HTML/JavaScript and access any browser APIs" |
| `@create-figma-plugin/utilities` 的 `emit` = `postMessage` 封装 | [create-figma-plugin 源码](https://github.com/yuanqing/create-figma-plugin)：UI 端 emit 调用 `parent.postMessage`，Main 端 emit 调用 `figma.ui.postMessage` |
| `figma.createFrame()` 等节点创建是同步的 | Figma 官方：异步方法统一以 `Async` 后缀标识，createFrame 无后缀 = 同步 |
| AgentOrchestrator 运行在 UI iframe | 源码：`useChat.ts` L379 `new AgentOrchestrator()`，React Hook = UI iframe 上下文 |

---

## 逐层并发分析（已验证）

### 层1: UI iframe 内（Agent 引擎所在）

| 操作 | 能否并发 | 状态 | 说明 |
|------|---------|------|------|
| 多个 LLM API 请求 | ✅ 可以 | **已确认** | 浏览器 fetch 天然支持并发 |
| 多个 AgentRuntime 实例 | ✅ 可以 | **已确认** | 普通 JS async 函数，iframe 有完整事件循环 |
| 多个 IpcBridge.callTool() | ✅ 可以 | **已确认** | requestId Map 多路复用，源码已验证 |
| Promise.all 启动多个子任务 | ✅ 可以 | **已确认** | iframe 有 setTimeout + Promise.all |

**结论：UI 侧完全没有并发障碍。多个子 Agent 可以同时运行。**

### 层2: IPC 通道

| 操作 | 能否并发 | 状态 | 说明 |
|------|---------|------|------|
| 同时发送多个 TOOL_CALL | ✅ 可以 | **已确认** | `emit` = `parent.postMessage`，非阻塞 |
| 多个请求同时 pending | ✅ 可以 | **已确认** | `pendingRequests: Map<requestId, Promise>` |
| 消息到达顺序 | ⚠️ 基本有序 | **已确认** | 浏览器 postMessage 对同一 sender-receiver 保序，但 async handler 的完成顺序不保证 |

**结论：IPC 本身不是瓶颈，已支持并发。**

### 层3: Main Thread（Figma API 所在）

这是真正需要仔细分析的层。

#### 事实1: `on('TOOL_CALL')` handler 是 async 的

```typescript
// main.ts L88
on<ToolCallHandler>('TOOL_CALL', async (data) => {
  await handleToolCall(data as any);  // async!
});
```

当 handler A 正在 `await` 某个异步操作时（如 `getNodeByIdAsync`），下一个 TOOL_CALL 消息可以开始处理。这是 **cooperative async concurrency** —  不是真并行，但多个 handler 可以交错执行。

#### 事实2: 节点创建是同步的，自身不会被中断

```typescript
// 这些是同步的，执行时不会被其他 handler 打断：
const frame = figma.createFrame();    // 同步，立即返回
frame.name = "Header";                // 同步
frame.resize(400, 200);               // 同步
parent.appendChild(frame);            // 同步
```

**在一个同步代码块内，不存在竞态条件**。JS 单线程保证了同步操作的原子性。

#### 事实3: 在 await 点会被中断

```typescript
async function handleJsx(params) {
  const parent = await figma.getNodeByIdAsync(params.parentId);  // ← await 点，可能被中断
  const frame = figma.createFrame();  // 同步，安全
  parent.appendChild(frame);          // 这时 parent 可能已被其他 handler 删除！
}
```

**在两个 await 之间，另一个 handler 可以运行并修改文档状态。**

#### 事实4: commitUndo 的交错风险

```
Handler A: createFrame → commitUndo
                ↕ (如果中间有 await)
Handler B: createFrame → commitUndo
```

如果两个 handler 交错在 await 点，commitUndo 会把两个 handler 的操作混在一起，导致 undo 栈混乱。

（来源：Figma 官方文档 + 多个 web search 结果确认 commitUndo 对 async 交错敏感）

#### 事实5: 用户操作也能在 await 间隔中发生

> "During the `await`, the user can continue interacting with the Figma file. They might select different objects, move layers, delete nodes."
> — Figma 官方推荐的 setTimeout-yield 模式文档

这意味着即使只有一个 Agent 在运行，如果它在 await 点 yield 了，用户也可能修改 canvas 状态。

#### 事实6: `figma.ui.onmessage` 的 async handler 确实会交错

> "While your handler is suspended at an `await` point, the main thread's event loop is free to process other tasks — including subsequent messages arriving from the UI."
> "Multiple messages can be in an 'active' state of processing if they are triggered during the gaps created by `await` statements."
> — 多个技术来源一致确认

这不是猜想，是 JS event loop 的标准行为。Figma sandbox 有 `setTimeout`（已验证），有完整的事件循环。

### 逐 Handler 的 await 点审计（源码事实）

以下是每个 command handler 中实际存在的 `await` 点，这决定了 handler 是否可能被其他 handler 交错：

| Handler | await 点数量 | 具体 await 操作 | 交错风险 |
|---------|------------|----------------|----------|
| **handleJsx** | **≥8** | `compileAndExecute()`, `prefetchIcons()`, `getNodeByIdAsync()` ×4, `walkTree()`, `exportAsync()` 等 | ❌ **高** — 写操作密集，多个 await 间有大量节点创建 |
| **handleJs** | **≥8** | `clientStorage.getAsync/setAsync` ×5, 动态代码 `await fn(figma)`, `setTimeout(r, 0)`, `saveLessons()` | ❌ **高** — 执行任意代码，完全不可预测 |
| **handleInspect** | **2-3** | `resolvePathToNode()`, `attachScreenshot()` → `exportAsync()` | ⚠️ **中** — 但是只读操作，不修改 canvas |
| **handleDescribe** | **0** | 无 await | ✅ **零** — 纯同步，不会被中断 |
| **handleEdit** | **0** | 无 await | ✅ **零** — 纯同步，不会被中断 |
| **handleTree** | **1** | `resolvePathToNode()` | ⚠️ **低** — 只读 |
| **handleCat** | **1-2** | `resolvePathToNode()`, 可选 `exportAsync()` | ⚠️ **低** — 只读 |
| **handleRm** | **≥2** | `resolvePathToNode()`, `resolveGlobPaths()` | ⚠️ **中** — 删除操作，await 后节点可能已被修改 |
| **handleMv** | **≥3** | `resolvePathToNode()` ×2-3 | ⚠️ **中** — 结构变更 |
| **handleCp** | **≥2** | `getNodeByIdAsync()`, `cloneNode()` | ⚠️ **中** — 写操作 |
| **setterAdapters** (set_text, set_fill, ...) | **0** | 无 await | ✅ **零** — 纯同步 |
| **searchAdapters** (find_nodes, ...) | **0** | 无 await | ✅ **零** — 纯同步 |
| **structureAdapters** (delete_node, ...) | **0** | 无 await | ✅ **零** — 纯同步 |
| **varAdapters** (list_variables, ...) | **0** | 无 await | ✅ **零** — 纯同步 |
| **compAdapters** (create_component, ...) | **0** | 无 await | ✅ **零** — 纯同步 |

#### 关键发现

**大多数 handler 是纯同步的（await = 0），不会被交错。** 真正有交错风险的是：

1. **handleJsx** — 你的主力创建工具，await 点最多，交错风险最高
2. **handleJs** — 执行任意代码，不可预测
3. **handleRm/handleMv/handleCp** — 结构变更操作，有 await

但在单 Agent 的当前架构中，ToolDispatcher 的 `for` 循环保证了**同 Agent 内的串行**，所以这些 handler 不会自己和自己交错。**只有多 Agent 并发时才需要关注。**

### Main Thread 并发分析总结

| 场景 | 安全性 | 风险 |
|------|--------|------|
| 两个 handler 都只做同步操作、不写同一节点 | ✅ 安全 | 无 |
| 两个 handler 都只读 | ✅ 安全 | 无 |
| 两个 handler 写不同 subtree，中间有 await | ⚠️ 基本安全 | 如果 handler B 的 await 恰好在 handler A 的同步写操作中被调度 — 不可能，因为同步操作不会 yield |
| 两个 handler 写同一个 parent 的 children | ❌ 不安全 | children 数组顺序不可预测 |
| 两个 handler 一个删节点，一个读那个节点 | ❌ 不安全 | 读到的引用可能已失效 |

---

## 修正之前的猜想

| 之前的猜想 | 验证结果 | 实际情况 |
|-----------|---------|---------|
| "Plugin Sandbox 是单线程" | ⚠️ **不够准确** | Plugin Sandbox（main 线程）是单线程，但 Agent 引擎运行在 UI iframe（另一个线程），两者通过 postMessage 通信 |
| "IPC 是共享单通道" | ❌ **错误** | IPC 是 requestId 多路复用的，已支持并发请求 |
| "两个 Agent 同时操作 canvas 会竞态" | ⚠️ **部分正确** | 纯同步操作不会竞态（JS 单线程保证）；但 async handler（主要是 handleJsx）在 await 点会交错，此时有竞态风险 |
| "Figma API 操作不能并行" | ❌ **错误** | 不同 subtree 的操作、所有只读操作都可以安全并行。同步写操作天然是原子的 |
| "Sandbox 没有 setTimeout" | ❌ **错误** | `setTimeout` 在 Main sandbox 里**可用**。源码 `main.ts` L52 和 `jsHandler.ts` L240 都直接使用了。Figma `closePlugin()` 会清理 timers 也侧面确认。官方文档的说法具有误导性 |

---

## 实际可行的并发方案

### 方案 A: 并行 LLM 推理 + 串行工具执行（最低风险）

```
UI iframe:
  Agent A LLM call ──────────────→ 等 IPC 结果 → LLM call → ...
  Agent B LLM call ──────────────→ 等 IPC 结果 → LLM call → ...
                    ↓ 并行              ↓ 串行
Main thread:
  [A的工具] → [B的工具] → [A的工具] → [B的工具]  (排队执行)
```

实现：在 IpcBridge 加一个队列，保证 Main 线程一次只处理一个 TOOL_CALL。

- 改动量：~20 行（IpcBridge 加 queue）
- 风险：零 — Main 线程行为和现在完全一样
- 收益：LLM 推理时间（约 70%）可以重叠

### 方案 B: 按 subtree 隔离的并行写入（中等风险）

```
UI iframe:
  Agent A (owns 123:456) ──→ TOOL_CALL(jsx, parent=123:456)
  Agent B (owns 789:012) ──→ TOOL_CALL(jsx, parent=789:012)
                               ↓ 都发出去
Main thread:
  两个 handler 同时运行（操作不同 subtree，不 await → 安全）
```

实现：
1. 子 Agent 启动时声明它操作的 parent 节点
2. Main 线程检查 parent ownership，相同 parent 排队，不同 parent 并行
3. 只读 TOOL_CALL (inspect, describe, find_nodes) 永远并行

- 改动量：~100 行
- 风险：低 — 不同 subtree 的同步写操作不会互相干扰（JS 单线程保证）
- 收益：如果父 Agent 创建了 Header/Content/Footer 三个 parent，三个 create 子 Agent 可以完全并行

### 方案 C: 完全并行 + 防御性编程（高风险）

不做任何排队，依赖 Figma API 自身的稳定性。

- 不推荐 — Figma 官方文档明确指出 await 点有状态不一致风险

---

## 推荐路径

**先做方案 A**（1-2 小时工作量），验证并行 LLM 推理的实际加速比。如果效果显著（预计减少 30-40% 总时间），再考虑方案 B。

方案 A 的核心改动：

```typescript
// 1. IpcBridge 加串行队列（防止 Main 线程交错）
class IpcBridge {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  async callTool(toolName, params) {
    return new Promise((resolve) => {
      this.queue.push(async () => {
        const result = await this._rawCallTool(toolName, params);
        resolve(result);
      });
      this.processQueue();
    });
  }
}

// 2. executeSubtask 支持并行启动
const [headerResult, footerResult] = await Promise.all([
  executeSubtask("Build header", { ...ctx }),
  executeSubtask("Build footer", { ...ctx }),
]);
```

---

## 关键源码索引

| 文件 | 运行环境 | 并发关注点 |
|------|---------|-----------|
| `src/features/chat/useChat.ts` L379 | UI iframe | AgentOrchestrator 创建点 — 证明引擎在 iframe |
| `src/engine/agent/ipcBridge.ts` | UI iframe | requestId 多路复用 — 已支持并发 |
| `src/main.ts` L88 | Main sandbox | `on('TOOL_CALL', async)` — async handler 可交错 |
| `src/ipc/handlers/toolCallHandler.ts` | Main sandbox | 无排队逻辑 — 多个 TOOL_CALL 可能交错 |
| `src/ipc/commands/index.ts` | Main sandbox | dispatchCommand 无锁 |
| `src/engine/agent/toolDispatcher.ts` L146 | UI iframe | 单 Agent 内 `for` 循环串行 — 但不同 Agent 的 dispatcher 互不影响 |
| `src/engine/agent/subtask/executor.ts` | UI iframe | `await executeSubtask` — 改为 Promise.all 即可并行 |

## 参考链接

- [Figma: How Plugins Run](https://www.figma.com/plugin-docs/how-plugins-run/)
- [Figma: Asynchronous Tasks](https://www.figma.com/plugin-docs/async-tasks/)
- [Figma: Frozen Plugins](https://developers.figma.com/docs/plugins/frozen-plugins)
- [Figma: commitUndo](https://developers.figma.com/docs/plugins/api/properties/figma-commitundo)
