# 确定性逻辑审计报告

**日期**: 2026-03-20
**分支**: feat/dogfood-ui
**审计原则**: 确定性逻辑别进上下文 — 凡是不需要模型"判断"的事情，都不要让模型来做
**审计方法**: Claude Opus + Codex (GPT-5.4) 交叉验证

---

## 核心结论

Agent 架构**违反了"确定性逻辑别进上下文"原则**。8 条确定性规则仍靠 prompt 记忆，而不是代码强制。

**根因**: Hook 架构搭了但没接线 — hookTypes.ts 声明了 5 个 lifecycle 点，agentRuntime.ts 只接通了 1 个 (afterLLMResponse)。4 个扩展点是死代码，导致确定性规则无处安放，只能写进 system prompt。

---

## 当前确定性执行机制 (3 层)

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: HOOKS (afterLLMResponse)                       │
│  ├── emptyResponseHook: 空响应重试 ≤2 次 → abort         │
│  └── loopDetectionHook: 指纹相同 ≥4 次 → 注入 hint       │
│                                                          │
│  Layer 2: RUNTIME GUARDS (agentRuntime.ts:745-881)       │
│  ├── emptyArgsGuard: 空参数 ≤3 次 → abort               │
│  ├── consecutiveFailure: 连续全失败 ≥3 次 → 策略切换     │
│  ├── partialFailure: PARTIAL_FAILURE → 强制修复指令      │
│  ├── truncationGuard: 截断 ≤3 次 → 强制结束             │
│  └── budgetWarning: 剩余 20% → wrap up 提示             │
│                                                          │
│  Layer 3: TOOL VALIDATION (toolDispatcher + IPC)         │
│  ├── $LAST expansion: 变量替换                           │
│  ├── unknownCommand: 未知命令 → 建议                     │
│  ├── chainOperators: &&/||/; 语义                        │
│  └── toolTimeout: 30s 超时                               │
│  └── IPC handlers: 路径存在/类型合法/语法校验            │
└─────────────────────────────────────────────────────────┘
```

---

## 8 个确定性规则违规 (按影响排序)

| # | 违规 | 来源 | 当前状态 | 应在哪层执行 |
|---|------|------|---------|-------------|
| 1 | "ALL design ops MUST go through jsx/edit" — 但 run 仍暴露 mk/js/rm/cp | CORE.md:10 | prompt 与 runtime 矛盾 | tool surface 层移除或 dispatcher 拒绝 |
| 2 | Hook 系统半成品 — 声明 5 个 lifecycle 点，只接了 afterLLMResponse | hookTypes.ts:21 | 4 个扩展点死代码 | 接通 before/afterToolExec |
| 3 | 无真正 tool validation — dispatcher 只验命令名和可解析性 | toolDispatcher.ts:312 | schema 定义了 required/enum 但没人检查 | dispatcher 执行前 + IPC 边界 |
| 4 | PARTIAL_FAILURE 修复靠注入"你必须修" — 模型可以忽略 | agentRuntime.ts:827 | 纯 prompt-by-proxy | beforeToolExec 阻断新建操作 |
| 5 | "Inspect before modify" / "never delete what you didn't create" | CORE.md:171 | prompt-only | beforeToolExec 追踪 read-before-write |
| 6 | "NEVER create bare node then style separately" | CORE.md:89 | 需要 afterToolExec 但未接通 | 有状态 hook 检测 create-then-style |
| 7 | 命名规范 (banned names, icon format, logos fill) | CORE.md:78-86 | prompt-only | IPC validator / postOpValidator |
| 8 | Prompt 浪费 token 重复运行时已有的事实 | CORE.md:7,9 | 冗余 | 删除已代码化的 prompt 规则 |

## 正确的 False Positives (不应代码化)

以下规则**需要语义判断**，正确地保留在 prompt 中：

- "Default to FRAME for all UI components" — 需理解"UI 组件"角色
- "Every text node has meaningful content" — 需语义判断
- "Always query knowledge first" — 上下文相关
- Design quality ladder (dimensions 1-7) — 设计决策
- "w:'fill' for text > ~30 chars" — 启发式规则
- "Stop within 1 additional iteration after done" — 需计划状态

---

## 架构发现：双层验证系统

代码库已有两套验证系统，只是没充分利用：

```
┌─── SANDBOX (Agent iframe) ──────────────────────────────┐
│  Hook System                                             │
│  特点: 能看到 tool call 元数据 (name, args)              │
│        不能访问 Figma API                                │
│        适合: 序列跟踪、状态管理、流程控制                │
└──────────────── IPC Bridge (dumb pipe) ─────────────────┘
                         ↓↑
┌─── MAIN THREAD (Figma API access) ─────────────────────┐
│  Property Handler Pipeline (mixin 模式, 已有)           │
│  PostOp Validator (异步审计, 已有 12 种 check)          │
│  特点: 能访问 Figma API、能看到实际节点状态             │
│        适合: 数据验证、属性检查、结果审计               │
└─────────────────────────────────────────────────────────┘
```

### 规则分流原则

```
确定性规则 → 需要什么能力？

  调用序列/状态       数据/属性         节点实际状态
  (谁做了什么)       (值对不对)        (结果对不对)
       │                │                  │
       ▼                ▼                  ▼
  Sandbox Hook     Main Handler      PostOp Validator
 (beforeToolExec) (PropertyHandler)  (validatePostOp)
```

| 规则 | 需要的能力 | 正确的层 |
|------|-----------|---------|
| 重复 tool call 去重 | 调用历史 | Sandbox: beforeToolExec |
| PARTIAL_FAILURE 后阻断新建 | 状态跟踪 | Sandbox: beforeToolExec |
| Read-before-write | 调用历史 | Sandbox: beforeToolExec |
| Create-then-style 检测 | 调用序列 | Sandbox: afterToolExec |
| 节点命名禁止 "unnamed"/"frame" | 字符串检查 | Main: postOpValidator |
| Icon prefix:name 格式 | regex | Main: postOpValidator / JSX parser |
| logos: 不加 fill | 前缀+属性检查 | Main: postOpValidator |
| TEXT 缺 size/fill | 节点状态检查 | Main: postOpValidator |

---

## 决策记录 (8 个 issue, 全部已决)

| Issue | 决策 | 方案 |
|-------|------|------|
| 1. Hook 接线 | **1A 双层协同** | Sandbox hook 接通 + Main thread postOp 扩展 |
| 2. 工具表面 | **2A 收窄** | 隐藏 mk/create/render + dispatcher 拒绝 |
| 3. Ad-hoc guards | **3A 全迁** | 5 个 inline guards → 5 个独立 hook 文件 |
| 4. Token 浪费 | **4A 删除** | 从 CORE.md 移除 3 条冗余规则 |
| 5. God-method | **5A 拆分+迁移同步** | run() → runIteration() + handleToolResults() + handleTurnEnd() |
| 6. PostOp 扩展 | **6A 加全部 3 个** | BANNED_NAME + TEXT_MISSING_STYLE + ICON_BAD_FORMAT |
| 7. 测试覆盖 | **7B 新 hook+postOp** | 新 hook + 新 check 有测试，回归靠现有 suite |
| 8. 性能 | **8B 加监控** | Hook 执行时间日志 |

## 延迟的 TODO

| TODO | 原因 |
|------|------|
| beforeToolExec: read-before-write 跟踪 | 比其他 hook 复杂，当前 scope 已够大 |
| beforeToolExec: identical tool call dedup | loopDetectionHook 已有模式级检测，单次 dedup 不紧急 |

---

## 实施计划 (4 波, 按依赖排序)

```
Wave 1: Infrastructure (前置条件)
  [1] 接通 beforeToolExec/afterToolExec/beforeIteration/afterIteration
      文件: agentRuntime.ts, toolDispatcher.ts (~20 行)
  [2] 拆分 run() 为 runIteration() + handleToolResults() + handleTurnEnd()
      文件: agentRuntime.ts (重构，不改行为)

Wave 2: Guard Migration (依赖 Wave 1)
  [3] 5 个 inline guards → 5 个独立 hook 文件
      emptyArgsHook, consecutiveFailureHook, partialFailureHook,
      truncationHook, budgetHook
      文件: src/engine/agent/hooks/ (5 新文件)
  [4] 从 agentRuntime.ts 删除对应 inline 代码 (~140 行)

Wave 3: Deterministic Rule Enforcement (依赖 Wave 1)
  [5] postOpValidator 扩展 3 个 check
      BANNED_NAME, TEXT_MISSING_STYLE, ICON_BAD_FORMAT
      文件: postOpValidator.ts (~60 行)
  [6] 收窄 LLM 可见工具集 (隐藏 mk/create/render + dispatcher 拒绝)
      文件: commandRegistry.ts, toolDispatcher.ts
  [7] 从 CORE.md 删除 3 条冗余 prompt 规则
      文件: src/prompts/CORE.md

Wave 4: Tests + Monitoring (依赖 Wave 2-3)
  [8] 新 hook 测试 + 新 postOp check 测试 (~150 行)
      文件: hookSystem.test.ts, postOpValidator.test.ts
  [9] Hook 性能监控日志 (~5 行)
      文件: hookRunner.ts
```

## Critical Gap

**Tool surface 收窄后的双重保证**: 如果只从 tool description 隐藏 mk/create/render 但 dispatcher 仍接受，模型可能从上下文记忆中继续使用。需要 **dispatcher 拒绝 + description 隐藏** 双重保证。

---

## 参考文件

| 文件 | 相关行 | 职责 |
|------|-------|------|
| src/engine/agent/agentRuntime.ts | 600-940 | Agent 主循环 + inline guards |
| src/engine/agent/hooks/hookTypes.ts | 21-37 | Hook lifecycle 定义 |
| src/engine/agent/hooks/hookRunner.ts | 29-71 | Hook 执行管线 |
| src/engine/agent/hooks/builtinHooks.ts | 61-123 | 现有 hook 模板 |
| src/engine/agent/toolDispatcher.ts | 115-338 | Tool 验证+执行 |
| src/engine/validation/postOpValidator.ts | 64-141 | 节点质量审计 (12 checks) |
| src/prompts/CORE.md | 1-182 | System prompt (确定性规则混入) |
| src/engine/agent/tools/unified/commandRegistry.ts | 42-65 | 命令注册表 |
