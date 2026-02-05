---
name: log-analysis
description: >
  用于分析 Figma Plugin/Agent 运行日志的技能。
  能够识别思考循环（Thinking Loop）、工具调用中断、性能瓶颈及架构耦合问题。
---

# Log-Oriented Analysis Skill (面向日志的分析技能)

> 通过分析运行时日志推断 LLM 的心理模型、执行偏差与系统瓶颈。

## 1. 核心检测模式 (Core Detection Patterns)

### A. 思考循环 (Thinking Loop / Cognitive Loop)
*   **症状：** `Iteration` 持续增加，但 `Progress` 内容高度重复，无工具调用。
*   **日志特征：**
    *   `[AgentRuntime] Iteration X/40` 连续出现。
    *   `Progress` 字段中出现类似 "I'm focusing on...", "Finalizing..." 的高频重复词汇。
    *   `[AgentRuntime] Thinking-only iteration detected` 警告。
*   **根本原因：** 任务进入微观打磨（Style Polishing）阶段，Prompt 没能提供“足够好（Good Enough）”的退出条件。

### B. 执行逃避 (Action Avoidance)
*   **症状：** LLM 输出大量 Markdown 解释逻辑，但 `Tool Call` 为空。
*   **日志特征：**
    *   `Text length: >2000` 但 `tool calls: 0`。
    *   频繁进行“业务逻辑推理”而非“具体执行方案”。
*   **根本原因：** 决策成本过高或工具参数不明确，导致 LLM 倾向于生成“安全”的解释性文本。

### C. 资源瓶颈 (Resource Bottlenecks)
*   **症状：** 缓存预热时间长，响应延迟。
*   **日志特征：**
    *   `[FigmaVariableCache] Cache warmed in >500ms`。
    *   `[AgentRuntime] Thinking timeout (30000ms)` 被触发。

## 2. 分析方法论 (Methodology)

1.  **分片扫描 (Iteration Mapping):** 将日志按 Iteration 分组，识别从 `PLANNING` 到 `EXECUTION` 的切换点。
2.  **熵增检查 (Entropy Check):** 观察 `Progress` 信息量的动态变化。如果信息熵（内容差异）急剧下降，说明进入循环。
3.  **工具效能审计 (Tool Audit):** 检查 `Tool Result` 是否被后续 Iteration 有效利用。
    *   *孤立配置：* 工具返回了数据，但 LLM 下一步完全忽略了该数据。
    *   *自愈循环：* 工具报错 -> LLM 尝试修复 -> 相同逻辑再次报错。

## 3. 常见问题及修复建议 (Troubleshooting & Fixes)

| 症状 | 修复策略 |
| :--- | :--- |
| **重复的 Progress 汇报** | 修改 Prompt：限制 `Progress` 字段长度，禁止在迭代 3 次以上重复相同词汇。 |
| **只思考不调用工具** | 增加强制约束：如果任务已完成 90%，必须调用 `complete_task`。 |
| **Cache 预热超时** | 优化 `FigmaVariableCache`：增加局部缓存或异步预热机制。 |
| **Token 预算超支** | 进行 `Tool Format` 精简，或使用裁剪版 Context（Levels 1-2）。 |

## 4. 调用示例 (Usage)

当用户输入“分析为什么卡住了”时，应调取此技能并按以下格式汇报：
1.  **当前阶段：** (例如：Iteration 12, EXECUTION mode)
2.  **循环点检测：** (高亮重复的 Progress 文本)
3.  **性能指标：** (Token 使用率，Timeout 状态)
4.  **改进建议：** (针对 Prompt 或 Architecture 的具体修复思路)
