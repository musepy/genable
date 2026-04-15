# 组件思维与两阶段构建模型

> 来源：Pencil MCP 组件系统分析
> 关联：[pencil-mcp-tool-design-deep-dive.md](pencil-mcp-tool-design-deep-dive.md)

## 核心问题

LLM 属性遗漏率与单次输出长度正相关。我们的 `create(xml)` 允许任意嵌套，一个 dashboard 50+ 节点、200+ 属性一次调用——后段属性遗漏严重。

Pencil 的解法：**把属性完整性从 LLM 运行时转移到组件定义时。**

```
我们：LLM 负责全部（结构+布局+间距+颜色+阴影+圆角+对齐+内容）
     属性完整性 = f(LLM 注意力, XML 长度)  ← 不可控

Pencil：组件兜底视觉品质，LLM 只负责选组件+排结构+填内容
       属性完整性 = f(组件库完备性)  ← 确定性的
```

---

## 组件三层架构

### 1. 定义层：reusable: true

组件 = 属性齐全的节点树，标记 `reusable: true`：

```json
{
  "id": "StatCard", "type": "frame", "reusable": true,
  "layout": "vertical", "gap": 8, "padding": 20,
  "fill": "#FFFFFF", "cornerRadius": 12,
  "effect": { "type": "shadow", "blur": 3, "color": "#0000001A" },
  "children": [
    { "id": "label", "type": "text", "fontSize": 14, "fill": "#64748B" },
    { "id": "value", "type": "text", "fontSize": 28, "fontWeight": "Bold", "fill": "#0F172A" },
    { "id": "change", "type": "frame", "layout": "horizontal", "gap": 4, "children": [...] }
  ]
}
```

~30 属性、8 节点。定义一次，永不重写。

### 2. 实例层：type: "ref"

LLM 使用组件只写引用 + 内容覆盖：

```javascript
card1=I(row, {type: "ref", ref: "StatCard", width: "fill_container"})
U(card1+"/label", {content: "Total Revenue"})
U(card1+"/value", {content: "$48,250"})
```

**5 行代码 vs 从零写 30 个属性。**

| 维度 | 从零写 XML | ref 实例化 |
|------|-----------|-----------|
| 每节点属性量 | 8-15 个 | 1-3 个 |
| 遗漏后果 | 缺 layout → 布局崩坏 | 组件有默认值 |
| 一致性 | 靠 LLM 记忆 | ref 保证 |

### 3. 插槽层：slot

组件内的 frame 可标记为可替换区域：

```json
{
  "id": "contentSlot", "type": "frame",
  "slot": ["StatCard", "TableRow"]  // 推荐放什么
}
```

```javascript
chart=R(card+"/contentSlot", {type: "frame", height: 240})
```

---

## 不是千篇一律

三层机制对抗视觉单一性：

**1. 变量/主题** — 同一组件换皮肤

```json
// 组件写 { "fill": "$primary" }
// 切 theme → "#007AFF" 变 "#E11D48" 变 "#7C3AED"
```

**2. Style Guide** — 创意方向（非固定模板）

```
get_style_guide(["dark", "glassmorphism"]) → 风格指导
```

**3. 组件由 LLM 当场创建** — 最关键

组件不是预置的，是 LLM 根据 style guide 为这个项目定制的：

```javascript
btn=I(document, {
  type: "frame", reusable: true, name: "GlassButton",
  fill: "#FFFFFF20", cornerRadius: 16,
  effect: { type: "background_blur", radius: 12 }
})
// 后续用 ref 复用
b1=I(form, {type: "ref", ref: "GlassButton"})
```

**千篇一律是跨项目问题。组件解决的是同一项目内一致性 + 属性完整性。**

---

## 两阶段模型

```
阶段 1：创作（需要创造力）
  LLM 创建小组件 → 3-5 节点、~10 属性
  ✅ 注意力集中，属性完整性高
  ✅ style guide 引导视觉方向

        ↓ 产出：项目专属组件库

阶段 2：组装（不需要创造力）
  LLM 用 ref 组装界面 → 每实例 2-3 属性
  ✅ 属性完整性由组件保证
  ✅ 一致性由 ref 保证
```

Dashboard 构建示例：

```javascript
// 批 1：骨架（5 ops）
screen=I(document, {type: "frame", layout: "horizontal", width: 1440, height: 900, placeholder: true})
sidebar=I(screen, {type: "ref", ref: "Sidebar", height: "fill_container"})
main=I(screen, {type: "frame", layout: "vertical", gap: 24, padding: 32})
topBar=I(main, {type: "ref", ref: "TopBar", width: "fill_container"})
statsRow=I(main, {type: "frame", layout: "horizontal", gap: 16})

// 批 2：KPI 卡片（8 ops）
c1=I(statsRow, {type: "ref", ref: "StatCard", width: "fill_container"})
U(c1+"/label", {content: "Total Revenue"})
U(c1+"/value", {content: "$48,250"})
c2=I(statsRow, {type: "ref", ref: "StatCard", width: "fill_container"})
U(c2+"/label", {content: "Active Users"})
U(c2+"/value", {content: "2,420"})

// 批 3-4：图表、表格、导航...
// 最后：U(screen, {placeholder: false})
```

每批 5-8 ops，注意力集中。

---

## 对我们的启示

### 需要的架构变更

| 能力 | 改什么 | 复杂度 |
|------|--------|--------|
| 组件定义 | create XML 支持 `reusable='true'` | 低 |
| 组件实例化 | 支持 `<ref component='id'>` | 中 |
| 属性覆盖 | ref 内 path-based override | 中 |
| Slot | frame 支持 `slot` 标记 | 中 |
| 组件发现 | read 支持 `search: {reusable: true}` | 低 |

### 不改架构的替代方案

在 WORKFLOW.md 引导分步构建（组件思维的简化版）：
1. 第一步 create 骨架（顶层 frame 结构）
2. 后续 create 逐区域填充
3. 每次 ≤10-15 节点

牺牲一致性保证，但缓解属性遗漏。

### 与 guidelines 的关系

Guidelines 提供 XML 模板片段（dashboard sidebar、metric card 等），本质是**文本级的组件**——LLM 看着模板写，但仍需手动复制全部属性。组件系统把这个过程从"LLM 看模板抄"变成"runtime 自动展开"，是 guidelines 的结构化升级。
