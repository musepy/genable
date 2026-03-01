# 阶段 5：回归与验收脚本

## 运行方式
```bash
npm run test -- src/engine/agent/__tests__/agentRuntime.events.e2e.test.ts
```

## 场景 1：正常完成
- 用例：`Scenario 1: normal completion emits full trajectory and completed status`
- 关注点：
  - 事件流出现 `iteration_start -> tool_call -> tool_result -> completed`
  - 包含 `context_usage` 更新
  - 最终状态为 `completed`
- 对应测试：`src/engine/agent/__tests__/agentRuntime.events.e2e.test.ts`

## 场景 2：工具报错恢复
- 用例：`Scenario 2: tool error then recovery keeps visible error trail and still completes`
- 关注点：
  - `tool_result.success=false` 且携带错误原因
  - 后续恢复工具成功
  - 最终仍可 `completed`
- 对应测试：`src/engine/agent/__tests__/agentRuntime.events.e2e.test.ts`

## 场景 3：用户中断
- 用例：`Scenario 3: user cancel stops issuing new tool calls and ends with canceled status`
- 关注点：
  - 触发 `cancel()` 后出现 `canceled` 事件
  - 停止后不再发起新工具调用（验证 `after_tool` 未被调用）
  - UI 文案应显示 `Canceled by user`
- 对应测试：`src/engine/agent/__tests__/agentRuntime.events.e2e.test.ts`

## UI 验收观察项
一次真实运行中，UI 持续可见并刷新：
- 当前阶段与进度（Stage & Progress）
- 最近工具链（Recent Tool Chain，含耗时/失败原因）
- 上下文占用（Context Usage，current/max/%）
