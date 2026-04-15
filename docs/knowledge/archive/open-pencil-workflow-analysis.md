# Open-Pencil 工作流分析

> 来源：https://github.com/open-pencil/open-pencil
> 分析时间：2026-03-20
> 主要文件：`src/ai/system-prompt.md`、`packages/core/src/tools/`

## 1. 四阶段工作流

Open-Pencil 的 AI Chat 使用严格的四阶段工作流，在 system prompt 中以 `## Workflow (MANDATORY)` 标注为强制执行。

### Phase 1 — Plan（纯文本，不调工具）

LLM 输出编号的分区计划，描述每个区块的尺寸和布局方式：

```
> 1. NavBar 1440×56 dark, row
> 2. Hero 1440×500 with image placeholder + overlay text
> 3. Stories grid: 2×2 cards in wrap row, grow cards
> 4. Sidebar: news feed + stocks widget + newsletter
> 5. Footer 3-col links
```

**设计意图**：强制 LLM 在动手前想清楚整体结构，避免边做边改的混乱。[^1]

### Phase 2 — Skeleton（创建占位骨架）

用 `render` 工具创建整页的灰色占位骨架。骨架使用真实的 Frame 布局结构，但内容用 Rectangle 替代。

```
Build the ENTIRE page with visible skeleton placeholders. Every section shows
gray blocks where content will go — the page looks like a wireframe with correct
proportions and spacing.
```

骨架创建完成后，**立即调用 `describe` 检查布局**，用 `batch_update` 修复问题。[^1]

### Phase 3 — Fill（逐区替换内容）

使用 `render(replace_id=xxx)` 将骨架节点原子替换为真实内容。**每次替换后必须 `describe` 检查 + `batch_update` 修复**：

```
render({ replace_id: "0:39", jsx: "..." })   // 1. render
describe({ id: "0:210" })                     // 2. IMMEDIATELY describe
batch_update({ operations: "[...]" })         // 3. fix ALL errors
// ONLY NOW proceed to next section
```

System prompt 明确禁止跳过检查：

> "Never skip step 2. Never defer describes to the end. Never batch multiple
> renders without describing each one. Errors compound — a missed `w="fill"`
> in Hero breaks Stories layout below it."

[^1]

### Phase 4 — Polish（批量填图 + 最终检查）

1. `stock_photo` 批量获取所有图片（一次调用，并行）
2. `describe` root depth=1 最终检查
3. `batch_update` 修复剩余问题

[^1]

## 2. 占位符约定

骨架占位符**没有正式 schema**，只是 system prompt 中的视觉惯例：

### 颜色约定

| 用途 | 颜色 | 说明 |
|------|------|------|
| 图片占位 | `#E2E8F0` | 浅灰，大面积矩形 |
| 文字占位 | `#CBD5E1` | 中灰，窄条状矩形 |
| 次要文字 | `#E2E8F0` | 浅灰，更短更细的矩形 |

### 形状约定

```jsx
// 图片占位 = 填满宽度的矩形
<Rectangle name="HeroImg" w="fill" h={420} bg="#E2E8F0" rounded={8} />

// 标题占位 = 接近全宽的矩形条
<Rectangle w="fill" h={28} bg="#CBD5E1" rounded={4} />

// 副标题/日期占位 = 短矩形条
<Rectangle w={200} h={14} bg="#E2E8F0" rounded={4} />

// 标签占位 = 很短的矩形
<Rectangle w={60} h={12} bg="#CBD5E1" rounded={4} />
```

### 关键特征

骨架是**真实节点**，不是特殊类型。容器结构（Frame、layout、gap、padding）和最终版完全一致，只是叶子节点用灰色 Rectangle 代替 Text 和图片。这意味着：

- 骨架可以被 `describe` 检查布局问题
- 替换时容器不变，只替换叶子节点
- 布局问题在骨架阶段就能发现和修复

[^1]

### 局限

没有结构化的模板定义。LLM 每次都要从零"发明"骨架结构（一个 card 骨架该有几个 Rectangle、什么比例），全靠 system prompt 中的两个示例（mobile app + 新闻网站）作为参考。[^1]

## 3. 批量设计

### `render` — 一次创建整棵子树

`render` 工具接受 JSX 字符串，通过 Sucrase 转译后构建节点树。一次调用可创建完整的嵌套结构：

```jsx
render({
  jsx: `<Frame name="Card" w={320} flex="col" gap={16} p={24} bg="#FFF" rounded={16}>
    <Text size={18} weight="bold">Title</Text>
    <Text size={14} color="#999">Description</Text>
  </Frame>`
})
```

支持 JavaScript 表达式（map、Array.from）用于生成重复结构。[^2]

System prompt 限制每次 render **不超过 40 个元素**，超过则拆分为 2-3 次调用：

> "🚫 NEVER render more than 40 elements in one render call."

[^1]

### `batch_update` — 批量属性修改

一次调用修改多个节点的属性：

```javascript
batch_update({
  operations: '[
    {"id":"0:5","props":{"spacing":8}},
    {"id":"0:6","props":{"sizing_horizontal":"FILL","grow":1}},
    {"id":"0:7","props":{"auto_resize":"HEIGHT"}}
  ]'
})
```

仅支持 16 个属性（spacing、padding 变体、alignment、sizing、grow、name、visible、corner_radius、opacity、auto_resize、direction）。填充、描边、字体等需要用单独的 `setFill`、`setFont` 等工具。[^3]

### `stock_photo` — 批量图片获取

所有图片在一次调用中并行获取：

```javascript
stock_photo({
  requests: '[
    {"id":"0:30","query":"wall street trading floor"},
    {"id":"0:58","query":"AI chip semiconductor"}
  ]'
})
```

System prompt 明确禁止逐个调用：

> "Batch all photos in one call — don't call stock_photo 14 times separately."

[^1]

### `calc` — 批量算术

所有布局计算在一次调用中批量完成：

```javascript
calc({ expr: '["1440 * 8 / 12", "(952 - 16) / 2", "floor(390 * 0.6)"]' })
```

System prompt 要求用工具计算，禁止心算：

> "Use calc for ALL layout arithmetic — never mental math."

[^1]

## 4. `describe` 检查设计

### 功能概述

`describe` 不是简单的属性读取，而是**自动诊断工具**。返回的是结构化诊断报告，不是原始属性列表。[^4]

### 返回结构

每个节点的描述包含：

| 字段 | 说明 |
|------|------|
| id, name, type | 节点身份 |
| role | 语义角色（button、link、heading(N)、separator 等，通过名称模式匹配 + 视觉特征自动检测） |
| size | "width×height" 可读格式 |
| visual | 人类可读的视觉描述（"white bg, 12px rounded, drop shadow"） |
| layout | 人类可读的布局描述（"vertical, gap=16, padding=24"） |
| issues[] | 代码自动检测的设计问题（severity + message） |
| children[] | 递归子节点描述 |

[^4]

### 自动深度控制（autoDepth）

根据子树规模自适应检查深度：

| 子节点数 | depth | 用途 |
|---------|-------|------|
| ≤15 | 4 | 小组件，深度检查 |
| ≤40 | 3 | 中等区块 |
| ≤100 | 2 | 大区域 |
| >100 | 1 | 全页概览 |

System prompt 建议省略 depth 参数使用自动模式：

> "⚠ Omit depth — it auto-adapts to subtree size."

[^1] [^4]

### 问题检测（30+ 种）

#### 结构问题（describe-issues.ts）

- 空 frame（无 fill 且无可见内容）
- 不可见 shape（无 fill + 无 stroke）
- 亚像素定位偏移
- 过深嵌套（单子节点 wrapper frame）
- 低对比度（文字在背景上，亮度 < 0.35）
- 触控区 < 44×44px（按钮）
- 圆角冲突（子节点圆角 > 父节点圆角、缺 overflow:hidden）
- 全大写文字 > 13px
- 间距不对齐网格

[^5]

#### 布局问题（describe-layout-issues.ts）

- 子节点溢出父节点边界
- 固定宽度 + grow 同时存在
- HUG 父容器 + 全部子节点 grow → 高度塌缩
- 文字缺 fill、窄容器文字溢出
- fill sizing 但父级没有 auto-layout
- 同级容器高度不一致
- 重复同名兄弟节点

每个问题带 severity（error/warning/info）。System prompt 指导优先级：

> "Fix error issues always. Fix warning issues when possible. Ignore info issues."

[^1] [^6]

### 使用模式

支持单节点和批量检查：

```javascript
// 单节点
describe({ id: "0:42" })

// 批量
describe({ ids: ["0:5", "0:6", "0:7"], depth: 1 })
```

System prompt 强调复用已有 ID：

> "Reuse IDs from render results and describe output. Do NOT call find_nodes
> to rediscover IDs already visible in previous tool results."

[^1]

## 5. 关注点分离

### 布局 vs 内容分离

四阶段工作流的核心设计是**将布局和内容分开处理**：

- **Phase 2（Skeleton）**：只关注布局结构（容器、间距、尺寸、排列）
- **Phase 3（Fill）**：只关注内容（文字、图片、颜色、字号）

这意味着：
- 布局 bug 在 Phase 2 就被发现和修复
- Phase 3 填充内容时不再调布局
- 不会出现"布局 bug + 内容 bug 混在一起"的 debug 困境

[^1]

### 计算 vs 创建分离

`calc` 工具单独处理所有算术，创建时直接使用计算结果：

```javascript
// 先算
calc({ expr: '["1440 - 48 - 48 - 24", "floor((1320) * 8 / 12)"]' })
// → [1320, 880]

// 再用
render({ jsx: `<Frame w={880}>...</Frame>` })
```

禁止在 render 中做心算或内联计算。[^1]

### 创建 vs 验证 vs 修复分离

每个创建动作后面紧跟验证和修复，形成**三拍子循环**：

```
create (render) → verify (describe) → fix (batch_update)
```

这三步不能合并、不能跳过、不能延后。[^1]

### 内容 vs 图片分离

Phase 3 先填文字内容，Phase 4 才批量填充图片。图片获取是 I/O 密集操作，集中到最后一步批量处理。[^1]

## 6. 信息流

### 整体信息流

```
Phase 1: Plan
  └─ 输出: 文字计划（编号区块列表）
       ↓
Phase 2: Skeleton
  ├─ calc()           → 输出: 尺寸数值
  ├─ render() ×5-7    → 输出: 节点 ID（idMap）
  ├─ describe(root)   → 输出: 布局诊断报告
  └─ batch_update()   → 输出: 修复确认
       ↓
Phase 3: Fill (每个区域重复)
  ├─ render(replace_id) → 输出: 新节点 ID
  ├─ describe(新节点)    → 输出: 内容诊断报告
  └─ batch_update()     → 输出: 修复确认
  └─ 每 3 次 render 后: describe(root, depth=1) → 全局布局漂移检查
       ↓
Phase 4: Polish
  ├─ stock_photo(batch) → 输出: 图片填充确认
  ├─ describe(root)     → 输出: 最终诊断报告
  └─ batch_update()     → 输出: 最终修复确认
```

[^1]

### ID 传递链

信息在工具之间通过 ID 传递：

1. `render()` 返回 `{ id: "0:42", children: [{id: "0:43"}, ...] }`
2. `describe(id: "0:42")` 使用 render 返回的 ID，返回深层子节点 ID
3. `batch_update` 使用 describe 返回的子节点 ID 修复具体节点
4. `render(replace_id: "0:43")` 使用之前获得的 ID 替换骨架节点
5. `stock_photo` 使用 render/describe 返回的图片占位节点 ID

System prompt 强调 ID 复用，禁止重复查询：

> "Reuse IDs from render results and describe output. These ARE the IDs
> for replace_id — use them directly. Do NOT call find_nodes to rediscover
> IDs already visible in previous tool results. Save 8+ tool calls and
> 16+ seconds per page."

[^1]

### Step Budget 控制

每条消息 50 步预算，典型分配：

```
1  calc
6  skeleton renders (Phase 2)
1  describe + fixes (Phase 2)
6  content renders (Phase 3)
2  describes + fixes (Phase 3)
1  stock_photo (Phase 4)
1  final describe + fixes (Phase 4)
─────
~18 步，留余量给重试和额外修复
```

快耗尽时 `ai-adapter.ts` 在 tool result 中追加警告：

> "⚠ 5 steps remaining out of 50. Wrap up: finish critical fixes, skip polish."

LLM 收到警告后应立即收尾。这是**软约束**（advisory），不是硬限制。[^7]

### 失败处理

System prompt 规定最多重试 2 次：

> "If a fix doesn't work after 2 attempts — delete the node and re-render
> with corrections. Do NOT debug with eval."

禁止用 `eval` 调试布局问题，强制走 delete → re-render 路径。[^1]

## 7. 与我们的对比总结

| 维度 | Open-Pencil | 我们（当前） |
|------|------------|------------|
| 工作流 | 强制四阶段（prompt MANDATORY） | PROGRESSIVE CREATION（建议性） |
| 创建后验证 | **强制** describe + fix | 可选 `cat -s`（靠 LLM 自觉） |
| 验证返回 | 诊断报告（role + issues + 修复建议） | 原始 JSON 或截图 |
| 问题检测 | 代码自动 30+ 种检测 | LLM 看截图自己判断 |
| 布局/内容分离 | 骨架阶段分离 | 不分离，同时创建 |
| 批量操作 | render(JSX)、batch_update、stock_photo、calc | mk batch、design 多行 |
| ID 管理 | 严格复用，禁止重复查询 | 路径寻址，较少关注 ID |
| 步数控制 | 50 步硬预算 + 警告 | 迭代次数限制（AgentLoopPolicy） |
| 读写格式 | JSX 对称（读写同格式） | 不对称（JSON 读 + CLI 写） |

## 参考文件

[^1]: `src/ai/system-prompt.md` — 570 行系统提示词，定义完整工作流、约束和示例
[^2]: `packages/core/src/tools/create.ts` — render 工具定义，JSX 创建节点
[^3]: `packages/core/src/tools/structure.ts` — batch_update 工具定义，16 个可批量更新属性
[^4]: `packages/core/src/tools/describe.ts` — describe 工具实现，角色检测 + 视觉分析 + 布局检查
[^5]: `packages/core/src/tools/describe-issues.ts` — 设计问题检测（结构、可见性、对比度、圆角、排版、间距）
[^6]: `packages/core/src/tools/describe-layout-issues.ts` — 布局问题检测（溢出、冲突、塌缩、文字、flex、一致性）
[^7]: `packages/core/src/tools/ai-adapter.ts` — AI 适配器，step budget 警告 + 重复调用检测 + no-op 检测
