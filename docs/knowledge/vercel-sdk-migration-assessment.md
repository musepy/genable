# 迁移评估：逐节点决策矩阵

> Date: 2026-03-31
> Index: [Vercel AI SDK 评估](vercel-ai-sdk-evaluation-index.md)
> 聚焦问题：综合前 5 篇分析，逐个节点给出"SDK 代劳 / 自建 / 混合"的推荐，以及渐进式改造路径

---

## 1. 逐节点决策矩阵

| 节点 | SDK 提供 | 我们现有 | SDK 优势 | 自建优势 | 推荐 |
|------|---------|---------|---------|---------|------|
| **Agent 循环** | `ToolLoopAgent` | while 循环 + Hook 系统 | 消除消息拼装/终止判断 bug，~200行→~15行 | Hook 系统灵活（beforeIteration、afterLLMResponse） | ⚖️ 待评估 |
| **Provider 适配** | `LanguageModel` | `LLMProvider` 接口 | 零代码加 Provider，协议差异自动处理 | 暴露 contextWindow、toolSystemInstruction | ✅ **SDK 代劳** |
| **Schema 验证** | `tool()` + valibot | Gemini native JSON Schema | 范围约束、验证失败重试、多 Provider | Gemini 原生够用 | 跟随 Agent 循环决策 |
| **Chat 会话** | `Chat<UIMessage>` | 4 层 Context + 懒压缩 | 流式渲染、Transport 切换 | Context 分层管理远超 SDK 能力 | ❌ **保留自建** |
| **多模态输出** | `toModelOutput` | `Part.inlineData` 手动组装 | 声明式，在工具定义层指定 | 已经能工作 | 🔧 借鉴模式 |
| **noop 检测** | ❌ SDK 不提供 | ❌ 缺失 | — | — | 🔧 **自建**（方案 B） |
| **重复调用检测** | ❌ SDK 不提供 | Hook 循环检测（粗粒度） | — | — | 🔧 **自建增强** |
| **步数警告** | ❌ SDK 不提供 | ❌ 缺失 | — | — | 🔧 **立即自建** |
| **工具日志** | ❌ SDK 不提供 | runtime event（基础） | — | — | 🔧 **自建增强** |
| **Anthropic cache** | `providerOptions` | N/A | 降低 token 消耗 | — | 跟随 Provider 决策 |

### 推荐符号说明

```
✅ SDK 代劳 — 明确推荐用 SDK 替代自建
❌ 保留自建 — SDK 不覆盖或我们做得更好
⚖️ 待评估 — 需要原型验证后决定
🔧 自建增强 — 不依赖 SDK，独立实现
```

## 2. Agent 循环的深度评估

这是最大的决策点。两个方向各有代价：

### 方向 A：引入 ToolLoopAgent

**需要适配的**：
- 4 层 Context → 映射到 `prepareCall` 中的 messages 注入
- Hook 系统 → 在工具的 `execute` 函数中实现（OpenPencil 已验证可行）
- beforeIteration/afterLLMResponse → 需要找到 SDK 中的等价钩子（`onStepFinish` 有部分覆盖）
- 工具审批（requireToolApproval）→ SDK 没有直接支持，需要在 execute 内 await
- 子任务递归（subtask executor）→ 可以作为一个工具注册到 SDK
- Truncation guard → SDK 内部处理，可能需要验证行为是否一致

**会失去的**：
- `beforeIteration` Hook 的灵活性
- `afterLLMResponse` Hook 对原始响应的拦截能力
- 对 `toolConfig.mode` 的 per-iteration 控制

**会获得的**：
- 消息格式兼容性由 SDK 保证
- 步数管理的一致性
- 消除自建循环的 edge case bug

### 方向 B：保留自建循环，修复已知问题

**需要修复的**：
1. "无工具调用 = 结束"的过早退出问题
2. truncation retry 的步数计量不一致
3. 消息格式在多 Provider 下的兼容性

**保留的优势**：
- Hook 系统的完全控制权
- 4 层 Context 的无缝集成
- 工具审批流的原生支持
- 子任务递归的精细控制

## 3. 推荐的渐进式改造路径

不建议一次性迁移。以下是**按风险从低到高**排序的改造步骤：

```
Phase 0: 独立增强（不需要 SDK，立即可做）
├── 步数警告注入（appendStepWarning 模式）
├── 工具日志增强（ToolLogEntry 结构）
├── 重复调用检测（callHistory Map）
└── Main Thread 端 noop 检测

Phase 1: Provider 抽象（引入 SDK 的 LanguageModel）
├── npm install ai @ai-sdk/google @ai-sdk/anthropic
├── 用 SDK createModel() 替代自建 GeminiProvider
├── 保留 AgentRuntime 循环不变
└── 验证：tool calling 格式兼容性

Phase 2: Schema 验证（引入 SDK 的 tool()）
├── 工具定义从 JSON Schema 迁移到 valibot + tool()
├── 在 ToolDefinition 中增加 mutates 信号
└── 验证：参数验证行为和现有一致

Phase 3: 评估 Agent 循环替换
├── 用 ToolLoopAgent 构建原型
├── 验证 4 层 Context 的映射方案
├── 验证 Hook 系统在 execute 层的适配
└── 决策：全量替换 vs 保留自建循环
```

### Phase 之间的依赖

```
Phase 0 → 独立，任何时候都能做
Phase 1 → 独立，但建议在 Phase 0 之后（先补齐可观测性）
Phase 2 → 依赖 Phase 1（需要 SDK 的 tool()）
Phase 3 → 依赖 Phase 2（需要 SDK 格式的工具定义）
```

## 4. 成本估算

| Phase | 代码变更量 | 风险等级 | 预期收益 |
|-------|----------|---------|---------|
| Phase 0 | ~100 行新增 | 极低 | 可观测性从 0 → 有 |
| Phase 1 | ~200 行重构 | 中 | 多 Provider 支持、消除 format 代码 |
| Phase 2 | ~150 行重构 | 中 | 参数验证自动化、mutates 信号 |
| Phase 3 | ~500 行重构 | 高 | 消除 Agent 循环 bug、简化核心逻辑 |

## 5. 最终建议

```
即刻行动 → Phase 0（独立增强）
    步数警告、重复检测、日志增强、noop 检测
    零依赖、零风险、立竿见影

短期规划 → Phase 1（Provider 抽象）
    如果计划支持多模型（Claude/GPT），优先做
    如果只用 Gemini，可以推迟

中期评估 → Phase 2 + 3
    在 Phase 0 和 1 完成后，再评估是否值得替换 Agent 循环
    此时我们已有足够经验判断 SDK 的适配成本
```
