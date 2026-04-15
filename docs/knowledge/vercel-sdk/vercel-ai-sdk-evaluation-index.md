# Vercel AI SDK 评估：是否转向？

> Status: 评估阶段
> Date: 2026-03-31
> Source: `open-pencil/open-pencil` 仓库真实源码（`ai: ^6.0.116`）

## 背景

OpenPencil 使用 Vercel AI SDK 覆盖了我们需要自建的绝大多数基础设施：Agent 循环、Provider 抽象、Schema 验证、Chat 管理、多模态输出。这引出一个核心决策：**我们是否应该转向 Vercel AI SDK？**

本系列文档逐个关键节点对比分析，基于真实代码（OpenPencil 源码 + 我们的 AgentRuntime 源码），提供决策依据。

## 文档索引

| # | 文档 | 核心问题 |
|---|------|---------|
| 0 | [vercel-sdk-architecture-overview.md](vercel-sdk-architecture-overview.md) | **架构全景** — 三层拓扑图、SDK 承担 vs 自建增值速查表、核心代码片段、工具规模 |
| 1 | [vercel-sdk-agent-loop.md](vercel-sdk-agent-loop.md) | **Agent Loop** — `ToolLoopAgent` vs 自建 while 循环，为什么 OpenPencil 选 SDK 驱动？终止判断、truncation guard、"无工具调用 = 结束"的隐患 |
| 2 | [vercel-sdk-provider-model.md](vercel-sdk-provider-model.md) | **LanguageModel 接口** — SDK 的 Provider 抽象 vs 我们的 `LLMProvider` 接口，耦合 vs 代劳的权衡 |
| 3 | [vercel-sdk-schema-validation.md](vercel-sdk-schema-validation.md) | **Schema 验证** — valibot → AI SDK tool() 管线 vs Gemini native function calling，5 种参数类型的验证谁来做 |
| 4 | [vercel-sdk-chat-multimodal.md](vercel-sdk-chat-multimodal.md) | **Chat 管理 + 多模态** — `Chat<UIMessage>` 会话管理 + `toModelOutput` 图片输出，SDK 包办 vs 自建 4 层 Context |
| 5 | [vercel-sdk-observability.md](vercel-sdk-observability.md) | **可观测性层** — noop 检测、快照、步数警告 → 第一性原理驱动的目标能力，不依赖运行环境 |
| 6 | [vercel-sdk-migration-assessment.md](vercel-sdk-migration-assessment.md) | **迁移评估** — 逐节点 SDK 代劳 vs 自建的决策矩阵，渐进式改造路径 |

## 核心发现

```
OpenPencil 用 Vercel AI SDK 省掉了什么？

✅ Agent 循环（ToolLoopAgent）    → 不用写 while + 消息组装
✅ Provider 适配（LanguageModel）  → 7+ Provider 零额外代码
✅ Schema 验证（valibot + tool()） → 参数类型、范围、枚举自动校验
✅ Chat 会话（Chat<UIMessage>）   → 消息历史、流式、Transport 切换
✅ 多模态输出（toModelOutput）     → base64 图片直接发给 LLM
✅ Cache 控制（providerOptions）   → Anthropic prompt caching

OpenPencil 在 SDK 之上自建了什么？（SDK 不提供）

🔧 noop 检测 — 工具执行后节点是否实际变化
🔧 重复调用检测 — 相同 tool+args 是否调用多次
🔧 Undo 快照 — snapshotPage → pushUndoEntry
🔧 字体加载 + 布局重算 — 业务特定后处理
🔧 节点闪烁反馈 — UI 特定视觉效果
🔧 步数警告注入 — 剩余 ≤5 步时向 LLM 返回值注入 _warning
```

## 推荐路径

```
Phase 0 → 立即可做，不依赖 SDK
    步数警告 | 重复检测 | 日志增强 | noop 检测

Phase 1 → 短期，引入 LanguageModel
    用 SDK 的 Provider 抽象替代自建

Phase 2 → 中期，引入 tool() + Schema
    工具定义迁移到 valibot + SDK

Phase 3 → 评估后决定
    是否用 ToolLoopAgent 替换自建 Agent 循环
```

## 阅读路径建议

```
初次了解 → 读 1（Agent Loop）+ 6（迁移评估）
深入对比 → 按序 1 → 2 → 3 → 4 → 5
做决策用 → 直接读 6（迁移评估的决策矩阵）
```
