# 分析报告：复用 UI Pro Max 配置架构的可行性评估

本文档评估了直接复用 UI Pro Max 的数据结构（[ui-reasoning.csv](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv)）和检索逻辑（[core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py)）的可行性。评估基于软件工程原则，特别是 DRY（Don't Repeat Yourself）、SSOT（Single Source of Truth）以及组件解耦原则。

## 1. 核心论点：为何应当复用

当前的配置系统面临硬编码值泛滥、维护困难的问题。相比之下，UI Pro Max 已经确立了一套成熟的“推理数据”结构。

从软件工程角度来看，复用现有的一套经过验证的数据模式（Schema）和内容（Content）是极其合理的。这不仅能减少重复劳动，还能直接继承该项目在设计推理上的知识积累。既然数据已经存在且结构合理，我们没有理由重新发明一套孤立的 JSON 配置文件。

## 2. 复用策略分析

我们面临的主要挑战是技术栈的差异：UI Pro Max 基于 Python 环境，而我们的 Figma 生成器运行在受限的 JavaScript 平面环境中。

### 策略 A：直接数据复用（推荐）

此策略主张将 UI Pro Max 的 CSV 文件视为“上游数据源”。我们不手动维护 [constraints.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/config/systems/shadcn/constraints.json)，而是编写一个构建脚本，将 CSV 数据自动转换为 TypeScript 友好的格式。

这种方法的优势在于它严格遵守了 SSOT 原则。设计推理逻辑只在一个地方维护（即 CSV 文件中），任何更新都会自动流向插件项目。它同时也解决了运行时性能问题，因为解析和索引的开销发生在构建阶段，而非用户设备上。数据结构的一致性得到了保证，因为我们的 TypeScript 接口将被强制对齐到 CSV 的 schema 上。

### 策略 B：逻辑逻辑移植（已废弃）

此策略涉及手动移植 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py)。**经评估，此方案已废弃。**

### 策略 C：采用成熟的搜索库 (MiniSearch) —— **(最终推荐)**

既然目标是引入“检索能力”，我们在 Exa/Context7 的调研中发现了 `minisearch` 等优秀的 JS 库。

- **优势**:
    - **轻量级**: 专为浏览器和 Node 设计，体积极小。
    - **功能强**: 支持模糊搜索、前缀匹配、权重配置（BM25 变体），比我们手动移植的 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py) 更强大。
    - **无需造轮子**: 符合“使用现有轮子”的原则。

## 3. 技术约束与解决方案

### 运行时环境限制
Figma 插件沙箱无法执行 Python 代码。因此，直接调用 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py) 是不可行的。我们必须在“构建时”和“运行时”之间画出清晰的界线。CSV 处理即为构建时任务。

### 类型安全
CSV 本质上是弱类型的。为了在 TypeScript 项目中安全使用，我们需要一个名为“适配器”的层。这个生成器脚本将负责验证 CSV 数据的完整性，并生成对应的 `.d.ts` 类型定义文件，确保我们在开发时就能捕获数据错误。

## 4. 结论与建议

我们应采纳 **"数据复用 + MiniSearch 引擎"** 的模式。

1.  **数据层**: 复用 UI Pro Max 的 CSV 文件。
2.  **构建层**: 编写脚本将 CSV 转为 JSON。
3.  **运行层**: 引入 `minisearch` 库，在插件启动时加载 JSON 数据建立索引。
4.  **接口层**: [DesignSystemLoader](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/designSystemLoader.ts#248-413) 通过 `minisearch` 查询所有意图。

这既利用了现有的高质量数据，又利用了成熟的 JS 生态，规避了手动移植逻辑的风险。
