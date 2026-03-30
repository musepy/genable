# Figma Constraint Rule Taxonomy

> 2026-03-28 — 梳理项目中所有 Figma 约束/规则的分类、来源、重复关系。

## 概述

项目中有 5 个文件处理 Figma 平台约束和设计规则，共 8 类规则。
同一条规则（如 "FILL 需要 parent auto-layout"）最多出现 3 次，分布在不同阶段。

### 文件一览

| 文件 | 路径 | 职责 |
|---|---|---|
| propertyDependencies | [`src/engine/actions/propertyDependencies.ts`](../../src/engine/actions/propertyDependencies.ts) | 状态依赖 + 执行顺序 + 拓扑排序 |
| LayoutValidator | [`src/engine/utils/LayoutValidator.ts`](../../src/engine/utils/LayoutValidator.ts) | HUG/FILL/FIXED 约束降级 |
| node-normalizers | [`src/domain/node-normalizers.ts`](../../src/domain/node-normalizers.ts) | 输入推断 + 类型限制 + 输入清理 |
| postOpValidator | [`src/engine/validation/postOpValidator.ts`](../../src/engine/validation/postOpValidator.ts) | 写入后质量检查（无生产调用） |
| jsxHandler | [`src/ipc/commands/jsxHandler.ts`](../../src/ipc/commands/jsxHandler.ts) | DSL 入口默认值注入 |

### 调用链

```
LLM props
  │
  ▼
normalizeProps()             ← jsxHandler / editHandler / writeHandlers
  │ expandShorthands         (类型 7: DSL 默认值)
  │ textAutoResize 推断      (类型 4: 输入推断)
  │ LINE height 限制         (类型 5: 节点类型限制)
  │ enum/boolean/range 清理  (类型 6: 输入清理)
  │
  ▼
nodeFactory.applyProps()
  │ validateDependencies()   (类型 2: 状态依赖)
  │ sortByPropertyOrder()    (类型 1: 执行顺序)
  │
  ▼
normalizeSizingInProps()     ← jsxHandler / editHandler / writeHandlers 单独调用
  │ normalizeSizing()        (类型 3: 约束降级)
  │ 降级后注入 fallback w/h
  │
  ▼
Figma API 写入
  │
  ▼
validatePostOp()             (类型 8: 设计质量 lint — 当前未接入生产)
```

---

## 类型 1: 执行顺序（Execution Order）

**定义**: Figma API 要求属性 A 必须在 B 之前写入，否则 B 被静默重置。

**来源**: [`propertyDependencies.ts` L143-158](../../src/engine/actions/propertyDependencies.ts) `EXECUTION_ORDER`

| # | before | after | 原因 |
|---|---|---|---|
| 1 | layoutMode | width, height, min/maxWidth, min/maxHeight | 结构先于尺寸 |
| 2 | width | layoutSizingH/V, primaryAxisSizingMode, counterAxisSizingMode | `resize()` 重置 sizing 为 FIXED |
| 3 | height | 同上 | 同上 |
| 4 | fontName | characters | Figma 要求先加载字体 |
| 5 | fontSize | characters | 同上 |
| 6 | fontWeight | characters | 同上 |
| 7 | width | textAutoResize | `resize()` 会重置 textAutoResize |
| 8 | height | textAutoResize | 同上 |

**无重复，唯一来源。** 通过 [`buildPropertyOrder()`](../../src/engine/actions/propertyDependencies.ts) Kahn 拓扑排序生成 `PROPERTY_ORDER`。

---

## 类型 2: 状态依赖（State Dependency / Gate）

**定义**: 属性 B 只在属性 A（gate）满足某条件时才生效。Self-scope 可自动注入 gate 值；parent-scope 只能 warn。

**来源**: [`propertyDependencies.ts` L52-137](../../src/engine/actions/propertyDependencies.ts) `DEPENDENCY_RULES`

| # | gate | condition | scope | inject | dependents |
|---|---|---|---|---|---|
| 1 | layoutMode | != 'NONE' | self | 'VERTICAL' | padding×4, itemSpacing, sizing modes, alignment, wrap 等 |
| 2 | layoutWrap | == 'WRAP' | self | 'WRAP' | counterAxisSpacing, counterAxisAlignContent |
| 3 | layoutMode | != 'NONE' | **parent** | — (warn) | layoutAlign, layoutGrow, layoutPositioning, FILL sizing |
| 4 | strokes | nonEmpty | self | — | strokeWeight, strokeAlign, strokeJoin, strokeCap, dashPattern 等 |
| 5 | strokeJoin | == 'MITER' | self | — | strokeMiterLimit |
| 6 | isMask | truthy | self | — | maskType |
| 7 | cornerRadius | > 0 | self | — | cornerSmoothing |
| 8 | textTruncation | == 'ENDING' | self | — | maxLines |

**消费者**: [`nodeFactory.applyProps()`](../../src/engine/actions/nodeFactory.ts) 调用 [`validateDependencies()`](../../src/engine/actions/propertyDependencies.ts) 执行 gate 检查 + 自动注入。

**重复**: 规则 #1（HUG gate）和 #3（FILL parent gate）在类型 3 LayoutValidator 中被重新实现。

---

## 类型 3: 约束降级（Constraint Demotion / Fallback）

**定义**: 约束不满足时，把 sizing 值降级到安全值，而不是报错或放行。

**来源**: [`LayoutValidator.ts` L26-60](../../src/engine/utils/LayoutValidator.ts) `normalizeSizing()`

| # | 规则 | 动作 | 与类型 2 重复？ |
|---|---|---|---|
| 1 | 根节点无 layoutMode | h,v 都→FIXED | 新规则（类型 2 没有） |
| 2 | HUG 需要 self layoutMode | HUG→FIXED | **重复类型 2 #1** |
| 3 | FILL 需要 parent layoutMode | FILL→HUG（self 有 layout）或 FIXED | **重复类型 2 #3** |
| 4 | 降级后二次检查 | HUG→FIXED（如果 self 无 layout） | #2 的补充 |

**附属**: [`getFlexFallbacks()`](../../src/engine/utils/LayoutValidator.ts) — FILL 时注入 `layoutGrow=1` / `layoutAlign='STRETCH'`。

**消费者**: [`normalizeSizingInProps()`](../../src/engine/actions/nodeFactory.ts) 调用 `normalizeSizing()`，由 [`jsxHandler`](../../src/ipc/commands/jsxHandler.ts)、[`editHandler`](../../src/ipc/commands/editHandler.ts)、[`writeHandlers`](../../src/ipc/commands/writeHandlers.ts) 在 `normalizeProps()` 之后单独调用。

---

## 类型 4: 输入推断（Input Inference）

**定义**: 从多个输入组合推断属性值。不是简单的 A→B 依赖，而是多输入条件逻辑。

**来源**: [`node-normalizers.ts` L97-130](../../src/domain/node-normalizers.ts) `normalizeProps()` Step 2

| # | 推断 | 逻辑 |
|---|---|---|
| 1 | textAutoResize | widthLocked + heightLocked → `'NONE'`; widthLocked → `'HEIGHT'`; isCreate → `'WIDTH_AND_HEIGHT'` |
| 2 | text alignment 映射 | `primaryAxisAlignItems` → `textAlignHorizontal`; `counterAxisAlignItems` → `textAlignVertical` |

**不适合放进 propertyDependencies**: 多输入条件 + isCreate 上下文，超出 gate/condition/dependents 模型。

---

## 类型 5: 节点类型限制（Node-Type Restriction）

**定义**: 某些属性在特定节点类型上无效，需要删除。

**来源**: [`node-normalizers.ts` L133-190](../../src/domain/node-normalizers.ts) `normalizeProps()` Step 3, 6

| # | 规则 | 动作 |
|---|---|---|
| 1 | LINE 不支持 height | 删除 height + warn |
| 2 | 非 TEXT 节点不支持 text-only props（`TEXT_ONLY_PROPS`） | 删除 + warn |

---

## 类型 6: 输入清理（Input Sanitization）

**定义**: 纠正格式错误或越界的输入值。不涉及 Figma 约束逻辑，只涉及值合法性。

**来源**: [`node-normalizers.ts` L139-204](../../src/domain/node-normalizers.ts) `normalizeProps()` Step 4-7

| # | 规则 | 动作 |
|---|---|---|
| 1 | boolean layout props（clipsContent 等）收到 string | string→boolean 转换 |
| 2 | enum 值不在 `PROP_METADATA.enumMap` | case-insensitive 匹配，不匹配→删除 + warn |
| 3 | scalar 值超出 `PROP_METADATA` min/max | clamp 到范围内 |
| 4 | 未知属性名（不在 `KNOWN_PROP_KEYS`） | Levenshtein 建议→删除 + warn |

---

## 类型 7: DSL 默认值（DSL Defaults）

**定义**: DSL 入口处注入 sensible defaults。不是 Figma 约束，是我们的 DX 决策。

**来源 1**: [`jsxHandler.ts`](../../src/ipc/commands/jsxHandler.ts) `applyLayoutDefaults`

| # | 规则 | 动作 |
|---|---|---|
| 1 | frame 有 layout 但没写 w | 注入 `w: 'hug'` |
| 2 | frame 有 layout 但没写 h | 注入 `h: 'hug'` |

**来源 2**: [`expandShorthands.ts`](../../src/engine/actions/expandShorthands.ts) — `row`/`column`/`row-fill` 等 pattern 展开为 layoutMode + sizing 组合。

---

## 类型 8: 设计质量 Lint（Design Quality Lint）

**定义**: 不是 Figma API 约束（Figma 不阻止），是设计最佳实践检查。

**来源**: [`postOpValidator.ts` L64-145](../../src/engine/validation/postOpValidator.ts) `validatePostOp()`

> **注意**: 当前无生产代码调用。只在测试文件中使用。

| # | code | 检查 | 是 Figma 约束？ |
|---|---|---|---|
| 1 | `ZERO_DIM` | width=0 或 height=0（LINE h=0 豁免） | 否 |
| 2 | `INVISIBLE` | opacity=0 | 否 |
| 3 | `TEXT_OVERFLOW` | 固定文本框内容溢出 | 否 |
| 4 | `TEXT_WIDTH_COLLAPSED` | 窄文本框导致过度换行 | 否 |
| 5 | `CHILDREN_OVERFLOW` | auto-layout 子节点总尺寸超过 FIXED 容器 | 否 |
| 6 | `SIBLING_WIDTH_MISMATCH` | 垂直布局子节点宽度不一致 | 否 |
| 7 | `MISSING_AUTO_LAYOUT` | 多子节点无 layout 重叠在原点 | 否 |
| 8 | `HUG_FILL_CYCLE` | parent HUG + child FILL 循环依赖 | **是**（Figma 静默退回 FIXED） |
| 9 | `LOW_CONTRAST` | 文字对比度 < 3:1 | 否 |
| 10 | `EMPTY_FRAME` | 空 frame 无子节点无 fill | 否 |
| 11 | `CORNER_RADIUS_MISMATCH` | 子圆角 > 父圆角 | 否 |
| 12 | `SMALL_TAP_TARGET` | 交互元素 < 44×44px | 否 |
| 13 | `BANNED_NAME` | Figma 默认名（Frame, Unnamed, Group） | 否 |
| 14 | `TEXT_MISSING_STYLE` | 无 fill 或 fontSize < 8 | 否 |
| 15 | `WHITE_ON_WHITE` | 白底白边框 | 否 |
| 16 | `SIZING_REVERTED` | FILL/HUG 被降为 FIXED | **是**（与类型 3 重复） |

16 条里只有 2 条是 Figma 约束（#8 `HUG_FILL_CYCLE`、#16 `SIZING_REVERTED`），其余 14 条是 lint。

---

## 重复关系总结

只有 **FILL/HUG sizing 约束**存在跨文件重复：

```
"FILL 需要 parent auto-layout"
  ├── propertyDependencies.ts  DEPENDENCY_RULES #3   → warn（parent scope 不能 inject）
  ├── LayoutValidator.ts       normalizeSizing #3     → 降级 FILL→HUG→FIXED
  └── postOpValidator.ts       SIZING_REVERTED        → 检测降级是否发生

"HUG 需要 self auto-layout"
  ├── propertyDependencies.ts  DEPENDENCY_RULES #1   → gate check + inject layoutMode
  └── LayoutValidator.ts       normalizeSizing #2     → 降级 HUG→FIXED

"HUG parent + FILL child = 循环"
  └── postOpValidator.ts       HUG_FILL_CYCLE         → 唯一来源（但未接入生产）
```

其余 6 类规则（执行顺序、输入推断、节点类型限制、输入清理、DSL 默认值、设计 lint）**各自独立，无重复**。

---

## 统一方向（备忘）

如果要消除重复，核心改动是让 LayoutValidator 的降级逻辑引用 propertyDependencies 的规则定义，而不是重新编码同一条判断。其余文件的规则属于不同类型，不需要合并到 propertyDependencies。
