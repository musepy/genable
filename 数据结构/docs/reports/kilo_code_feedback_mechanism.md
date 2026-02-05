# Kilo Code 反馈机制与 LLM In-Context Learning 研究报告

**日期**: 2026-01-29  
**分析对象**: Kilo Code 系统架构与提示词工程  
**目的**: 解析其如何构建反馈闭环以增强 LLM 的上下文学习能力

---

## 1. 核心发现 (Executive Summary)

Kilo Code 的强大之处在于它不仅仅把 LLM 当作一个“文本生成器”，而是将其置于一个**全链路感知的反馈闭环**中。它通过**环境注入**提供输入反馈，通过**测试驱动**提供结果反馈，并通过**结构化思维协议**强迫 LLM 在上下文中进行自我修正。

## 2. 反馈机制详解 (Feedback Mechanisms)

### 2.1 全息环境感知 (Holographic Environment Injection)
Kilo Code 极大地丰富了 LLM 的“视觉”，使其不再盲目猜测。
*   **实时终端流 (Runtime Error Buffer)**: LLM 不仅看到代码，还能直接看到终端的报错日志 (`stderr`)。这让 LLM 能够直接根据报错堆栈进行调试，而不是等待用户粘贴错误信息。
*   **编辑器物理状态**: 注入光标位置、当前活跃文档、选中的代码行。这提供了隐式的上下文线索（例如：用户光标在某函数内，LLM 会优先关注该函数）。
*   **系统元数据**: OS 版本、Shell 类型、CPU 负载等，确保生成的命令（如 `sed` vs `gsed`）适配当前环境。

### 2.2 测试驱动调试 (TDD as the Ultimate Feedback)
在 Debug 模式下，Kilo Code 强制执行标准的 TDD 循环，将其作为最强的反馈信号：
1.  **能够复现 Bug 的测试** -> `Fail` (明确的反馈：问题存在且被捕获)
2.  **修复代码** -> `Pass` (明确的反馈：问题已解决且无回归)
*这种二进制的 Pass/Fail 信号是 LLM 进行强化学习和自我确认的最可靠依据。*

### 2.3 语义化索引 (Semantic Indexing)
强制 LLM 输出 `[filename:line_number](path)` 格式的引用。
*   **作用**: 这不仅是给用户看的，更是给 LLM 自己建立“锚点”。当 LLM 必须精准指出它的修改位置时，幻觉会显著减少。

## 3. In-Context Learning 策略

### 3.1 动态模式切换 (Dynamic Mode Switching)
Kilo Code 不试图用一个通用的 Prompt 解决所有问题，而是根据任务阶段切换“人格”：
*   **Architect**: 纯规划，只读。In-Context 重点是“信息搜集与架构图”。
*   **Code**: 纯实现。In-Context 重点是“代码风格一致性”。
*   **Debug**: 纯诊断。In-Context 重点是“假设-验证”循环。
*切换模式本质上是切换了 LLM 的关注力（Attention Mask），使其在有限的 Context Window 中聚焦于当前最重要的信息。*

### 3.2 结构化思维协议 (Structured Thinking Protocol)
不仅仅是 "Think step by step"，而是具体的算法：
*   **Reflect & Distill**:
    1.  **发散**: 列出 5-7 个潜在原因。
    2.  **收敛**: 蒸馏出 1-2 个最可能的根因。
    3.  **验证**: 在修改前先打日志确认。

### 3.3 原子化工具链 (Atomic Tool Usage)
*   **One-at-a-time**: 限制一次只调用一个工具。
*   **Verify before Commit**: 修改完代码后，必须调用读取工具（或运行测试）来确认修改已生效。这是在单次对话轮次内实现 In-Context Learning 的关键——**“做 -> 看 -> 改”**。

## 4. 对 Figma Agent 项目的启示

结合我们现有的 [`figma-feedback-in-context-learning-analysis.md`](./figma-feedback-in-context-learning-analysis.md)，我们可以直接借鉴以下 Kilo Code 的实践：

| Kilo Code 实践 | Figma Agent 落地建议 |
| :--- | :--- |
| **Runtime Error Injection** | **Enhanced Tool Feedback**: 在 `createNode` 返回中直接注入 `NodeSerializer` 的结果 (Actual State)，让 Agent 看到它创建的真实节点属性，而不是仅看到 "Success"。 |
| **TDD / Test Feedback** | **Visual Verification**: 提供截图工具或渲染检查工具，让 Agent 能够“看到”布局是否崩坏（Container 尺寸 vs Content 尺寸）。 |
| **Reflect & Distill** | **Prompt Engineering**: 在 System Prompt 中引入 `==== THOUGHT PROCESS ====` 章节，强制 Agent 在调用 Figma 工具前先输出设计意图。 |
| **Mode Switching** | **Task-Based Prompts**: 区分“UI 生成模式”（注重美学、Token 规范）和“逻辑修复模式”（注重 API 正确性、父子关系）。 |

## 5. 结论

Kilo Code 的核心哲学是 **"Context looks different when you are doing different things"**。通过极高密度的环境信息注入和严格的思维协议，它成功地在无微调的情况下实现了强大的 In-Context Learning 能力。我们的 Figma Agent 应优先实现 **Tool Result 的状态回显**，这是实现类似能力的最低成本路径。
