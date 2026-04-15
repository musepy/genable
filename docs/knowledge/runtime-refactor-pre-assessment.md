# Agent Runtime 重构计划 — 前置评估

> 日期: 2026-03-31 | 评估对象: effervescent-baking-comet.md

## 事实验证（计划 vs 代码）

| # | 计划声明 | 实际情况 | 判定 |
|---|---------|---------|------|
| 1 | agentRuntime.ts 1015 LOC | 1015 LOC | ✅ |
| 2 | L314-578 = 上下文管理 | 三块：assembly L320-340, chat panel L349-475, compression L485-579 | ⚠️ 粗化 |
| 3 | run() 含~120行首次init | 首次init L623-698 = 75行 | ⚠️ 偏差 |
| 4 | Bug #2: iteration++ 在截断分支 | L960 确认 | ✅ |
| 5 | Bug #1: 无 finishReason 检查 | L949-950 已有完整守卫 | ❌ Bug不存在 |
| 6 | format 方法在 coordinator 中 | formatResponse 在 agentRuntime:866, formatToolResults 通过 ToolDispatcher config | ❌ 定位错 |
| 7 | 4 Provider 中 3 个用默认实现 | 2 default (DashScope, OpenRouter) + 2 custom (Gemini, Proxy) | ❌ 2/4 |
| 8 | toolConfig.mode='ANY' 存在 | 完整实现（types.ts + 4 provider） | ✅ |
| 9 | Hook 有未接线 | 全部 7 hook 已接线，5 生命周期事件全有触发 | ❌ Codex错 |

## 严重问题

### 1. Bug #1 不是 Bug
代码 L949-964 已有完整 finishReason 守卫。用 toolConfig.mode='ANY' 强制工具调用会引入新问题。建议删除。

### 2. Phase 2 定位错误
formatResponse 在 agentRuntime.ts:866（run() 内），formatToolResults 在 toolDispatcher.ts:329。不在 coordinator 里。Phase 2 "内化到 coordinator" 目标错误。

### 3. Provider 自定义比例 2/4
Proxy 也有 custom 实现。Phase 2 工作量比预估大。

## ContextManager 提取实际范围
- Context assembly: L320-340 = 20行
- endTurn: L477-483 = 6行
- Compression: L485-579 = 95行
- 总计 ~121行（不是200行）
- contextSummarizer.ts (402行) 和 turnResultCompressor.ts (243行) 已是独立模块
- 5处 hook context 引用 `this.turnMessages` 需改为 `contextManager.getTurnMessages()`

## Phase 优先级调整建议
- Phase 0: 全部保持，可直接开始
- Phase 1.1 ContextManager: 降低预期（~121行提取，不是200）
- Phase 1.2 ChatPanelRenderer: 保持（~120行，独立关注点）
- Phase 1.3 RunInitializer: 建议删除（75行+参数依赖重，ROI低）
- Phase 1.5 Bug#1: 删除（不是bug），Bug#2 保留
- Phase 2: 修正内化目标（不是 coordinator）
- Phase 3: 保持

## 瘦化预期修正
计划声称 1015→~400行，实际预计 1015→~650行（ChatPanelRenderer ~120行 + ContextManager 状态字段和方法 ~121行 + 部分辅助方法）
