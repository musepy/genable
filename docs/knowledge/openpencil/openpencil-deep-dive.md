# OpenPencil 工具实现深度剖析（Q&A 版）

> Source: `packages/core/src/tools/` @ [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil)
> Date: 2026-03-30
> Parent: [OpenPencil 工具架构总览](openpencil-tool-architecture.md)
> Follow-up (2026-04-21): [DSL 词汇迁移计划](vocabulary-migration-plan.md) — 基于最新 open-pencil v0.11 仓库对照，修正"我们在 Figma API CamelCase 象限"的误判，给出 Wave 1 / Wave 2 迁移清单

---

## 术语表

| 术语 | 英文 | 含义 |
|------|------|------|
| param | parameter | **参数**，调用函数时传入的值 |
| ParamDef | Parameter Definition | **参数定义**，描述一个参数「长什么样」：类型、是否必填、默认值、约束 |
| interface | - | **接口**，TypeScript 的类型声明方式。定义对象「应该有哪些字段」，是"契约/规格"，不是"展示/界面" |
| args | arguments | **实际参数**，函数被调用时传进来的真实值（param 是定义时的占位名，args 是调用时的真实值） |
| Record | - | TypeScript 类型表示法，`Record<string, ParamDef>` = "key 为字符串、value 为 ParamDef 的对象" |
| valibot | - | 参数验证库，用于验证 LLM 输出的 JSON 参数是否合法（和 zod 功能类似） |
| FigmaNodeProxy | - | OpenPencil 模拟 Figma 节点的代理对象，属性名和 Figma Plugin API 一致 |
| mutates | - | ToolDef 上的一个**字段**（不是参数），标记该工具"会修改画布" |
| noop | no operation | **无效操作**，工具执行了但画布没有任何变化 |
| enum | enumeration | **枚举**，限制参数只能在预定义的几个值中选择 |

---

## 一、AI Adapter：管理 LLM 输出的中间层

### ai-adapter 具体能管什么？

`ai-adapter.ts` 是**工具定义（ToolDef）和 Vercel AI SDK 之间的桥梁**。它把工具定义转成 LLM 能看到的 schema，同时在每次工具执行前后做增值处理。

它做的事情：

```
LLM 输出 JSON → Vercel AI SDK 解析 → ai-adapter 包装层 → 工具的 execute 函数

包装层做了什么：
  1. 执行前：如果 mutates === true，拍一张节点快照（nodeBefore）
  2. 调用 onBeforeExecute 钩子
  3. 执行工具的 execute 函数
  4. 执行后：
     a. 如果 mutates === true，从返回值中提取新建/修改的节点 ID
     b. 调用 onFlashNodes(ids) —— 让 UI 闪烁高亮这些节点
     c. 再拍一张节点快照（nodeAfter），和 nodeBefore 对比
     d. 如果前后没变化 → 标记为 noop
     e. 计算剩余步数，如果快用完 → 在返回值中注入 _warning
     f. 调用 onToolLog 记录日志
  5. 如果 execute 抛异常 → catch 并返回 { error: errorMsg }
  6. 调用 onAfterExecute 钩子
```

### mutates 是参数还是字段？

**是 ToolDef 上的字段**，属于工具的元数据定义，不是 LLM 传的参数：

```typescript
interface ToolDef {
  name: string           // 字段
  description: string    // 字段
  mutates?: boolean      // ← 这是字段，工具开发者在定义时写死
  params: Record<...>    // 字段
  execute: Function       // 字段
}
```

LLM **看不到** `mutates`，它只存在于后端。ai-adapter 根据 `mutates` 决定是否做前后快照。

### adapter 还能根据哪些字段做出行动？

| 字段 | adapter 的行为 |
|------|---------------|
| `mutates: true` | 做前后快照 → 检测 noop → 闪烁节点 → 只对 mutating 工具标记重复 |
| `def.name === 'export_image'` | 特殊处理：把 base64 图片转成 Vercel AI SDK 的 media content 格式 |
| `params` | 转成 valibot schema → 转成 JSON Schema → 作为 function definition 发给 LLM |
| `description` | 直接传给 Vercel AI SDK 的 `tool()` —— LLM 看到的工具描述 |

### 谁来决定 schema 哪些能被 LLM 看到？

**`params` 中定义的所有参数都会被 LLM 看到**。`paramToValibot` 把每个 ParamDef 转成 valibot schema，Vercel AI SDK 再转成 JSON Schema 发给 LLM。没有隐藏机制。

LLM 能看到的：`name`, `description`, 以及所有 `params` 的类型/描述/enum 列表。

LLM **看不到**的：`mutates`, `execute` 函数体, `min/max` 约束（valibot 用于验证但不一定反映在 JSON Schema 中）。

---

## 二、noop 检测：什么是无效修改？

### noop 的含义

noop = "no operation"，指**工具执行了，没报错，但画布上什么都没变**。

例如：LLM 调用 `set_fill({id: "0:5", color: "#FF0000"})`，但节点 "0:5" 的填充本来就是 `#FF0000`，所以实际上什么都没变。

### 检测逻辑代码

```typescript
function detectUnchangedProps(
  toolName: string,
  args: Record<string, unknown>,
  before: Record<string, unknown>,   // 执行前快照
  after: Record<string, unknown>     // 执行后快照
): string[] {
  const unchanged: string[] = []

  for (const [argKey, argVal] of Object.entries(args)) {
    if (argKey === 'id' || argVal === undefined) continue   // 跳过 id 参数
    if (skipSet?.has(argKey)) continue                       // 跳过某些工具的特殊参数

    // 把工具参数名映射到节点属性名
    // 例如 args.color → node.fills, args.corner_radius → node.cornerRadius
    const nodeProp = ARG_TO_NODE_PROP[argKey] ?? argKey

    const beforeVal = before[nodeProp]
    const afterVal = after[nodeProp]

    // 用 JSON.stringify 对比前后值
    if (beforeVal !== undefined && afterVal !== undefined) {
      if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) {
        unchanged.push(nodeProp)  // 这个属性没变 → noop
      }
    }
  }
  return unchanged
}
```

规则：
1. 只在 `mutates: true` 的工具上检测
2. 在 execute **之前**用 `structuredClone(node)` 拍快照
3. 在 execute **之后**再拍一次快照
4. 对比每个被修改的属性是否前后相同
5. 相同的属性名列入 `unchangedProps`

### 重复调用检测

**只是记录，不干涉 LLM，也不反馈给 LLM**。逻辑：

```typescript
// buildDebugLog 中
const key = `${entry.tool}:${JSON.stringify(entry.args)}`  // 相同工具+相同参数 = 重复
const existing = callCounts.get(key)
if (existing) {
  existing.count++
  if (entry.mutates) entry.isDuplicate = true  // 标记为重复
}
```

重复检测的结果存在 `ToolDebugLog.duplicates` 中，是**开发者调试用**的。LLM 永远不知道自己重复调用了。

---

## 三、render 工具代码逐行解读

### 定义结构

```typescript
export const render = defineTool({
  name: 'render',              // LLM 看到的工具名
  mutates: true,               // 会修改画布
  description: 'Render JSX...', // LLM 看到的描述
  params: {
    jsx: { type: 'string', description: '...', required: true },
    // ↑ jsx 是 string 类型，必须传。LLM 传一段 JSX 字符串
    replace_id: { type: 'string', description: '...' },
    // ↑ 可选。如果传了，新节点会替换这个 ID 对应的旧节点
    parent_id: { type: 'string', description: '...' },
    // ↑ 可选。渲染到哪个父节点下
    insert_index: { type: 'number', description: '...' },
    // ↑ 可选。在兄弟节点中的位置
    x: { type: 'number', description: 'X position of the root node' },
    y: { type: 'number', description: 'Y position of the root node' },
    // ↑ x, y 是root节点的位置
  },
```

### x, y 是相对于根节点吗？必须渲染到根节点？

**不是**。x, y 是根节点在其父节点坐标系中的位置。`parent_id` 可以是任何节点，不一定是页面根。

如果不传 `parent_id`，默认是当前页面（`figma.currentPageId`）。

```typescript
let parentId = args.parent_id ?? figma.currentPageId
// 如果没传 parent_id → 渲染到当前页面下
// 如果传了 → 渲染到指定节点下
```

### execute 逐行解读

```typescript
execute: async (figma, args) => {
    // figma = FigmaAPI 实例（OpenPencil 的虚拟 Figma 环境）
    // args = LLM 传来的实际参数值（已被 valibot 验证）

    const { renderJSX } = await import('../render/render.js')
    // ↑ 动态导入渲染器。render.js 就是下面发现的用 sucrase 编译 JSX 的文件

    let parentId = args.parent_id ?? figma.currentPageId
    // ↑ 确定父节点：传了就用，没传就用当前页面

    let replaceIndex = -1

    if (args.replace_id) {
      // ↑ 如果 LLM 传了 replace_id
      const target = figma.graph.getNode(args.replace_id)
      // ↑ 找到旧节点
      if (target?.parentId) {
        parentId = target.parentId
        // ↑ 父节点改为旧节点的父节点（保持位置）
        const parent = figma.graph.getNode(parentId)
        if (parent) {
          replaceIndex = parent.childIds.indexOf(args.replace_id)
          // ↑ 记录旧节点在兄弟中的位置（第几个子节点）
        }
      }
    }

    const result = await renderJSX(figma.graph, args.jsx, {
      parentId, x: args.x, y: args.y
    })
    // ↑ 核心调用：把 JSX 字符串渲染成节点，挂到 parentId 下
    // renderJSX 内部用 sucrase 编译 JSX → 执行代码 → 创建节点

    if (args.replace_id && replaceIndex >= 0) {
      figma.graph.reorderChild(result.id, parentId, replaceIndex)
      // ↑ 把新节点移到旧节点的位置
      figma.graph.deleteNode(args.replace_id)
      // ↑ 删除旧节点
    } else if (args.insert_index !== undefined) {
      figma.graph.reorderChild(result.id, parentId, args.insert_index)
      // ↑ 按指定位置插入
    }

    return { id: result.id, name: result.name, type: result.type, children: result.childIds }
    // ↑ 返回新节点的摘要信息
}
```

### render 返回的 id 是怎么来的？和 mutates 有关吗？

id 来自 `renderJSX` 创建节点时 SceneGraph 自动分配的。和 `mutates` 无关——`mutates` 只影响 ai-adapter 的 debug 行为（是否做快照），不影响 execute 内部逻辑。

### replace_id 是 string 还是 string[]？

**是 `string`**，只能替换一个节点。不是 `string[]`。

```typescript
replace_id: { type: 'string', description: 'Node ID to replace...' }
```

一步替换的实现逻辑：
1. 找到旧节点，记住它的父节点和位置
2. 渲染新 JSX 生成新节点（默认追加到父节点末尾）
3. 把新节点移到旧节点的位置
4. 删除旧节点

### renderJSX 内部：sucrase 编译（和我们一样！）

```typescript
// render/render.ts
import { transform } from 'sucrase'  // ← 和我们的 templateCompiler 一样用 sucrase！

export function buildComponent(jsxString: string): () => unknown {
  const code = `
    const __h = React.createElement
    const Frame = 'frame', Text = 'text', Rectangle = 'rectangle', ...
    // ↑ 预定义 JSX 标签名
    return function Component() { return ${jsxString.trim()} }
  `
  // sucrase 编译 JSX → 调用 __h (即 React.createElement)
  const result = transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxPragma: '__h',
    production: true
  })

  // 用 new Function 执行编译后的代码 —— 这就是代码执行
  return new Function('React', result.code)(React)
}
```

所以 render 的完整流程：
1. LLM 输出 JSX 字符串
2. **sucrase 编译** JSX 为 JS 函数调用
3. **new Function 执行**编译后的代码
4. 生成虚拟 DOM 树（mini-react）
5. 遍历虚拟树，对每个节点调用 `graph.createNode()` 创建真正的 SceneGraph 节点
6. 返回根节点 ID

---

## 四、render 的 JSX 属性 vs batch_update 的属性

### render 支持的 JSX 属性（从 renderer.ts 提取）

**创建时可写的属性**——比 batch_update 多得多：

| 类别 | JSX 属性 | 说明 |
|------|----------|------|
| **尺寸** | `w`, `width`, `h`, `height` | 支持数字、`"fill"`、`"hug"` |
| **位置** | `x`, `y` | 坐标 |
| **名字** | `name` | 图层名 |
| **布局方向** | `flex="col"` / `flex="row"` | 自动布局方向 |
| **间距** | `gap` | 子节点间距 |
| **对齐** | `justify`, `items` | 主轴/交叉轴对齐 |
| **内边距** | `p`, `padding`, `px`, `py`, `pt`, `pr`, `pb`, `pl` | 丰富的快捷写法 |
| **填充** | `bg`, `fill` | 背景色 |
| **描边** | `stroke`, `strokeWidth` | 边框 |
| **圆角** | `rounded`, `cornerRadius`, `roundedTL/TR/BL/BR` | 独立四角 |
| **透明度** | `opacity` | |
| **旋转** | `rotate` | |
| **混合** | `blendMode` | |
| **裁切** | `overflow="hidden"` | |
| **阴影** | `shadow="0 4 8 #00000040"` | CSS-like 语法 |
| **模糊** | `blur` | |
| **文字** | `size`, `font`, `weight`, `color`, `lineHeight`, `letterSpacing`, `textAlign`, `textDecoration` | |
| **Grid** | `grid`, `columns`, `rows`, `columnGap`, `rowGap`, `colStart`, `rowStart`, `colSpan`, `rowSpan` | |
| **子节点行为** | `grow` | flex-grow |

### batch_update 只支持 15 种

和 render 比，batch_update 只是一个**子集**：

```
batch_update 能改的 ⊂ render 能设的
```

但两者**不完全一致**。比如：
- render 没有 `auto_resize`（文本专用），batch_update 有
- render 用 `flex="col"` 表示方向，batch_update 用 `direction: "VERTICAL"`
- render 的属性名是**简短友好的**（`bg`, `p`, `gap`），batch_update 的属性名是**接近 Figma API 的**（`spacing`, `padding`, `counter_align`）

**render 是给创建用的（声明式），batch_update 是给修改用的（命令式）**。

---

## 五、LLM 调用 setter 的完整流程

### LLM 必须输出什么？

Vercel AI SDK 的 function calling 格式（和 OpenAI 相同）：

```json
{
  "tool": "set_fill",
  "args": {
    "id": "0:5",
    "color": "#FF0000"
  }
}
```

这不是 LLM 手打明文——是 LLM 在特定格式化模式下输出的结构化 JSON。Vercel AI SDK 负责解析和验证。

### set_fill 是 LLM 能看到的吗？

**是的**。ai-adapter 把所有注册的 CORE_TOOLS 都转成了 function definition 发给 LLM。LLM 在对话开始时看到一个工具列表，其中包括 `set_fill` 的名字、描述和参数 schema。

### 我们和 OpenPencil 的 setter 有什么不同？

| 维度 | OpenPencil setter | 我们的 edit |
|------|-------------------|-----------|
| 工具粒度 | 20+ 个 setter，每个管一类属性 | 1 个 edit，管所有属性 |
| LLM 输出 | `set_fill({id, color})` — 选工具 + JSON 参数 | `edit({id, props})` — 一个工具 + props 对象 |
| 参数验证 | 每个 setter 有独立的 valibot schema + enum 约束 | 我们构建时从 Figma 获取 API 参数 |
| 属性来源 | **硬编码**在各 setter 的 params 中 | **构建时动态获取**（声明式） |
| 错误隔离 | set_fill 错了不影响 set_layout | 一个 edit 里多个属性错了可能全部失败 |

---

## 六、update_node 的 13 个参数来源

### 硬编码的吗？来源于哪里？

**是硬编码的**。直接写在 `modify.ts` 的 `updateNode` 工具定义中：

```typescript
params: {
  id: { type: 'string', required: true },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number', min: 1 },
  height: { type: 'number', min: 1 },
  opacity: { type: 'number', min: 0, max: 1 },
  corner_radius: { type: 'number', min: 0 },
  visible: { type: 'boolean' },
  text: { type: 'string' },
  text_direction: { type: 'string', enum: ['AUTO', 'LTR', 'RTL'] },
  flow_direction: { type: 'string', enum: ['AUTO', 'LTR', 'RTL'] },
  font_size: { type: 'number', min: 1 },
  font_weight: { type: 'number' },
  name: { type: 'string' },
}
```

### 为什么是这个范围？

这 13 个是 OpenPencil 开发者认为"最常需要一次改多个"的属性。更专业的属性（填充、描边、布局、effects）有独立 setter。

### 需要像我们那样从 Figma 动态获取吗？

不需要——因为 OpenPencil 有自己的 SceneGraph 实现（`FigmaNodeProxy`），属性都是它自己定义的，不会变。而我们是对接真正的 Figma Plugin API，API 可能随 Figma 版本更新而变化，所以动态获取更合理。

**这是两者架构差异导致的**：OpenPencil 控制自己的 API → 可以硬编码。我们依赖外部 API → 需要声明式/动态获取。

---

## 七、setter 读回生效值 = Figma 画布的实际值

**完全正确**。你的理解是对的：

```
你在 Figma 设圆角 999px → Figma 计算后受限于布局 → 实际 25px
setter 返回 node.cornerRadius 读到的是 25，不是 999
```

这仅限于少数属性——大部分属性设什么就是什么，不会被引擎修正。

---

## 八、错误返回 + Debug 信息

### 工具层的错误返回

只有一个字段 `{ error: string }`，没有更多了。

### ai-adapter 层的 ToolLogEntry

```typescript
interface ToolLogEntry {
  tool: string                        // 工具名
  args: Record<string, unknown>       // LLM 传的参数
  result: unknown                     // 工具返回值
  error?: string                      // 错误消息
  timestamp: number                   // 开始时间戳
  durationMs: number                  // 执行耗时（毫秒）
  mutates: boolean                    // 是否修改画布

  // 以下仅 mutates === true 时有值
  nodeBefore?: Record<string, unknown>   // 修改前的完整节点属性快照
  nodeAfter?: Record<string, unknown>    // 修改后的完整节点属性快照
  unchangedProps?: string[]              // 前后没变的属性名(即 noop 属性)
  isDuplicate?: boolean                  // 是否和之前的调用完全相同
}
```

### nodeBefore / nodeAfter 是什么？是 diff 吗？

**不是 diff**。是完整的节点属性**快照**——`structuredClone(node)` 深拷贝的整个节点对象。

```typescript
function captureNodeSnapshot(figma, args) {
  const targetId = args.id
  const raw = figma.graph.getNode(targetId)
  return structuredClone(raw)  // ← 深拷贝整个节点的所有属性
}
```

然后 `detectUnchangedProps` 去对比 before 和 after 中各个属性是否变化。

### 记录在哪里？存多少？

存在内存中的 `ToolLogEntry[]` 数组里。`buildDebugLog(entries)` 汇总后产出 `ToolDebugLog` 对象。

Open Pencil 代码中没有看到日志大小限制或持久化逻辑——是**会话级**的内存记录，会话结束就没了。

### 只记录 mutates 为真的内容吗？

**所有工具调用都记录**（每次 execute 都会调用 `emitToolLog`）。但**前后快照只在 mutates === true 时拍**：

```typescript
const nodeBefore = def.mutates && options.onToolLog
  ? captureNodeSnapshot(figma, args)   // 只有 mutates 才拍
  : undefined
```

读工具（get_node, find_nodes 等）的日志也记录，但 nodeBefore/nodeAfter/unchangedProps 都是 undefined。

---

## 九、depth 参数如何工作

### LLM 怎么决定传多少？

靠 description 提示：

```typescript
depth: {
  type: 'number',
  description: 'Max depth of children to include (0 = no children). Default: unlimited'
}
```

LLM 根据需要选择：
- 只看节点本身 → `depth: 0`
- 看一层子节点 → `depth: 1`
- 看完整子树 → 不传（默认无限）

### find_nodes 的 count 怎么来的？

```typescript
execute: (figma, args) => {
  const matches = page.findAll((node) => {
    if (args.type && node.type !== args.type) return false
    if (args.name && !node.name.toLowerCase().includes(args.name.toLowerCase())) return false
    // ↑ 名字匹配是大小写不敏感的（toLowerCase）
    return true
  })
  return { count: matches.length, nodes: matches.map(nodeSummary) }
  //        ↑ count = 匹配到的节点数量
}
```

`count` 就是 `matches.length` —— 筛选后的结果数组长度。

### enum 是什么？

`enum` = **枚举**，限制参数只能是预定义的几个值：

```typescript
type: {
  type: 'string',
  enum: ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE', ...]
}
```

如果 LLM 输出 `type: "CIRCLE"`（不在 enum 中），valibot 会拒绝这个调用。

---

## 十、工具组合使用

### 一次调用可以组合用吗？

**不能在一次 function call 中调用多个工具**。LLM 每次只能调用一个工具。但在一个对话轮次中，LLM 可以**连续发起多个工具调用**：

```
LLM 第 1 次调用: find_nodes({name: "Card"})
  → 返回 [{id: "0:5", name: "Card", type: "FRAME"}]

LLM 第 2 次调用: set_fill({id: "0:5", color: "#FF0000"})
  → 返回 {id: "0:5", color: {r:1, g:0, b:0}}

LLM 第 3 次调用: describe({id: "0:5"})
  → 返回 lint 检查结果
```

这就是工具组合使用的方式——**多轮连续调用**，每次一个工具。

例外：Vercel AI SDK 支持 `parallel tool calls`（LLM 一次输出多个工具调用），但 OpenPencil 的代码中没有显式限制或启用这个功能。

---

## 十一、Vercel AI SDK 集成细节

### toolsToAI 和 tool() 分别是什么？

```
toolsToAI(工具定义数组, 选项, 依赖)
  │
  ├─ 输入：ToolDef[] —— OpenPencil 的工具定义
  │
  └─ 输出：Record<string, tool()> —— Vercel AI SDK 的工具对象
                                        │
                                        └─ 每个 tool() 包含：
                                             description: 给 LLM 看的描述
                                             inputSchema: valibot schema → JSON Schema
                                             execute: 包装后的执行函数
```

不是 "LLM 输出 tool() 对象"。tool() 是 SDK 侧的工具定义格式，**发给 LLM 之前**就转好了。LLM 看到的是 JSON Schema 格式的函数描述。

### valibot 和我们构建时从 Figma 获取的 API 参数类似吗？

**目的相同**——都是约束参数类型/范围。但来源不同：

| | OpenPencil | 我们 |
|---|---------|------|
| 参数约束来源 | 开发者硬编码在 ParamDef 中 | 构建时从 Figma API 动态提取 |
| 验证方式 | valibot（运行时验证 LLM 输出） | 构建时生成 schema |
| 时机 | LLM 每次调用工具时验证 | 构建时固化 |

---

## 十二、剩余步数

### 达到上限会怎样？

**只是警告，不会阻止**。当剩余步数 ≤ 5 时，在工具返回值里注入 `_warning`：

```typescript
const STEP_WARNING_THRESHOLD = 5

function appendStepWarning(result, budget) {
  const remaining = budget.max - budget.current
  if (remaining > STEP_WARNING_THRESHOLD) return result  // 还有很多步 → 不警告
  const warning = `⚠ ${remaining} steps remaining out of ${budget.max}. Wrap up...`
  return { ...result, _warning: warning }
}
```

步数上限本身由外部管理（`getStepBudget()` 回调），adapter 只负责注入警告。达到上限后是 Vercel AI SDK 的 `maxSteps` 或调用方决定是否停止——不是 adapter 阻止的。

---

## 十三、节点闪烁

### 什么意思？

当 LLM 修改了一个节点（比如改了填充颜色），adapter 调用 `onFlashNodes(["0:5"])`。这是一个回调钩子——OpenPencil 的 UI 层会短暂地高亮/闪烁这个节点，让用户看到"哪个节点被修改了"。

具体 UI 实现不在 tools 包里，在 OpenPencil 的前端渲染层（`packages/web`）。从代码看，`onFlashNodes` 只是传递节点 ID 给 UI 层，具体的闪烁动画由 UI 层实现。

```typescript
if (def.mutates && options.onFlashNodes) {
  const ids = extractNodeIds(execResult)
  // ↑ 从返回值中提取节点 ID（如果返回 {id: "0:5"} 则提取 "0:5"）
  // 如果返回 {deleted: "0:5"} 则不提取（已删除的节点无法高亮）
  if (ids.length > 0) options.onFlashNodes(ids)
}
```

---

## 十四、替换节点的工具有多少？

OpenPencil 有**两个**替换相关的工具：

1. **`render({replace_id})`** — 用新 JSX 替换旧节点。适用于"重新渲染整个子树"的场景。
2. **`node_replace_with({id, jsx})`** — structure.ts 中的独立工具，也是用 JSX 替换旧节点。

```typescript
// structure.ts
export const nodeReplaceWith = defineTool({
  name: 'node_replace_with',
  mutates: true,
  description: 'Replace a node with JSX content.',
  params: {
    id: { type: 'string', description: 'Node ID to replace', required: true },
    jsx: { type: 'string', description: 'JSX string for the replacement', required: true }
  },
  execute: async (figma, args) => {
    const node = figma.getNodeById(args.id)
    const parentId = node.parent?.id ?? figma.currentPageId
    const x = node.x;  const y = node.y
    node.remove()                             // 先删旧节点
    const { renderJSX } = await import('../render/render.js')
    const result = await renderJSX(figma.graph, args.jsx, { parentId, x, y })
    // ↑ 在旧节点的位置渲染新 JSX
    return { id: result.id, name: result.name, type: result.type }
  }
})
```

区别：
- `render({replace_id})` 保持在兄弟节点中的**位置顺序**（先渲染再删）
- `node_replace_with` 只保持 x, y **坐标**（先删再渲染）

---

## 十五、与我们系统的关键差异

### 我们的数据流有很多步

没错，对比：

```
OpenPencil (同一进程，4步):
  LLM JSON args → valibot 验证 → execute(figma, args) → JSON 回执

我们 (跨进程，7+步):
  LLM JSON args → toolDispatcher → ipcBridge emit → [Figma进程 IPC 接收]
  → toolCallHandler → commandParser CLI解析 → handleXxx → figma.xxx()
  → [IPC 回传] → result string
```

### OpenPencil 除了 render 都是纯 JSON 工具调用？

**是的**。只有 `render`, `node_replace_with`, `get_jsx`, `diff_jsx`, `evalCode` 涉及代码/JSX。其他 85+ 个工具都是纯 JSON 参数 → 直接调 FigmaNodeProxy 属性 → JSON 返回值。不需要 CLI 字符串解析。

### 我为什么之前称你们的 jsx 为"模板编译"？

这是我的表述不够准确。实际上我们的 jsx 工具和 OpenPencil 的 render **都用 sucrase 编译 JSX**——本质是同一个技术。"模板编译"不准确，应该叫"JSX 编译+执行"。

### 我们的错误表达多了一层嵌套吗？

是的。我们的 `ToolResponse` 有嵌套：

```typescript
// 我们的错误格式
{
  error: {
    code: 'TIMEOUT',
    message: 'Tool call timed out after 30000ms'
  }
}
```

OpenPencil 的错误是扁平的：
```typescript
{ error: 'Node "0:5" not found' }
```

### 我们的 loop 检测和它们的 debug 一致吗？

不一致。我们的**没有** noop 检测（"执行了但没变"）和重复调用检测。OpenPencil 的 `ToolDebugLog` 是一套完整的事后分析系统，包含 noop 检测、重复检测、总字节数统计——这些我们目前都没有。

---

## 十六、CORE_TOOLS 够我们参考吗？

**够了**。CORE_TOOLS 22 个工具覆盖了 90%+ 的日常设计操作：

- 读取（4个）：get_selection, get_node, find_nodes, get_jsx
- 创建（1个）：render
- 修改（8个）：updateNode, setLayout, setLayoutChild, setRadius, setFill, setStroke, setText, setTextProperties
- 结构（3个）：deleteNode, reparentNode, nodeResize
- 批量（1个）：batchUpdate
- 工具（5个）：stockPhoto, describe, calc, evalCode, viewportZoomToFit

EXTENDED_TOOLS 里的 69 个大多是**低频操作**（变量管理、布尔运算、SVG 导出）或**CORE 的细化版本**（set_font 是 setText 的拆分）。

对于我们的重构，**CORE_TOOLS 的工具分类和粒度**是最有参考价值的：
- 一个 render（创建）
- 多个细粒度 setter（修改）
- 独立的结构操作工具
- describe 作为验证闭环
