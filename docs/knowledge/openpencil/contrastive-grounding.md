# 概念对照桥：OpenPencil ↔ 我们的项目

> Date: 2026-03-30
> Index: [工具架构重构计划](tool-refactoring-index.md)
> 补充文档，为 [深度剖析](openpencil-deep-dive.md) 和 [Q&A 第二轮](openpencil-qa-session2.md) 中的概念添加"我们的代码怎么做"的对照

---

## 这种学习方式叫什么？

**对照式学习（Contrastive Grounding）**

核心做法：每学一个外部概念，**立刻用自己项目里的代码做对照**——
不是"A 系统这样做"就结束了，而是"A 这样做 ↔ 我们这样做 ↔ 差异在哪 ↔ 哪个更好"。

```
❌ 只说 OpenPencil:
  "OpenPencil 用 { error: '...' } 返回错误"

✅ 加上对照:
  "OpenPencil 用 { error: '...' } 返回错误。
   我们用 { error: { code, message } }。
   OpenPencil 的更扁平，LLM 不需要多解析一层。
   但我们的可以按 code 分支处理。
   → 对 LLM 场景来说，扁平的更合适。"
```

### 如何向我提问才能触发这种输出？

在问题末尾加上触发词：

| 触发方式 | 示例 |
|---------|------|
| **"对照我们的代码"** | "OpenPencil 的回调机制是什么？**对照我们的代码**解释" |
| **"我们项目里怎么做的？"** | "noop 检测的意义是什么？**我们项目里有类似的吗？**" |
| **"差异是什么"** | "valibot 验证参数，**和我们构建时获取 schema 的差异是什么？**" |
| **"用代码块对比"** | "同层错误返回是什么意思？**用代码块对比我们的**" |

最简单的一句话：**"对照我们的代码"**。

---

## 第一轮补充对照（openpencil-deep-dive.md）

### 一、ai-adapter 的中间件模式 ↔ 我们的 IPC 模式

```
OpenPencil 的 adapter（同一进程内的包装函数）:
  ┌──────────────────────────────────────┐
  │  LLM 调用 tool                       │
  │    ↓                                 │
  │  adapter.execute(args)               │
  │    ├── 1. 拍快照（如果 mutates）       │
  │    ├── 2. 调用 def.execute(figma, args)│ ← 直接调用，同一进程
  │    ├── 3. 闪烁节点                     │
  │    ├── 4. noop 检测                    │
  │    └── 5. 返回结果给 LLM              │
  └──────────────────────────────────────┘

我们的 IPC Bridge（跨进程异步消息传递）:
  ┌──────────────────────────────────────┐
  │  LLM 调用 tool                       │
  │    ↓                                 │
  │  ipcBridge.callTool(name, params)    │
  │    ├── 生成 requestId                 │
  │    ├── emit('TOOL_CALL', {...})       │ ← 发送消息到 Figma 进程
  │    ├── 等待 on('TOOL_RESULT')         │ ← 异步等待回传
  │    ├── 超时 30s → resolve({error:...})│
  │    └── 收到结果 → resolve(response)   │
  └──────────────────────────────────────┘
```

**关键差异**：OpenPencil 不需要处理超时、不需要序列化参数、不需要跨进程 ID 匹配。我们因为 Figma 插件的沙箱限制，必须用 IPC。

**我们的代码**（`src/engine/agent/ipcBridge.ts`）：
```typescript
// 我们生成 requestId 来匹配请求和响应
const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 我们需要 setTimeout 防止挂死
const timeout = setTimeout(() => {
  resolve({
    error: { code: 'TIMEOUT', message: `Tool call '${toolName}' timed out` }
  });
}, timeoutMs);

// 我们用 emit/on 跨进程通信
emit<ToolCallHandler>('TOOL_CALL', { toolName, parameters, context, requestId });
```

OpenPencil **没有**这些——它直接 `await def.execute(figma, args)`，同步等结果。

---

### 二、工具错误返回 ↔ 我们的 ToolResponse

```typescript
// ═════════ OpenPencil 的错误返回 ═════════
// 同层。成功或失败都是同一级别的扁平对象。

// 成功时：
return { id: "0:5", color: { r: 1, g: 0, b: 0 } }

// 失败时：
return { error: "Node '0:5' not found" }

// LLM 怎么判断？ → 有 error 字段吗？有就是失败。


// ═════════ 我们的错误返回 ═════════
// 嵌套。成功和失败分别在不同的字段里，且 error 本身也是嵌套对象。

// 成功时（src/engine/agent/tools/types.ts:76-87）：
return { data: { id: "0:5", color: { r: 1, g: 0, b: 0 } } }

// 失败时：
return {
  error: {
    code: 'NOT_FOUND',         // ← 多了一层：错误类型编码
    message: "Node '0:5' not found",
    details: { nodeId: "0:5" }  // ← 多了一层：结构化详情
  }
}

// 超时时（src/engine/agent/ipcBridge.ts:72-75）：
return {
  error: {
    code: 'TIMEOUT',
    message: `Tool call '${toolName}' timed out after ${timeoutMs}ms`
  }
}
```

**对照结论**：
- OpenPencil 的扁平格式对 LLM 更友好（少一层嵌套 → 少一层认知负担）
- 我们的 `code` 字段适合**程序化分支处理**，但 LLM 通常不需要按 code 分支
- 我们还额外有 `_stderr` 和 `_stages`，OpenPencil 没有——这些是我们的 debug 信息

---

### 三、setter 回执 ↔ 我们的 edit 返回

```typescript
// ═════════ OpenPencil 的 set_fill 返回 ═════════
// 读回 Figma 节点的真实值，确认修改生效
return {
  id: args.id,
  fills: node.fills    // ← 从节点上读取，不是复述 LLM 的输入
}
// 如果 LLM 设了 color: "#FF0000"
// 但 Figma 内部转换为 { r: 1, g: 0, b: 0, a: 1 } 格式
// 返回的是转换后的真实值


// ═════════ 我们的 edit 返回 ═════════
// 目前返回的是操作状态，不是节点真实值
return {
  data: {
    success: true,
    appliedOps: 5,    // ← 执行了多少个操作
    // 没有读回节点属性
  }
}
```

**对照结论**：
- OpenPencil 的"读回真实值"让 LLM 能**自我验证**——"我设的颜色生效了吗？"
- 我们的"执行了 5 个操作"不够——LLM 不知道这 5 个操作的效果是什么
- 重构方向：setter 返回应该包含修改后的节点属性值

---

### 四、valibot 验证 ↔ 我们的构建时 schema

```typescript
// ═════════ OpenPencil 的运行时验证 ═════════
// 每次 LLM 调用工具时，valibot 验证参数

// 开发者定义：
params: {
  color: { type: 'color', required: true }
}

// paramToValibot 转换为：
v.object({
  color: v.pipe(v.string(), v.description('Color in hex format'))
})

// LLM 输出 { color: 123 } → valibot 拒绝："color 应该是 string"
// LLM 输出 { color: "#FF0000" } → valibot 通过 ✓


// ═════════ 我们的构建时 schema ═════════
// 构建时从 Figma Plugin API 定义中提取类型信息

// 构建脚本读取：
// figma.d.ts → 提取 fills, strokes, cornerRadius 等属性类型
// → 生成 JSON Schema → 存入 agent-registry.json

// 运行时 LLM 看到的参数定义来自构建产物，不是硬编码
```

**两种方式的优劣**：

| 维度 | OpenPencil（硬编码 + valibot） | 我们（构建时提取） |
|------|------|------|
| **灵活性** | 需要手动更新 ParamDef | Figma API 更新 → 重新构建即可 |
| **运行时验证** | ✅ valibot 实时验证 | ⚠️ 目前没有运行时验证 |
| **维护成本** | 每加一个工具需要写 params | 自动从 API 提取 |
| **类型安全** | 受限于 5 种 ParamDef 类型 | 可以表达 Figma API 的完整类型 |

---

### 五、mutates 信号 ↔ 我们没有等价机制

```typescript
// ═════════ OpenPencil 的 mutates 字段 ═════════
export const setFill = defineTool({
  name: 'set_fill',
  mutates: true,    // ← 声明"这个工具会修改画布"
  // → adapter 自动做：快照、闪烁、noop 检测
})

export const getNode = defineTool({
  name: 'get_node',
  // mutates 默认 undefined → 不做快照、不闪烁
})

// ═════════ 我们的现状 ═════════
// 没有 mutates 字段。所有工具调用走同一条路径。
// ipcBridge.callTool('edit', params)
// ipcBridge.callTool('inspect', params)
// ↑ 两者在 IPC 层没有区分——都是 emit → on 的流程
// 没有快照、没有 noop 检测、没有闪烁

// 重构方向：在 ToolDef 中加入 mutates 字段
// 用途：
//   1. 修改前后对比（debug 用）
//   2. selection + viewport 滚动（替代闪烁）
//   3. 未来的 undo 支持
```

---

### 六、depth 参数控制 ↔ 我们的节点检查

```typescript
// ═════════ OpenPencil 的 get_node ═════════
// LLM 可以精确控制要多少层信息

get_node({ id: "0:5", depth: 1 })
// → 返回节点 + 直接子节点

get_node({ id: "0:5", depth: 0 })
// → 只返回节点本身的属性

// ═════════ 我们的 inspect ═════════
// 目前的 inspect 命令没有 depth 参数
// 返回的是固定深度的信息
// LLM 无法控制"我只想看这个节点本身"

// 重构方向：添加 depth 参数
// 好处：
//   减少返回数据量 → 减少 token 消耗
//   LLM 可以渐进式探索（先 depth:0 看概览，再 depth:1 深入）
```

---

### 七、回调 / 钩子 ↔ 我们的 IPC 事件

```typescript
// ═════════ OpenPencil 的回调 ═════════
// 同步的函数引用。直接调用，没有延迟。

options.onBeforeExecute?.(def)
// ↑ 调用方在创建 adapter 时传入一个函数
// adapter 在工具执行前调用它
// 这是一个直接的函数调用——像一个插座，你往里面插什么灯就亮什么

// ═════════ 我们的 IPC 事件 ═════════
// 异步的消息传递。有序列化、有延迟。

emit<ToolCallHandler>('TOOL_CALL', { ... })
// ↑ 发送一条消息到另一个进程
// 另一个进程里的 on('TOOL_CALL', handler) 收到后执行
// 不是直接调用——像寄一封信，对方收到信后执行

// 对照：
//   回调 = 在同一个房间里喊话，对方立刻听到
//   IPC = 写一封信寄出去，等对方回信
```

---

### 八、工具组合使用 ↔ 我们的 run 命令

```typescript
// ═════════ OpenPencil 的多工具调用 ═════════
// LLM 每次调一个工具，连续调多次

// 第 1 轮: find_nodes({name: "Card"})
//   → {count: 1, nodes: [{id: "0:5"}]}
// 第 2 轮: set_fill({id: "0:5", color: "#FF0000"})
//   → {id: "0:5", fills: [{type: "SOLID", color: {...}}]}
// 第 3 轮: describe({id: "0:5"})
//   → "Card frame with red fill..."

// 三个独立工具，三次调用，每次的返回值指导下一步

// ═════════ 我们的 run 命令 ═════════
// LLM 一次输出所有操作，打包在一个 run 命令里

// run("edit Card fill:#FF0000; inspect Card")
//   ↑ 一个字符串里塞了两个操作
//   需要 commandParser 解析分号分隔的子命令
//   如果第一个操作失败，第二个还要不要执行？
//   错误边界不清晰

// 对照结论：
//   OpenPencil："每个工具做一件事" → 职责单一，错误隔离
//   我们的 run："一个命令做多件事" → 解析复杂，错误交叉
//   重构方向：拆分成独立工具
```

---

### 九、节点闪烁 ↔ 我们可以做什么

```typescript
// ═════════ OpenPencil 的节点闪烁 ═════════
// 自己的渲染引擎 → 可以直接在节点上画高亮
options.onFlashNodes(["0:5", "0:6"])
// → UI 层在这些节点上短暂显示高亮边框

// ═════════ 我们能做的 ═════════
// Figma 不暴露画布渲染 API，但可以：

// 方案 1：选中节点（用户看到蓝色选中框）
figma.currentPage.selection = [node]

// 方案 2：滚动视口到节点位置
figma.viewport.scrollAndZoomIntoView([node])

// 方案 3：在 UI 面板中显示操作日志（我们已有的方式）
emit('AGENT_LOG', { action: 'modified', nodeId: "0:5" })

// 最实用的组合：
figma.currentPage.selection = [node]
figma.viewport.scrollAndZoomIntoView([node])
// → 选中 + 滚动到该节点 → 用户立刻看到"agent 改了什么"
```

---

### 十、batch_update 的 JSON 字符串参数 ↔ 我们的 flatOps

```typescript
// ═════════ OpenPencil 的妥协 ═════════
// batch_update 的 updates 参数是 JSON 字符串（不是对象）
params: {
  updates: {
    type: 'string',
    description: 'JSON string of [{id, ...props}]'
  }
}
// → LLM 输出一个 JSON 字符串，execute 内部 JSON.parse 解析
// → 因为 function calling 不支持嵌套对象数组的 schema

// ═════════ 我们的 flatOps ═════════
// 我们的 edit 命令也有类似的扁平化：
// JsxNode[] → flatOps 文本 → DesignOp[] → 执行
// ↑ 中间有一层字符串序列化/反序列化

// 对照：
//   两者都在用"字符串作为中间格式"来传递复杂数据
//   都是为了绕过某种限制（LLM schema 限制 / 跨层传递限制）
//   都引入了额外的 parse 步骤
//   都可能因为格式错误导致运行时失败
```

---

## 第二轮补充对照（openpencil-qa-session2.md）

### LLM 可见端 / 系统内部端 ↔ 我们的 Sandbox / Main

```typescript
// ═════════ OpenPencil 的"前后端" ═════════
// "前端" = LLM 看到的（name, description, params schema）
// "后端" = 系统内部的（mutates, execute, adapter 逻辑）

// ═════════ 我们的分界线更物理 ═════════
// Sandbox（UI 线程）= agent 运行、LLM 交互、工具分发
// Main（Figma 线程）= 真正操作 Figma 节点、读取画布

// 我们的"看不到"不只是逻辑上的隐藏，是物理上的进程隔离：
// Sandbox 不能直接 import figma API → 必须通过 IPC 通信
// Main 不能直接 import LLM SDK → 只处理来自 Sandbox 的请求

// emit('TOOL_CALL', {...})   ← 从 Sandbox 发到 Main
// on('TOOL_RESULT', {...})   ← 从 Main 回到 Sandbox
//                           ↑ 这条线就是我们的"前后端"分界
```

### params→schema 转换 ↔ 我们的构建管线

```
OpenPencil（3 步运行时转换）:
  ParamDef → paramToValibot() → valibot schema
  valibot schema → @ai-sdk/valibot → JSON Schema
  JSON Schema → Vercel AI SDK → function definition → LLM

我们（构建时 + 运行时混合）:
  figma.d.ts → 构建脚本提取 → agent-registry.json（JSON Schema）
  agent-registry.json → 运行时加载 → 注册为 Gemini function declaration → LLM
```

差异：OpenPencil 每次启动都做转换。我们在构建时一次性完成，运行时直接用。

---

## 如何用这种方法自学

1. **看到新概念**：记下来
2. **翻我们的代码**：搜索相似的模式
3. **写对照**：
   ```
   他们的做法 → [代码]
   我们的做法 → [代码]
   差异 → [列表]
   哪个更好 → [分析]
   ```
4. **发现缺口**：如果"我们没有等价机制"→ 这就是重构方向

这不是"记笔记"——是**主动建立认知连接**。每个新概念都锚定在你已经熟悉的代码上，记忆效果远好于孤立学习。

---

## 本文档变更记录

| 日期 | 变更 |
|------|------|
| 2026-03-30 | 创建。为前两轮 Q&A 的 10 个核心概念添加项目代码对照 |
| 2026-03-30 | 追加：跨进程架构深度对照——沙箱/UI Thread/requestID/防挂死的因果关系 |

---

## 深度对照：跨进程通信——我们和 OpenPencil 的根本差异

### 为什么需要跨进程？

不是我们选择了跨进程——是 **Figma 的插件沙箱模型强制的**。

```
┌──────────────────────────────────────────────────────────────┐
│                    Figma 桌面应用                              │
│                                                              │
│  ┌───────────────────────┐        ┌────────────────────────┐ │
│  │  Main Thread           │◄══════►│  UI Thread (Sandbox)    │ │
│  │                       │  IPC   │                        │ │
│  │  ✅ figma.* API       │  消息   │  ❌ 不能用 figma.*     │ │
│  │  ✅ 创建/修改节点      │        │  ✅ React UI           │ │
│  │  ✅ 读取画布           │        │  ✅ LLM SDK (Gemini)   │ │
│  │  ❌ 没有 UI 界面      │        │  ✅ 网络请求            │ │
│  │  ❌ 不能发网络请求     │        │  ❌ 不能碰画布          │ │
│  │                       │        │                        │ │
│  │  src/main.ts          │        │  src/ui.tsx + agent     │ │
│  └───────────────────────┘        └────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

OpenPencil 的世界（对比）:
┌──────────────────────────────────────────────────────────────┐
│  单一进程                                                     │
│                                                              │
│  LLM SDK + 渲染引擎 + SceneGraph + UI    ← 全在一起          │
│  adapter.execute(args) → figma.graph.createNode()            │
│  ↑ 直接调用，无 IPC，无超时，无 requestId                      │
└──────────────────────────────────────────────────────────────┘
```

### 因果关系链

```
根因：Figma 插件沙箱限制
  │
  ├─→ UI Thread 不能调用 figma.* API
  │     │
  │     └─→ 必须把"操作画布"的请求发给 Main Thread
  │           │
  │           └─→ 需要跨进程消息传递（emit / on）
  │                 │
  │                 ├─→ 消息是异步的 → 不知道什么时候回来
  │                 │     │
  │                 │     ├─→ 需要 requestId 匹配请求和响应
  │                 │     │     （同时发了 inspect 和 edit，
  │                 │     │      回来两个结果怎么分辨？）
  │                 │     │
  │                 │     └─→ 需要 setTimeout 防挂死
  │                 │           （Main 线程崩了 → 消息永远不回来
  │                 │            → Promise 永远 pending
  │                 │            → agent 卡死
  │                 │            → 用户只能关插件重开）
  │                 │
  │                 └─→ 参数必须可序列化
  │                       （函数、class 实例不能通过 IPC 传递
  │                        → 只能传 JSON 兼容的数据）
  │
  └─→ Main Thread 不能发网络请求
        │
        └─→ LLM API 调用只能在 UI Thread
              │
              └─→ agent 运行在 UI Thread
                    → agent 需要操作画布 → 回到"必须 IPC"
```

### 逐行代码对照：每个概念的来源

```typescript
// ═══════════════════════════════════════════════════════════
//  requestId：为什么需要？
// ═══════════════════════════════════════════════════════════

// 场景：agent 快速连续调了两个工具
ipcBridge.callTool('inspect', { id: "0:5" })    // 请求 A
ipcBridge.callTool('set_fill', { id: "0:5", color: "#F00" })  // 请求 B

// 两个 emit 几乎同时发出
// Main 线程异步处理，可能先完成 B 再完成 A
// 回来两个 TOOL_RESULT → 哪个是 inspect 的？哪个是 set_fill 的？

// 没有 requestId → 无法区分 → 数据错乱
// 有 requestId → 每个请求有唯一编号 → 精确匹配

// src/engine/agent/ipcBridge.ts:65
const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//                 ↑ 时间戳 + 随机字符串 = 几乎不可能重复

// src/engine/agent/ipcBridge.ts:80
this.pendingRequests.set(requestId, { resolve, reject, timeout });
// ↑ 用 Map 存起来：key = requestId，value = 这个请求的 resolve 函数
//   收到 TOOL_RESULT 时，用 requestId 从 Map 里找到对应的 resolve

// src/engine/agent/ipcBridge.ts:42-48
on<ToolResultHandler>('TOOL_RESULT', (data) => {
  const request = this.pendingRequests.get(data.requestId);
  //                                      ↑ 用回来的 requestId 查找
  if (request) {
    clearTimeout(request.timeout);     // 取消超时计时器
    this.pendingRequests.delete(data.requestId);  // 清理
    request.resolve(data.response);    // 把结果交给等待的 Promise
  }
});


// ═══════════════════════════════════════════════════════════
//  setTimeout 防挂死：为什么需要？
// ═══════════════════════════════════════════════════════════

// 场景 1：Main 线程处理 Figma API 时 Figma 内部死锁
// 场景 2：Main 线程抛了异常但没 catch → 没发 TOOL_RESULT
// 场景 3：Figma 升级后某个 API 行为变了

// 如果没有超时：
//   await ipcBridge.callTool('edit', params)
//   ↑ 这个 await 永远不会 resolve
//   ↑ agent 的 generateText 循环卡在这一步
//   ↑ 用户看到："agent 在思考..." → 永远在思考

// src/engine/agent/ipcBridge.ts:68-77
const timeout = setTimeout(() => {
  if (this.pendingRequests.has(requestId)) {
    this.pendingRequests.delete(requestId);
    resolve({
      error: {
        code: 'TIMEOUT',
        message: `Tool call '${toolName}' timed out after ${timeoutMs}ms`
      }
    });
    // ↑ 30 秒后主动 resolve 一个错误
    //   agent 收到错误 → 可以重试或换一种方式
    //   比永远卡死好得多
  }
}, timeoutMs);


// ═══════════════════════════════════════════════════════════
//  对照 OpenPencil：它为什么不需要这些？
// ═══════════════════════════════════════════════════════════

// OpenPencil 的工具调用：
const result = await def.execute(figma, args)
// ↑ 直接的函数调用，在同一个进程里
// ↑ 如果卡了 → 整个进程卡 → 用户看到界面冻结 → 知道出问题了
// ↑ 如果抛异常 → catch 直接捕获 → 返回 { error: ... }
// ↑ 不存在"消息发出去了但对方没收到"的情况
// ↑ 不存在"两个结果分不清"的情况（同步执行，一次一个）

// 所以 OpenPencil 不需要：
//   ❌ requestId（不需要匹配——直接赋值给 result）
//   ❌ setTimeout（不需要——卡住了调用方也知道）
//   ❌ pendingRequests Map（不需要——没有并发请求）
//   ❌ 可序列化限制（不需要——可以直接传对象引用）
```

### 这些概念的关系总结

```
沙箱（Sandbox）
  = Figma 对 UI Thread 施加的安全限制
  = "你可以显示界面、发网络请求，但不能碰画布"
  = 这是一切的起因

UI Thread
  = 运行我们的 React UI 和 agent 的线程
  = 在沙箱里
  = 不能直接调 figma.createFrame()

跨进程通信（IPC）
  = emit() / on() 消息传递
  = 沙箱限制的直接后果
  = UI Thread 和 Main Thread 之间传递数据的唯一方式

requestId
  = 消息的唯一编号
  = 跨进程通信的必然需求（异步 → 需要匹配）

防挂死（setTimeout）
  = 跨进程通信的必然风险防护（消息可能丢失 → 需要超时））

关系：沙箱 → 跨进程 → requestId + 防挂死
     ↑ 原因    ↑ 结果      ↑ 配套设施
```

### 重构的影响

即使我们按 OpenPencil 模式把 `run` 拆成独立工具，**这些跨进程机制不会消失**：

```
重构前：
  agent → run("edit Card fill:#F00") → ipcBridge → Main → run parser → figma.*

重构后：
  agent → set_fill({id:"0:5", color:"#F00"}) → ipcBridge → Main → setFillHandler → figma.*
                                                ↑
                                           IPC 仍然存在！

能优化的部分：
  ✅ 去掉 run parser（不再解析 CLI 字符串）
  ✅ 参数已经是结构化 JSON（不需要从字符串中提取参数）
  ✅ 错误来源更明确（set_fill 失败 vs run 里不知道哪步失败）

不能消除的部分：
  ❌ emit/on 消息传递（沙箱决定的）
  ❌ requestId 匹配（异步消息决定的）
  ❌ setTimeout 超时（消息可靠性决定的）
  ❌ 参数序列化（跨进程决定的）
```

