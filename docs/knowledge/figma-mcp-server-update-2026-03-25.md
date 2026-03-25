# Figma MCP Server 更新调研 (2026-03-25)

## 重大变化：画布双向读写

2026-03-24 Figma 宣布 MCP server 从只读变为双向读写。核心新工具 `use_figma` 可以直接在画布上创建/编辑/删除任何对象。

## 当前状态

我们的 MCP 连接正常（`https://mcp.figma.com/mcp`，Connected），但 `use_figma` 尚未出现在工具列表中——可能还在 beta rollout 中。`generate_figma_design`（网页→Figma 图层）已可用。

## use_figma 工具详细分析

### 执行模型
- 直接执行 JavaScript，等同于 Figma Plugin API
- 代码自动包装在 async IIFE 中，支持顶层 `await`
- 用 `return` 返回数据（JSON 序列化）
- 原子执行：失败的脚本不会产生任何修改
- **每次调用 `figma.currentPage` 重置到第一页**——需要 `setCurrentPageAsync` 切换

### 关键 API 陷阱（从 figma-use skill 的 gotchas.md 提取）

这些直接适用于我们的 js 命令和 executor：

| 陷阱 | 错误做法 | 正确做法 |
|------|---------|---------|
| 颜色范围 | `color: {r: 255, g: 0, b: 0}` | `color: {r: 1, g: 0, b: 0}` (0-1) |
| Fills/Strokes | `node.fills[0].color = ...` (只读) | `const f = [...node.fills]; f[0] = {...}; node.fills = f;` |
| 字体加载 | 设置文本前不加载 | `await figma.loadFontAsync({family, style})` |
| resize 重置 | `resize()` 后设 FILL | `resize()` 在 HUG/FILL 之前调用 |
| FILL 时机 | `layoutSizingHorizontal = 'FILL'` 在 appendChild 前 | **必须** appendChild 后再设 FILL |
| counterAxisAlignItems | `'STRETCH'` | 不存在。用 `'MIN'` + 子节点 FILL |
| lineHeight | `lineHeight = 24` | `lineHeight = {value: 24, unit: 'PIXELS'}` |
| letterSpacing | `letterSpacing = 1` | `letterSpacing = {value: 1, unit: 'PIXELS'}` |
| effects | 缺 visible/blendMode | `{type:'DROP_SHADOW', ..., visible:true, blendMode:'NORMAL'}` |
| notify | `figma.notify(...)` | 直接抛 "not implemented" |
| Variable paint | `setBoundVariableForPaint` 改原 paint | 返回**新** paint，必须捕获并重新赋值 |

### 不可用的 API
- `figma.notify()` — 抛错
- `figma.showUI()` / `figma.openExternal()` — 静默 no-op
- `figma.listAvailableFontsAsync()` — 未实现
- `figma.loadAllPagesAsync()` — 未实现
- `figma.teamLibrary.*` — 未实现
- `getPluginData()` / `setPluginData()` — 不支持，用 `getSharedPluginData()`
- TextStyle.setBoundVariable — headless 不可用

### 20KB 输出限制
每次 `use_figma` 调用的返回值限制 20KB。大结构需要分批返回。

## Self-Healing 验证循环

Figma 官方推荐的 agent 工作流：

```
1. use_figma      → 创建/修改节点
2. get_metadata   → 验证结构（快，便宜）
3. use_figma      → 修复发现的问题
4. get_metadata   → 再次验证
5. ... 重复 ...
6. get_screenshot  → 每个里程碑后视觉检查
```

**get_metadata vs get_screenshot 选择**：
- 结构验证（节点数、名称、层级）→ `get_metadata`
- 视觉验证（文字裁切、重叠、间距）→ `get_screenshot`

这与我们的 inspect→edit→inspect 模式完全一致。

## Skills 系统

### 文件格式
```
.claude/skills/<skill-name>/
  SKILL.md          — 主文件（frontmatter + markdown）
  scripts/          — helper 脚本
  references/       — 详细文档
  assets/           — 模板、查找表
```

### Frontmatter
```yaml
---
name: skill-identifier
description: "触发条件描述"
disable-model-invocation: false
metadata:
  mcp-server: figma
---
```

### 官方内置 Skills
| Skill | 用途 |
|-------|------|
| figma-use | **必须前置**。Plugin API 规则、陷阱、模式。含 12 个 reference docs |
| figma-generate-design | 从代码构建完整页面 |
| figma-generate-library | 构建设计系统（变量、组件、样式）|
| figma-implement-design | Figma→代码翻译 |
| figma-code-connect-components | Code Connect 映射 |

### figma-use 的 Reference 文档清单
- `gotchas.md` — 25+ 已知陷阱 + 正确/错误示例
- `common-patterns.md` — 脚本模板
- `plugin-api-patterns.md` — Fills/Strokes/Auto Layout/Effects
- `api-reference.md` — 节点创建、Variables API
- `validation-and-recovery.md` — 验证循环工作流
- `component-patterns.md` — combineAsVariants、component properties
- `variable-patterns.md` — Collections、modes、scoping、aliasing
- `text-style-patterns.md` — 字体探测、样式应用
- `plugin-api-standalone.d.ts` — 完整 Plugin API 类型定义

## Rate Limits

| Seat 类型 | Starter | Professional | Organization | Enterprise |
|-----------|---------|-------------|-------------|-----------|
| View/Collab | 6/月 | 6/月 | 6/月 | 6/月 |
| Dev/Full | — | 15/分, 200/天 | 20/分, 200/天 | 600/天 |

免限制：`add_code_connect_map`, `generate_figma_design`, `whoami`

`use_figma` Beta 期间免费，之后按用量付费。需要 Full seat 的编辑权限。

## 与我们插件的对比

| 维度 | 我们的插件 | Figma MCP use_figma |
|------|-----------|---------------------|
| 执行位置 | Sandbox iframe + IPC | 远程 HTTP → Plugin API |
| 节点创建 | JSX markup → executor 解析 | 直接 `figma.create*()` |
| 寻址方式 | `name#id` refs | 返回的 node ID |
| 验证 | dev bridge E2E / inspect | `get_metadata` + `get_screenshot` |
| 上下文管理 | 4 层 context + lazy compression | Skill files + 返回的 node IDs |
| 工具数量 | 4 (jsx, inspect, edit, run) | 16 (read/write/manage) |
| 延迟 | 低（sandbox 内直接调用）| 高（HTTP 往返）|
| LLM 选择 | 自定义（Kimi K2.5 等）| 取决于 MCP client |

## 对我们有帮助的发现

### 1. gotchas.md 直接可用
`use_figma` 的 25+ 陷阱清单与我们的 executor/js handler 面对的问题完全相同。应该把这些集成到我们的 js error memory 初始数据或 system prompt 中。

### 2. 验证循环模式
Figma 推荐的 `use_figma` → `get_metadata` → fix → `get_screenshot` 循环验证了我们昨天实验的 create → verify → fix 模式。不同之处：
- Figma 用 `get_metadata`（XML 结构）做**快速结构检查**
- 用 `get_screenshot`（截图）做**视觉检查**
- 我们用 `inspect`（JSON）做两者合一

### 3. 增量创建：一次一个 section
Figma 官方推荐每次 `use_figma` 只创建一个 section，不要一次性生成整页。这与我们的 PROGRESSIVE CREATION 规则一致。

### 4. resize() 重置 sizing 模式
**关键发现**：`resize()` 会把 `layoutSizingHorizontal/Vertical` 重置为 `FIXED`。必须在 `resize()` 之后再设 HUG/FILL。这可能是我们 executor 里一些 sizing 问题的根因。

### 5. FILL 必须在 appendChild 之后
`layoutSizingHorizontal = 'FILL'` 必须在 `parent.appendChild(child)` 之后设置。如果提前设，会报错或被忽略。这对我们 executor 的属性应用顺序有影响。

### 6. Skill system 的 references/ 目录模式
Figma 的 skill 不止一个 SKILL.md，还有 `references/` 目录放详细文档。这比我们当前的纯 SKILL.md 模式更灵活，值得学习。

## 待办

- [ ] 等 `use_figma` rollout 到我们账号后，测试其能力边界
- [ ] 将 gotchas 集成到 js error memory 的初始数据
- [ ] 检查 executor 中 `resize()` 和 `FILL` 的应用顺序是否正确
- [ ] 考虑 skill 的 references/ 目录模式
- [ ] 评估 `search_design_system` 是否可以替代我们的 comp 命令
