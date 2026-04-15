# 架构提案评估与推荐方案

## 诊断结论：提案 70% 与现有架构重叠或在 Figma 沙箱中不可行

逐条评估如下：

| 步骤 | 提议 | 现状 | 可行性 | 建议 |
|------|------|------|--------|------|
| 1. VirtualCanvasState | 构建虚拟画布状态 | Figma 文档本身就是 SSOT；`nodeRegistry` 做会话级缓存，每次请求清空 | **负价值** — 建了第二个真相源，用户手动编辑/协作/Cmd-Z 立刻导致漂移，Figma 无 onChange 事件无法同步 | **不做** |
| 2. 操作协议 | opId + preconditions + intentReason | `batchOperations` 已有 opId、dependsOn、onError 策略；`patchCache` 做幂等 | 部分缺失：无前置条件校验、无 intent 记录 | **增量扩展现有 batchOperations** |
| 3. 编译执行器 | ops → batchOperations | `autoBatchToolCalls()` + `toolCallHandler.executeSingleOperation()` 已经是这个流程 | 已存在 | **不做** — 换了术语描述现有架构 |
| 4. 提交日志 + Undo | 完整修订系统 | 无 | **严重受限** — Figma 无 plugin undo API，`figma.undo()` 只撤销最后一个原子操作；无持久存储（clientStorage 容量小、不跨设备） | **仅做轻量内存操作日志** |
| 5. 回读校验 | 执行后强制 inspectDesign 对比 | `layoutSnapshots` 已在 batch 后返回序列化结果；`VERIFICATION` 模式已存在 | 缺自动 diff | **在现有 snapshot 基础上加 intended vs actual diff** |
| 6. LLM 上下文包 | 从对话切为快照 | `ContextManager` 已做：turn-based 压缩、instruction anchoring、narration stripping、tool result 截断、200K 上下文 80% 压缩 | LLM API 要求多轮对话格式，不能只发快照 | **改进迭代开头的状态摘要注入，属于 prompt 工程** |
| 7. 双轨迁移 | dual-write | `generateDesign` 已作为备选路径存在 | 改动太小不需要双轨 | **不需要** |

---

## 真正值得做的 4 件事

基于代码探索发现的实际问题：

### 1. 前置条件校验（Precondition Validation）
**问题**：LLM 尝试对 TEXT 节点设 layoutMode，对非 auto-layout 子节点设 FILL sizing → 运行时失败 → 触发 RECOVERY 模式 → 浪费 3+ 轮迭代。

**方案**：在 `toolCallHandler.ts` 的 `executeSingleOperation()` 入口处，加一层轻量校验：
- 节点类型是否支持该属性（TEXT 不支持 layoutMode）
- 父节点是否满足子属性要求（FILL sizing 需父节点有 auto-layout）
- 目标节点是否存在（提前返回明确错误而非 Figma 抛异常）

**修改文件**：
- `src/ipc/handlers/toolCallHandler.ts` — 添加 `validatePreconditions()`
- `src/engine/agent/tools/designSuperTools.ts` — schema 中加 optional `preconditions` 字段

### 2. 操作意图记录（Intent Tracking）
**问题**：当 LLM 连续调用 `applyDesignPatch` 时，没有记录"为什么"，导致循环检测只能靠签名匹配，且 LLM 在后续轮次中忘记自己做过什么。

**方案**：
- 在 `batchOperations` / `applyDesignPatch` 参数中加 optional `reason: string`
- 在 AgentRuntime 中维护 `operationLog: Array<{opId, tool, reason, timestamp, success}>` （内存，最近 20 条）
- 每轮迭代开头将 operationLog 摘要注入 system prompt

**修改文件**：
- `src/engine/agent/tools/designSuperTools.ts` — schema 加 reason 字段
- `src/engine/agent/agentRuntime.ts` — 维护 operationLog，注入摘要
- `src/engine/llm-client/context/promptComposer.ts` — 新增 operation-history section

### 3. 自动化 Diff 校验（Automated Diff）
**问题**：`layoutSnapshots` 返回了实际状态，但 LLM 必须自己解读是否符合预期。Figma 会静默修正某些属性（如无效的 sizing 组合），LLM 无法察觉。

**方案**：
- batch 执行后，对比 intended params vs actual snapshot
- 生成简洁的 diff 摘要（如 `"node frame1: intended layoutMode=VERTICAL, actual=NONE (parent has no auto-layout)"`)
- 将 diff 附加到 tool result 中

**修改文件**：
- `src/ipc/handlers/toolCallHandler.ts` — 在 batch 结果处理中加 `diffIntendedVsActual()`
- 新增 `src/engine/validation/mutationDiff.ts` — diff 逻辑

### 4. 迭代状态摘要（Iteration State Summary）
**问题**：LLM 在第 10+ 轮迭代时，由于上下文压缩丢失了早期操作记忆，重复创建已存在的元素或反复修改同一属性。

**方案**：
- 每轮迭代 system prompt 开头注入紧凑的状态行：
  ```
  [STATE] Canvas: root "Main Frame" (12 children) | Step 3/5 "Build card grid" |
  Last 3 ops: createNode(header), batchOps(3 cards), applyPatch(spacing fix) |
  Known issues: none
  ```
- 利用现有 planState + operationLog 生成

**修改文件**：
- `src/engine/agent/agentRuntime.ts` — 在 `composeSystemPrompt()` 中注入状态摘要
- `src/engine/llm-client/context/sectionRegistry.ts` — 注册新的 `iteration-state` section

---

## 实施顺序

1. **前置条件校验** — 最高 ROI，直接减少 RECOVERY 模式触发
2. **操作意图记录** — 为后续步骤提供数据基础
3. **迭代状态摘要** — 利用 #2 的 operationLog 改善 LLM 上下文质量
4. **自动化 Diff 校验** — 最后做，因为需要序列化对比逻辑

## 验证方式

- 运行现有测试：`src/engine/agent/__tests__/` 下的 agentRuntime、agentLoopPolicy、behavior_contract 测试
- 手动测试：在 Figma 中触发 agent 完成一个多步骤 UI 生成任务，观察：
  - RECOVERY 模式触发次数是否减少（前置条件校验效果）
  - LLM 是否重复创建元素（状态摘要效果）
  - Tool result 中是否包含 diff 信息（自动化 diff 效果）
- 对比迁移前后的平均迭代次数和成功率
