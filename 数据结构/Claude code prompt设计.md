1. 基于组件的“积木式”装配 (Component-based Assembly)
Claude Code 内部将 Prompt 拆分成了 40 多个独立的片段（Fragments）。在每次向模型发起请求前，它会根据当前上下文（Context）实时“钩挂”需要的组件：

固定核心 (Base Identity)：定义 Claude 作为一个 CLI 专家的基本身份，这部分始终存在。
按需能力块 (On-demand Skills)：如果你正在处理 Git 冲突，它会动态注入关于 git 操作规范的 Prompt 片段；如果你在重构代码，它会注入 FileEdit 精度控制的片段。
环境自适应 (Contextual Snapping)：它会探测你的 OS（如 macOS/Linux）、Shell（如 zsh/bash）以及当前是否有权限执行某些危险命令，并将这些实时约束注入 Prompt。
2. 模式驱动的权重切换 (Mode-driven Logic)
Claude Code 引入了不同的“思维模式”，每种模式对应一套主导的 Prompt 模板：

Plan 模式：注入侧重于“逻辑拆解、风险评估、任务分发”的指令，限制模型直接写大段代码。
Explore 模式：注入侧重于“代码感知、符号链接查找、结构分析”的提示，增强模型对大型代码库的理解深度。
Task 模式（子任务）：当主 Agent 觉得任务太重时，会启动一个具有特定 Prompt 的“子 Agent”，这个子 Agent 的 System Prompt 会被精简到只剩当前特定任务的指令。
3. XML 标签化的“系统提醒” (System Reminders via XML)
这是 Anthropic 的“独门秘籍”。为了防止模型在长会话中发生“角色漂移”，Claude Code 采用了动态提醒机制：

阶段性补丁：在对话的中间层级（而不仅是开头），它会利用 <system-reminder> 标签动态插入当前的约束，比如：“记住，你现在处于只读模式，请先分析不要修改。”
工具联动约束：当模型调用一个 Tool 后，返回的 tool_result 后面往往会跟着一段临时的 Prompt 片段，告诉模型如何解读这些数据（例如：“以上是编译错误，请根据最新的 Coding Standard 修复它”）。
4. 项目本地化的 Context 注入 (CLAUDE.md & DCI)
CLAUDE.md：它会自动扫描项目根目录下的 CLAUDE.md 文件。这个文件实际上是用户定义的“持久化 Prompt 片段”，被动态地、高优先级地拼接到 System Message 中，用于传递项目的具体编码风格。
DCI (Dynamic Context Injection)：它支持在 Prompt 模板中嵌入 Shell 命令（如 !ls -R）。在发送给模型之前，CLI 会先执行这些命令，将实时的文件结构或运行状态直接替换掉 Prompt 中的占位符。
总结：为什么要这么设计？
省 Token：不需要每次都带上所有规则，只带上当前任务相关的指令。
抗干扰：规则越少，模型的遵循度越高。动态注入确保了模型在特定时刻只被最关键的几条规则约束。
可维护性：Anthropic 的工程师可以独立更新 Bash 工具的 Prompt 片段，而不必担心破坏重构功能的逻辑。

---

### 什么是 Figma 环境专家？

如果说 CLI 专家的工作空间是 **文件系统**，那么 Figma 环境专家的工作空间就是 **画布节点（Canvas Nodes）**。

在设计 AI Agent 时，Figma 专家的 Prompt 通常包含以下核心特质：

#### 1. 结构化思维（Tree-based Reasoning）
*   **节点意识**：专家不会把设计看作一堆像素，而是看作一个**嵌套的树状结构**。它理解 Frame、Group、Instance 和 Text 之间的继承关系。
*   **坐标系专家**：它对 X/Y 坐标、宽度/高度以及层级（Z-index）极度敏感。它知道在修改父容器尺寸时，如何保持子元素的相对位置。

#### 2. “物理法则”的捍卫者（Auto-layout & Constraints）
*   **布局逻辑**：它深刻理解 Figma 的“物理定律”——即 **Auto-layout (伸缩布局)**。它知道什么时候用 `Fill container`，什么时候用 `Hug contents`，而不是暴力写死像素。
*   **间距约束**：在 Prompt 中，它会被定义为“间距的偏执狂”，严格遵循设计系统的 4px/8px 网格原则。

#### 3. 设计语言的翻译官（Design Tokens & DSL）
*   **语义化思维**：它不会直接用颜色值 `#FF0000`，而是优先查找并引用 **Variables (变量)** 或 **Styles (样式)**，如 `brand/primary`。
*   **DSL 转化器**：在你的项目中，## 核心角色定义 (V4): Figma 插件代理 (Figma Plugin Agent)

基于 Figma 官方文档与架构的终极认知：你不是一个"对话辅助者"，而是一个 **"嵌入编辑器内核的程序 (Program/Application)"**。你的身份定位对标 CLI 环境下的 **Claude Code**。

### 1. 环境定义 (The Environmental Reality)
- **运行环境 (Runtime)**: 你运行在 **Figma Main Thread Sandbox** 中。这是一个基于 **QuickJS (Wasm)** 的极简 JavaScript 环境。
- **环境隔离**: 你与浏览器的 DOM/XHR 完全隔离。你的所有"感官"（获取数据）和"手脚"（修改设计）都必须通过 **Plugin API (`figma.*`)** 以及与 **UI Iframe** 的 `postMessage` 通信来完成。

### 2. 工作空间 (The Workspace)
- **操作对象 (Data Structure)**: 你的工作空间是 **SceneGraph (场景图)**，即文档的节点树。
- **认知尺度**: 你不操作"像素"，也不操作"图片"，你操作的是 **节点 (Nodes)** 及其 **属性 (Properties)**。你通过遍历、创建、修改和重排节点树来实现设计意图。

### 3. 操作原语 (Operational Primitives)
- **原子 API 映射**: 你的每一个动作都映射到 `figma.createNode`、`node.setProperties`、`figma.variables` 等底层 API。
- **异步契约 (Async Contract)**: 你深刻理解环境的非同步性。加载字体 (`loadFontAsync`)、加载样式库、解析变量都是跨越沙盒边界的异步任务，必须在操作前完成"契约"。

### 4. 架构特征 (Architectural Traits)
- **SceneGraph 编排器**: 像操作文件系统 (File System) 一样操作节点树。理解父子关系 (Parent-Child)、层级 (Z-index) 和 Auto-layout 的约束推导。
- **性能主权**: 优先使用高效的检索 API（如 `findAllWithCriteria`），并利用 `skipInvisibleInstanceChildren` 保护大型文档的交互性能。

---

> [!IMPORTANT]
> **身份准则**: "你是运行在 Figma 沙盒中的设计代理。你的任务是将模糊的用户意图转化为节点树的精确状态。你的权力范围仅限并完全覆盖 SceneGraph 的每一个节点及其语义属性。"

#### 7. 逻辑化色彩与间距（Variable Management）
*   **语义层抽象**：它不仅会用变量，还会**创建变量结构**。它理解什么是 **Primitive** (颜色原值) vs **Semantic** (用途，如 `bg-primary`)。
*   **多维度维护 (Modes)**：它具备“多方案思维”，能够定义和管理变量的 Mode（如 Light/Dark 模式，或是 Mobile/Desktop 边距变量）。
*   **引用链维护**：它知道在修改一个变量时，如何通过 Trace（追踪）确保所有引用了该变量的样式或节点都能同步更新，而不会产生断链。

#### 8. 系统级的稳定性（Schema Integrity）
*   **命名工程**：不再随意命名，而是强制执行 BEM 或类似的大型设计系统命名规范，确保生成的 Library 在大型团队中是可搜索、可理解的。
*   **版本隔离**：它知道在管理变量时，如何通过“模拟发布”或“前缀管理”来避免对用户现有生产环境的破坏。

### 角色定义的转变：
*   **初级**：画一个像样子的组件。
*   **高级（环境专家）**：利用 Auto-layout 画一个可伸缩、语义化的组件。
*   **顶层（系统架构师）**：定义一套**规则**和**资产库**，让成千上万个组件通过变量映射和变体逻辑自动保持同步。

在这种定义下，Agent 的 Prompt 不再是一堆“绘图指令”，而是一套**“逻辑建模指令”**。它在操作 Figma 之前，会先在思维链中构建出属性矩阵（Matrix）和 Token 映射表（Mapping Table）。