# Debug 模式专项分析报告：@/gemini vs Kilo Code

本报告针对当前项目的 `@/gemini` 工作流与 Kilo Code 的 Debug 模式进行了深度对比，旨在识别当前调试机制的优化空间。

## 1. 维度对照表

| 维度参数 | Kilo Code (Debug Mode) | @/gemini Workflow | 差距评估 |
| :--- | :--- | :--- | :--- |
| **思维发散 (Thinking)** | 强制要求反思 5-7 个可能原因。 | 无明确数量要求，仅要求“寻求背景信息”。 | **差距：** 缺乏发散性思考，容易导致思维定式，跳进错误的修复方向。 |
| **逻辑收敛 (Distillation)** | 将诱因蒸馏至 1-2 个最高概率项。 | 要求“确认哪里出错了以及为什么”。 | **核心一致：** 都强调理解本质。Kilo Code 更有算法美感。 |
| **验证手段 (Validation)** | **日志先行**。用日志验证假设的可行性。 | **测试先行**。强调 TDD 重现 Bug。 | **补充性：** 日志适合探测黑盒逻辑，TDD 适合锁定回归边界。应结合。 |
| **诊断确认 (Diagnosis)** | 修复前要求用户确认**诊断结果**。 | 修复前要求用户确认**错误原因**。 | **一致性高**。 |

## 2. Code 模式与 Debug 模式的“高重合度”风险

目前项目中，Code 模式（实现功能）与 Debug 模式（修复问题）的表现确实非常相似，甚至接近重合，原因如下：

*   **单一提示词逻辑**：[composeAgentSystemPrompt](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/src/engine/llm-client/context/promptComposer.ts#53-108) 是一次性生成的，没有针对“修复”和“开发”做条件分支。
*   **Workflow 全局化**：`@/gemini` 被作为全局指令，导致在“写代码”时，Agent 也会反复确认行为，虽然严谨但可能降低新功能开发的爆发力。

### 启发：
> [!IMPORTANT]
> **Code 模式**应侧重于：设计模式、代码质量、可扩展性、原子化提交。
> **Debug 模式**应侧重于：根因分析、副作用隔离、测试覆盖、日志采样。
>
> 如果两者完全一致，Agent 会在需要“创造性”时表现得过于“防御性”。

## 3. 改进建议 (针对 @/gemini)

1.  **引入深度反思 (5-7 Sources)**：将 Kilo Code 的思维路径引入 `@/gemini`，强制 Agent 在回答前列出多种可能性。
2.  **区分模式指令**：在 [composeAgentSystemPrompt](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/src/engine/llm-client/context/promptComposer.ts#53-108) 中注入 `mode` 参数。
    - `mode === 'debug'`：激活 TDD 与日志验证 SOP。
    - `mode === 'code'`：激活设计模式审计、目录结构优化指南。
3.  **日志分层**：借鉴 Kilo Code，将日志不仅仅作为 debug 工具，而是作为“验证假设”的科学手段。
