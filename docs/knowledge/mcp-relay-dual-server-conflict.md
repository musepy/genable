# MCP Relay 双服务器连接冲突

## 问题现象

MCP 命令随机路由到错误的 Figma 文件（genable_dev vs genable test），读写操作结果不一致。

## 根因

两个独立的 bug 叠加：

### Bug 1: WS 端口冲突

- 主插件（Figma 正式版）和 worktree 插件（Figma 测试版）都连接 `ws://localhost:3458`
- Relay 只支持单客户端，采用"后来者替换"策略
- 两个插件各自 5s 重连，导致连接在两个 Figma 之间无限抖动
- **表现**：同一个命令有时路由到 genable_dev，有时到 genable test

**端口分配规则**：
| 环境 | MCP Relay 端口 | Dev Bridge 端口 |
|------|---------------|----------------|
| 主插件（正式版 Figma） | 3458 | 3456 |
| Worktree 插件（测试版 Figma） | 3459 | 3457 |

**修复文件**：
- `src/dev/useMcpBridge.ts` — 主插件，WS_URL = `ws://localhost:3458`
- `.claude/worktrees/*/src/dev/useMcpBridge.ts` — worktree，WS_URL = `ws://localhost:3459`
- `tools/mcp-server/wsRelay.ts` — relay 改为 first-client-wins，已有健康连接时拒绝新连接（close code 4001）

### Bug 2: IPC 字段名不匹配

- `toolCallHandler.ts` 发送 `emit('TOOL_RESULT', { requestId, result })`
- `useMcpBridge.ts` 读取 `data.response`（与 `ToolResultHandler` 类型定义一致）
- 字段名 `result` vs `response` 不匹配 → relay 收到 `undefined` → 崩溃
- **表现**：`Cannot read properties of undefined (reading 'error')`

**修复文件**：
- `src/ipc/handlers/toolCallHandler.ts` — `result` → `response`

## 排查要点

1. `lsof -i :3458` — 检查哪个 Figma 进程连着 relay
2. `ps -p <PID> -o command=` — 区分 `Figma.app`（正式版）vs `Figma Beta.app`
3. MCP 返回的 `_file.name` — 确认命令实际执行在哪个文件
4. 改完 relay 代码（`wsRelay.ts`）需要重启 MCP server 才生效（kill PID → /mcp 重连）
5. 改完插件代码需要 `node build.js`，Figma 自动重载

## 预防

- **新建 worktree 时必须检查** `useMcpBridge.ts` 的端口是否改为 3459
- **worktree build 后** 确认 `lsof -i :3458` 没有 Figma Beta 的连接
- Relay 的 first-client-wins 策略是安全网，但不替代端口隔离
