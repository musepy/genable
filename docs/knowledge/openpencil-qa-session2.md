# OpenPencil 深度 Q&A（第二轮）

> Date: 2026-03-30
> Parent: [OpenPencil 深度剖析](openpencil-deep-dive.md)
> Index: [工具架构重构计划](tool-refactoring-index.md)

---

## 一、"前端"和"后端"在这个语境里的含义

### 这里不是网页开发的"前端/后端"

在 web 开发中，前端 = 浏览器，后端 = 服务器。但在 LLM 工具调用的语境中：

| 术语 | 含义 | 谁能看到 |
|------|------|---------|
| **前端（LLM 侧）** | 发送给 LLM 的信息——工具名、描述、参数 schema | LLM 看到 |
| **后端（系统侧）** | 系统内部的元数据和逻辑——mutates 字段、execute 函数体、adapter 逻辑 | LLM 看不到 |

```
                 ┌─────────────────────────────────────┐
                 │  LLM 能看到的（"前端"）              │
                 │                                     │
                 │  name: "set_fill"                   │
                 │  description: "Set fill color..."   │
                 │  parameters: {                      │
                 │    id: { type: "string" },           │
                 │    color: { type: "string" }         │
                 │  }                                   │
                 └──────────────┬──────────────────────┘
                                │
            ╔═══════════════════╧═══════════════════════╗
            ║  LLM 看不到的（"后端"）                    ║
            ║                                           ║
            ║  mutates: true                            ║
            ║  execute: (figma, args) => { ... }        ║
            ║  ai-adapter 的包装逻辑                     ║
            ║  nodeBefore / nodeAfter 快照               ║
            ║  noop 检测 / 重复检测                      ║
            ╚═══════════════════════════════════════════╝
```

所以：**ai-adapter 是系统侧（后端）的中间件**。它在 execute 前后做增值处理，但 LLM 完全不知道它的存在。

---

## 二、noop 在哪里定义的？

### noop 不是代码中的关键字或变量名

你说得对——**noop 不是像 `string`、`boolean` 那样的语言原语**。它是 OpenPencil 开发者**自定义的概念**，体现在代码里的方式是：

```typescript
// ai-adapter.ts - 第一处出现
interface ToolDebugLog {
  entries: ToolLogEntry[]
  duplicates: Array<...>
  noopMutations: ToolLogEntry[]    // ← 这里！"noop mutation" 是自定义术语
  totalResultBytes: number
}

// 第二处出现：判断逻辑
if (entry.mutates && !entry.error && entry.unchangedProps?.length) {
  noopMutations.push(entry)   // ← 符合条件就归类为 noop mutation
}
```

noop 的"定义"就是这个条件：
- `mutates === true`（工具声称会修改画布）
- `!error`（执行没报错）
- `unchangedProps.length > 0`（但实际上有属性没变）

这三个条件同时满足 → 就是"无效操作"。OpenPencil 没有一个叫 `noop` 的变量——它是一个**概念**，用 `noopMutations` 数组来收集。

---

## 三、工具字段作为"信号"

### mutates 是唯一的布尔信号吗？

在 `ToolDef` 的接口里，只有两个可选字段承担"信号"角色：

```typescript
interface ToolDef {
  name: string                    // 必须。标识符
  description: string             // 必须。给 LLM 看的
  mutates?: boolean               // 可选。信号：是否修改画布
  params: Record<string, ParamDef>  // 必须。参数定义
  execute: Function               // 必须。执行逻辑
}
```

`mutates` 是**唯一显式的布尔信号**。

但 `name` **隐式地也可以当信号**——代码里有一处硬编码检查：

```typescript
if (def.name === 'export_image') {
  toolOpts.toModelOutput = ...  // 特殊处理：把 base64 图片转成 media 格式
}
```

所以实际上有两种信号机制：
1. **声明式信号**：`mutates: boolean` → adapter 自动做快照、闪烁等
2. **硬编码名字匹配**：`name === 'export_image'` → 特殊格式转换

### 其他四种参数类型呢？

你问的"四个类型"应该是指 ParamDef 的 5 种参数类型（string, number, boolean, color, string[]）。它们**不是信号**——它们是参数的**数据类型描述**，被 `paramToValibot` 转换成验证规则：

```
ParamDef.type = 'string'   → v.string()    （验证 LLM 输出是字符串）
ParamDef.type = 'number'   → v.number()    （验证是数字）
ParamDef.type = 'boolean'  → v.boolean()   （验证是布尔值）
ParamDef.type = 'color'    → v.string() + description  （验证是字符串，描述告知格式）
ParamDef.type = 'string[]' → v.array(v.string())（验证是字符串数组）
```

这些类型**影响 adapter 如何生成 schema**，但不触发任何特殊处理逻辑。只有 `mutates` 会触发后端行为差异（快照、闪烁、noop 检测）。

---

## 四、ai-adapter 如何处理 mutating 工具

### 完整代码流程（简化注释版）

```typescript
// toolsToAI 中为每个工具定义生成包装后的 execute
execute: async (args) => {
  const startTime = Date.now()
  const figma = options.getFigma()

  // =========== 步骤 1：条件快照 ===========
  const nodeBefore = def.mutates && options.onToolLog
    ? captureNodeSnapshot(figma, args)
    // ↑ 仅当 mutates===true 且有日志回调时，深拷贝目标节点
    : undefined

  // =========== 步骤 2：执行前钩子 ===========
  options.onBeforeExecute?.(def)
  // ↑ 外部可以注册回调，比如显示 loading 状态

  try {
    // =========== 步骤 3：调用工具本身 ===========
    let execResult = await def.execute(options.getFigma(), args)

    // =========== 步骤 4：节点闪烁（仅 mutating） ===========
    if (def.mutates && options.onFlashNodes) {
      const ids = extractNodeIds(execResult)
      // ↑ 从返回值中提取节点 ID
      //   {id: "0:5"} → ["0:5"]
      //   {results: [{id:"0:5"},{id:"0:6"}]} → ["0:5","0:6"]
      //   {deleted: "0:5"} → []  （已删除的不闪烁）
      if (ids.length > 0) options.onFlashNodes(ids)
    }

    // =========== 步骤 5：日志记录（含 noop 检测） ===========
    emitToolLog(options, def, args, startTime, figma, nodeBefore, execResult)
    // ↑ 内部会：拍 nodeAfter 快照 → detectUnchangedProps

    // =========== 步骤 6：步数警告注入 ===========
    if (options.getStepBudget) {
      execResult = appendStepWarning(execResult, options.getStepBudget())
      // ↑ 剩余 ≤5 步时，在返回值中追加 _warning 字符串
    }

    return execResult  // → 这个结果回传给 LLM
  } catch (err) {
    // =========== 异常处理 ===========
    const errorMsg = err instanceof Error ? err.message : String(err)
    emitToolLog(options, def, args, startTime, figma, nodeBefore, null, errorMsg)
    return { error: errorMsg }  // ← 扁平错误返回给 LLM
  } finally {
    await options.onAfterExecute?.(def)
  }
}
```

### 如果是非 mutating 工具（如 get_node），同样的代码走哪些步骤？

```
步骤 1：nodeBefore = undefined（跳过快照）
步骤 2：onBeforeExecute（正常执行）
步骤 3：调用 execute（正常执行）
步骤 4：跳过闪烁（def.mutates === false）
步骤 5：记日志（但 nodeAfter/unchangedProps 都是 undefined）
步骤 6：步数警告（正常检查）
```

---

## 五、params 如何变成 LLM 看到的工具定义

### 转换链条

```
ParamDef（开发者写的）
    │ 第一次转换：paramToValibot()
    ↓
valibot schema（运行时验证对象）
    │ 第二次转换：valibotSchema()（即 @ai-sdk/valibot 提供的 jsonSchema）
    ↓
JSON Schema（标准格式）
    │ 第三次转换：Vercel AI SDK 内部
    ↓
function definition（发给 LLM 的格式）
```

params 的"名字"始终没变——`id`, `color`, `depth` 这些 key 名从头到尾一样。变的是**格式**：

| 阶段 | 格式 | 用途 |
|------|------|------|
| ParamDef | `{ type: 'string', enum: [...], required: true }` | OpenPencil 内部表示 |
| valibot | `v.picklist(["HORIZONTAL", "VERTICAL"])` | 运行时验证 LLM 输出 |
| JSON Schema | `{ type: "string", enum: [...] }` | LLM 理解参数结构 |
| function definition | 嵌在 `tools` 数组里发给 LLM | LLM 决定怎么调用 |

### "工具定义"和"描述"的区别

**工具定义** = name + description + parameters schema。是完整的结构化信息。

**描述** = 只是 `description` 字符串，是工具定义的一部分。

```json
{
  "name": "set_fill",                // ← 工具定义的一部分
  "description": "Set fill color...", // ← 描述（description），属于定义的一部分
  "parameters": {                     // ← 参数 schema，也属于定义的一部分
    "id": {"type": "string"},
    "color": {"type": "string"}
  }
}
```

LLM 看到的是**完整的工具定义**，其中**包含**描述。

---

## 六、JSON.stringify 和属性对比逻辑

### JSON.stringify 是什么？

`JSON.stringify` = 把 JavaScript 对象转成 JSON 字符串。

```javascript
JSON.stringify({r: 1, g: 0, b: 0})
// → '{"r":1,"g":0,"b":0}'

JSON.stringify({r: 1, g: 0, b: 0}) === JSON.stringify({r: 1, g: 0, b: 0})
// → true（字符串完全一致）
```

为什么不直接 `===`？因为 JavaScript 中对象比较的是**引用**（内存地址），不是内容。两个内容完全一样的对象，`===` 比较结果是 `false`。所以先转成字符串，再比字符串。

### 对比的是什么？

**对比的是单个属性**，不是整个节点：

```typescript
for (const [argKey, argVal] of Object.entries(args)) {
  // ↑ 遍历 LLM 传的每个参数
  // argKey = "color", argVal = "#FF0000"

  if (argKey === 'id' || argVal === undefined) continue
  // ↑ 过滤 1：跳过 id 参数本身（id 不是要修改的属性）

  if (skipSet?.has(argKey)) continue
  // ↑ 过滤 2：跳过某些工具的"输入参数但不直接对应节点属性"的参数
  //   例如 set_fill 的 color 不直接对应 node.color（而是 node.fills）
  //   set_layout 的 align 不直接对应 node.align（而是 node.primaryAxisAlign）

  const nodeProp = ARG_TO_NODE_PROP[argKey] ?? argKey
  // ↑ 映射名字：args.color → node.fills, args.corner_radius → node.cornerRadius
  //   如果没有特殊映射，就用参数名本身

  const beforeVal = before[nodeProp]   // 修改前该属性的值
  const afterVal = after[nodeProp]     // 修改后该属性的值

  if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) {
    unchanged.push(nodeProp)   // 前后一样 → 这个属性是 noop
  }
}
```

### `Record<string, unknown>` 是什么？

是 TypeScript 类型标注：
- `Record<string, unknown>` = "key 是字符串，value 是任意类型的对象"
- `unknown` 表示"不确定是什么类型"（可能是 number、string、object、array...）

在这里：`before: Record<string, unknown>` 表示"修改前的节点快照，是一个键值对对象，key 是属性名（字符串），value 是属性值（任意类型）"。

### 回答问题：noop 后不告诉 LLM，也不限制重复？

**对**。noop 检测和重复检测都是**纯粹的开发者诊断工具**：
- 不反馈给 LLM
- 不阻止后续调用
- 不改变返回值
- 只记录在 `ToolDebugLog` 中供开发者查看

---

## 七、可选参数的行为

### 没写 `required: true` 的参数

LLM 可以选择不输出。不输出时，`args.replace_id` 就是 `undefined`。

工具代码中用 `if` 条件来处理：

```typescript
if (args.replace_id) {
  // LLM 传了 replace_id → 执行替换逻辑
} else {
  // LLM 没传 → 普通渲染，不替换
}

if (args.parent_id) {
  parentId = args.parent_id
} else {
  parentId = figma.currentPageId   // 默认当前页面
}

if (args.x !== undefined) {
  // 有指定位置
} else {
  // 不指定位置，让布局引擎决定
}
```

**没输出完全没事**——工具被设计成"可选参数不传就用默认行为"。

---

## 八、x, y 坐标和自动布局

### 坐标的含义

x, y 是**在父节点坐标系中的位置**。

如果 parent_id 指向一个 Frame 节点：
- `x: 20, y: 40` 表示在该 Frame 内部，距左上角 (20, 40) 的位置
- 不是页面全局坐标

### 自动布局下的行为

从 `renderer.ts` 的代码可以看到：

```typescript
const hasExplicitPosition = props.x !== undefined || props.y !== undefined
const isInsideAutoLayout = parentLayout !== 'NONE'

if (hasExplicitPosition && isInsideAutoLayout) {
  o.layoutPositioning = 'ABSOLUTE'
  // ↑ 如果父节点是自动布局，但你指定了 x/y
  // → 自动切换为"绝对定位"，脱离自动布局流
}
```

所以：
- **有自动布局 + 不传 x/y** → 由布局引擎自动排列。**LLM 不需要算位置**。
- **有自动布局 + 传了 x/y** → 变成绝对定位，脱离流式排列。LLM 需要知道坐标。
- **没有自动布局 + 不传 x/y** → 默认 (0, 0)。

**设计意图**：大多数场景 LLM 不传 x/y，让自动布局处理排列。

---

## 九、批量替换

### `replace_id` 是 string，不能批量替换？

对。一次 `render` 调用只能替换一个节点。

如果 LLM 需要替换多个节点，只能**多次调用**：

```
调用 1: render({jsx: "...", replace_id: "0:5"})
调用 2: render({jsx: "...", replace_id: "0:8"})
调用 3: render({jsx: "...", replace_id: "0:12"})
```

OpenPencil 没有 `batch_replace` 这样的一次替换多节点的工具。

为什么不做？可能因为：
1. 替换涉及 JSX 编译 + 代码执行，每次的 JSX 内容通常不同
2. 批量场景不如 `batch_update`（改属性）那么常见
3. 如果 JSX 相同但位置不同，LLM 可以 `render` 一次再用 `batch_update` 调整

---

## 十、JSX 标签和 `new Function` 的工作原理

### 什么是 JSX 标签？

JSX 标签是 `<Frame>`, `<Text>`, `<Rectangle>` 这样的元素名。它们不是 args 或 params——是 **JSX 字符串内部的语法元素**。

```
工具调用的参数层面:
  args = { jsx: "整个 JSX 字符串", parent_id: "0:1" }
                    │
                    ↓ JSX 字符串内部有标签
  "<Frame name='Card' w={320}>
     <Text size={18}>Hello</Text>
   </Frame>"
         ↑        ↑
     标签名    属性（props，不是 params）
```

层级关系：
- `params/args` = 工具级别的参数（jsx, parent_id, replace_id...）
- `标签/props` = JSX 字符串里的内容，由 sucrase 编译器处理

### `new Function('React', result.code)` 为什么能执行？

```javascript
// 这行代码做了什么：
new Function('React', result.code)(React)
```

拆解：

```javascript
// 1. new Function('React', result.code) 创建一个函数：
function anonymous(React) {
  // result.code 的内容，比如：
  const __h = React.createElement
  const Frame = 'frame', Text = 'text'
  return function Component() {
    return __h(Frame, {name:"Card", w:320}, __h(Text, {size:18}, "Hello"))
  }
}

// 2. (React) 立即调用这个函数，传入 OpenPencil 自己的 mini-react 对象
// 返回值是 Component 函数
```

`'React'` 是**参数名**（一个字符串），不是在"执行 React"。它定义了匿名函数的形参名叫 `React`。后面的 `(React)` 传入的是 `import * as React from './mini-react'` —— OpenPencil 自己实现的极简 React（只有 `createElement`，没有 DOM、没有状态管理）。

### 换成 Vue 会怎样？

不能。这个系统**硬绑定了 React 的 JSX 语法**：
- sucrase 编译 JSX → `React.createElement()` 调用
- mini-react 处理虚拟 DOM 树
- renderTree 遍历虚拟树创建 SceneGraph 节点

如果要支持 Vue 模板语法，需要换编译器、换 createElement 实现、换树遍历逻辑——基本上要重写整个渲染管线。

### 返回根节点 ID 的细节

```typescript
return {
  id: result.id,          // 根节点的 ID（SceneGraph 自动分配的）
  name: result.name,      // 根节点的名字（来自 JSX 的 name 属性）
  type: result.type,      // 根节点的类型（FRAME, TEXT 等）
  childIds: result.childIds  // 根节点的直接子节点 ID 列表
}
```

所以是**根节点摘要 + 子节点 ID 列表**。子节点的详细内容需要 LLM 再调用 `get_node` 查看。

---

## 十一、Record、count、depth 辨析

### ai-adapter 里的 `Record<string, any>` 是什么？

```typescript
const result: Record<string, any> = {}
// ↑ key 是工具名（string），value 是 tool() 对象

for (const def of tools) {
  result[def.name] = tool(toolOpts)
  // result["set_fill"] = tool({...})
  // result["get_node"] = tool({...})
}

return result
// ↑ 返回 { "set_fill": tool对象, "get_node": tool对象, ... }
```

所以 `result` 的 key 是**工具名**，value 是**Vercel AI SDK 的 tool 对象**。这个对象最终传给 `generateText()` 或 `streamText()`，SDK 把它转成发给 LLM 的工具列表。

**Record 不等于"LLM 输出"**——它等于"给 SDK 的工具注册表"。SDK 拿着这个注册表：
1. 把工具 schema 发给 LLM（让 LLM 知道有什么工具可以用）
2. 当 LLM 输出工具调用时，用注册表里的 execute 函数来执行

### count 和 depth 的区别

`count` 和 `depth` **完全不相关**：

| | count | depth |
|---|-------|-------|
| 含义 | **匹配到多少个节点** | **子树展开到多少层** |
| 出现在 | `find_nodes` 的返回值 | `get_node` 的参数 |
| 类型 | 整数（如 count: 3） | 整数（如 depth: 2） |
| 表示 | 搜索结果数量 | 树的遍历深度 |

```
find_nodes({name: "Card"})
→ { count: 3, nodes: [{id:"0:5"}, {id:"0:12"}, {id:"0:20"}] }
  ↑ count=3 意思是"找到 3 个匹配的节点"

get_node({id: "0:5", depth: 2})
→ { id:"0:5", children: [{ id:"0:6", children: [{ id:"0:7", children: "..." }] }] }
  ↑ depth=2 意思是"展开 2 层子节点"
```

count **不表示嵌套深度**。它就是数组长度。

### LLM 怎么决定 depth？

从实际使用场景推测：
- **depth: 0** — "我只想看这个节点本身的属性"。常见于 setter 之后验证
- **depth: 1** — "我想看节点和它的直接子节点"。最常用
- **不传（无限）** — "给我完整子树"。用于首次理解页面结构

LLM 根据任务判断——如果任务是"检查 Card 组件的标题文字"，depth: 1 就够了。如果是"分析整个页面结构"，就不传 depth。

---

## 十二、步数上限配置

### OpenPencil 有设置吗？

`getStepBudget` 是通过 `AIAdapterOptions` 注入的回调函数：

```typescript
interface AIAdapterOptions {
  getStepBudget?: () => StepBudget  // ← 可选的
}

interface StepBudget {
  current: number   // 当前已用步数
  max: number       // 最大步数
}
```

OpenPencil 的 adapter 代码**不设置具体数值**——它接受外部传入。具体的 `max` 值由调用 `toolsToAI` 的上层代码决定（大概率在 web 前端或 CLI 入口配置）。

Vercel AI SDK 的 `generateText`/`streamText` 有独立的 `maxSteps` 参数：

```typescript
const result = await generateText({
  model,
  tools: toolsToAI(CORE_TOOLS, options, deps),
  maxSteps: 20,   // ← SDK 级别的硬限制
  messages
})
```

当达到 `maxSteps`，SDK **直接停止**——不再允许 LLM 发起工具调用。OpenPencil 的 `_warning` 注入是在 SDK 硬停之前给 LLM 一个"收尾"的软信号。

---

## 十三、节点闪烁能在 Figma 里实现吗？

### OpenPencil 可以，Figma 插件很难

OpenPencil 有自己的渲染引擎（Skia/CanvasKit），所以可以在节点上画高亮边框、闪烁动画——完全控制渲染管线。

Figma 插件**不能控制画布渲染**。但有一些替代方案：

| 方案 | 可行性 | 效果 |
|------|--------|------|
| `figma.viewport.scrollAndZoomIntoView([node])` | ✅ 可用 | 滚动到节点位置并缩放 |
| `figma.currentPage.selection = [node]` | ✅ 可用 | 选中节点（蓝色选中框） |
| 在 UI 面板中显示操作日志 | ✅ 可用 | 文字提示，不是画布高亮 |
| 绘制临时高亮图层 | ⚠️ 勉强 | 需要创建/删除临时节点，副作用大 |
| 自定义渲染覆盖层 | ❌ 不可能 | Figma 不暴露画布渲染 API |

所以"节点闪烁"这个功能在 Figma 插件中**用 selection + viewport 滚动**是最实际的替代。

---

## 十四、`node_replace_with` 和 `render({replace_id})` 的区别

### 两者都用 `renderJSX`

是的，本质上都是调用同一个 `renderJSX` 函数——所以 JSX 编译和执行逻辑完全一样。区别在**替换策略**：

```
render({replace_id}):
  1. 先用 renderJSX 创建新节点（追加到父节点末尾）
  2. 把新节点移到旧节点的位置（保持兄弟顺序）
  3. 删除旧节点
  → 优点：新旧节点短暂共存，如果渲染失败，旧节点还在
  → 保持的是：在兄弟列表中的索引位置

node_replace_with({id, jsx}):
  1. 记录旧节点的 x, y 坐标
  2. 先删除旧节点
  3. 在旧位置 renderJSX 新节点
  → 缺点：删除后渲染失败 → 旧节点没了、新节点也没有
  → 保持的是：画布上的 x, y 坐标位置
```

---

## 十五、为什么 OpenPencil 用扁平的错误消息？

### 设计哲学

OpenPencil 的错误消息 `{ error: "..." }` 扁平化的原因：

1. **LLM 友好**：LLM 不需要解析 error code。一段人类可读的文字比 `{ code: "NOT_FOUND", message: "..." }` 更容易被 LLM 理解和反应。

2. **和正常返回值同层**：错误也是一个普通 JSON 对象。LLM 用同一种方式处理"成功"和"失败"——看返回值里有没有 `error` 字段。

3. **简化 adapter**：`catch (err) { return { error: err.message } }` —— 一行搞定。不需要定义错误类型枚举、不需要嵌套结构。

4. **OpenPencil 的 debug 信息分离在 ToolLogEntry 中**：开发者需要的详细信息（时间戳、堆栈）不在返回值里，而在 log 系统中。给 LLM 的只需要一个简短错误描述。

我们的嵌套格式 `{ error: { code, message } }` 的优势是可以按 code 做分支处理。但对 LLM 来说，它通常不会根据 `code = 'TIMEOUT'` vs `code = 'NOT_FOUND'` 做不同操作——它只需要知道"失败了，原因是什么"。

---

## 本文档变更记录

| 日期 | 变更 |
|------|------|
| 2026-03-30 | 创建。回答第二轮 Q&A：adapter 处理流程、noop 定义、坐标系统、批量替换、JSX 编译原理、Record 类型、错误格式等 |
