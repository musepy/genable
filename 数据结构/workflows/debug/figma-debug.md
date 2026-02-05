---
description: Figma 插件调试与日志捕获 (CDP + MCP 方案)
---

# Figma Plugin Debug Workflow

> 通过 Chrome DevTools Protocol 或 MCP 工具自动化捕获 Figma 插件日志。

---

## 前提条件

- macOS 系统
- Figma Desktop 已安装
- 项目依赖已安装 (`npm install`)
- **⚠️ 必须启用 Developer VM**：
  1. 在 Figma 中打开：`Plugins > Development > Use Developer VM` ✓
  2. 这样插件日志才会暴露到 CDP 端点

---

## 方法一：CDP 直连 (推荐开发时)

### 1. 启动 Figma 调试模式

// turbo
```bash
cd /Users/daxiaoxiao/Projects/figma\ gen\ plugin/figma-ai-generator
./scripts/start-figma-debug.sh
```

这会关闭已运行的 Figma 并以调试模式重启（端口 9222）。

### 2. 验证调试端点

// turbo
```bash
curl http://localhost:9222/json | head -20
```

应该返回可调试目标的 JSON 列表。

### 3. 启动日志捕获

```bash
npx tsx scripts/cdp-log-reader.ts
```

可选参数：
- `--output <file>` - 指定日志输出文件（默认：`figma-plugin.log`）
- `--filter <pattern>` - 只捕获包含特定关键词的日志

### 4. 查看日志文件

// turbo
```bash
tail -f figma-plugin.log
```

---

## 方法二：MCP 工具 (推荐 AI 集成)

使用 `figma-console-mcp` Local Mode，让 AI 直接读取日志。

### 配置 MCP

确保 `~/.gemini/antigravity/mcp_config.json` 包含：

```json
{
  "mcpServers": {
    "figma-console": {
      "command": "node",
      "args": ["/Users/daxiaoxiao/Projects/figma gen plugin/figma-console-mcp/dist/local.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "figd_你的token"
      }
    }
  }
}
```

### 使用方式

1. 在 Figma 插件中执行生成操作
2. 告诉 AI：「分析日志」或「读取插件日志」
3. AI 会自动调用 `figma_get_console_logs` 并分析错误

---

## 常见问题

### 端口被占用

```bash
lsof -i :9222
kill -9 <PID>
```

### 无法连接

确保先运行 `start-figma-debug.sh`，等待 Figma 完全启动。

### 日志不显示

1. 确认 Developer VM 已启用
2. 尝试在 Figma 中：`Plugins > Development > Open Console` 打开插件 DevTools
3. 确认插件代码使用了 `console.log`

### MCP 连接错误 "EOF"

1. 确认 `dist/local.js` 文件存在
2. 确认 Token 有效
3. 确认 Figma 以调试模式运行

---

## 📚 相关资源

- 脚本文件: `scripts/start-figma-debug.sh`, `scripts/cdp-log-reader.ts`
- MCP 项目: `/figma-console-mcp`
