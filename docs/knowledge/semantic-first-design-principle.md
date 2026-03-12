# Semantic-First Design Principle: 先想"是什么"，再想"长什么样"

## 问题来源

使用 Figma plugin MCP 工具手动测试生成 Pricing Card 时，feature 列表的 checkmark 图标出现了典型的多步修补过程：

1. **第一步**：创建空的绿色圆形 frame（`{w:20, h:20, bg:'#10B981', corner:99}`）— 当装饰处理
2. **第二步**：发现没有内容，补加 `✓` text 节点
3. **第三步**：发现没有居中，补加 auto layout + center
4. **第四步**：发现 auto layout 把固定尺寸变成 hug，再补 `sizingH:'fixed'`

4 步修补，本质是 1 步就能完成的事。

## 根因分析

**思维起点错误**：从视觉形状出发（"需要一个绿色圆"），而非从语义出发（"需要一个 checkmark icon"）。

当 LLM 以视觉形状为起点时：
- 想到"绿色圆" → `frame` + `bg` + `corner:99` → 漏掉内容
- 想到"里面要有勾" → 补 `text('✓')` → 漏掉居中
- 想到"要居中" → 补 `layout` → 破坏了固定尺寸
- ……每一步都在补上一步的遗漏

当 LLM 以语义为起点时：
- 想到"checkmark icon" → `icon('lucide:check')` → 一步到位
- 或者：想到"带背景的 checkmark" → frame(layout+center+固定尺寸) + text('✓') → 两行，一步完成

## 核心原则：Semantic-First

> **不要先想"这个东西长什么样"，而是先想"这个东西是什么"。**

| 语义 | 正确实现 | 错误实现（视觉先行） |
|------|---------|---------------------|
| Checkmark icon | `icon(parent, {icon:'lucide:check', ...})` | 绿色圆形 frame（忘记放 icon） |
| User avatar | `image(parent, {...})` 或 `ellipse` | 灰色圆形 frame（忘记放图片） |
| Status indicator | `icon` + 语义名称 | 彩色小圆点（无法区分语义） |
| Divider | `line` 或 `rect({h:1})` | frame + bg（过度包装） |

**节点类型就是语义声明**：`icon` = 图标，`text` = 文字，`image` = 图片，`line` = 分隔线。形状（圆形、方形）是属性，不是类型选择的依据。

## 与现有 Prompt 规则的关系

### 已有但未被遵守的规则
- CORE.md:157 — "ALWAYS query knowledge FIRST when creating a NEW component"
- `card-layout` guideline 的 Pricing Card skeleton 里已经用了 `<icon name='Check' icon='lucide:check'>`
- 如果查了 guideline 再创建，就不会犯这个错

### 缺失的规则
Prompt 教了"先查后画"（query-first），但没有教**思维起点**——在写每个节点时，先确定它的**语义类型**，再决定视觉属性。这是比 query-first 更底层的认知规则。

## 与设计生成策略的关系

我们的核心策略是 **骨架先行 + 参数调优**：

1. **骨架阶段**（Skeleton）：确定语义结构
   - 每个节点的**类型**（frame/text/icon/image）由语义决定
   - 每个节点的**层级关系**（谁是谁的 parent）由信息架构决定
   - 这一步追求**结构正确性**，不追求视觉效果

2. **参数阶段**（Styling）：调整属性达到设计多样性
   - 颜色、间距、圆角、阴影、字体 → 通过 style guide 驱动
   - 同一个骨架 + 不同 style guide = 不同风格的设计
   - 这一步追求**视觉多样性和风格化**

**Semantic-First 原则服务于骨架阶段**：骨架的质量取决于语义是否正确。如果骨架阶段就把 icon 错误地表达为 frame，后续参数调优无法修复这个结构性错误——你可以改绿色圆的颜色和大小，但它永远不会变成一个 checkmark icon。

```
正确流程：
  语义分析 → 骨架（类型+层级） → 参数（style guide） → 验证

错误流程：
  视觉想象 → 形状拼凑 → 发现缺失 → 多步修补 → 仍然结构错误
```

## 对 Prompt 工程的启示

### 可能的改进方向
在 CORE.md 的 "Pre-output scan" 或 WORKFLOW.md 的 "PROGRESSIVE CREATION" 中加入一条：

> **Semantic-first node selection**: Before writing any node, identify what it IS (icon, image, text, divider), then pick the matching node type. Do NOT use `frame` as a visual substitute for semantic types — `frame` is a container, not a shape primitive.

### 已有 guidelines 的价值
Guidelines（如 `card-layout`）已经提供了语义正确的 XML skeleton。强化"先查 guideline 再创建"的执行力，本身就能大幅减少这类语义错误。

## 总结

| 维度 | 错误模式 | 正确模式 |
|------|---------|---------|
| 思维起点 | 视觉形状 → 找节点类型 | 语义类型 → 加视觉属性 |
| 节点类型选择 | "需要圆形" → frame | "需要 icon" → icon |
| 生成策略 | One-shot 视觉拼凑 | 骨架（语义）→ 参数（风格） |
| 多样性来源 | 改骨架结构 | 同骨架 + 不同 style guide |
| 错误修复 | 多步修补（4 步补 1 个 icon） | 结构正确则无需修补 |
