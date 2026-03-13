# MCP 连接静默切换文件

## 现象

在 simpledesignsystem 打开插件后，MCP 连接绑定到了该插件实例。用户切换回 genable_dev 文件视图，MCP 连接不跟随，仍然操作 simpledesignsystem。

## 根因

MCP relay 绑定的是**插件实例**，不是 Figma 文件视图。Figma 允许多个文件同时打开，但插件只在某一个文件里运行。用户切换文件视图时，插件不会自动迁移，MCP 连接也不会切换。

## 影响

- 2 次重建都在错误文件（simpledesignsystem）创建了垃圾节点
- 用户毫无感知，以为在操作 genable_dev

## 加剧因素

`query` 工具搜索所有 page 能找到节点（因为是在当前连接的文件里搜），`inspect`/`context` 找不到同一节点 → 误判为 page 问题而非文件连接问题。这个不一致性让调试更困难。

## 现有缓解手段

每个工具响应现在注入 `_file: { name, currentPage }`（`toolCallHandler.ts` line 504–510），可以在调用后检查连接的文件名是否正确。

## 潜在修复方向

1. **UI 层警告**：插件 header 显示当前连接文件名，与 Figma 当前活跃文件不匹配时高亮提示
2. **MCP 工具层校验**：每次工具调用前检查 `_file.name`，不匹配则返回错误而非静默执行
3. **Relay 层感知**：插件监听 Figma 文件切换事件，主动断开并通知 MCP 客户端重连
