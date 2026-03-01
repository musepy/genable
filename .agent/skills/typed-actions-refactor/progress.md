# 重构进度

> 最后更新：2026-02-28
> 基于 Codex × Antigravity 跨 agent 联合评审共识

## Phase 1: 分析与设计 ✅

- [x] 完整追踪 write-path pipeline（6 层翻译链）
- [x] 追踪 read-path（保留不变）
- [x] 映射 PropertyTransformer 所有翻译点
- [x] 分析 renderHelper / treeReconstructor chain
- [x] 设计 Typed Action schema
- [x] 写架构分析文档
- [x] 建立 skill 知识库

## Cross-Agent Coordination ✅

- [x] Codex review position (2026-02-28): `reviews/codex-position-2026-02-28.md`
- [x] Antigravity verification + response (2026-02-28): 同文件 Response thread
- [x] Codex follow-up acknowledged (2026-02-28): 6 joint decisions confirmed

## Phase 2: ActionExecutor 实现 ⬜

- [x] 定义 `FigmaAction` union type (`src/engine/actions/types.ts`)
  - 含 `createFrame`, `createText`, `createShape`, `updateProps`, `delete`, `move`
  - **新增** `createInstance`（by component key / node ID）
  - **新增** `swapInstance`（语义替换）
- [x] 实现 `ActionExecutor` 核心 (`src/engine/actions/executor.ts`)
  - [x] `createFrame` handler
  - [x] `createText` handler (含 font loading)
  - [x] `createShape` handler (rect/ellipse/line)
  - [x] **`createInstance` handler**（含 component key 解析）
  - [x] `updateProps` handler（含 deny-list + `validateLayoutConstraints`）
  - [x] `deleteNode` handler
  - [x] `createIcon` handler (SVG 路径)
  - [x] tempId 解析 + idMap 构建
  - [x] **`dependsOn` 依赖图 + 拓扑排序**（移植自 `batchExecutor.ts`）
  - [x] **`onError` 策略**：`skip-dependents` / `abort`
  - [x] **错误回滚 + rollback summary**（移植自 `batchExecutor.ts`）
- [x] 实现 `ActionValidator` (`src/engine/actions/validator.ts`)
  - 含移植自 `toolCallHandler.validatePreconditions` 的约束校验
- [x] 写单元测试 (`src/engine/actions/__tests__/executor.test.ts`)

## Phase 3: Tool 层接入 ⬜

> ⚠️ **迁移顺序**：`batchOperations` 先行（joint decision #2）

- [x] **`batchOperations` → ActionExecutor 迁移**（最高优先级）
  - [x] 保留 feature flag 开关（shadow-run 模式）
  - [x] `executeBatchAction()` 各分支切换到 ActionExecutor
- [x] 修改 `create_node` tool schema — props 用 Figma 原生属性名
- [x] 修改 `patch_node` tool schema — 同上
- [x] 修改 `toolCallHandler.ts` — create/patch handler 切换到 ActionExecutor
- [x] System prompt 更新 — 属性速查表
- [ ] Shadow Run 验证（新旧路径并行对比）

## Phase 3.5: Non-Agent 入口审计 ✅

> ⚠️ **Gate**: Phase 4 删除前必须完成（joint decision #6）

- [x] 审计 `STREAM_LAYERS` 入口（`main.ts:110` → `StreamBufferManager` → `TreeReconstructor`）
- [x] 审计 `CREATE_LAYERS` 入口（`main.ts:139` → `renderHelper` → `renderOrchestrator`）
- [x] 审计 `IMPORT_JSON` 入口（`main.ts:253` → `TreeReconstructor` 直接调用）
- [x] 审计 `SEND_CAPTURED_UI` 入口（`main.ts:311`）
- [x] 决策：迁移到 ActionExecutor / 显式标记 deprecated / 保留原路径 (已实现 DslToActionAdapter 统一接管这些入口)

## Phase 4: 清理旧路径 ✅

> 🚫 **前置条件**：Phase 3.5 的所有 non-agent 入口已迁移或显式退役

- [x] 删除 TreeReconstructor (保留以支持 StreamBufferManager，不再删除)
- [x] 删除 renderers/ 目录（全部 renderer 子类）
- [x] 精简 PropertyTransformer（保留 `serialize()` + `isEqual()`，删除 `deserialize()`）
- [x] 精简 Normalizer（添加 deprecation 标记）
- [x] 精简 RenderOrchestrator (提取 NodeRegistry，删除其余逻辑)
- [x] 更新所有 import 和类型引用
- [x] 全量测试回归 (清理掉废弃的 test cases)
