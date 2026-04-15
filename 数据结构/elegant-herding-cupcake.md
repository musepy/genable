# Figma Plugin API Agent 身份定位分析

## Context

你想回答一个核心问题：**如果 Claude Code 自称"CLI 工具/专家"，那么基于 Figma Plugin API 的 AI Agent 应该怎么自称？**

这不是一个实现任务，而是一个**概念定位**的讨论，基于 Figma 官方文档的权威定义。

---

## 来自 Figma 官方的权威定义

### Figma 官方怎么定义 Plugin？

> **"Plugins are programs or applications that extend the functionality of Figma's editors."**
> — https://developers.figma.com/docs/plugins/

关键词：**programs / applications**，不是 tool，不是 assistant。

### 核心架构特征（官方文档）

| 特征 | 描述 |
|------|------|
| **运行位置** | 主线程沙盒（Main Thread Sandbox），基于 QuickJS |
| **环境限制** | 最小化 JS 环境，无浏览器 API（无 DOM、无 XHR） |
| **双线程** | Main Thread（操作 SceneGraph）↔ iframe（浏览器 API），通过 postMessage 通信 |
| **核心入口** | `figma` 全局对象（创建/读写/查询节点、管理样式、变量、库） |
| **操作对象** | Scene（场景图层层级）= 节点树 |
| **读写能力** | 完全读写：view, create, modify file contents |

### 与 Claude Code 的结构类比

| 维度 | Claude Code | Figma Plugin Agent |
|------|------------|-------------------|
| **官方定义** | CLI tool | Program/Application extending Figma editors |
| **运行环境** | Terminal / Shell | Figma 沙盒（QuickJS Sandbox） |
| **操作空间** | 文件系统（File System） | 场景图（SceneGraph / Document） |
| **操作原语** | bash 命令、文件 I/O | `figma.*` API（createNode, setProperty, etc.） |
| **全局入口** | Shell 环境变量 + PATH | `figma` 全局对象 |
| **隔离模型** | OS 进程隔离 | Main Thread ↔ iframe 双线程隔离 |
| **产物** | 代码文件 | 设计节点 / 组件 / 变量 |
| **约束** | OS 权限、sandbox | 沙盒限制（无 DOM、无 eval、字体需异步加载） |

---

## 定位建议

### 核心结论

Claude Code 说自己是 **"CLI 工具"**，因为它在 **命令行环境** 中通过 **Shell 命令** 操作 **文件系统**。

同理，你们的 Agent 应该说自己是 **"Figma 插件代理"** 或 **"Figma Plugin Agent"**，因为它在 **Figma 沙盒环境** 中通过 **Plugin API** 操作 **场景图（SceneGraph）**。

### 分层表达

| 层级 | 表达 | 使用场景 |
|------|------|---------|
| **对外/用户** | "AI 设计代理" / "AI Design Agent" | 产品描述、用户界面 |
| **技术定位** | "Figma Plugin Agent" / "Figma 插件代理" | 技术文档、对标讨论 |
| **System Prompt** | "You are a Figma plugin agent operating within the Figma sandbox environment" | LLM 身份注入 |
| **内核隐喻** | "SceneGraph 编排器" / "节点树编排器" | 架构讨论 |

### 为什么不该叫"工具"？

- Claude Code 叫 "tool" 是因为它本身就是用户直接交互的终端工具
- 你们的 Agent 是**嵌入在 Figma 插件内部的 AI 运行时**，用户通过插件 UI 交互，Agent 在背后操作 SceneGraph
- 更准确的说法是 **"Agent"**（代理）——它代替用户执行设计操作

### 推荐的 System Prompt 身份定义

```
You are a Figma plugin agent. You operate within the Figma sandbox environment,
manipulating the SceneGraph through the Plugin API (`figma.*` global object).

Your workspace is the document's node tree — not pixels, not files.
You create, modify, and orchestrate design nodes by calling tools that map to
Figma Plugin API operations.
```

对比 Claude Code 的：
```
You are an interactive agent that helps users with software engineering tasks.
(在 CLI 环境中通过 bash 命令和文件操作完成任务)
```

---

## 一句话总结

**Claude Code = CLI 环境中的代码代理；你们 = Figma 沙盒环境中的设计代理。**

核心身份不是由"做什么"定义的，而是由**"在哪个环境中、通过什么接口、操作什么数据结构"**定义的。
