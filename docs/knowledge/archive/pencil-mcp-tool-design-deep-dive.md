# Pencil MCP 工具设计深度研究

> 研究对象：Pencil MCP Server（.pen 文件编辑器）的全部 14 个工具
> 目的：提炼工具设计模式、Schema 设计、参数策略、执行模型，对比我们的 Figma 插件工具设计，发现可借鉴点

---

## 一、工具分层架构

Pencil 把 14 个工具按职责分为 5 层：

```
┌─────────────────────────────────────────────────┐
│ Layer 5: Design Knowledge（知识检索）             │
│   get_guidelines / get_style_guide_tags /        │
│   get_style_guide                                │
├─────────────────────────────────────────────────┤
│ Layer 4: Visual Verification（视觉验证）          │
│   get_screenshot / snapshot_layout               │
├─────────────────────────────────────────────────┤
│ Layer 3: Bulk Operations（批量操作）              │
│   search_all_unique_properties /                 │
│   replace_all_matching_properties                │
├─────────────────────────────────────────────────┤
│ Layer 2: Variable/Theme System（变量系统）        │
│   get_variables / set_variables                  │
├─────────────────────────────────────────────────┤
│ Layer 1: Core CRUD（核心读写）                    │
│   batch_design (I/C/U/R/M/D/G) / batch_get      │
│   get_editor_state / open_document /             │
│   find_empty_space_on_canvas                     │
└─────────────────────────────────────────────────┘
```

**关键洞察**：不是 1 个万能工具，也不是每个操作 1 个工具。而是按**抽象层级**分——底层精确操作、中层批量操作、上层知识检索。LLM 在不同阶段调用不同层级的工具。

### 对比：我们的 Figma 插件

| 层级 | Pencil | 我们 |
|------|--------|------|
| Core CRUD | batch_design + batch_get | create + edit + read |
| Bulk Ops | search_unique + replace_all | ❌ 缺失 |
| Variables | get/set_variables | ❌ 缺失 |
| Verification | screenshot + snapshot_layout | read(screenshot=true) |
| Knowledge | guidelines + style_guide | query_knowledge |

**核心差距：Layer 2-3 完全缺失。** 这意味着我们的 LLM 做批量修改时只能逐个列举，没有"改所有蓝色为紫色"的能力。

---

## 二、batch_design：操作脚本 DSL

### 2.1 设计哲学

batch_design 是 Pencil 最核心的写工具。它不是 JSON/XML，而是**类 JavaScript 的绑定脚本 DSL**：

```javascript
card=I("parent", {type: "frame", layout: "vertical", gap: 16})
title=I(card, {type: "text", content: "Hello"})
U(card+"/subtitle", {content: "Updated"})
D("oldNode")
G(card, "ai", "hero image prompt")
```

### 2.2 七种原子操作

| 操作 | 语法 | 返回值 | 用途 |
|------|------|--------|------|
| **Insert** | `id=I(parent, nodeData)` | 新节点 ID（绑定） | 创建新节点 |
| **Copy** | `id=C(sourceId, parent, overrides)` | 副本 ID（绑定） | 复制节点（含 descendants 覆盖） |
| **Update** | `U(path, updateData)` | 无 | 修改已有节点属性 |
| **Replace** | `id=R(path, nodeData)` | 替换后 ID（绑定） | 整体替换节点 |
| **Move** | `M(nodeId, parent, index)` | 无 | 移动节点位置 |
| **Delete** | `D(nodeId)` | 无 | 删除节点 |
| **GenerateImage** | `G(nodeId, "ai"\|"stock", prompt)` | 无 | 生成图片填充到节点 |

### 2.3 绑定系统（Binding System）

这是 Pencil DSL 最巧妙的设计。每个 I/C/R 操作都**必须**有一个绑定名：

```javascript
// 创建时绑定
card=I("parent", {type: "frame"})
// 后续引用——字符串拼接访问子节点
U(card+"/titleText", {content: "New Title"})
// 绑定作为 parent
child=I(card, {type: "text", content: "Child"})
```

**为什么这样设计：**
- Insert 返回的 nodeId 是运行时生成的，LLM 写操作时不知道
- 绑定解决了"引用未来节点"的问题——LLM 用变量名引用，runtime 替换为真实 ID
- `card+"/titleText"` 路径拼接支持组件实例内部子节点访问

**对比我们的 create 工具：**
- 我们用 XML 嵌套表达父子关系：`<frame><text>child</text></frame>`
- 优点：结构直观，一棵树一个 create 调用
- 缺点：不支持跨调用引用（create 返回 idMap，但 LLM 需要在下次调用时手动使用）
- Pencil 的绑定在**同一个 batch_design 调用内**天然支持前向引用

### 2.4 执行模型

- **顺序执行**：操作按书写顺序依次执行
- **事务性回滚**：任一操作失败 → 全部回滚
- **批次限制**：单次 ≤25 操作（避免 LLM 输出过长导致质量下降）
- **跨批次无绑定**：绑定只在同一个 batch_design 调用内有效

**25 操作限制的设计意图：**
这和我们 MEMORY.md 中记录的 "属性遗漏" 问题完全一致——LLM 单次输出越长，后段质量越差。Pencil 通过硬限制 25 ops 来强制分步，每步保持注意力集中。

### 2.5 组件实例模式（Component Instance）

Pencil 有完整的组件系统。组件 = `reusable: true` 的节点，实例 = `type: "ref"` 引用：

```javascript
// 插入组件实例
card=I(body, {type: "ref", ref: "CardComp"})
// 通过路径覆盖子节点属性
U(card+"/titleText", {content: "New Title"})
// 替换 slot 内容
newNode=R(card+"/headerSlot", {type: "text", content: "Custom"})
```

**Slot 机制：**
- 组件内的 frame 可标记 `slot: ["recommendedCompId1", ...]`
- slot 是可插入子内容的占位容器
- `enabled: false` 隐藏不需要的 slot

**对比我们：** 我们没有组件/实例系统。每个节点都是独立的。这是架构级差异。

---

## 三、batch_get：读取与搜索

### 3.1 双模式读取

batch_get 合并了两种读取需求到一个调用：

```json
{
  "patterns": [{"type": "text"}, {"reusable": true}],  // 模式搜索
  "nodeIds": ["abc", "def"],                             // 精确读取
  "searchDepth": 3,                                      // 搜索深度
  "readDepth": 2                                         // 读取深度
}
```

| 参数 | 用途 |
|------|------|
| `patterns` | 按 type/name/reusable 搜索节点 |
| `nodeIds` | 按 ID 批量读取 |
| `parentId` | 限定搜索范围 |
| `searchDepth` | 搜索递归深度 |
| `readDepth` | 返回结果的子节点展开深度 |
| `resolveInstances` | 展开组件实例（ref → 完整树） |
| `resolveVariables` | 解析变量引用为计算值 |

### 3.2 搜索深度 vs 读取深度的分离

这是一个精妙的设计：
- `searchDepth=5` → 深入 5 层搜索匹配节点
- `readDepth=2` → 但每个匹配节点只返回 2 层子节点

**为什么分离：** 搜索需要深（找到目标），但返回需要浅（避免数据爆炸）。LLM 先广搜发现节点，再按需深读。

### 3.3 Pattern 搜索

支持的 pattern 属性：
- `type`: frame/text/rectangle/ellipse/line/polygon/path/group/connection/note/icon_font/image/ref
- `name`: 正则匹配节点名
- `reusable`: 布尔值，过滤组件定义

**注意：不支持属性值匹配。** 不能搜索"所有 fill=#3B82F6 的节点"——这由 `search_all_unique_properties` 工具完成（Layer 3）。

### 对比我们的 read 工具

| 能力 | Pencil batch_get | 我们的 read |
|------|-----------------|-------------|
| 按 ID 读取 | ✅ 批量 | ✅ 单个 |
| 模式搜索 | ✅ type/name/reusable | ❌ |
| 搜索深度控制 | ✅ searchDepth | ❌（固定 depth 参数） |
| 读取深度控制 | ✅ readDepth | ✅ depth 参数 |
| 展开组件实例 | ✅ resolveInstances | N/A（无组件系统） |
| 解析变量 | ✅ resolveVariables | N/A（无变量系统） |
| 截图 | ❌（独立工具） | ✅ screenshot=true |

**核心差异：** batch_get 是搜索 + 读取一体化，我们的 read 只是读取。搜索能力让 LLM 可以"先发现再操作"，而不是必须已知 ID。

---

## 四、批量属性操作（Layer 3）

这是 Pencil 最值得借鉴的设计，直接解决"LLM 改 20 个节点同一属性"的 O(n) token 问题。

### 4.1 search_all_unique_properties

**职责：** 递归扫描子树，收集所有唯一属性值。

```json
{
  "parents": ["200:1"],
  "properties": ["fillColor", "fontSize", "fontFamily"]
}
```

**返回示例：**
```json
{
  "fillColor": ["#3B82F6", "#EF4444", "#6B7280", "#FFFFFF"],
  "fontSize": [12, 14, 16, 20, 24, 32],
  "fontFamily": ["Inter", "Fira Code"]
}
```

**支持的属性（10 种）：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `fillColor` | string | 填充颜色 |
| `textColor` | string | 文字颜色 |
| `strokeColor` | string | 描边颜色 |
| `strokeThickness` | number | 描边粗细 |
| `cornerRadius` | number[] | 圆角 |
| `padding` | number | 内边距 |
| `gap` | number | 间距 |
| `fontSize` | number | 字号 |
| `fontFamily` | string | 字体 |
| `fontWeight` | string | 字重 |

### 4.2 replace_all_matching_properties

**职责：** 递归替换子树中匹配的属性值。

```json
{
  "parents": ["200:1"],
  "properties": {
    "fillColor": [
      {"from": "#3B82F6", "to": "#8B5CF6"},
      {"from": "#EF4444", "to": "#F59E0B"}
    ],
    "fontSize": [
      {"from": 14, "to": 16}
    ]
  }
}
```

**设计要点：**
- **from→to 映射**：不是"设置所有为 X"，而是"把 A 换成 B"——更安全，不会误改
- **多属性同时替换**：一次调用可替换颜色 + 字号 + 字体
- **多值替换**：同一属性类型可有多条 from→to 规则
- **递归子树**：parents 指定起点，递归遍历所有后代

### 4.3 两个工具的组合模式

典型工作流：

```
1. search_all_unique_properties → 发现子树中有哪些颜色/字号
2. LLM 决定替换规则（from→to 映射）
3. replace_all_matching_properties → 一次批量替换
```

**LLM token 成本：**
- 无此机制：O(n) — 列出 n 个节点 ID + 属性
- 有此机制：O(1) — 只需 from→to 映射，无论 n 多大

### 4.4 设计哲学

**为什么是 "search + replace" 而不是 "select + set"？**

选择"先查再改"的两步法而不是 CSS-selector 式的一步法：
1. **LLM 需要看到当前值才能做决策**——盲目设置可能误改
2. **from→to 语义更安全**——只改特定值，不影响其他值
3. **属性范围有限（10 种）**——覆盖最高频的视觉属性，不追求全属性

**为什么只有 10 种属性？**
这 10 种是**主题切换最常改的属性**。背景色、文字色、描边色、字号、字体、字重、圆角、间距、边距。实际上覆盖了 90%+ 的批量修改场景。

---

## 五、变量/主题系统（Layer 2）

### 5.1 变量定义

Pencil 支持设计变量（Design Tokens），节点属性可引用变量：

```json
// 节点引用变量
{"fill": "$--primary", "fontSize": "$--font-size-base"}
```

**变量不需要 $ 前缀**——名称是任意字符串，引用时加 `$` 前缀。

### 5.2 主题轴（Theme Axes）

变量可以有多个主题维度的值：

```json
{
  "--primary": {
    "light": "#3B82F6",
    "dark": "#60A5FA"
  },
  "--background": {
    "light": "#FFFFFF",
    "dark": "#0F172A"
  }
}
```

### 5.3 get_variables / set_variables

- `get_variables` → 返回所有变量定义和主题
- `set_variables` → 新增/更新变量（默认合并，可选整体替换）

### 5.4 变量与批量替换的关系

这是两种不同层级的抽象：
- **变量**：声明式——节点引用 token，改 token 值则所有引用自动更新
- **replace_all**：命令式——找到匹配值，逐个替换

理想状态是节点都引用变量，改主题只需 `set_variables`。但现实中可能有硬编码颜色，这时 `replace_all` 就是兜底方案。

---

## 六、视觉验证（Layer 4）

### 6.1 snapshot_layout

返回计算后的布局矩形（每个节点的 x, y, width, height）：

```json
{
  "filePath": "design.pen",
  "parentId": "200:1",
  "maxDepth": 2,
  "problemsOnly": true  // 只返回有问题的节点（如被裁切的）
}
```

**`problemsOnly` 参数特别有价值**——不需要看全部布局，只看出问题的节点。这让 LLM 可以快速定位布局错误。

### 6.2 get_screenshot

截图验证，最直观的反馈：

```json
{
  "filePath": "design.pen",
  "nodeId": "200:1"
}
```

### 6.3 验证流水线

Pencil 的 guidelines 反复强调验证循环：

```
batch_design → get_screenshot → 分析截图 → 发现问题 → batch_design 修复 → get_screenshot
```

每次 batch_design 之后都应该截图验证。这和我们在 WORKFLOW.md 中的 screenshot 验证策略一致。

---

## 七、设计知识系统（Layer 5）

### 7.1 三级知识架构

```
get_guidelines(topic)     → 通用设计规范（schema、布局、排版、规则）
get_style_guide_tags()    → 可用的风格标签
get_style_guide(tags)     → 具体风格指南（配色、字体、间距方案）
```

### 7.2 Guidelines 的主题分类

| 主题 | 内容 |
|------|------|
| `design-system` | 组件系统：slot、sidebar、card、tab、table 组合模式 |
| `landing-page` | 营销页：内容策略、章节结构、视觉层次、反 AI 审美规则 |
| `table` | 表格：结构、单元格、布局规则 |
| `code` | 代码生成：从 .pen 提取、组件实现、验证流程 |
| `tailwind` | Tailwind 实现：布局转换、样式映射 |
| `mobile-app` | 移动端设计规范 |
| `web-app` | Web 应用设计规范 |

### 7.3 按需加载模式

Guidelines 不是全部塞进 system prompt，而是**按任务需要动态加载**。LLM 在开始设计前主动调用 `get_guidelines` 获取相关规范。

这和我们的 `query_knowledge` / skill 系统思路一致——动态注入，避免 system prompt 膨胀。

---

## 八、Schema 设计要点

### 8.1 节点类型

```
frame | group | rectangle | ellipse | line | polygon | path |
text | connection | note | icon_font | image | ref
```

其中 `ref` 是组件实例类型，`icon_font` 是字体图标。

### 8.2 布局属性

```json
{
  "layout": "vertical" | "horizontal",
  "gap": 16,
  "padding": 24,          // 或 [T, R, B, L]
  "alignItems": "center",
  "justifyContent": "space_between",
  "width": "fill_container" | "fit_content" | 400,
  "height": "fill_container(900)" | "fit_content(200)" | 64
}
```

**`fill_container(min)` / `fit_content(max)` 语法：** 带括号数字表示最小/最大值约束。比如 `height: "fill_container(900)"` = 填充父容器但最小 900px。

### 8.3 样式属性

```json
{
  "fill": "#FFFFFF" | "$--background",     // 颜色或变量引用
  "stroke": {
    "align": "inside",
    "fill": "$--border",
    "thickness": {"bottom": 1}             // 单边描边
  },
  "cornerRadius": 8 | [8, 8, 0, 0],       // 均匀或四角
  "shadow": "...",                          // 阴影
  "opacity": 0.5
}
```

### 8.4 文本属性

```json
{
  "type": "text",
  "content": "Hello World",
  "fontSize": 16,
  "fontWeight": "600",
  "fontFamily": "$--font-primary",
  "fill": "$--foreground",         // 文字颜色用 fill
  "textColor": "#000000",         // 或 textColor
  "textGrowth": "fixed-width"     // 文本增长模式
}
```

### 8.5 对比我们的 XML 属性

| 维度 | Pencil (JSON) | 我们 (XML) |
|------|--------------|-----------|
| 颜色 | `fill`, `textColor`, `strokeColor` | `bg`, `fill`, `stroke` |
| 布局 | `layout: "vertical"` | `layout='column'` |
| 间距 | `gap: 16, padding: 24` | `gap='16' p='24'` |
| 对齐 | `alignItems`, `justifyContent` | `alignMain`, `alignCross` |
| 尺寸 | `width: "fill_container"` | `sizingH='fill'` |
| 变量 | `"$--primary"` | ❌ 不支持 |

属性命名差异不大，核心差异在**变量引用**和**组件实例**。

---

## 九、关键设计决策对比

### 9.1 操作格式：脚本 DSL vs XML

| 维度 | Pencil (JS-like DSL) | 我们 (XML) |
|------|---------------------|-----------|
| 可读性 | 代码风格，对 LLM 友好 | 标记语言，结构化 |
| 嵌套 | 扁平 + 绑定引用 | 原生嵌套 |
| 前向引用 | ✅ 绑定变量 | ❌ 需要先 create 再 edit |
| 批量 | 同一调用内 25 个操作 | 一棵 XML 树 |
| 原子性 | 7 种操作混合 | create 和 edit 分离 |

### 9.2 读写分离 vs 混合

| 维度 | Pencil | 我们 |
|------|--------|------|
| 写工具 | batch_design（7 种操作混合） | create + edit（严格分离） |
| 读工具 | batch_get（搜索 + 读取混合） | read（纯读取） |
| 设计理念 | 一个调用完成一个设计步骤 | 每种操作一个工具，语义清晰 |

Pencil 的"一个调用完成一步"减少了工具调用次数，但单个工具的复杂度更高。我们的分离设计更简洁，但需要更多次调用。

### 9.3 批量限制策略

| 策略 | Pencil | 我们 |
|------|--------|------|
| 硬限制 | 25 ops / batch_design | 无限制 |
| 设计意图 | 防止 LLM 输出过长导致质量下降 | 依赖 WORKFLOW.md 的 PROGRESSIVE CREATION 规则 |
| 效果 | 强制分步，每步注意力集中 | LLM 可能一次输出过长 XML |

### 9.4 组件系统

| 维度 | Pencil | 我们 |
|------|--------|------|
| 组件定义 | reusable=true 节点 | ❌ 无 |
| 实例化 | type="ref", ref=组件ID | ❌ 无 |
| 属性覆盖 | descendants 映射 | ❌ 无 |
| Slot 机制 | slot 属性标记可插入区域 | ❌ 无 |
| 影响 | LLM 复用组件，token 效率高 | LLM 每次从头描述完整结构 |

---

## 十、可借鉴的设计模式

### 模式 1：Search + Replace 批量操作

**问题**：LLM 改 20 个节点的颜色，需要逐一列出 ID。
**Pencil 方案**：search_all_unique_properties + replace_all_matching_properties。
**我们可借鉴**：

```typescript
// 新工具：replace_matching
// LLM 调用：
replace_matching({
  parentId: "200:1",
  match: { fill: "#3B82F6" },
  set: { fill: "#8B5CF6" }
})
```

实现成本低（递归遍历 + 属性匹配），token 节省巨大。

### 模式 2：绑定系统解决前向引用

**问题**：create 返回 idMap，但后续 edit 需要 LLM 记住 ID。
**Pencil 方案**：同一调用内的绑定变量。
**我们可借鉴**：在 create XML 中支持 `ref` 属性：

```xml
<frame ref="card" layout='column'>
  <text ref="title">Hello</text>
</frame>
```

返回的 idMap 用 ref 作为 key：`{"card": "200:1", "title": "200:2"}`。
后续 edit 中 LLM 可以用 ref name 或 real ID。

### 模式 3：搜索深度与读取深度分离

**问题**：read 的 depth 参数同时控制搜索和返回，要么搜不深，要么数据太多。
**Pencil 方案**：searchDepth（搜多深）和 readDepth（返回多深）独立。
**我们可借鉴**：read 工具增加 `search` 参数：

```json
read({
  nodeId: "200:1",
  search: { type: "text" },
  searchDepth: 5,
  depth: 1
})
```

### 模式 4：problemsOnly 模式

**问题**：snapshot_layout 返回全部布局矩形数据量大。
**Pencil 方案**：`problemsOnly: true` 只返回有问题的节点。
**我们可借鉴**：read 工具增加 `issues` 模式：

```json
read({ nodeId: "200:1", mode: "issues" })
// 返回：溢出的节点、空 frame、缺少 layout 的 frame 等
```

这相当于 runtime 侧的自动审查，减少 LLM 需要处理的信息量。

### 模式 5：操作批次硬限制

**问题**：LLM 单次输出太长，后段属性遗漏率高。
**Pencil 方案**：25 ops 硬限制。
**我们可借鉴**：在 tool definition 中明确建议"单次 create 不超过 15 个节点"，或在 runtime 侧检测 XML 节点数超阈值时警告。

### 模式 6：知识按需加载

**Pencil 方案**：get_guidelines(topic) 按主题动态加载。
**我们已有**：query_knowledge + skill 系统已实现类似模式。

---

## 十一、Pencil 的执行算法细节

### 11.1 batch_design 执行流程

```
1. 解析操作脚本 → 操作列表 [{op, binding, args}]
2. 按序执行：
   for op in operations:
     - 解析绑定引用（替换变量名为真实 ID）
     - 解析路径拼接（card+"/title" → "200:1/title"）
     - 执行操作（Insert/Copy/Update/Replace/Move/Delete/Generate）
     - 如果是 I/C/R，记录 binding → nodeId 映射
     - 如果失败，回滚所有已执行操作
3. 返回创建的节点列表（depth 2）
```

### 11.2 组件实例属性覆盖算法

```
1. 插入 ref 节点 → 从组件定义复制完整子树
2. 应用 descendants 覆盖：
   for (path, overrides) in descendants:
     - 解析路径（可多级："container/label"）
     - 找到目标子节点
     - 合并 overrides 到子节点属性
3. 后续 U() 操作通过 instanceId/childId 路径继续覆盖
```

### 11.3 replace_all_matching_properties 算法

```
1. 从 parents 开始递归遍历子树
2. 对每个节点：
   for property in replacements:
     currentValue = node[property]
     for rule in replacements[property]:
       if currentValue == rule.from:
         node[property] = rule.to
         break  // 一个属性只匹配第一条规则
3. 返回修改计数
```

**精确匹配**——不是模糊匹配或正则，是严格相等。这保证了替换的安全性。

---

## 十二、25 ops 限制的实际执行机制（补充调查）

通过调用 `get_editor_state(include_schema=true)` 和全部 `get_guidelines(topic)` 获取到 Pencil 暴露给 LLM 的完整上下文后，发现：

### 12.1 同一规则重复 4 次（冗余强化策略）

"maximum 25 operations" 出现在 4 个不同位置：

| 位置 | 原文 |
|------|------|
| batch_design tool description | "Aim for maximum 25 operations per call" |
| General instructions (schema 附带) | "Keep each batch_design call to **maximum 25 operations** for optimal performance" |
| Core Principles (Workflow 章节) | "Keep each batch_design call to **maximum 25 operations** - split larger designs into multiple calls by logical sections" |
| Workflow step 6 | "batch_design() → Generate layout using components (keep to maximum 25 ops per call)" |

LLM 无论从哪个角度切入都会看到这条限制。

**为什么要重复 4 次：** LLM 读长 context 时注意力分散，关键规则只出现一次很容易被淹没。多处出现 = 提高命中率。这 4 处分布在不同的语义区域（工具定义、通用规则、设计原则、工作流步骤），无论 LLM 从哪个思维路径做决策，都有机会"撞到"这条限制。

**对我们的启发：** 在我们的 agent 中，`staticSystemPrompt`（CORE + WORKFLOW + EXAMPLES）和 tool definitions 全在每次 LLM 调用的同一个 context 里。如果要强化某条规则（如节点数限制），应该在至少 3 处植入：
1. **tool description**（最高价值——LLM 在组装 function call 参数时会重新聚焦 tool description，注意力比读 system prompt 时集中得多）
2. **WORKFLOW.md**（工作流规则层）
3. **EXAMPLES.md**（通过示例隐式体现——示例中每个 create 只包含 5-10 个节点，LLM 通过 few-shot 内化规模感）

### 12.2 全部是软约束，无 runtime 硬限制证据

所有 4 处用的都是建议性语气（"Aim for"、"for optimal performance"、"keep to"），没有 "MUST NOT exceed" 或 "will be rejected"。大概率没有 runtime 侧截断/报错。

### 12.3 Placeholder 分步工作流机制

Pencil 有一个间接强制分步的**状态标记机制**——`placeholder: true`：

```
规则：
1. 创建新 frame 时 MUST 设 placeholder: true
2. 在 placeholder frame 上工作期间，不能碰其他节点
3. 完成后 MUST 移除 placeholder: true
4. 多个 screen 时，先批量创建所有 placeholder frame，再逐个填充
5. "There should never be a placeholder flag on an object that's finished"
```

**设计意图：** 这不是视觉效果（placeholder 可能影响渲染），而是**工作流状态机**：
- `placeholder: true` = "正在施工，未完成"
- 移除 placeholder = "本区域完工"
- 同时只能有一个 placeholder 在工作中 = **强制串行化，防止 LLM 同时改多个区域**

**对比我们：** 我们的 create 没有任何"施工中"标记。LLM 可以一个 create 调用生成整棵树，没有"先骨架后内容"的约束。

**潜在借鉴：**
- 在 create 工具中引入类似机制：第一步创建骨架 frame（带标记），后续步骤逐区域填充内容
- 或在 runtime 侧：检测到 create 生成了超过 N 个节点时，自动在返回结果中建议"对以下区域继续细化"

### 12.4 Guidelines 里的场景化分步建议

不只是说"max 25 ops"，还在每个具体场景里示范了合理的步骤规模：

| 场景 | 建议 | 来源 |
|------|------|------|
| 表格行 | "split into multiple batch_design calls (e.g., 2-3 rows per call)" | design-system guidelines |
| 布局骨架 | "Each pattern is typically one batch_design call (3-5 ops)" | design-system guidelines |
| Landing page | "Then add sections...in separate batch_design calls" | landing-page guidelines |
| 组合使用 | "Combine with content...to reach maximum 25 ops per call" | design-system guidelines |

这比抽象地说"分步创建"具体得多——LLM 知道每步该做多少。

---

## 十三、总结

### Pencil 工具设计的核心思想

1. **分层抽象**：精确操作 → 批量操作 → 知识检索，LLM 在不同阶段用不同层级
2. **绑定系统**：解决顺序操作中的前向引用问题
3. **Search + Replace**：O(1) token 的批量修改，避免 LLM 逐一列举
4. **事务性回滚**：一个批次要么全成功要么全回滚
5. **冗余强化分步**：25 ops 上限在 4 个位置重复出现，全为软约束（无 runtime 硬限制证据）
6. **Placeholder 状态标记**：强制"先骨架后内容"的串行化工作流，防止 LLM 同时改多个区域
7. **搜索与读取分离**：深搜浅读，精准获取需要的信息
8. **变量系统**：声明式主题管理，改一处全局生效
9. **场景化分步示范**：不只说"分步"，在每个场景里明确告诉 LLM 每步该做多少（表格 2-3 行/步，骨架 3-5 ops/步）

> 组件思维与两阶段构建模型已拆分至独立文档：[component-thinking.md](component-thinking.md)

### 我们最应优先引入的

按投入产出比排序：

1. **replace_matching 工具**（批量属性替换）— 投入小，解决大痛点
2. **create tool desc 节点数限制 + 冗余强化**（多处重复建议）— 纯 prompt 改动，零代码
3. **create XML 的 ref 绑定**（前向引用）— 改善 LLM 跨步骤协作
4. **组件系统（reusable + ref）**— 从根本上解决属性完整性问题，详见 [component-thinking.md](component-thinking.md)
5. **placeholder 分步工作流**（先骨架后内容的状态标记）— 缓解属性遗漏，需 runtime 配合
6. **read 的 pattern 搜索**（发现 + 读取一体化）— 减少 LLM 探索步骤
7. **issues 模式**（自动布局审查）— 减少 LLM 信息处理负担
