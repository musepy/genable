# Kilo Code 设计模式深度调研报告

## 1. 核心架构与 UI/业务绑定
Kilo Code 采用了典型的 **Webview + Extension Host** 架构，实现了前端 UI 与后端业务逻辑的精准绑定。

*   **前端 (Webview UI)**: 负责对话界面、状态显示和用户交互。它通过 VS Code 的 `postMessage` 接口与后端通信。
*   **后端 (Extension Host)**: 运行 Agent 核心逻辑、工具执行引擎（Tools Service）和代码索引服务。
*   **绑定机制**: 采用 **JSON-RPC** 风格的长连接通信。这种双向、持久化的连接确保了 UI 可以实时反映 Agent 的“思维过程”（Thinking）和“执行步骤”（Execution）。

## 2. 对话式窗口设计 (Conversational Window)
Kilo Code 的对话窗口不仅是聊天，还是一个 **任务编排器**。

*   **Session 管理**: 每个对话都是一个 Session，保存了仓库上下文、完整对话历史和任务元数据。
*   **子任务 (Subtasks)**: 支持将复杂任务拆分为子任务，子任务拥有独立的对话历史，完成后将结果汇总回主任务。
*   **思维展示**: Agent 的思考过程（Plan/Thinking）与执行步骤（Tool Use）在 UI 中交织展示，用户可以清晰看到 Agent “为什么这么做”。

## 3. 工具系统与 MCP (Tools)
Kilo Code 的工具设计极具扩展性，核心依赖 **Model Context Protocol (MCP)**。

*   **行动类工具 (`use_mcp_tool`)**: 执行具体操作，如运行 Shell 命令、读写文件、操作浏览器。
*   **资源类工具 (`access_mcp_resource`)**: 仅用于获取上下文信息，如读取文档、API 返回值等。
*   **动态发现**: 工具在运行时动态加载，Agent 通过 MCP 发现可用能力。

## 4. API 设计
Kilo Code 提供了高度抽象的 API 接入层：

*   **多模型支持**: 通过统一的 Provider 接口支持 30+ 模型（Claude, GPT, Gemini, DeepSeek 等）。
*   **状态化连接**: 与传统的 RESTFUL API 不同，Kilo 的内部服务通信是**有状态的**，能够更好地追踪 Agent 的多轮迭代过程。

## 5. 检查点机制 (Checkpoints)
这是 Kilo Code 确保“精准操作”的关键。

*   **Shadow Git**: Kilo 会在后台创建一个独立的影子 Git 仓库，自动为 Agent 的每一次修改创建“检查点”。
*   **非破坏性探索**: 用户可以随时对比（Diff）代码变化，或是一键撤销到任何一个历史状态。
*   **安全性**: 即使 Agent 做出了错误的决策，由于有检查点保护，用户的原始代码始终安全可控。

## 6. 工具可见性与透明度 (Transparency)
为了解决“黑盒”问题，Kilo Code 实现了极高的透明度：

*   **实时观察**: 在对话窗口中直接输出 Shell 命令、文件修改路径及具体 Diff。
*   **执行流追踪**: 每一步工具调用都有状态标记（Pending, Success, Error）。
*   **审计日志**: 所有的 Agent 行为都有迹可循，用户可以明确看到 Agent 正在访问哪些文件、运行哪些测试。

---
> [!TIP]
> **本地发现**: 当前项目中存在 `.kilocode/mcp.json` 文件（目前为空），这表明该项目已预留了 Kilo Code 的 MCP 扩展接口。
