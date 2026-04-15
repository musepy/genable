# edit → Setter 拆分分析

> Date: 2026-04-01
> Status: 研究阶段
> Related: [tool-refactoring-index.md](tool-refactoring-index.md) | [openpencil-tool-architecture.md](openpencil-tool-architecture.md)

## 问题

当前 `edit({node, props})` 是万能 setter——通过 handler pipeline 可设置所有属性。Schema 太宽泛，LLM 缺乏意图信号。OpenPencil 拆成 8 个 core setter，值得分析拆分逻辑。

---

## OpenPencil 8 Core Setter 清单

| # | Setter | 控制的设计决策 | 关键参数 |
|---|--------|--------------|---------|
| 1 | `update_node` | 通用/杂项（位置、尺寸、透明度） | id + 各属性 |
| 2 | `set_layout` | 父节点布局配置 | direction, spacing, padding, align |
| 3 | `set_layout_child` | 子节点 sizing 行为 | sizing_horizontal/vertical, grow |
| 4 | `set_radius` | 圆角 | radius, top_left/right... |
| 5 | `set_fill` | 填充颜色/渐变 | color, color_end, gradient |
| 6 | `set_stroke` | 描边 | color, weight, align |
| 7 | `set_text` | 文本内容 | text |
| 8 | `set_text_properties` | 文本视觉样式 | align_horizontal/vertical, decoration |

Extended 补充（12 个）：`set_effects`, `set_opacity`, `set_font`, `set_visible`, `set_constraints`, `set_rotation`, `set_minmax`, `set_font_range`, `set_text_resize`, `set_blend`, `set_locked`, `set_stroke_align`, `set_image_fill`

---

## 为什么是 8 个？三个拆分原则

### 原则 1：一个 setter = 一个设计决策的原子单位

设计师的心智模型不是"设置 paddingLeft=16"，而是"调间距"、"改颜色"、"调圆角"。每个 setter 对应一个设计意图：

```
设计意图              →  setter
"把背景改成蓝色"      →  set_fill
"加个描边"           →  set_stroke
"调一下间距和 padding" →  set_layout
"让子元素自适应宽度"   →  set_layout_child
"圆角大一点"         →  set_radius
"改文字内容"         →  set_text
"文字居中"           →  set_text_properties
"挪一下位置/改大小"   →  update_node
```

### 原则 2：参数互斥性

set_fill 的参数（color, gradient）和 set_layout 的参数（direction, spacing, padding）**永远不会**在同一个意图中共现。如果两组参数经常一起出现，就不该拆。

反例：如果拆出 `set_padding` 和 `set_spacing`，它们经常一起出现（调布局时通常同时调间距和内边距），所以 OpenPencil 把它们合并在 `set_layout` 里。

### 原则 3：操作目标差异

`set_layout` vs `set_layout_child` 最能说明这个原则——虽然都是"布局相关"，但：
- `set_layout` 改的是**父节点**的布局配置（方向、间距、padding）
- `set_layout_child` 改的是**子节点**如何响应父的布局（sizing、grow）

操作目标不同 = 心智模型不同 = 应该是不同 tool。同理 `set_text`（改内容）vs `set_text_properties`（改样式）。

### 为什么不是 1 或 20

| 方案 | 问题 |
|------|------|
| 1 个 edit（我们现状）| Schema 太宽泛，LLM 不知道该填哪些参数；调用 edit 看不出意图 |
| 20+ setter | 选择困难——LLM 要在 20 个里选对的；schema 开销 ~4K tok；低频 setter 是噪声 |
| **8 个** | 甜点：每个意图明确、高频覆盖 80%+、schema ~1.6K tok |

### update_node 是安全网

OpenPencil 没有让 7 个专用 setter 覆盖所有属性。`update_node` 承担"其他一切"——opacity、position、size 这些不属于任何特定设计维度但又常用的属性。避免了 setter 数量膨胀。

---

## Variable 绑定覆盖分析

### Figma 5 类可绑定字段

```
VariableBindableNodeField:         通用节点
  width, height, characters,
  itemSpacing, paddingLeft/Right/Top/Bottom,
  visible, topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius,
  minWidth, maxWidth, minHeight, maxHeight,
  counterAxisSpacing, strokeWeight, strokeTopWeight/Bottom/Left/Right,
  opacity

VariableBindableTextField:         文本专属
  fontFamily, fontSize, fontStyle, fontWeight,
  letterSpacing, lineHeight, paragraphSpacing, paragraphIndent

VariableBindablePaintField:        填充/描边颜色
  color

VariableBindableEffectField:       效果
  color, radius, spread, offsetX, offsetY

VariableBindableLayoutGridField:   布局网格
  sectionSize, count, offset, gutterSize
```

### 8 Core Setter 覆盖情况

| 可绑定属性 | Core Setter | 覆盖？ |
|-----------|------------|--------|
| width, height | `update_node` | ✅ |
| opacity | `update_node` | ✅ |
| 四角 radius | `set_radius` | ✅ |
| itemSpacing, padding×4, counterAxisSpacing | `set_layout` | ✅ |
| strokeWeight（统一） | `set_stroke` | ✅ |
| characters | `set_text` | ✅ |
| fills/strokes color | `set_fill` / `set_stroke` | ✅ |
| **visible** | ❌ 无 core setter | ❌ 需 extended `set_visible` |
| **minWidth/maxWidth/minHeight/maxHeight** | ❌ | ❌ 需 extended `set_minmax` |
| **strokeTopWeight 等四边独立** | ❌ | ❌ 无专门 setter |
| **fontFamily/fontSize/fontStyle/fontWeight** | ❌ | ❌ 需 extended `set_font` |
| **letterSpacing/lineHeight** | ❌ | ❌ 不确定 `set_font` 是否覆盖 |
| **paragraphSpacing/paragraphIndent** | ❌ | ❌ 大概率无覆盖 |
| **effect 属性** | ❌ | ❌ 需 extended `set_effects` |
| **layoutGrid 属性** | ❌ | ❌ 无 setter |

### 结论

**8 core setter 覆盖约 60% 的可绑定属性**。加上 12 个 extended setter 后覆盖 ~90%。仍有缝隙：
- 四边独立描边（strokeTopWeight 等）
- 文本排版属性（letterSpacing/lineHeight/paragraphSpacing/paragraphIndent）—— 取决于 `set_font` 的实际参数范围
- layoutGrid 属性（无 setter）

但 `update_node` 如果是真正的通用兜底（接受任意属性名），则可以填补所有缝隙。

---

## 对我们拆分 edit 的启示

### 优点

- **意图明确**: `set_fill(node, {color: "#1A73E8"})` 比 `edit(node, {fills: [{type:'SOLID', color:{r:0.1,g:0.45,b:0.91}}]})` 清晰得多
- **Schema 精确**: 每个 tool 的参数类型明确，LLM 不会犯"给 text 节点设 layoutMode"的错误
- **可验证性**: 返回值可以针对性设计（set_fill 返回颜色确认，set_layout 返回布局状态）

### 风险

- **跨类别组合**: 同时改 fill + padding + corner 需要 3 次 tool call（当前 edit 一次搞定）
- **Token 开销**: 每个 tool ~200 tok schema，8 个 = ~1.6K 额外 prompt cost
- **选择认知负担**: LLM 要在 8+ 个 setter 中选择正确的（但 OpenPencil 验证了 LLM 能做到）

### 我们的 handler pipeline 是天然的拆分边界

当前 `applyProps` 的 10 个 handler 按处理逻辑分组，和 setter 的分组高度吻合：

```
handler                    → 对应 setter
variableBindingHandler     → 横切所有 setter（$syntax）
styleRefHandler            → 可能独立为 set_style
paintHandler               → set_fill, set_stroke
effectHandler              → set_effects
unitValueHandler           → set_text_properties（letterSpacing, lineHeight）
resizeHandler              → update_node（width, height）
constraintsHandler         → set_constraints
dashPatternHandler         → set_stroke
hyperlinkHandler           → set_text_properties
defaultHandler             → update_node（兜底）
```

---

## 实际 edit 调用数据分析（2026-04-01）

数据来源：24 个 dev bridge E2E meta.json（/tmp + docs/e2e-results），22 次 edit 调用，展开为 114 个节点级 prop set。

### 属性共现模式（频率排序）

```
 37x  [_content_only]                        → 纯文字内容更新
 18x  [fill]                                 → 单独改颜色
  9x  [fill, font, fontSize, fontWeight,     → 完整文本节点设置
       h, type, w]
  6x  [p]                                    → 单独改 padding
  6x  [bg]                                   → 单独改背景
  5x  [gap]                                  → 单独改间距
  4x  [bg, stroke]                           → 卡片样式（背景+描边）
  4x  [Name, Role]                           → 组件属性覆写
  3x  [w]                                    → 单独改宽度
  3x  [fill, w]                              → 颜色+宽度
  3x  [Price, ProductName]                   → 组件属性覆写
  1x  [gap, justify]                         → 间距+对齐
  1x  [bg, corner]                           → 背景+圆角
  1x  [bg, corner, fill]                     → 背景+圆角+文字色
  1x  [bg, corner, stroke]                   → 背景+圆角+描边
  1x  [align, fill]                          → 对齐+颜色
  1x  [align, fill, w]                       → 对齐+颜色+宽度
  1x  [bg, fill]                             → 背景+文字色
  1x  [fill, stroke]                         → 填充+描边色
  1x  [layout]                               → 改布局方向
```

### 单属性频率

```
 35x  fill          (文字色或填充色)
 16x  w             (宽度)
 14x  bg            (背景)
  9x  font/fontSize/fontWeight  (文本排版，总是成套出现)
  6x  gap           (间距)
  6x  p             (padding)
  6x  stroke        (描边)
  3x  corner        (圆角)
  2x  align         (对齐)
  1x  justify       (flex justify)
  1x  layout        (布局方向)
```

### 按设计意图分类

| 意图类别 | 数量 | 占比 | 典型模式 |
|---------|------|------|---------|
| **CONTENT** (改文字内容) | 37 | 32% | `edit({content: "..."})` |
| **COLOR/SURFACE** (改颜色/背景/描边) | 30 | 26% | `fill`, `bg`, `bg+stroke`, `fill+stroke` |
| **LAYOUT** (间距/padding/方向) | 13 | 11% | `p`, `gap`, `layout`, `gap+justify` |
| **TEXT_SETUP** (完整文本节点设置) | 9 | 8% | `type+font+fontSize+fontWeight+fill+w+h` |
| **COMPONENT_DATA** (组件属性覆写) | 14 | 12% | `Name+Role`, `Price+ProductName` |
| **SIZING** (改尺寸) | 3 | 3% | `w` |
| **MIXED** (跨类别混合) | 8 | 7% | `fill+w`, `bg+corner+fill`, `align+fill+w` |

### 关键发现

#### 发现 1：92% 的 edit 可以映射到单个 setter

114 个 prop set 中，106 个（92%）只涉及一个设计意图类别。仅 8 个（7%）需要跨类别组合。

**参数互斥性假设成立** — fill/bg 和 gap/p 和 corner 确实很少在同一次 edit 中共现。

#### 发现 2：LLM 的实际意图聚类与 OpenPencil 8 setter 高度吻合

| 我们的数据聚类 | 对应 OpenPencil setter | 频率 |
|--------------|----------------------|------|
| 纯文字内容 | `set_text` | 32% |
| fill/bg/stroke 颜色 | `set_fill` + `set_stroke` | 26% |
| padding/gap/direction | `set_layout` | 11% |
| 宽度/高度 | `update_node` 或 `set_layout_child` | 3% |
| 圆角 | `set_radius` | ≤2% |

缺少对应：
- **TEXT_SETUP (8%)** — OpenPencil 没有"完整文本节点设置"的 setter，需要 3 个 setter 组合
- **COMPONENT_DATA (12%)** — OpenPencil 没有组件属性覆写 setter

#### 发现 3：TEXT_SETUP 是一个重要的特殊模式

9 次 `{type, w, h, font, fontSize, fontWeight, fill}` 的完整组合出现，代表"把节点转为文本类型"操作。在 OpenPencil 模型下需要 3 次 setter 调用（update_node + set_font + set_fill），但概念上是 1 个操作。

**这暗示我们不应 1:1 抄 OpenPencil 的分类**，而应考虑保留一个处理"多属性批量设置"的路径。

#### 发现 4：fill 是最多态的属性

fill 出现 35 次，18 次单独出现，17 次与其他属性共现。它既是"文字颜色"也是"图形填充"，语义取决于目标节点类型。如果拆 setter，fill 会横跨 set_fill 和 set_text_properties。

#### 发现 5：组件属性覆写是独立意图

14 次（12%）组件属性覆写（Name+Role, Price+ProductName）完全不属于任何 OpenPencil setter。这是我们有 component instance 但 OpenPencil 的 core setter 没覆盖的场景。

#### 发现 6：batch edit 中 40% 是跨类别混合

20 次 batch edit（含 nodes 数组）中：

```
PURE  (单类别): 12 (60%)
  9x  CONTENT only        ← 批量改文字
  3x  COLOR only           ← 批量改颜色
  5x  COMP_DATA only       ← 批量改组件属性
  1x  LAYOUT only          ← 批量改间距

MIXED (跨类别): 8 (40%)
  3x  COLOR + LAYOUT       ← 颜色和间距一起调（11+2+2 节点）
  1x  TEXT_STYLE + COLOR + SIZING  ← 9 个文本节点全设置
  1x  COLOR + RADIUS + SIZING + ALIGN  ← 20 节点大型 polish pass
  1x  LAYOUT + SIZING      ← gap + width 一起调
  1x  COLOR + LAYOUT       ← fill + padding
  1x  COLOR + CONTENT      ← 改文字顺便改颜色
```

**关键洞察：MIXED batch 是"一次性 polish pass"** — LLM inspect 完整设计后，把所有需要修的东西打包成一次 edit。如果拆成 setter，这个 20 节点的 polish pass 会变成 4 次 setter 调用。**这与效率目标矛盾。**

#### 发现 7：当前 edit 错误率为 0

22 次 edit 调用，0 error，0 warning。**LLM 使用当前 edit 没有犯过错误。**

这意味着拆分 edit 的收益不是"减少错误"，而是"增加意图清晰度"——但数据不支持后者有实际价值（LLM 已经在正确使用了）。

---

## 设计决策：setter + edit 双层模型（2026-04-01）

### 核心洞察

OpenPencil 的 `batch_update` 不组合 setter——它是独立的第三条写入路径。setter 的价值不在减少调用次数，而在**约束参数空间**：

- `set_fill({node, bg})` — 不可能传出 `gap` 或 `fontSize`
- `edit({node, props: {...任意...}})` — 什么都能传

拆分是**职责边界问题**（一个工具承担太多不同意图），不是错误率问题。

### 采用方案：4 setter + edit 保留（batch_update 角色）

```
精确修改（单节点、单意图、类型化参数）→ 4 setter
批量修复（N 节点、跨类别、自由参数）   → edit（保留 nodes[] batch）
```

| setter | 设计意图 | 参数 | 频率 |
|--------|---------|------|------|
| `set_text` | 改文字内容 | `{node, text}` 或 `{nodes: [{node, text}]}` | 32% |
| `set_fill` | 改颜色 | `{node, fill?, bg?}` | 26% |
| `set_stroke` | 加/改描边 | `{node, stroke}` 或 `{node, color, weight?, align?}` | 5% |
| `set_layout` | 调布局 | `{node, layout?, gap?, p?, justify?, align?, wrap?}` | 11% |
| `edit` | 批量修复 + 其余属性 | `{nodes: [{node, props?, content?}]}` | 剩余 |

### 职责边界

| | setter | edit |
|---|--------|------|
| 节点数 | 单节点（set_text 支持 batch） | N 节点 |
| 参数 | 类型化、约束 | 自由 props |
| 意图 | 单一设计决策 | polish pass / 批量修复 |
| 覆盖属性 | 颜色、描边、布局、文字 | sizing、radius、opacity、effects、组件属性... |

### 实现架构

```
set_fill({node, bg: "#FFF"})
  → IPC → setterAdapter.handleSetFill()
    → handleEdit({node, props: {bg: "#FFF"}})  // 委托给 editHandler
      → nodeFactory.applyProps()                // 复用 handler pipeline
```

setter 是 editHandler 的**类型化入口**，不是新管线。代码改动：
- `setterTools.ts` — 4 个 ToolDefinition（~120 行）
- `setterAdapter.ts` — 4 个 IPC adapter（~100 行）
- `unified/index.ts` — 注册 4 个工具
- `commands/index.ts` — 注册 4 个 handler
- `edit.ts` — 更新 description，引导 LLM 使用 setter

### 工具总数

```
之前: 20 工具
之后: 24 工具（+set_text, +set_fill, +set_stroke, +set_layout）
```

### 实现状态

- [x] `src/engine/agent/tools/unified/setterTools.ts` — 4 个 ToolDefinition
- [x] `src/ipc/commands/setterAdapter.ts` — 4 个 IPC adapter（委托 handleEdit）
- [x] `src/engine/agent/tools/unified/index.ts` — 注册
- [x] `src/ipc/commands/index.ts` — 注册
- [x] `src/engine/agent/tools/unified/edit.ts` — 更新 description
- [x] TypeScript 编译通过
- [x] Build 通过
- [x] 单元测试 — `setterAdapter.test.ts`（21 tests pass）：参数翻译、必填校验、batch 模式
- [x] Prompt 更新 — `CORE.md` setter 工具节 + edit 改为 batch 定位
- [x] E2E 测试 — `set_fill` 端到端验证通过（trigger-1775023972562）
  - 批量修改（3 变更）→ LLM 用 `edit`（batch_update 角色）✅
  - 单一修改（改按钮色）→ LLM 用 `set_fill`（setter 角色）✅
  - 路由链: setterAdapter → handleEdit → applyEdit → nodeFactory → success

---

## 代码文件导航

```
Setter 工具（新增）
  src/engine/agent/tools/unified/setterTools.ts  ← 4 个 setter ToolDefinition
  src/ipc/commands/setterAdapter.ts              ← 4 个 IPC adapter → handleEdit
  src/ipc/commands/__tests__/setterAdapter.test.ts ← 21 个单元测试

edit（更新角色为 batch_update）
  src/engine/agent/tools/unified/edit.ts         ← edit 工具定义（updated description）
  src/ipc/commands/editHandler.ts                ← IPC handler（setter 也委托给它）

共享管线（不变）
  src/engine/actions/nodeFactory.ts              ← applyProps
  src/engine/actions/expandShorthands.ts         ← 简写展开
  src/engine/actions/handlers/                   ← 10 个 property handler

注册
  src/engine/agent/tools/unified/index.ts        ← unifiedTools 数组
  src/ipc/commands/index.ts                      ← COMMAND_HANDLERS dispatch table

OpenPencil 参考
  docs/knowledge/openpencil/openpencil-tool-architecture.md  ← 93 工具全景
  docs/knowledge/openpencil/openpencil-deep-dive.md          ← batch_update vs setter 分析
```
