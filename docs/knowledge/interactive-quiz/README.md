---
description: 知识评测系统设计理念、量化指标与 Agent 工作流说明规范 (Interactive Assessment V2)
---

# Knowledge Assessment System & Agent Workflow (知识评测与 LLM 命题规约)

本组件是一个与 Figma 插件主程序解耦的**本地交互式知识评测终端**。它被设计用以量化你对应用架构和设计模式的理解，并通过 Node.js 本地服务将数据直接静默同步给作为智能助教的 LLM (Agent)，完成**数据驱动闭环教学**。

## 1. 架构与自动化链路 (Zero-Touch Metric Capture)

前端 SPA 已经与本地的 `server.js` 打通：
*   **读取指标**：用户一旦在网页端点击“确认提交”完毕所有题目，成绩（包含各维度的 DSR 正确率）就会被 POST 到后台，持久化覆盖 `metrics_latest.json`。**作为 LLM 助手，你可以随时调用工具抓取此文件。**
*   **IDE-Agnostic 源头溯源**：知识解析 (Explanation) 中的专属超链接 `[链接名](file:///绝对路径)` 被前端拦截，并自动下发至后端调用系统 `open` 命令打开。此举完全绕开了跨域和浏览器 Sandbox 限制，不仅顺畅，且**不锁定具体 IDE（任意系统默认文档编辑器均可响应）。**

## 2. LLM 核心命题约束协议 (Adversarial QA Protocol)

未来的每一次题库扩充，**LLM (你自身) 必须绝对服从以下「对抗性生成协议」**，任何违反此协议而生成的凑数题目都将被视为未达标：

### 规则一：事实验证 (Fact-Checking Grounding)
所有题目必须有其产生的**原初依据**。在生成的每道题 `explanation` 中，必须硬编码相关 Markdown 笔记文件的绝对本地路径作为线索入口，确保用户能瞬间溯源。严禁凭空捏造与本地项目上下文无关的空泛知识。

### 规则二：对抗性干扰层 (Adversarial Distractors)
错误选项 (Distractors) 不能是显而易见的废话（比如：“因为 LLM 会死机”）。错误选项必须基于**开发时的真实疑虑或常见误区**：
*   *错误示范*：“为什么不用白名单？因为白名单名字不好听。”
*   *正确示范*：“为什么不用白名单？因为 TypeScript 编译器去掉了 const 标志变成 var。” (基于一种真实但在此情景下错误的片面认知引发困惑)。
**LLM在出题前，必须进行对抗自审：如果这道题用户仅凭语感和排除法就能答对，必须推翻重拟。**

### 规则三：渐进式设计与跨界综合 (Progressive & Cross-Domain)
系统支持数组形态的 `domain` 分类和 `difficulty` 星级机制。
*   **Level 1 (基础事实)**：单领域考记忆点（如 JS 的按值传递 / Figma 黑白名单）。
*   **Level 2 (机制分析)**：串联机制原理（如 文本解析 vs 模板管线、AST转化）。
*   **Level 3 (高维架构整合)**：必须横跨至少 2 个 Domain 领域，深度融合上层应用体验与底层性能约束。例如：探讨 Vercel AI SDK 的 `mutates` 快照策略如何解决沙箱管道堵塞死锁（涵盖 `ARCHITECTURE` 与 `PIPELINE`）。

## 3. 设计哲学重申 (Anti-AI Aesthetics)

*   **克制至上**：拒绝“因为是 AI 产品所以就加发光/蓝紫色”的惯性审美。容器和交互通过细微的内边距、响应式的 Tailwind Zinc 灰色系完成层级堆叠。
*   **认知解脱**：作答阶段全程无干扰警告。红绿色状态评价仅在确核步骤出现。进度由顶部极简 ProgressBar 精确映射。

## 4. 启动方式 (Launch Command)

如果你需要预览，或者向本地服务同步验证指标，只需在本项目目录下通过后备命令拉起 Node 环境：

```bash
cd "/Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator-dogfood/docs/knowledge/interactive-quiz"
node server.js
```
服务将被挂载在 `http://127.0.0.1:8080/`。
