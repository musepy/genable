# MCP Server 方向探索

## 背景

我们的插件架构（create/edit/read/query_knowledge）与 Pencil MCP 没有本质区别：
- 核心模式相同：LLM 生成设计操作 → 执行器创建/修改节点 → 返回结果 + 问题 → LLM 迭代修复
- 差异只在表层：XML vs 脚本语法、嵌套 vs binding、回滚策略等
- 平台不同：我们操作 Figma 节点，Pencil 操作 .pen 文件

## MCP 化方案

### 架构

```
现在:  插件内 AgentRuntime → LLM → tool call → Figma API
MCP化: 外部 Claude Code/任意客户端 → MCP server → websocket → Figma plugin → Figma API
```

### 暴露的 MCP Tools

- `create(xml)` — 创建节点树
- `edit(xml)` — 修改/删除已有节点
- `read(nodeId, screenshot?)` — 读取画布 + 可选截图
- `query_knowledge(source)` — 查询设计知识/组件/token

### 与官方 Figma MCP 的定位差异

官方 MCP (`mcp__claude_ai_Figma__*`) 以读取为主。我们的 MCP 是**生成为主**——带 XML 设计语法、布局引擎、后验校验，专门为 AI 生成设计优化的写入层。

### 最小实现路径

基于 dev bridge 改造：
- 协议：HTTP 轮询 → MCP 协议（stdio 或 SSE）
- 通信：文件系统轮询 → websocket 双向通信
- 粒度：发整个 prompt → 单个 tool call 级别
- 插件角色：agent runtime → 纯执行层

### 关键取舍

- **MCP 化** = 更通用（任何 LLM 客户端都能用），但失去对 agent 行为的控制（loop policy、context 管理、设计专属优化）
- **自带 runtime** = 体验可控，但绑死在自己的 LLM loop 里
- **可以共存**：插件内置 agent 给普通用户，MCP 接口给开发者/Claude Code

### 使用场景

1. 开发者在 Claude Code 里说"在 Figma 里设计一个 settings 页面" → Claude Code 通过 MCP 直接操作 Figma
2. 反向：读取 Figma 设计 → 生成对应代码
3. 设计系统检查：检查 Figma 页面是否符合 design system

## 待解决问题

- MCP server 进程管理（随插件启停？独立进程？）
- websocket 连接稳定性（Figma 插件 CSP 限制）
- 是否需要认证/权限控制
- tool 粒度是否需要调整（当前 4 个 vs Pencil 的 batch 模式）
