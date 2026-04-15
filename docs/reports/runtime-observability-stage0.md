# 阶段 0：现状冻结与问题清单（2026-02-27）

## 目标范围
- 工具调用可见性
- 上下文预算可见性
- 进度可见性
- 中途中断能力

## 现状-证据-缺口

| 范围 | 现状 | 证据（代码位置） | 事件链路（当前） | 缺口 |
|---|---|---|---|---|
| 工具调用可见性 | UI 通过分散回调拼工具状态（开始/结束） | `src/engine/agent/agentRuntime.ts:778-823`（生成/分流工具调用）；`src/engine/agent/agentRuntime.ts:944-974`（`onToolCall`/`onToolResult`）；`src/engine/services/AgentOrchestrator.ts:215-223`（转发）；`src/features/chat/useChat.ts:241-290`（更新 `toolCalls`） | `AgentRuntime.onToolCall/onToolResult -> AgentOrchestrator.handleToolCall/handleToolResult -> useChat setHistory/setToolCalls -> ToolExecutionPanel` | 没有统一事件协议；工具状态依赖 UI 侧本地时间戳拼接，无法保证与运行时单一事实源一致 |
| 上下文预算可见性 | 预算只在 Runtime 打日志，UI 无结构化订阅 | `src/engine/agent/agentRuntime.ts:408-417`（计算并打印 `currentTokens/max`）；`src/features/chat/useChat.ts:184`（声明 `onUsageUpdate`）；`src/engine/services/AgentOrchestrator.ts:39`（声明 `onUsageUpdate`） | `AgentRuntime console.log(context)`, 未进入 UI 状态流 | 用户看不到 `current/max/%` 的连续更新；`onUsageUpdate` 声明存在但未接线到 Runtime 事件 |
| 进度可见性 | 进度来自多个回调与弱结构字符串 | `src/features/chat/useChat.ts:155-236`（`onStatusChange/onThinkingUpdate/onIterationStart/onIteration` 并行更新）；`src/features/chat/index.tsx:165`（`loadingStatus || Thinking...`）；`src/ui/components/ToolExecutionPanel.tsx:365-423`（基于 `toolCalls` 推断阶段） | `AgentRuntime -> 多回调 -> useChat 多状态 -> MessageList/ToolExecutionPanel` | UI 不是订阅单一事件流；“阶段 + 进度”不是强类型字段，推断结果可能与真实阶段漂移 |
| 中途中断能力 | 没有用户 Stop 入口，也没有 Runtime cancel 机制 | `src/features/chat/index.tsx:391-414`（仅提交输入，无 Stop/Continue/New instruction 控制）；`src/engine/services/AgentOrchestrator.ts:70-123`（无 cancel API）；`src/engine/agent/agentRuntime.ts:403-875`（主循环无取消检查） | 用户只能等待 `run()` 自然结束或报错 | 无法保证“Stop 后不再发新工具调用”；UI 无明确 `Canceled by user` 终态 |

## 漂移实现（阶段 4 预清单）

| 现象 | 证据（代码位置） | 风险 |
|---|---|---|
| 未接线组件：`ToolCallItem` | `src/ui/components/ToolCallItem.tsx:1-104`（仅定义，无引用） | 文档/类型存在但实际不显示，增加维护噪音 |
| 未消费入参：`MessageList` 的 `currentToolCalls/iterations` | `src/features/chat/index.tsx:123-132`（定义）；`src/features/chat/index.tsx:148-214`（未使用） | 形成“看起来有状态，实际不用”的错位 |
| 未落地回调：`onUsageUpdate` | `src/engine/services/AgentOrchestrator.ts:39`（定义）；全仓未见调用 | “类型说有 usage 通道，实际 UI 不更新” |

## 结论（阶段 0 验收）
- 四个范围均已给出“现状-证据-缺口”。
- 每个缺口均包含代码位置与明确事件链路。
- 后续阶段以“统一 `AgentRuntimeEvent` 单流”为改造主线。
