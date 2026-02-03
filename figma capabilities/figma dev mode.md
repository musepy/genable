name: figma dev mode
description: 解释 Figma Dev Mode 插件、Codegen 及社区灵感。

## 1. 什么是 Codegen (代码生成)？
**Codegen** 是 "Code Generation" 的缩写。在 Figma 中，它特指开发者模式侧边栏的“代码块”部分。
- **技术本质**：通过 `figma.codegen.on('generate')` 接口，插件可以监听你的点击行为，把选中的“图层属性”实时翻译成“代码文本”。
- **我们的机会**：原生 Figma 只会给 CSS。而我们可以给 React 组件、给带有特定业务逻辑的 UI 代码。

## 2. Dev Mode 插件有什么用？
除了复制代码，社区里的插件主要解决三个核心痛点：

| 插件类型 | 代表作 | 核心用处 |
| :--- | :--- | :--- |
| **代码交付型** | Builder.io, Anima | 将设计稿一键转为高质量的 React/Tailwind 代码，支持响应式。 |
| **文档/上下文型** | Jira, GitHub, Storybook | 在 Figma 里直接查看对应的任务状态、代码库里的组件 Demo，不用在工具间跳转。 |
| **设计系统管理** | Tokens Studio | 确保设计稿里的“变量”与代码库里的 `theme.json` 是同一套东西，实时同步。 |

## 3. 对本项目 (Genable) 的启发
通过研究社区，我们可以在以下三个方向发力：

### A. 语义化同步 (Semantic Sync)
- **启发**：像 Storybook Connect 一样，让开发在看到设计稿时，插件显式指出：“这个按钮对应代码库里的 `<Button />` 组件”，而不是一段 raw CSS。
- **行动**：我们已经在做变量映射，下一步是让生成的代码更智能。

### B. AI 辅助检查 (AI Inspector)
- **启发**：利用 AI 分析设计稿中不规范的地方（比如没用 Token 的颜色），在 Dev Mode 侧边栏给出修复建议。
- **行动**：让 Genable 变成开发的“设计评审助手”。

### C. 零成本交付 (Zero-Effort Handoff)
- **启发**：Builder.io 的强大在于“复制即运行”。
- **行动**：优化我们的 React 选项卡，让生成的代码包含所有必要的 Import 和样式，开发拿走就能跑。

## 4. 工具与接口规格说明 (Technical Specs)

### A. Figma MCP 接口 (外部 AI 感知)
这些工具位于 Figma 外部，帮助 AI “看懂”设计稿，提取“原材料”。

| 工具名称 | 定义与能力 | 数据结构 (Output) | 示例 (Logic) |
| :--- | :--- | :--- | :--- |
| **`get_design_context`** | 提取设计逻辑，自动转代码。 | `CodeSnippet[]` | `[{"language": "TSX", "code": "<button className='...'>..."}]` |
| **`get_metadata`** | 获取节点层级树（省 Token）。 | **XML** (树状) | `<frame name="Header"><text name="Title"/></frame>` |
| **`get_variable_defs`** | 提取命名的变量定义。 | `Record<Token, Value>` | `{"Brand/Blue": {"r": 0, "g": 0.5, "b": 1}}` |
| **`get_screenshot`** | 获取区域高清快照。 | `Base64 Image` | `data:image/png;base64,iVBORw...` |

### B. 插件内部接口 (Genable 执行引擎)
这些接口位于插件主线程，负责把 AI 的构思变成“真实图层”。

| 接口名称 (Event) | 执行能力 | 输入 Schema | 示例参数 (DSL) |
| :--- | :--- | :--- | :--- |
| **`CREATE_LAYERS`** | 真实图层实例化。 | `NodeLayer` (DSL) | `{ type: 'FRAME', props: { layoutMode: 'VERTICAL' } }` |
| **`STREAM_LAYERS`** | 实时流式渲染（打字机）。 | `NodeLayer & Session` | `{ type: 'TEXT', props: { characters: '...' }, sessionId: '...' }` |
| **`IMPORT_TOKENS`** | Token 强同步。 | `CSS / JSON` | `:root { --color-primary: #007AFF; }` |
| **`TOOL_CALL`** | 代理执行原子工具。 | `(Name, Params)` | `{ toolName: 'createFrame', parameters: { width: 100 } }` |

## 5. 数据结构快照对比 (Data Snapshots)

### [官方 REST JSON] - 原始矿石 (Raw)
适合开发读取，但属性过多，AI 容易“迷失”。
```json
{
  "id": "1:23",
  "name": "Rect",
  "absoluteBoundingBox": { "x": 100, "y": 200, "width": 50, "height": 50 },
  "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 0, "b": 0 } }],
  "effects": [],
  "characters": "Hello"
}
```

### [MCP XML] - 布局地图 (Map)
专为 AI 优化，只保留结构和关键对齐，节省 80% Token。
```xml
<frame id="100:1" name="Header" layoutMode="HORIZONTAL" gap="16">
  <instance id="100:2" name="Logo" />
  <text id="100:3" characters="Home" />
</frame>
```

### [Genable DSL] - 语义指令 (Intent)
我们插件定义的精简格式，AI 输出此格式即可直接渲染图层。
```json
{
  "type": "FRAME",
  "props": {
    "name": "Button",
    "layoutMode": "HORIZONTAL",
    "padding": 16,
    "fills": ["$colors.brand.primary"],
    "cornerRadius": 8
  },
  "children": [{ "type": "TEXT", "props": { "characters": "Submit" } }]
}
```
