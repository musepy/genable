# Kilo Code 系统提示词对比报告与启发

本项目旨在借鉴 Kilo Code 的系统提示词设计，优化当前 Figma AI 插件的 Agent 表现。以下是基于 Kilo Code 提示词维度的详细评估与启发分析。

## 1. 核心维度对比矩阵

| 维度 | Kilo Code 表现 | 当前项目 (Agentic Loop) 表现 | 差距与启发 |
| :--- | :--- | :--- | :--- |
| **Markdown 引用** | 强制要求 `[filename](path:line)` 可点击，带行号且语义明确。 | 基本 Markdown 输出，无特定格式索引要求。 | **启发：** 引入文件/代码块索引规则，可增强 Agent 在复杂多步操作中的追溯能力。 |
| **环境感知** | 实时注入 OS, Shell, CPU, 活跃文档, 光标位置, 运行中终端。 | 仅提供 `SelectionContext` (Figma 节点数据)。 | **启发：** 应注入更多工程上下文（如：插件版本、UI 状态、正在进行的测试），避免 Agent 做出脱离环境的决策。 |
| **工具协议约束** | 严格定义思维逻辑：Assess -> Choose -> Iterative -> Iterative. 强制要求先分析再执行。 | 提示词中仅提到 "chain multiple tool calls"，缺乏思维路径引导。 | **启发：** 将“先思考、再检索、最后修改”的原子化步骤写入 System Prompt，减少生成幻觉。 |
| **行为准则 (Nudges)** | 明确禁止客套话 (No Great/Sure), 严格执行路径规范 (No ~/$HOME)。 | 侧重于目标达成，缺乏对 Agent 交互语气和路径安全的限制。 | **启发：** 增加“防御性”提示，限制 Agent 的回复冗余度和路径风险，提高工程化质感。 |
| **角色模式 (Modes)** | 明确拆分 Architect, Code, Ask, Debug 等模式，职责边界极其清晰。 | 统一由 `composeAgentSystemPrompt` 生成，未根据具体任务细化角色行为。 | **启发：** 当目标从“生成设计”切换到“调试 Bug”时，应动态调整 System Prompt 权重。 |

## 2. 系统提示词存在的问题分析

经对比，当前项目的系统提示词存在以下主要问题：
1. **指令稀疏性：** `composeAgentSystemPrompt` 中的逻辑更像是一份“说明书”，而不是“操作规程”。Agent 知道有什么工具，但对“何时以何种顺序使用”缺乏强约束。
2. **状态隔离：** Agent 处于“盲目执行”状态。它感知不到外部终端的报错 or UI 线程的阻塞，除非它显式调用工具获取。
3. **反馈链路模糊：** 缺乏类似 `attempt_completion` 的标准化退出信号，导致 Agent 可能在任务完成后继续废话。

## 3. 改进方案建议

### A. 结构化指令升级
参考 Kilo Code 的 `==== SECTION ====` 风格，重构 `promptComposer.ts`。
> [!TIP]
> 使用清晰的标题和分割线（如 `==== SYSTEM INFORMATION ====`）帮助模型建立上下文边界。

### B. 引入“工程元数据” (Project Metadata)
在 `AgentRuntime` 调用时，动态注入：
- **Runtime Error Buffer:** 注入最近的控制台错误日志。
- **Working Context:** 注入当前用户正在编辑的文件名。

### C. 增强工具使用协议
在 Prompt 中增加以下硬约束：
- **One-at-a-time:** 除非极高置信度，否则一次只调用一个工具。
- **Verify before Commit:** 修改设计前必须先执行 `read/search` 类工具确认状态。

---
*注：本报告旨在从提示词工程 (Prompt Engineering) 角度提升 Agent 的稳定性和专业度。*
