---
description: 查看 Figma 插件最近的错误日志
---
运行以下命令查看最近捕获到的日志：

// turbo
1. 执行 curl 查看日志摘要：
```bash
curl -s http://localhost:3456/logs/summary | jq .
```

2. 如果你想清空日志：
```bash
curl -s http://localhost:3456/logs/clear
```

注意：该工作流依赖于 `npm run watch` (或 `node scripts/log-server.js`) 正在运行。
