# OpenPencil 深度 Q&A（第三轮）

> Date: 2026-03-30 (补充: 2026-03-31)
> Parent: [OpenPencil Q&A 第二轮](openpencil-qa-session2.md)
> Index: [工具架构重构计划](tool-refactoring-index.md)

---

## 目录

| # | 主题 | 类型 |
|---|------|------|
| [1](#1-回调callback和钩子hook) | 回调（callback）和钩子（hook） | 概念 |
| [2](#2-工具定义的三要素是通用的吗) | 工具定义三要素 | 概念 |
| [3](#3-为什么--不能比较对象内容) | `===` 引用比较 | JS 基础 |
| [4](#4-noop-对比时过滤的原因) | noop 对比过滤 | 实现细节 |
| [5](#5-默认行为具体是什么) | 可选参数默认行为 | 实现细节 |
| [6](#6-默认位置和视口的关系) | 坐标系统与视口 | 概念 |
| [7](#7-关于节点属性批量替换的区分) | 批量操作区分 | 设计决策 |
| [8](#8-sucrase-处理-jsx-字符串内部的内容) | sucrase 编译管线 | 实现细节 |
| [9](#9-支持-vue-意味着什么) | 多框架渲染管线 | 架构 |
| [10](#10-resultchildids-的类型) | RenderResult 类型 | 类型 |
| [11](#11-find_nodes-的-count) | find_nodes 查询 | 实现细节 |
| [12](#12-替换策略在哪里定义和-renderjsx-的解耦) | renderJSX 解耦 | 设计决策 |
| [13](#13-llm-的解析是什么意思) | LLM 认知负担 | 设计原理 |
| [14](#14-同层的代码表示) | 同层错误设计 | 设计原理 |

### 已落地改动索引

以下条目在 2026-03-31 已实际实现，每条附有代码对比和 E2E 验证结果：

| 对应章节 | 改动 | 关键文件 |
|----------|------|----------|
| [§13 补充](#已落地2026-03-31) | `ToolResponse.error` 从 `{code,message}` 扁平化为 `string` | `src/engine/agent/tools/types.ts` |
| [§13 补充](#已落地2026-03-31) | 删除 exit code 系统，`_meta` 从 `[exit:0 \| 43ms]` 简化为 `[43ms]` | `exitCode.ts`, `presentation.ts` |
| [§14 补充](#已落地2026-03-31-1) | `presentForLLM` 将 `data` 展开到顶层，成功/失败同层 | `presentation.ts` |

---

## 1. 回调（callback）和钩子（hook）

### 你的理解是对的

回调**确实是一种信号机制**——"当某件事发生时，执行你给我的这段代码"。

```typescript
// 定义时：声明"这里有个插槽，你可以塞代码进来"
interface AIAdapterOptions {
  onBeforeExecute?: (def: ToolDef) => void      // 插槽 1：执行前
  onAfterExecute?: (def: ToolDef) => void        // 插槽 2：执行后
  onFlashNodes?: (nodeIds: string[]) => void     // 插槽 3：节点变化时
  onToolLog?: (entry: ToolLogEntry) => void      // 插槽 4：日志产生时
}

// 使用时：往插槽里塞具体的代码
const options: AIAdapterOptions = {
  onBeforeExecute: (def) => {
    showLoadingSpinner()            // ← 你决定"执行前"做什么
    console.log(`开始执行 ${def.name}`)
  },
  onAfterExecute: (def) => {
    hideLoadingSpinner()            // ← 你决定"执行后"做什么
  },
  onFlashNodes: (ids) => {
    highlightNodesInUI(ids)         // ← 你决定"节点变化"时做什么
  }
}
```

### 回调 vs 钩子（hook）

本质上是同一件事，只是语境不同：

| 术语 | 含义 | 常见语境 |
|------|------|---------|
| **回调（callback）** | "把一个函数传给别人，让别人在合适的时候调用" | 通用编程 |
| **钩子（hook）** | "在流程的某个节点上挂一个回调" | 框架/管线设计 |
| **事件监听器（listener）** | "注册一个函数，当事件发生时被调用" | 事件驱动系统 |

三者的核心是一样的：**把代码的执行权交给别人，别人决定什么时候调用**。

### "注册"是什么？

**注册（register）= 把你的回调函数告诉系统，让系统记住它**。

```typescript
// 注册 = 把函数存到系统里
const toolRegistry = new Map<string, ToolDef>()
toolRegistry.set('set_fill', setFillDef)     // ← 注册一个工具
toolRegistry.set('get_node', getNodeDef)     // ← 注册另一个工具
```

和我们构建时获取 Figma API **不一样**：
- 我们的构建时获取 = **从外部拉取数据**（读 Figma API → 生成 schema）
- 注册 = **向系统里推送代码**（把工具定义/回调存到注册表里）

方向相反：一个是"拉"，一个是"推"。

---

## 2. 工具定义的三要素是通用的吗？

### 是的，这是行业标准

`name + description + parameters` 是所有 LLM function calling 系统的**最小必要结构**：

| 系统 | name | description | parameters |
|------|------|-------------|------------|
| OpenAI Function Calling | ✅ `name` | ✅ `description` | ✅ `parameters` (JSON Schema) |
| Anthropic Tool Use | ✅ `name` | ✅ `description` | ✅ `input_schema` |
| Google Gemini | ✅ `name` | ✅ `description` | ✅ `parameters` |
| Vercel AI SDK `tool()` | ✅ `name` (key) | ✅ `description` | ✅ `inputSchema` |
| OpenPencil `ToolDef` | ✅ `name` | ✅ `description` | ✅ `params` |

**任何 LLM 工具至少需要这三点**。有些系统还有额外字段（如 `strict: true` 强制结构化输出），但三要素是底线。

---

## 3. 为什么 `===` 不能比较对象内容？

### 你的理解需要微调

> "因为实际内容是在内存里的，必定不同"

更准确的说法：**两个不同的对象即使内容完全一样，在内存中也是两个独立的存储位置**。`===` 比较的是"是不是同一个存储位置"（引用），不是"内容是否一样"。

```javascript
// 同一个对象（同一块内存）
const a = { r: 1, g: 0, b: 0 }
const b = a           // b 指向了 a 的内存地址
a === b               // → true（指向同一块内存）

// 两个不同对象（两块内存，内容碰巧一样）
const c = { r: 1, g: 0, b: 0 }
const d = { r: 1, g: 0, b: 0 }
c === d               // → false（两块不同的内存）

// 字符串不一样——字符串是按内容比较的
"hello" === "hello"   // → true（JavaScript 对字符串做了特殊处理）

// 所以：先转字符串，再比
JSON.stringify(c) === JSON.stringify(d)  // → true
```

关键区别：
- **对象**：`===` 比引用（内存地址）
- **字符串/数字/布尔**：`===` 比内容（值）

所以 `JSON.stringify` 的作用就是**把对象变成字符串**，从而可以用 `===` 比内容。

---

## 4. noop 对比时过滤的原因

### 你的理解完全正确

```typescript
if (argKey === 'id') continue
// ↑ 过滤 id：id 是"操作哪个节点"，不是"修改什么属性"
//   比较 id 前后是否变化没有意义——节点的 id 永远不会因为修改属性而改变

if (skipSet?.has(argKey)) continue
// ↑ 过滤某些输入参数：因为参数名 ≠ 节点属性名
//   例如 set_fill({color: "#FF0000"})
//   LLM 传的参数是 "color"
//   但节点上存的属性是 "fills"（一个包含颜色、类型、透明度的数组）
//   color → fills 的转换在 execute 内部完成
//   直接比较 args.color 和 node.color 没有意义
//   所以 SKIP_ARGS 跳过 color，用 ARG_TO_NODE_PROP 映射到 fills 去比较
```

你说的"被应用后的参数"这个理解很到位——参数经过处理后变成了节点属性，两者不是直接对应关系。

---

## 5. "默认行为"具体是什么？

每个可选参数都有自己的默认逻辑：

```typescript
// replace_id 不传 → 不替换，直接创建
if (args.replace_id) {
  // 替换逻辑
}
// 没有 else —— 不传就跳过整个替换流程

// parent_id 不传 → 渲染到当前页面
let parentId = args.parent_id ?? figma.currentPageId
//                              ↑ ?? 是"如果左边是 undefined/null，就用右边的值"

// insert_index 不传 → 追加到父节点末尾（默认行为由 graph.createNode 决定）

// x, y 不传 → 不设置位置，由布局引擎决定
if (options.x !== undefined) graph.updateNode(result.id, { x: options.x })
// ↑ 只有传了才设置。不传就不调用这行代码。
```

**"默认行为"不是一个统一的概念**——每个参数有自己的默认处理方式，写在 execute 函数的条件分支里。

---

## 6. 默认位置和视口的关系

### (0, 0) 是父节点坐标系的原点

```
没有自动布局 + 不传 x/y:
  → 新节点出现在父节点的左上角（坐标 0, 0）

如果父节点是页面根:
  → 出现在页面坐标 (0, 0)，通常是画布的中心区域附近
  → 但 (0, 0) 不等于"视口中央"——视口可以被用户滚动到任何位置

如果父节点是某个 Frame:
  → 出现在 Frame 的左上角内部
```

OpenPencil 没有"默认放在画布中央"的逻辑。render 完成后，如果需要让用户看到新节点，会使用 `viewportZoomToFit` 工具——这是一个独立的步骤，不是 render 自动做的。

---

## 7. 关于节点/属性批量替换的区分

你的反思很好。明确一下：

| 操作 | 什么在变 | 工具 | 批量？ |
|------|---------|------|--------|
| **属性批量修改** | 多个节点的属性值 | `batch_update` | ✅ 支持 |
| **节点替换** | 整个节点被新内容取代 | `render({replace_id})` | ❌ 一次一个 |
| **节点批量创建** | 在一个 JSX 中创建多个节点 | `render` | ✅ 一段 JSX 可以有多个子节点 |

---

## 8. sucrase 处理 JSX 字符串内部的内容

### 对，但更精确地说

sucrase 处理的是 `buildComponent` 拼接出来的**完整 JavaScript 代码**，其中**包含** JSX 字符串：

```typescript
// LLM 传来的 jsx 参数值
const jsxString = '<Frame name="Card"><Text>Hello</Text></Frame>'

// buildComponent 把它拼接进一段 JS 代码
const code = `
  const __h = React.createElement
  const Frame = 'frame', Text = 'text'
  return function Component() { return ${jsxString} }
`
// ↑ 最终代码变成：
// const __h = React.createElement
// const Frame = 'frame', Text = 'text'
// return function Component() {
//   return <Frame name="Card"><Text>Hello</Text></Frame>
// }

// sucrase 把 JSX 语法编译成函数调用
const result = transform(code, { transforms: ['jsx'], jsxPragma: '__h' })
// 编译后：
// return function Component() {
//   return __h('frame', {name:"Card"}, __h('text', null, "Hello"))
// }
```

所以 sucrase 处理的是**整段代码**，其中 JSX 标签（`<Frame>`, `<Text>`）被转换成了 `__h()` 函数调用。字符串 `"Card"`、`"Hello"` 这些普通值不需要编译——它们本来就是合法的 JavaScript。

---

## 9. 支持 Vue 意味着什么？

### 替换管线节点上的代码，步骤数不变

管线步骤结构不变（编译 → 执行 → 创建虚拟树 → 渲染到 SceneGraph），但**每一步的实现都要换**：

| 步骤 | 现在（React JSX） | 如果换成 Vue 模板 |
|------|-------------------|------------------|
| 1. 编译 | sucrase 把 JSX → `createElement()` | 需要 Vue 模板编译器把 `<template>` → `render()` |
| 2. 执行 | new Function 执行编译后代码 | new Function 执行编译后代码（类似） |
| 3. 虚拟树 | mini-react 的 createElement 生成 | 需要 mini-vue 的虚拟 DOM 生成 |
| 4. 渲染 | 遍历 React 虚拟树 → SceneGraph | 遍历 Vue 虚拟树 → SceneGraph（需要适配） |

步骤数不变（4 步），但 4 步中的代码都需要改。所以说"重写渲染管线"——意思是管线的框架保留，里面的实现全换。

---

## 10. `result.childIds` 的类型

### 是 `string[]`（字符串数组）

```typescript
export interface RenderResult {
  id: string          // "0:42"
  name: string        // "Card"
  type: NodeType      // "FRAME"
  childIds: string[]  // ["0:43", "0:44", "0:45"]
}
```

`childIds` 是**扁平的 ID 列表**，不是嵌套对象。每个元素就是一个节点 ID 字符串。

如果 LLM 想知道 `"0:43"` 具体长什么样，需要再调用 `get_node({id: "0:43"})` 获取完整属性。

---

## 11. find_nodes 的 count

### 你的理解基本正确，精确一下

count 不是"某个 key 对应 value 的节点有多少个"——是**满足所有筛选条件的节点总数**：

```typescript
// LLM 调用: find_nodes({name: "Card", type: "FRAME"})

const matches = page.findAll((node) => {
  // 条件 1：名字包含 "Card"（大小写不敏感搜索）
  if (args.name && !node.name.toLowerCase().includes("card")) return false
  // 条件 2：类型是 FRAME
  if (args.type && node.type !== "FRAME") return false
  return true  // 两个条件都满足 → 匹配
})

return {
  count: matches.length,  // 有多少个同时满足两个条件的节点
  nodes: matches.map(n => ({id: n.id, name: n.name, type: n.type}))
}
```

---

## 12. 替换策略在哪里定义？和 renderJSX 的解耦

### renderJSX 本身不管替换

renderJSX 只做一件事：**JSX → 节点**。它不知道也不关心"要不要替换旧节点"。

替换策略定义在**调用 renderJSX 的工具代码**里：

```typescript
// render 工具的 execute（替换策略 A）
const result = await renderJSX(graph, args.jsx, { parentId })
// ↑ renderJSX 只管创建，返回新节点
if (args.replace_id && replaceIndex >= 0) {
  graph.reorderChild(result.id, parentId, replaceIndex)  // ← 策略 A：先移位
  graph.deleteNode(args.replace_id)                       // ← 然后删旧
}

// node_replace_with 工具的 execute（替换策略 B）
node.remove()                                             // ← 策略 B：先删旧
const result = await renderJSX(graph, args.jsx, { parentId, x, y })  // ← 然后创建
```

**这就是解耦**——renderJSX 是纯粹的"创建引擎"，替换逻辑抽离到上层工具。不同工具可以用不同的替换策略，但共用同一个渲染引擎。

如果没有解耦，renderJSX 内部需要 `if (mode === 'replace_order') {...} else if (mode === 'replace_position') {...}`——逻辑膨胀，职责不单一。

---

## 13. LLM 的"解析"是什么意思？

### 不是 transformer 内部计算

这里的"解析"是**更宏观的含义**——LLM 需要理解返回值的结构，从中提取有用信息。

```json
// 扁平返回（OpenPencil）
{ "error": "Node '0:5' not found" }
// LLM 看到一个字符串，直接理解"失败了，原因是节点没找到"
// 不需要知道这是"什么类型的错误"

// 嵌套返回（我们旧的）
{ "error": { "code": "NOT_FOUND", "message": "Node '0:5' not found" } }
// LLM 需要理解这是一个嵌套对象
// 需要区分 code 和 message 的含义
// 需要判断"NOT_FOUND 是什么意思"
```

"解析"在这里指的是：**LLM 在生成下一步回复时，需要从返回值中理解信息，嵌套越深、字段越多，LLM 需要处理的信息越多**。

这不是说 LLM 内部有一个"JSON parser"——而是说嵌套结构增加了 LLM 的认知负担（更多 token 要处理、更多结构要理解）。扁平的一个字符串，LLM 读了就懂。嵌套的，LLM 需要理解 `error.code` 和 `error.message` 的区别。

### 已落地（2026-03-31）

这个设计已在我们的代码库中实现。核心改动：

**类型层**：`ToolResponse.error` 从 `{ code: string; message: string }` → `string`

```typescript
// 之前（types.ts）
export interface ToolResponse<T = any> {
  data?: T;
  error?: { code: string; message: string; details?: any };
}

// 之后
export interface ToolResponse<T = any> {
  data?: T;
  error?: string;   // 扁平字符串，OpenPencil 约定
}
```

**生产者侧**：~80 处 handler 全部扁平化

```typescript
// 之前（compHandlers.ts 等）
return { error: { code: 'NOT_A_FRAME', message: `"${node.name}" is not a frame.` } }

// 之后
return { error: `"${node.name}" is not a frame.` }
```

**消费者侧**：5 个读取 `error.code` 的位置全部迁移

| 消费者 | 旧方式 | 新方式 |
|--------|--------|--------|
| `exitCode.ts` | `NOT_FOUND_CODES.has(error.code)` → exit:127 | **已删除**。exit code 系统整体移除 |
| `partialFailureGuard.ts` | `error.code === 'PARTIAL_FAILURE'` | `Array.isArray(data?.errors)` — 用结构特征替代 |
| `contextSummarizer.ts` | `error.code` 提取 | 直接用 error 字符串 + `data.errors` 存在性 |
| `toolDispatcher.ts` | `error?.message \|\| error?.code` | 直接取 `error`（已是字符串） |
| `agentRuntime.ts` | `typeof error === 'string' ? error : error.message` | 直接取 `error` |

**exit code 删除**：`_meta` 从 `[exit:0 | 43ms]` 简化为 `[43ms]`

```typescript
// 之前（presentation.ts）
const exitCode = computeExitCode(result);
cleaned._meta = formatMeta(exitCode, durationMs);  // → "[exit:0 | 43ms]"

// 之后
cleaned._meta = `[${formatTiming(durationMs)}]`;    // → "[43ms]"
```

error 存在/不存在本身就是成功/失败的唯一信号，exit code 是冗余信息。

**E2E 验证**（dev bridge SSE，DashScope provider）：

```json
// 成功的 jsx 调用
{ "data": { "id": "1375:43482", "name": "Login Card", ... } }

// 失败的 render 调用（工具不存在）
{ "error": "Unknown tool \"render\"." }
```

无嵌套 error 对象泄漏，LLM 看到的是纯字符串。

---

## 14. "同层"的代码表示

```typescript
// OpenPencil 的"同层"设计：成功和失败用同一种结构
// LLM 看到一个对象，检查有没有 error 字段

// 成功时：
return { id: "0:5", color: { r: 1, g: 0, b: 0 } }
//       ↑ 直接返回结果对象，没有 error 字段

// 失败时：
return { error: "Node '0:5' not found" }
//       ↑ 同样是一个对象，只有 error 字段

// LLM 的判断逻辑（隐式的）：
// "返回值里有 error 字段吗？"
//   有 → 失败了，error 的值告诉我原因
//   没有 → 成功了，整个对象就是结果

// ──────────────────────────────────────────
// 我们旧的"嵌套"设计：成功和失败的结构不同

// 成功时：
return { result: { id: "0:5", ... } }

// 失败时：
return { error: { code: "NOT_FOUND", message: "Node not found" } }

// 嵌套多了一层：result.xxx 或 error.code + error.message
```

"同层"的意思是：**error 和正常数据字段在同一个 JSON 层级上**，不需要先判断"是 result 还是 error"再深入一层去取值。

### 已落地（2026-03-31）

`presentForLLM`（LLM 看到的最终格式）已完全对齐 OpenPencil 的同层设计：

```typescript
// presentForLLM 输出 — 成功时（data 展开到顶层）
{ id: "1375:43482", name: "Login Card", type: "frame",
  children: ["Header#1375:43483", "Fields#1375:43486"],
  _meta: "[43ms]" }

// presentForLLM 输出 — 失败时（error 也在顶层）
{ error: "Unknown tool \"render\".", _meta: "[0ms]" }
```

**内部仍保留 `data` wrapper**：`ToolResponse` 类型里成功结果放在 `data` 字段中（`{ data: { id, name, ... } }`），`presentForLLM` 负责把 `data` 的字段展开到顶层。这是合理的分层——内部 `data` wrapper 方便 `KEEP_FIELDS` 做 noise stripping 和 `extractStderr` 从 `data.errors`/`data.warnings` 提取 stderr，而 LLM 不需要知道这层包装的存在。

如果未来要彻底消除 `data` wrapper（让 handler 直接返回顶层字段），那是另一个重构，涉及所有 handler 的返回格式。当前 LLM 侧已完全对齐。

---

## 本文档变更记录

| 日期 | 变更 |
|------|------|
| 2026-03-30 | 创建。回答第三轮 Q&A：回调/钩子概念、工具定义三要素、=== 引用比较、默认行为、坐标系统、替换策略解耦、LLM 解析含义、同层错误设计 |
| 2026-03-31 | §13、§14 补充"已落地"小节：error 扁平化实现细节、exit code 删除、E2E 验证结果、内部 data wrapper 说明。增加目录索引和已落地改动索引 |
