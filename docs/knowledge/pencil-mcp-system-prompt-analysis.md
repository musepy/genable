# Pencil MCP System Prompt 反推分析

通过 16 个 MCP 工具的接口定义、参数约束和描述中的行为指令，反推其 system prompt 的职能设计。

## 核心定位

Pencil 是设计编辑器的 AI 代理层，让 LLM 成为能读写 `.pen` 格式设计文件的设计师。

## 7 个职能域

### 1. 场景图读写（Scene Graph CRUD）
- 工具: `batch_get`, `batch_design` (I/C/U/R/M/D/G 七种操作)
- `.pen` 文件是树状场景图（frame → children → nested frames/text/shapes）
- 节点类型: frame, group, rectangle, ellipse, line, polygon, path, text, connection, note, icon_font, image, ref
- 自定义 DSL 语法: `foo=I(parent, {...})`，变量可用 `+` 拼接路径
- 操作顺序执行，失败整体回滚，每次最多 25 个操作

### 2. 组件/设计系统（Component & Design System）
- 工具: `batch_get` 的 `reusable` 过滤、`batch_design` 的 `ref` 节点
- 组件 = `reusable: true` 的节点，实例 = `type: "ref"` 引用组件
- 实例内部修改路径语法: `instanceId/childId`（斜杠分隔嵌套路径）
- Copy 时通过 `descendants` map 修改子节点（Copy 会重新分配 ID，不能单独 Update）
- slot 机制: 向组件实例的插槽插入内容

### 3. 布局与空间感知（Layout & Spatial Awareness）
- 工具: `snapshot_layout`, `find_empty_space_on_canvas`
- Frame 布局属性: `layout: "vertical"/"horizontal"`, `gap`, `padding`, `alignItems`
- 尺寸语法: `fill_container`, `fill_container(500)`（带最小值）
- `snapshot_layout` 检查计算后实际矩形，`problemsOnly` 检测裁剪/重叠
- `find_empty_space_on_canvas` 管理画布空间，避免重叠

### 4. 视觉验证循环（Visual Validation Loop）
- 工具: `get_screenshot`（描述强调 "ALWAYS analyze"、"Think carefully"）
- 设计后必须截图验证，形成 design → screenshot → analyze → fix 迭代循环
- LLM 需对截图进行视觉分析，检测对齐、间距、颜色等问题

### 5. 设计灵感与美学引导（Style & Aesthetic Direction）
- 工具: `get_style_guide_tags`, `get_style_guide`
- 设计前先获取风格指南的工作流: tags → style guide → apply
- 风格基于标签组合（5-10 个标签），覆盖色彩、排版、间距
- 区分需要风格指南（从零设计）vs 跳过（纯组合操作）

### 6. 多领域设计规则（Domain-Specific Guidelines）
- 工具: `get_guidelines` 的 8 个 topic
- landing-page（高转化率着陆页）、mobile-app、web-app、slides、design-system、table、code（设计→代码）、tailwind
- 按任务类型动态注入规则，非一次性加载

### 7. 设计变量与主题系统（Variables & Theming）
- 工具: `get_variables`, `set_variables`, `batch_get` 的 `resolveVariables`
- 变量绑定颜色/间距等，支持多主题（light/dark）
- 变量名任意字符串，不需要 `$` 前缀
- 代码生成时变量映射为 CSS 全局规则

## 推断的工作流编排

从工具调用顺序暗示和 "IMPORTANT" 标注反推 system prompt 规定的标准流程：

```
1. get_editor_state          → 了解当前状态和选区
2. get_guidelines(topic)     → 按任务类型加载规则
3. get_style_guide_tags      → 获取可用风格标签
4. get_style_guide(tags)     → 获取设计灵感/配色/排版指南
5. batch_get(patterns)       → 发现现有组件和结构
6. find_empty_space           → 找到放置新内容的位置
7. batch_design(operations)  → 执行设计操作（≤25 ops/call）
8. get_screenshot             → 截图验证
9. snapshot_layout(problems)  → 检查布局问题
10. 如有问题 → 回到步骤 7 修复
```

## 与我们 Figma AI 插件的对比

| 维度 | Pencil MCP | 我们的 Figma 插件 |
|------|-----------|-------------------|
| 设计格式 | `.pen` 自有格式（加密） | Figma 原生节点 |
| LLM 交互方式 | MCP 工具（外部调用） | Agent 内部工具（sandbox → IPC） |
| 操作语法 | 自定义 JS-like DSL (I/C/U/R/M/D/G) | 统一 XML 标记 |
| 组件系统 | `reusable: true` + `ref` 实例 | Figma Components |
| 验证机制 | `get_screenshot` + `snapshot_layout` | `read(screenshot=true)` |
| 风格系统 | 内置 style guide tags | 无（依赖 LLM 自身审美） |
| 上下文管理 | 工具级按需加载 guidelines | 3 层 context（system + summary + turn） |
| 属性遗漏防线 | 可能在 guidelines 中 | DESIGN DIMENSIONS 思考框架 |

## 关键设计洞察

1. **Guidelines 按需加载** — 类似我们的 skill 系统，不全部塞进 system prompt
2. **Style guide 是差异化** — 内置设计灵感库，LLM 不需从零审美
3. **batch_design DSL 比 XML 更灵活** — 支持 binding 变量、路径拼接、Copy，但学习成本更高
4. **截图验证是强制行为** — 工具描述用 "ALWAYS analyze"，system prompt 把这当核心流程
5. **批量风格修改工具** — `search_all_unique_properties` + `replace_all_matching_properties` 处理"改主题色"等批量任务
