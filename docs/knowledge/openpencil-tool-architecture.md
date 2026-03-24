# OpenPencil 工具架构分析

> Source: https://github.com/open-pencil/open-pencil
> Date: 2026-03-24

## 概述

OpenPencil 是开源 AI 原生矢量设计编辑器，自有渲染引擎（Vue3 + Skia/CanvasKit + Yoga layout）。
通过 FigmaNodeProxy 层模拟 Figma Plugin API 接口，工具代码"长得像"Figma API 但实际操作自有 SceneGraph。

Agent 运行时：Vercel AI SDK `ToolLoopAgent`，无自定义 loop/hook/phase 状态机。50 步上限。
工作流完全靠 system prompt 驱动（571 行 markdown）。

---

## 工具总览

| 层级 | 工具数 | 加载场景 | Schema Token |
|------|--------|----------|-------------|
| CORE_TOOLS | 23 | AI Chat（默认） | ~3K |
| EXTENDED_TOOLS | 69 | MCP / CLI | — |
| MCP-only | 1 (`get_codegen_prompt`) | MCP | — |
| **合计** | **93** | | |

---

## CORE_TOOLS（23 个）— AI Chat 默认加载

### Read（5 个）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `get_selection` | 获取当前选中节点 | — |
| `get_node` | 按 ID 读节点详细属性 | id, depth |
| `find_nodes` | 按名称/类型搜索节点 | name, type |
| `get_jsx` | 获取节点的 JSX 表示（可往返） | id |
| `describe` | 语义描述 + 角色检测 + **内置 lint 48 条规则** | id, ids, depth, grid |

### Create（1 个）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `render` | JSX 创建节点，支持 `replace_id` 原子替换 | jsx, replace_id, parent_id, x, y |

### Modify（8 个 setter）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `update_node` | 通用属性更新（位置、尺寸、透明度、圆角、文字） | id + 各属性 |
| `set_layout` | Auto-layout：方向、对齐、间距、padding | id, direction, spacing, padding, align |
| `set_layout_child` | 子节点布局：sizing、grow、alignment | id, sizing_horizontal/vertical, grow |
| `set_radius` | 圆角（统一或逐角） | id, radius, top_left/right... |
| `set_fill` | 填充：纯色或线性渐变 | id, color, color_end, gradient |
| `set_stroke` | 描边 | id, color, weight, align |
| `set_text` | 设置文本内容 | id, text |
| `set_text_properties` | 文本对齐、resize、装饰 | id, align_horizontal/vertical... |

### Structure（3 个）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `delete_node` | 删除节点 | id |
| `reparent_node` | 移动节点到新父节点 | id, parent_id |
| `node_resize` | 调整尺寸 | id, width, height |

### Batch（1 个）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `batch_update` | 批量修改（JSON 数组 {id, props}） | operations |

### Utility（4 个）
| 工具名 | 说明 | 关键参数 |
|--------|------|----------|
| `stock_photo` | 搜索并应用 stock 图片 | requests (JSON 数组) |
| `calc` | 算术计算器（避免 LLM 心算错误） | expr |
| `eval` | 执行任意 JS（escape hatch） | code |
| `viewport_zoom_to_fit` | 缩放视口适应节点 | ids |

---

## EXTENDED_TOOLS（69 个）— 仅 MCP/CLI

### Read 进阶（10 个）
`get_page_tree`, `get_current_page`, `list_pages`, `select_nodes`, `query_nodes`(XPath),
`get_components`, `switch_page`, `page_bounds`, `list_fonts`, `diff_jsx`

### Create 进阶（9 个）
`create_shape`, `search_icons`, `insert_icon`, `fetch_icons`, `create_component`,
`create_instance`, `create_page`, `create_vector`, `create_slice`

### Modify 进阶（12 个 setter）
`set_effects`(阴影/模糊), `set_opacity`, `set_font`, `set_visible`, `set_constraints`,
`set_rotation`, `set_minmax`, `set_font_range`(范围字体), `set_text_resize`,
`set_blend`(混合模式), `set_locked`, `set_stroke_align`, `set_image_fill`

### Structure 进阶（14 个）
`clone_node`, `node_move`, `rename_node`, `group_nodes`, `ungroup_node`, `flatten_nodes`,
`node_to_component`, `node_bounds`, `node_ancestors`, `node_children`, `node_tree`,
`node_bindings`, `node_replace_with`(JSX 替换), `arrange`(网格/行/列排列)

### Variables（11 个）
`list_variables`, `list_collections`, `get_variable`, `find_variables`, `create_variable`,
`set_variable`, `delete_variable`, `bind_variable`, `get_collection`, `create_collection`,
`delete_collection`

### Vector & Export（13 个）
`boolean_union/subtract/intersect/exclude`, `path_get/set/scale/flip/move`,
`viewport_get/set`, `export_svg`, `export_image`

### Analyze & Diff（6 个）
`analyze_colors`, `analyze_typography`, `analyze_spacing`, `analyze_clusters`(重复模式检测),
`diff_create`(结构 diff), `diff_show`(预览 diff)

### Codegen（2 个）
`design_to_tokens`(提取 design tokens), `design_to_component_map`(组件分解)

---

## 4 阶段工作流（system prompt 驱动，无代码强制）

### Phase 1: Plan（纯文本，0 工具）
- LLM 输出编号分区计划 + 大致尺寸 + 布局策略
- 不调用任何工具

### Phase 2: Skeleton（~8 次工具调用）
- 用灰色占位块构建完整页面线框
- 工具使用：
  - `calc` × 1（批量算所有尺寸）
  - `render` × 5-7（每次 ≤40 元素，骨架块用 `#E2E8F0`, `#CBD5E1`）
  - `describe` × 1（root depth=2 验证布局）
  - `batch_update` × 1（修复所有 issues）

### Phase 3: Fill Content（~10 次工具调用）
- 逐区替换骨架为真实内容
- **强制模式**: `render({replace_id})` → `describe` → `batch_update` → 下一个区
- 每 3 次 render 后对 root describe depth=1 检查整体布局漂移
- 工具使用：
  - `render` × 6（每次带 replace_id）
  - `describe` × 3-6（每次 render 后验证）
  - `batch_update` × 1-2（修复问题）

### Phase 4: Polish（~3 次工具调用）
- 工具使用：
  - `stock_photo` × 1（批量处理所有图片占位）
  - `describe` × 1（最终检查）
  - `batch_update` × 1（修复剩余问题）

**总预算**: 12-25 步 / 50 步上限

### 各阶段工具分布

```
Phase 1 (Plan):    0 工具调用
Phase 2 (Skeleton): calc(1) + render(5-7) + describe(1) + batch_update(1) = ~9
Phase 3 (Fill):    render(6) + describe(3-6) + batch_update(1-2) = ~11
Phase 4 (Polish):  stock_photo(1) + describe(1) + batch_update(1) = ~3
                                                              Total: ~23
```

---

## Describe 工具内置 Lint：48 条规则

### 架构

```
describe(node)
  └→ detectIssues(node, gridSize, graph)
       ├── detectStructuralIssues()    — 12 条
       ├── detectVisibilityIssues()    — 3 条
       ├── detectLayoutIssues()        — 20 条
       ├── detectRadiusIssues()        — 2 条
       ├── detectTypographyIssues()    — 1 条
       ├── detectSpacingIssues()       — 4 条
       └── standalone checks          — 6 条
```

### 严重级别

```
error:   overflow, invisible, dark on dark, 触摸目标太小, 嵌套文字
warning: 大部分规则（默认）
info:    重复命名, 大写文字, 颜色与父级相同, 圆角建议
```

### 结构问题（12 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 1 | 亚像素坐标 | `Subpixel position (3.5, 7.2)` |
| 2 | 空 frame 无填充 | `Empty frame with no fill` |
| 3 | 不可见图形 | `RECTANGLE has no fill and no stroke — invisible` |
| 4 | 空图标容器 | `Icon-sized frame (24x24) has no visible content` |
| 5 | 触摸目标太小 | `Touch target too small (32x28)` — 按钮 < 44px |
| 6 | Gap 不在网格上 | `Gap 13 not on 8px grid` |
| 7 | 有 stroke 颜色但 weight=0 | `has stroke color but zero weight` |
| 8 | 有 stroke weight 但无颜色 | `has stroke weight but no visible stroke` |
| 9 | 圆角未裁剪 | `circular but not clipping — image children will overflow` |
| 10 | 过度嵌套 | `3 levels of single-child wrapper frames` |
| 11 | 子节点颜色=父节点 | `fill #FFFFFF matches parent — invisible border` |
| 12 | 图片占位缺失 | `looks like image container but no image or placeholder fill` |

### 可见性问题（3 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 13 | 近透明填充 | `Near-invisible fill #FF0000 at 10%` — opacity < 15% |
| 14 | 近透明描边 | `Near-invisible stroke at 15%` — opacity < 20% |
| 15 | 低对比度文字 | `Low contrast: text #333 on #3A3A3A (distance 12)` — RGB 距离 < 15 |

### 布局问题（20 条）— 最大的类别

| # | 规则 | 示例消息 |
|---|------|----------|
| 16 | 文字无颜色 | `"Title" has no color — invisible` |
| 17 | 深色背景+深色文字 | `"Title" dark on dark (#222 on #1A1A1A)` |
| 18 | 重复子节点名 | `3 children named "Item" — ambiguous` |
| 19 | fill sizing 无 auto-layout | `uses fill sizing but parent has no auto-layout` |
| 20 | 子节点太小（非 flex） | `200px wide inside 800px Container (no auto-layout)` |
| 21 | wrap 无 rowGap | `uses wrap but no rowGap — rows stick together` |
| 22 | justify=between 子节点 <2 | `only 1 child — needs >=2` |
| 23 | justify=between + HUG | `no effect when parent shrinks to fit` |
| 24 | items=stretch 被忽略 | `all children have fixed height — stretch ignored` |
| 25 | 等宽子节点无 gap | `4 equal children packed at start with no gap` |
| 26 | 分割线方向错误 | `Vertical divider inside column layout` |
| 27 | grow 在 HUG 父节点 | `grow=1 inside HUG parent — no effect` |
| 28 | grow 覆盖固定尺寸 | `fixed width=200 and grow=1 — grow overrides` |
| 29 | 子节点溢出（主轴） | `"Inner" (500px) overflows "Outer" (300px)` |
| 30 | 子节点总宽溢出 | `Children total 800px > available 600px` |
| 31 | HUG 塌陷（全 grow） | `HUG but all children use grow — collapses to zero` |
| 32 | HUG 塌陷（交叉轴 stretch） | `HUG on cross axis but all children stretch — collapses` |
| 33 | 文字溢出（宽度） | `Text 500px wide, parent has 300px` |
| 34 | 文字换行 | `Text wraps to ~4 lines in 200px` |
| 35 | 交叉轴溢出 | `300px on cross axis, parent has 200px` |

### 圆角问题（2 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 36 | 子圆角 > 父圆角 | `"Inner" radius 20 > parent 12` |
| 37 | 内圆角计算错误 | `radius 12 should be 4 (parent 12 - padding 8)` |

### 排版问题（1 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 38 | 大字号用大写 | `"SUBSCRIBE" uppercase at 18px — only for small labels <=13px` |

### 间距问题（4 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 39 | Gap 远大于 padding | `Gap 32 >> padding 8` — gap > 2x padding |
| 40 | 间距不在 4px 网格 | `Spacing 13 off 4px grid` |
| 41 | 兄弟节点 padding 不一致 | `Inconsistent padding across siblings (24, 32, 16)` |
| 42 | 兄弟节点 gap 不一致 | `Inconsistent gaps across siblings (8, 12, 16)` |

### 独立检查（6 条）

| # | 规则 | 示例消息 |
|---|------|----------|
| 43 | 嵌套文字 | `Nested Text "inner" inside "outer" — causes overflow` |
| 44 | 容器有填充无 padding | `has text content with fill but no padding` |
| 45 | 按钮无水平 padding | `Button "CTA" has no horizontal padding` |
| 46 | 行内容未对齐 | `row children top-aligned with large empty space below` |
| 47 | 兄弟高度不一致 | `"Card3" is 180px while siblings are ~120px` |
| 48 | 嵌套 flex 无 fill/grow | `Nested flex may collapse — no fill or grow` |

### Issue 数据结构（返回给 LLM）

```typescript
interface DescribeIssue {
  severity: 'error' | 'warning' | 'info'
  message: string
  suggestion?: string    // 修复建议（文字描述，非可执行命令）
}
```

### LLM 看到的输出示例

```json
{
  "id": "0:5",
  "name": "LoginCard",
  "type": "FRAME",
  "role": "article",
  "size": "400x500",
  "visual": "#FFFFFF fill, rounded, drop shadow",
  "layout": "vertical, justify=center, 16px gap, 24px padding",
  "issues": [
    {"severity": "error", "message": "dark on dark (#333 on #2A2A2A)", "suggestion": "Use a light color"},
    {"severity": "warning", "message": "Gap 14 not on 8px grid", "suggestion": "16"}
  ],
  "children": [
    {"role": "heading(2)", "name": "Title", "summary": "\"Sign In\" 24px Inter bold", "id": "0:6"},
    {"role": "button", "name": "Submit", "id": "0:8",
     "issues": [{"severity": "warning", "message": "no horizontal padding", "suggestion": "Add px={16}"}]}
  ]
}
```

---

## 与我们的 qualityScorer 对比

| 维度 | 我们的 qualityScorer | OpenPencil describe |
|------|---------------------|---------------------|
| 检查数 | 6 维度（统计型） | 48 条规则（逐节点型） |
| 侧重点 | 覆盖率百分比（spacing:80%） | 具体节点的具体问题 |
| 布局检查 | 1 条（有无 auto-layout） | 20 条（溢出、grow 冲突、HUG 塌陷…） |
| 修复建议 | 可执行 edit 命令 ✅ | 文字描述 |
| 溢出检测 | 无 | 5 种溢出场景 |
| 对比度 | WCAG AA 标准 ✅ | 简单 RGB 距离 |
| 间距系统 | 4pt 网格 + 层级变化 | 4px/8px 网格 + 兄弟一致性 |
| 排版 | 字号/字重/比例 | 仅大写检查 |
| 触发时机 | 每次 inspect 自动 | 每次 describe 自动 |

### 我们缺少但 OpenPencil 有的

- 布局冲突检测：grow/HUG 矛盾、justify 无效、stretch 被忽略
- 溢出检测：子节点/文字/交叉轴溢出
- 结构检测：过度嵌套、不可见元素、亚像素坐标
- 圆角检测：子圆角 > 父圆角、内圆角公式
- 一致性检测：兄弟间 padding/gap 不一致

### 我们有但 OpenPencil 没有的

- WCAG AA 对比度标准（更严格）
- 可执行修复命令（agent 可直接复制粘贴）
- 排版层级分析（字号比例、字重多样性）
- 统计型总览（快速看出哪个维度最弱）

---

## 设计哲学差异

| 方面 | OpenPencil | 我们 |
|------|-----------|------|
| 工具粒度 | 细粒度 setter（每属性一工具） | 粗粒度（4 个工具覆盖全部） |
| 工具数量 | 23 core / 93 total | 4 |
| 创建方式 | `render`(JSX) — 相同 | `jsx`(JSX) — 相同 |
| 编辑方式 | N 个 setter | 1 个 `edit` (batch) |
| 验证方式 | `describe`(48 条 lint) | `inspect`(6 维度 quality score) |
| 工作流控制 | 纯 prompt（4 阶段） | 纯 prompt（WORKFLOW.md） |
| Agent 运行时 | Vercel AI SDK（无自定义） | 自研 AgentRuntime（hook 管线） |
| 上下文管理 | SDK 默认（全量历史） | 4 层分层 + 惰性压缩 |
