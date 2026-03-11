# MCP 化方向：Tools-as-MCP（方案 B）

## 决策
选 Tools-as-MCP：将 6 个 LLM-facing tools 直接暴露为 MCP tools，agent loop 交给外部 MCP client（如 Claude Code）。

## 架构

```
Claude Code (MCP client, stdio)
  → MCP Server (Node.js, tools/mcp-server/index.ts)
    → WebSocket (localhost:3458)
      → Figma Plugin UI (useMcpBridge.ts)
        → IPC emit/on (复用现有 TOOL_CALL / TOOL_RESULT)
          → Figma Main Thread (toolCallHandler.ts, 不改)
```

## 暴露的 6 个 MCP Tools

| Tool | 类型 | 说明 |
|------|------|------|
| context | read | 画布概览，无参数 |
| outline | read | 结构骨架（nodeId, depth） |
| inspect | read | 完整样式 + 可选 screenshot |
| design | write | 统一创建/编辑/删除（flat ops） |
| replace | write | 批量搜索/替换属性 |
| query | read | 搜索节点/设计规范/样式 |

## 关键复用

- `unifiedTools`（tool 定义）→ 自动转换为 MCP inputSchema
- `toolCallHandler.ts`（main thread dispatch）→ 完全不改
- IPC emit/on pattern → 完全复用
- `requestId` 加 `mcp_` 前缀区分 MCP 和 agent sandbox 的请求

## 与 dev-bridge 共存

- dev-bridge（prompt 级）→ E2E 测试用
- MCP bridge（tool-call 级）→ 外部 LLM 客户端用
- 两者并行运行，互不影响

## 待解决

- WebSocket CSP：Figma plugin iframe → ws://localhost 可行性需验证
- `query(source="guidelines"|"style"|"style-tags")` 在 sandbox 本地执行，不走 IPC → MCP 需在 server 侧实现或改走 IPC
- screenshot base64 → MCP image content type 转换
- 依赖：`@modelcontextprotocol/sdk` + `ws`
