# Agent Context Management V2 设计稿（Figma Sandbox + UI）

状态：Draft  
日期：2026-02-24  
适用范围：Genable 插件（UI 线程 + Main/Sandbox 线程）  

## 1. 背景与问题

当前上下文清洗器的目标是防止 token 膨胀，但存在两个核心问题：

1. 清洗策略偏“统一强裁剪”，不同工具的关键信号被同样处理，导致语义损失。  
2. 运行时要求 `inspectDesign -> validateLayout` 做验证链路，但 `inspectDesign` 结果在进入模型前已被过度蒸馏，形成契约冲突。  

本设计稿目标：在不牺牲稳定性的前提下，重构为“分层上下文管理 + 非破坏压缩 + 自动恢复 + 外置记忆 + 显式控制面”。

## 2. Figma 插件环境约束（必须遵守）

### 2.1 双线程模型

1. Main/Sandbox 线程：可访问 Figma SceneGraph 与 Plugin API；无 DOM。  
2. UI 线程（iframe）：有 DOM、可做 UI 交互；通过 IPC 与 Main 通信。  
3. 线程间通信依赖事件协议（`TOOL_CALL`/`TOOL_RESULT`），大 payload 会直接推高上下文和延迟。

### 2.2 平台限制

1. `documentAccess: dynamic-page` 下节点访问必须走 async API（如 `getNodeByIdAsync`）。  
2. Figma 操作本质上需顺序执行，批量工具可封装但不能假设真实并发写 SceneGraph。  
3. 网络访问受 `manifest.json -> networkAccess.allowedDomains` 约束。  
4. Main 线程应保持“可预测、短路径、低阻塞”；复杂文本处理和压缩策略优先放 UI 线程。

## 3. 设计目标与非目标

### 3.1 目标

1. 工具结果按语义差异化保留，不再统一裁剪。  
2. 压缩过程非破坏，可回放原始结果。  
3. 上下文超限自动恢复（不依赖人工中断）。  
4. 提供跨会话外置记忆（稳定事实沉淀）。  
5. 提供显式控制动作（clear/compact/new-task-handoff）。

### 3.2 非目标

1. 不在本阶段引入重型向量数据库。  
2. 不改变现有工具执行语义（只改上下文组织与恢复策略）。  
3. 不把 SceneGraph 写操作迁移出 Main 线程。

## 4. 总体架构（V2）

将上下文拆成 3 层，而非 1 层“清洗后直接上模型”：

1. `L0 Raw Store`（非破坏层）  
2. `L1 Working Context`（模型输入层）  
3. `L2 Durable Memory`（跨会话稳定层）

### 4.1 L0 Raw Store（新增）

用途：保存每次工具原始响应，供回放与再压缩。  
特征：

1. 只追加（append-only），不做 destructive 覆盖。  
2. 每条记录生成 `resultId`、`toolName`、`timestamp`、`payloadHash`。  
3. 采用 Ring Buffer + TTL（避免无限增长）。  

建议结构：

```ts
type RawToolResultRecord = {
  resultId: string;
  toolName: string;
  requestId: string;
  createdAt: number;
  payloadHash: string;
  rawResponse: unknown; // 原始 TOOL_RESULT.response
};
```

### 4.2 L1 Working Context（替代当前统一清洗）

用途：提供给 LLM 的“可推理最小上下文”。  
核心：按工具名应用不同保留策略（policy-driven distillation）。

建议接口：

```ts
type DistillPolicy = {
  toolName: string;
  preserve: string[];      // JSONPath/字段白名单
  compactChildren?: boolean;
  maxItems?: number;
  onOversize: "summarize" | "skeletonize" | "drop-oldest";
};
```

### 4.3 L2 Durable Memory（外置记忆）

用途：存稳定事实，不把“长期记忆”塞进会话上下文。  
建议内容：

1. 架构决策（decision log）  
2. 项目约定（design/system constraints）  
3. 进行中任务摘要（handoff state）

建议存储适配器：

1. `FigmaClientStorageAdapter`（默认，跨会话）  
2. `InMemoryAdapter`（测试/回归）

> 注：若后续有文件系统桥接，再加 `FileAdapter`，但不作为 V2 前提。

## 5. 差异化清洗策略（第一版矩阵）

| 工具 | 必保字段 | 可裁剪字段 | 备注 |
|---|---|---|---|
| `inspectDesign(selection)` | `count`, `nodes[].id/name/type` | 过长 metadata | 不能丢 `nodes` |
| `inspectDesign(node/hierarchy)` | `id/type/props(关键布局与文本)/childrenCount` | 深层 children 全量 props | 保留可验证信息 |
| `validateLayout` | `valid`, `errors`, `warnings`, `summary` | 冗余上下文文本 | 验证链路核心 |
| `batchOperations` | `idMap`, `results(opId/action/success/nodeId/error/diff)` | 重复大字段 | 便于后续 patch |
| `applyDesignPatch` | `summary`, `results(nodeId/applied)` | 原始大块 echo | 回归与解释足够 |

## 6. 非破坏压缩机制

核心原则：**压缩的是 L1，不是删除 L0**。

流程：

1. 工具返回后先写入 L0。  
2. 再根据 `toolName` 生成 L1 distilled 视图。  
3. 当 token 紧张时，仅替换/压缩 L1 历史片段。  
4. 若需要细节，可通过 `resultId` 从 L0 重新构建。

回放接口（内部）：

```ts
rehydrateToolResult(resultId: string, mode: "full" | "verify"): unknown
```

## 7. 自动恢复（Context Overflow Recovery）

触发条件（任一）：

1. 预测 token 使用率超过阈值（建议 70% 预警、80% 执行）。  
2. Provider 返回 context window / token overflow 错误。  

恢复策略：

1. `Phase A`：优先压缩 L1 旧 tool results（保留最新任务链）。  
2. `Phase B`：执行 25% oldest working context 截断（L0 不动）。  
3. `Phase C`：最多重试 2~3 次并记录恢复事件。  
4. `Phase D`：仍失败则生成 handoff 摘要并触发 `new_task` 建议。

## 8. 显式控制面（Control Surface）

新增或扩展 workflow 控制动作：

1. `compact_context(focus?: string)`：主动压缩当前任务相关上下文。  
2. `clear_context(mode: "soft" | "hard")`：  
   - `soft`：清 L1，保 L0/L2  
   - `hard`：清 L1 + 丢弃本会话 L0 索引（L2 保留）  
3. `new_task_handoff(summaryScope)`：将当前状态写入 L2 并开始新任务。

> 在 Figma 环境下，这些动作应在 UI 线程执行编排，Main 线程只提供必要持久化桥接。

## 9. 线程职责划分（Sandbox + UI）

### 9.1 UI 线程职责

1. ContextManagerV2（L0/L1）  
2. DistillPolicyEngine  
3. Overflow Recovery Orchestrator  
4. 用户控制命令入口（clear/compact/new-task）

### 9.2 Main/Sandbox 线程职责

1. 工具执行（SceneGraph 读写）  
2. 精简存储桥接（clientStorage 读写）  
3. 不承载复杂摘要与压缩逻辑

## 10. 与现有代码的落地映射

### 10.1 首批改造文件

1. `src/engine/agent/context/toolResultCleaner.ts`  
2. `src/engine/agent/agentRuntime.ts`  
3. `src/engine/agent/context/contextManager.ts`  
4. `src/engine/agent/tools/workflowTools.ts`（新增控制动作）  
5. `src/types.ts` + `src/ipc/handlers/*`（若引入持久化桥接事件）

### 10.2 关键改造点

1. 并行与顺序路径都传入 `toolName` 到清洗层，保证策略一致。  
2. 为 `inspectDesign` 增加专用策略，确保 `selection` 不丢字段。  
3. 引入 `RawToolResultStore`，替换“只保留蒸馏结果”的单层模式。  
4. 在 Runtime 增加 overflow 恢复状态机。  
5. 为 workflow tool 添加显式上下文控制动作。

## 11. 分阶段计划

### Phase 1（低风险，先止血）

1. 修复 `inspectDesign` 契约丢失。  
2. 并行/顺序清洗入口统一。  
3. 增加清洗策略单测矩阵。

### Phase 2（结构升级）

1. 引入 L0 Raw Store。  
2. 引入 policy-driven distillation。  
3. 落地 soft/hard clear。

### Phase 3（稳定性升级）

1. 自动恢复状态机。  
2. L2 durable memory（clientStorage 适配）。  
3. handoff/new task 贯通。

## 12. 验收标准

1. `inspectDesign(selection)` 在 LLM 侧仍能看到 `count/nodes`。  
2. `inspectDesign -> validateLayout` 链路可重复成功。  
3. 上下文超限后可自动恢复继续执行（无人工重启）。  
4. 清理动作可显式触发且行为可预测。  
5. 历史压缩后仍可从 L0 回放关键工具结果。

## 13. 风险与缓解

1. 风险：L0 过大导致内存压力  
   缓解：Ring Buffer + TTL + Hash 去重  
2. 风险：策略矩阵维护成本  
   缓解：按工具分组 + 回归测试模板化  
3. 风险：过度压缩导致隐性回归  
   缓解：引入 `verify mode` 回放与 golden tests

---

该设计稿优先保证“可验证链路正确性”和“Figma 双线程可执行性”，再逐步提升上下文效率。
