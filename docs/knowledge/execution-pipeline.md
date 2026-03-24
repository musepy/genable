# Execution Pipeline: 工具→执行→LLM 完整链路

4 个 first-class 工具（jsx / inspect / edit / run）从 LLM 调用到 Figma 节点操作的完整数据流。

## 工具总览

```
LLM tool call
    ↓
toolDispatcher.dispatch()          ← 统一入口
    ├── jsx    → jsxHandler        ← 创建节点树
    ├── inspect→ inspectHandler    ← 读取节点（ls/tree/detail）
    ├── edit   → editHandler       ← 修改节点属性
    └── run    → unwrapRunCommand  ← CLI 子命令路由
         ├── ls/tree/cat → readHandlers
         ├── mk          → createHandler
         ├── mv/rm/cp    → writeHandlers
         ├── grep/sed    → searchHandlers
         └── man         → help
    ↓
presentForLLM()                    ← 扁平化 + _meta + 安全网
    ↓
functionResponse.response          ← LLM 看到的结果
```

---

## Layer 0: 调度层

### toolDispatcher.ts — `dispatch(toolCalls, iteration)`
- 入口：接收 LLM 的 tool calls
- 展开 `$LAST` 变量
- `run` 工具：`unwrapRunCommand()` 解析 CLI → 路由到子命令
- 执行前/后 hook（beforeToolExec / afterToolExec）
- 调用 `presentForLLM()` 格式化结果
- 提取 `$LAST` 节点 ID
- **所有工具共用**

### presentation.ts — `presentForLLM(result, commandName, durationMs)`
- 扁平化：`{success, data: {...}}` → `{...dataFields}`
- error 替代 success：失败时 `{error: "msg"}`，成功时无 error 字段
- 添加 `_meta: "[exit:0 | 150ms]"`
- 添加 `_stderr`（质量警告、错误摘要）
- KEEP_FIELDS 噪声过滤
- overflow 截断 + binary 检测
- **所有工具共用**

---

## Pipeline A: jsx（创建节点树）

```
JSX string
    ↓
① parseJsx()               jsxParser.ts
    JsxNode[] AST（tag, attrs, children, textContent）
    ↓
② jsxToFlatOps()            jsxToFlatOps.ts          ⚠ 序列化（可优化）
    DFS 遍历 → 文本行 "n1=frame(root, {name:'Card', w:400})"
    helpers: escapeFlatOpsStr, injectLayoutDefaults, mkPropToFlatOps
    margin→gap 转换，layout 默认值注入
    ↓
③ executeFlatOps()           shared.ts
    ├─ compileDesignOps()    flatOpsParser.ts         ⚠ 反序列化（可优化）
    │   文本行 → DesignOp[]（解析+引用验证+编译）
    │   DesignOp = {lineNumber, raw, symbol, action: FigmaAction, dependsOn}
    │
    ├─ executor.executeDesignOps()   executor.ts
    │   顺序执行 DesignOp[]
    │   symbolMap: tempId(n1) → realId(1:42)
    │   依赖检查、abort/continue、回滚
    │   ↓ 对每个 op:
    │   ├─ resolveSymbolRefs()     symbol → realId 替换
    │   ├─ executeOneWithRetry()   失败自动重试(max 2)
    │   │   └─ executeOne()        核心：创建 Figma 节点
    │   │       ├─ resolveParent() 获取父节点
    │   │       ├─ ActionValidator.validate()
    │   │       ├─ normalizeSizingInProps()
    │   │       ├─ figma.createFrame/Text/Shape/...  ← Figma API
    │   │       ├─ parent.appendChild(node)
    │   │       └─ applyProps() / applyTextProps()   ← 属性管线
    │   │
    │   └─ 回滚：失败时移除已创建节点
    │
    ├─ buildCreateReceipt()  receiptBuilder.ts
    │   LineResult[] → {idMap, created, edited, stats}
    │
    └─ buildStderr()         shared.ts
        诊断+违规+警告 → stderr 文本
    ↓
④ jsxHandler 后处理          jsxHandler.ts
    从 idMap + AST 重建嵌套返回：{id, name, type, children}
    ↓
⑤ scoreCreatedNodes()        qualityScorer.ts
    6 维度评分 → _stderr 质量报告
```

**jsx 独有问题**：② → ③ 是多余的序列化→反序列化往返。AST 已经是结构化的树，转成文本再解析回结构。④ 的返回值重建也是为了弥补 flat 格式丢失的层级信息。

---

## Pipeline B: edit（修改节点属性）

```
{node: "Card#1:2", props: {bg: "#FFF", corner: 8}}
或 {nodes: [{node: "Card#1:2", props: {...}}, ...]}   ← 批量模式
    ↓
① editHandler.ts — handleEdit()
    解析 node/path 参数 → resolvePathToNode() 获取真实节点
    构建 update ops 文本: "update(Card#1:2, {bg:#FFF, corner:8})"
    批量模式：多个 update ops 用 \n 连接
    ↓
② executeFlatOps()           shared.ts                  ← 共用管线
    ├─ compileDesignOps()    → DesignOp[] (action: updateProps)
    ├─ executor.executeDesignOps()
    │   └─ executeOne()
    │       ├─ 查找目标节点 figma.getNodeByIdAsync()
    │       └─ applyProps() / applyTextProps()           ← 属性管线
    └─ buildCreateReceipt()  → {edited: N}
```

**edit 用 flat ops 是合理的**——编辑操作天然是 "update(target, props)" 格式。

---

## Pipeline C: inspect（读取节点）

```
{node: "Card#1:2", mode: "tree|detail|list"}
    ↓
① inspectHandler.ts — handleInspect()
    路由到三种模式：
    ↓
    ├── mode: "list" → handleLs()           readHandlers.ts
    │   遍历 children → formatLsEntry()
    │   返回: {listing: "Card/ frame 400×300 layout:column\n..."}
    │
    ├── mode: "tree" → handleTree()         readHandlers.ts
    │   NodeSerializer.serializeWithCompression()  → NodeLayer 树
    │   JsonNodeSerializer.serialize(skeleton: true)
    │   → {tree: {id, name, type, role, summary/size/visual/layout, children}}
    │
    └── mode: "detail" → handleCat()        readHandlers.ts
        NodeSerializer.serializeWithCompression()  → NodeLayer 树
        JsonNodeSerializer.serialize()             → 完整属性 JSON
        → {type, id, name, content, fontSize, ..., children}
    ↓
② scoreCreatedNodes()        qualityScorer.ts
    → _stderr 质量报告
```

**inspect 不经过 flat ops**——纯读取，无写入。

---

## Pipeline D: run（CLI 子命令）

```
{command: "ls /Card/"}  或  {command: "mk /Card/ frame {w:400}"}
    ↓
① toolDispatcher.unwrapRunCommand()
    解析 CLI string → {name: "ls", args: {path: "/Card/"}}
    支持链: "tree / && cat /Card/" → __chain 模式
    ↓
② 路由到子命令 handler:
    ├── ls/tree/cat  → readHandlers.ts     ← 同 inspect
    ├── mk           → createHandler.ts     ← LLM 直接写 flat ops
    │   executeFlatOps(ops)
    ├── mv           → writeHandlers.ts
    │   executeFlatOps("move(...)")
    ├── rm           → writeHandlers.ts
    │   executeFlatOps("delete(...)")
    ├── cp           → writeHandlers.ts
    │   executeFlatOps("clone(...)")
    ├── grep         → searchHandlers.ts    ← 纯读取
    ├── sed          → searchHandlers.ts    ← executeFlatOps("update(...)")
    └── man          → help text
```

**run 子命令的写操作全部经过 executeFlatOps**——CLI 格式天然是文本。

---

## 属性管线（所有写操作共用）

```
applyProps(node, props)  /  applyTextProps(node, props)
    ↓
① expandShorthands(props)        expandShorthands.ts
   50+ 缩写展开: p→paddingTop/Right/Bottom/Left, layout→layoutMode,
   fill→fills, bg→fills, size→fontSize, corner→cornerRadius, ...
    ↓
② expandMacros(action)           macroExpander.ts
   1→N 展开: grid macro, outline-offset
    ↓
③ validateDependencies(props)    propertyDependencies.ts
   检查依赖门控: padding 需要 layoutMode, gap 需要 layoutMode
   发出警告（不阻止执行）
    ↓
④ sortByPropertyOrder(props)     propertyDependencies.ts
   拓扑排序: layoutMode 在 sizing 前, font 在 characters 前
    ↓
⑤ applyProperty(node, key, value)  handlers/index.ts
   10 个 handler，first-match-wins:
   variableHandler → styleRefHandler → paintHandler → effectHandler →
   unitValueHandler → resizeHandler → constraintHandler → dashHandler →
   hyperlinkHandler → defaultHandler
    ↓
   Figma API: (node as any)[figmaKey] = processedValue
```

---

## 序列化格式对比

| 数据 | flat ops 文本 | DesignOp | FigmaAction |
|------|--------------|----------|-------------|
| 创建 | `n1=frame(root, {name:'Card', w:400})` | `{lineNumber, raw, symbol:'n1', action, dependsOn:['root']}` | `{action:'createFrame', parentId:'root', props:{name:'Card', w:400}}` |
| 编辑 | `update(Card#1:2, {bg:'#FFF'})` | `{..., action:{action:'updateProps', nodeId:'1:2', props:{bg:'#FFF'}}}` | `{action:'updateProps', nodeId:'1:2', props:{bg:'#FFF'}}` |
| 删除 | `delete(Card#1:2)` | `{..., action:{action:'delete', nodeId:'1:2'}}` | `{action:'delete', nodeId:'1:2'}` |

**DesignOp 相对 FigmaAction 多了**：lineNumber（行号）、raw（原文）、symbol（tempId）、dependsOn（依赖列表）。这些全是文本格式的产物。

---

## executeFlatOps 的调用者

| 调用者 | 输入来源 | 必须经过文本格式？ |
|--------|---------|------------------|
| jsxHandler | AST → 序列化 → 文本 | ❌ AST 可直接转 FigmaAction |
| editHandler | 拼接 update() 文本 | ✅ 编辑天然是文本操作 |
| createHandler | LLM 直接输出文本 | ✅ LLM 写的就是 flat ops |
| renderHandler | 缩进标记 → 文本 | ✅ 旧格式 |
| writeHandlers | 拼接 move/delete/clone | ✅ 命令天然是文本 |
| searchHandlers (sed) | 拼接 update() 文本 | ✅ |

**结论**：只有 jsx 是不必要的绕弯。
