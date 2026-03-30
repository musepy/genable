# JSX Pipeline Deep Dive: 从 JSX String 到 Figma Node

2026-03-26 代码审计。完整追踪 jsx 工具的数据流，标记所有已发现问题。

## 管线总览

```
JSX string
  ↓ parseJsx()                   jsxParser.ts        — 语法解析
JsxNode[] AST
  ↓ jsxToIR()                    jsxToIR.ts           — 语义转换（新路径，替代 jsxToFlatOps）
OperationIR[]
  ↓ compileFromIR()              flatOpsParser.ts     — 编译（所有工具共用出口）
DesignOp[] (含 FigmaAction)
  ↓ executeDesignOps()           executor.ts          — 顺序执行
    ↓ executeOne()
      ↓ applyProps/applyTextProps
        ↓ handler pipeline       handlers/*.ts        — 属性写入
Figma SceneNode
```

## 各层职责

### Layer 1: jsxParser.ts — 语法解析

- 手写递归下降 parser，~370 行，零依赖
- 输入：JSX-like markup string
- 输出：`JsxNode[] { tag, attrs, children, textContent?, line }`
- 支持 12 个 tag（VALID_TAGS），未知 tag 报错但继续解析（error recovery）
- 属性值 3 种语法：`{400}`（花括号 + 自动 number）、`"string"`（引号）、裸值
- `<text>` 标签特殊处理：parseTextElement() 收集 textContent
- 不做任何语义转换，纯语法层

关键方法：
- `parseJsx()` — 公共入口
- `parseElement()` — 解析一个完整标签
- `parseTextElement()` — text 标签的 textContent 收集
- `parseAttrValue()` — 三种属性值语法
- `parseAttrName()` — 允许 `a-zA-Z0-9_-.:$`（覆盖 set:, child.prop, $var）

### Layer 2: jsxToIR.ts — 语义转换（新路径）

- DFS 遍历 JsxNode[] → 生成 OperationIR[]
- 4 个分支：instance / text / icon / container
- 语义转换：
  - `set:Title` → `overrides.Title = {characters: value}`（instance）
  - `textContent` → `props.characters`（text）
  - `size` → `width + height`（icon 专用）
  - `mt/mb` → parent `gap`（margin→gap，CSS mental model 桥接）
  - layout + 无显式 w/h → 注入 `hug`（layout defaults）
  - `p: {top:12, right:16}` → `pt/pr/pb/pl`（对象 padding 展开）
- 每个分支最终调 `normalizeProps()` 做 shorthand 展开 + 校验

替代了旧路径 `jsxToFlatOps.ts`（已死代码）。

### Layer 3: flatOpsParser.ts — compileFromIR()

- **所有工具的唯一编译出口**：jsx（jsxToIR）、edit/run（parseFlatOps）→ 都汇入 compileFromIR()
- 三步：variantSet 隐式依赖 → 符号引用验证 → compileLine 逐行编译
- `compileLine()` 是 OperationIR → DesignOp 的 switch（9 个 command case）
- 输出 `{ops: DesignOp[], errors: DesignOpError[], diagnostics: DesignDiagnostic[]}`

### Layer 4: executor.ts — ActionExecutor

两个入口（新旧并存）：
- `executeDesignOps()` — 新入口，接收 DesignOp[]，自管 symbolMap（生产路径）
- `execute()` — legacy，接收 FigmaAction[]，用 tempIdMap + topoSort（无生产调用者）

executeDesignOps 执行流程：
1. 错误种子 — parse/compile errors 直接标记 failed
2. Icon 预取 — 批量 prefetchIcons（并行）
3. 顺序执行循环 — 每个 DesignOp：
   - 3a. abort 检查
   - 3b. 依赖跳过 — dep failed/skipped → skip
   - 3c. 符号解析 — resolveSymbolRefs() symbol→realId
   - 3d. 执行 — executeOneWithRetry()（最多 2 次 auto-fix retry）
   - 3e. 降级兜底 — createFrame 失败 → 最小空 frame（防级联 skip）
   - 3f. 更新 symbolMap + createdNodes
4. 统计
5. 回滚 — rollbackMode='created_nodes' + hasErrors → 全删已创建节点
6. pluginData 标记 — '_agent'='created'

executeOne() — 13 个 FigmaAction case，统一模式：
- 创建类：create node → appendChild → applyProps → 失败则 remove（原子性）
- 更新类：resolve target → applyProps
- 删除/移动：直接操作

### Layer 5: Handler Pipeline — 属性写入

applyProps() 流程：
1. `expandShorthands()` — 第二次（第一次在 normalizeProps，幂等但冗余）
2. `validateDependencies()` — 检查 gate 属性，自动注入缺失的（如 layoutMode）
3. `sortByPropertyOrder()` — 拓扑排序（依赖图派生）
4. for each [key, value] → `applyProperty()` — first-match handler pipeline

10 个 handler（优先级顺序）：

| 优先级 | Handler | match | 职责 |
|--------|---------|-------|------|
| 1 | variableBindingHandler | `value.startsWith('$')` | Figma 变量绑定 |
| 2 | styleRefHandler | `key in {textStyle,fillStyle,...}` | 样式引用 |
| 3 | paintHandler | `fills \| strokes` | hex/gradient → Figma Paint[] |
| 4 | effectHandler | `effects` | shadow/blur → Figma Effect[] |
| 5 | unitValueHandler | `lineHeight \| letterSpacing` | number/% → UnitValue |
| 6 | resizeHandler | `width \| height` | `node.resize()` 而非直接赋值 |
| 7 | constraintsHandler | `constraints` | "MIN,CENTER" → object |
| 8 | dashPatternHandler | `dashPattern` | "10,5" → number[] |
| 9 | hyperlinkHandler | `hyperlink` | URL/NODE 链接 |
| 10 | defaultHandler | `key in node` | `node[key] = value`（兜底） |

propertyDependencies.ts — Figma API 约束的单一来源：
- DEPENDENCY_RULES: 7 条状态依赖规则（layoutMode→padding 等），self-scope 可自动注入
- EXECUTION_ORDER: API 调用顺序约束（layoutMode→resize→sizing, font→characters）
- sortByPropertyOrder: Kahn 拓扑排序，保证属性应用顺序正确

## 问题清单

### 🔴 高优先级

| # | 文件:行 | 问题 | 影响 |
|---|---------|------|------|
| P1 | jsxParser.ts:127 | `<icon>text</icon>` 的 textContent 被跳过。只有 `<text>` 走 parseTextElement()，icon 走通用 parseElement()，非标签内容被 skipToNextTag() 丢弃 | `<icon>lucide:search</icon>` 写法无法工作，icon 名称只能通过 attr 传递 |
| P3 | jsxToIR.ts:63 | Instance 的 deps 漏了 componentRef。旧路径 flatOpsParser L142 会把 compSym 加到 deps，jsxToIR 只加了 parentSym | 如果 component 在同一批次的后面定义，instance 可能先于 component 执行 → 找不到组件 |
| P7 | flatOpsParser.ts:569-575 | image command 的 name 被 placeholder 覆盖。`name: placeholder ?? 'Image Placeholder'`，但 jsxToIR 从未设置 placeholder。用户指定的 name 在 rest 里被 spread，但 name 键在 rest 之前 → 被 rest 中的 name 覆盖回来（实际上 `{name: placeholder, ...rest}` 的 rest 含原始 name，所以最终 name 是对的）。**更正：这不是 bug**，rest 中的 name 会覆盖 placeholder。但代码意图不清晰 | 代码可读性差，容易在修改时引入 bug |

### 🟡 中优先级

| # | 文件:行 | 问题 | 影响 |
|---|---------|------|------|
| P2 | jsxParser.ts:249 | JSON5 对象解析用 `replace(/([{,]\s*)(\w+)\s*:/g, ...)` 给 key 加引号。嵌套值含 `:` 时可能误匹配 | 边界情况，实际使用中 padding 对象值都是数字 |
| P4 | jsxToIR.ts:171-179 | Margin→Gap 直接 `delete child.attrs.mt` 修改了 JsxNode AST。如果同一棵 AST 被 jsxToIR 调用两次，第二次 margin 数据已丢失 | 目前只调用一次，但 AST 不可重用是隐患 |
| P8 | flatOpsParser.ts:534 | OperationIR.props 类型是 CanonicalProps（含 PaintValue[] 等复杂类型），但 FigmaAction 类型声明的是 `string[]`（如 fills?: string[]）。`const props: Record<string, any>` 断裂了类型链 | 运行时 executor 两种都处理，但类型系统无保护 |
| P9 | createTypes.ts:142 | VALID_COMMANDS 缺少 'clone' 和 'componentProperty'。compileLine 能处理但 VALID_COMMANDS 没列 | 如果有代码依赖 VALID_COMMANDS 做校验会漏判 |
| P10 | executor.ts:366-529 | legacy execute() 与 executeDesignOps() 大量重复逻辑（retry、dependency check、rollback）。两套并行代码 | 改一个忘改另一个会 diverge |
| P13 | executor.ts:304-307 | resolveSymbolRefs() 解析 source.nodeId 只查 symbolMap，不查 componentRegistry。但 executeOne() 内的 resolveComponent() 会兜住 | 两层解析，职责模糊 |
| P14 | executor.ts:1258 | applyProps() 再次调 expandShorthands()。props 已在 normalizeProps() 中 expand 过一次。expandShorthands 幂等，不出错但冗余 | 浪费 CPU，每次 applyProps 都做一次无用 expand |
| P15 | handlers/index.ts:133-134 | readCurrentValue 用 `node[key]` 读 before/after 做 diff。variableBindingHandler 写的是 setBoundVariable()，读 node[key] 拿不到绑定状态 | 变量绑定的 diff 可能不准 |

### 待清除（死代码）

| 文件 | 原因 |
|------|------|
| jsxToFlatOps.ts | 旧路径，jsxHandler 已切到 jsxToIR。零生产 import |
| jsxToFlatOps.test.ts | 死代码的测试 |

## 降级兜底 vs 回滚的关系

两者分层，不冲突：

- **降级兜底**（executeDesignOps step 3e）：单个 op 级别。createFrame 失败 → 创建最小空 frame → 子节点不会级联 skip。标记为 `warning` 非 `failed`
- **回滚**（executeDesignOps step 5）：批次级别。`rollbackMode='created_nodes' + hasErrors` → 删除所有已创建节点

jsx 工具用 `rollbackMode: 'created_nodes'`（jsxHandler.ts:65），所以是原子性的：全成功或全删。降级兜底在这个模式下意义有限——降级保住了子节点，但如果任何 op 最终 failed，整批回滚。

## normalizeProps vs expandShorthands

expandShorthands — 纯映射，context-free：
- `layout:'row'` → `layoutMode:'HORIZONTAL'`
- `p:24` → `paddingTop/Right/Bottom/Left:24`
- `bg:'#FFF'` → `fills:['#FFF']`
- `fill:'#333'` on TEXT → `fills:['#333']`

normalizeProps — **调用 expandShorthands 作为第一步**，然后做需要 nodeType 上下文的校验：
1. expandShorthands()
2. textAutoResize 同步（需 nodeType='TEXT'）
3. text alignment 转换（align → textAlignHorizontal）
4. LINE height 限制
5. boolean 属性 string→boolean
6. enum 校验（PROP_METADATA）
7. scalar clamping（opacity -1 → 0）
8. text-only 属性过滤
9. unknown 属性过滤 + Levenshtein 建议

关系：`normalizeProps ⊃ expandShorthands`。管线中 normalizeProps 在 jsxToIR 调用一次，applyProps 在 executor 又独立调 expandShorthands 一次（幂等但冗余）。

## flat ops 字符串格式的现状

jsx 工具已绕过 flat ops string。但 edit 和 run 仍然使用：

| 调用者 | 用法 |
|--------|------|
| editHandler.ts | 拼 `update('nodeId', {props})` 字符串 → executeFlatOps() |
| writeHandlers.ts | run 子命令 (mv, rm, cp, clone, mkdir, sed) → executeFlatOps() |
| nodesToFlatOps.ts | JSON node 数组 → flat ops 字符串（create 旧 JSON 路径） |

executeFlatOps = parseFlatOps() + compileFromIR()，共用同一个编译出口。

---

## 附录：代码审计工作流

本文档通过以下工作流生成。可复用于任意管线的深度审计。

### 触发条件

用户提出管线级的架构问题，例如：
- "旧路径是否还有必要？"
- "这个中间层能不能去掉？"
- "从 X 到 Y 的完整数据流是什么？"

### 工作流步骤

```
Phase 1: 定位入口，确定边界
├─ 从用户指向的文件/函数出发
├─ grep import/调用关系，确定上下游
├─ 画出粗粒度管线图（几层，每层输入输出类型）
└─ 产出：管线总览图 + 死代码标记

Phase 2: 逐层深读，标记问题
├─ 每层：读源码 → 理解职责 → 标记问题
├─ 问题分级：🔴 功能缺失/行为错误  🟡 维护债务/边界情况  🟢 设计选择/无实际影响
├─ 每层回答用户的追问，带代码块引用链接
├─ 累积维护问题清单（跨层汇总）
└─ 产出：每层的职责说明 + 标记的问题

Phase 3: 跨层分析
├─ 识别重复逻辑（如双重 expandShorthands）
├─ 识别职责模糊（如两层 symbol 解析）
├─ 识别类型断裂（如 CanonicalProps → Record<string, any>）
├─ 回答跨层问题（如"降级 vs 回滚"、"normalizeProps vs expandShorthands"）
└─ 产出：跨层关系说明 + 架构级问题

Phase 4: 记录
├─ 写入 docs/knowledge/（不是 memory）
├─ 内容结构：管线总览 → 各层职责 → 问题清单 → 跨层分析
├─ 问题清单按严重度分组，每条带文件:行引用
└─ 产出：本文档
```

### 关键原则

1. **逐层推进，不跳层**：每层读完、标记完、回答完追问后，才进入下一层
2. **累积问题清单**：每层新发现的问题追加到总表，跨层可见
3. **所有引用带代码链接**：`file.ts:行号` 格式，用户可直接跳转
4. **区分"问题"和"设计选择"**：不是所有不完美都是 bug，标 🟢 的是有意为之
5. **标记死代码但不立即删**：先记录，让用户决定清理时机
6. **回答用户追问优先于推进**：用户在某层提出深入问题时，就地回答，不急着往下走

### 本次审计的实际路径

```
jsxToFlatOps.ts（用户选中）
  → "旧路径还在做什么？flat ops 是否还有必要？"
  → grep 调用关系 → 画出新旧管线对比 → 标记 jsxToFlatOps 为死代码
  ↓
jsxParser.ts（用户打开）
  → 逐层读 → 标记 P1（icon textContent）、P2（JSON5 正则）
  ↓
jsxToIR.ts（用户继续）
  → 标记 P3（instance deps）、P4（AST mutate）
  ↓
flatOpsParser.ts — compileFromIR + compileLine
  → 确认"是否是最后一层"→ 是
  → 标记 P7-P9
  ↓
executor.ts — executeDesignOps + executeOne
  → 用户追问：降级 vs 回滚？双重 expand？基础 action 是否该分开？
  → 就地回答 → 标记 P10-P14
  ↓
handlers/*.ts — applyProperty pipeline
  → 10 个 handler 速览 → propertyDependencies 排序机制
  → 标记 P15
  ↓
记录 → docs/knowledge/jsx-pipeline-deep-dive.md
```
