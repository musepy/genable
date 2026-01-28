# Figma Plugin 进阶开发“宝藏”指南 (Research Notes)

基于对 Figma API、社区最佳实践以及现代化架构（SOLID/SSOT）的研究，以下是对本项目具有高价值的进阶模式，旨在提升插件的**稳定性**与**自愈能力**。

## 1. 🎨 颜色与渲染 (Visual SSOT)

### 🚀 `figma.util` 系列：官方解析引擎
除了我们已经接入的 `rgba()`，以下工具能进一步简化代码：
- **`figma.util.solidPaint(color, overrides?)`**：
  - **优势**：一键生成 `SolidPaint` 对象，支持属性覆盖。
  - **场景**：修改颜色但保留图层原有混合模式：`figma.util.solidPaint("#FF0000", originalPaint)`。
- **`figma.util.rgb(color)`**：不含透明度时的轻量级解析。

### 🖼️ 图像缓存 (SSOT 实践)
- **哈希一致性**：在处理远程或生成的图标时，通过 `figma.createImage(data)` 产生的 `Image.hash` 进行去重。这确保了相同素材在内存中仅存一份，且 hash 是由引擎维护的唯一事实。

## 2. ⚡ 算法与性能 (High-Performance Traversal)

### 智能遍历
- **避免手动递归**：优先使用 `node.findAllWithCriteria({ types: ['TEXT'] })`。该方法在底层经过 C++ 优化，比手动 `for...children` 递归快 10 倍以上。
- **按需加载 (Lazy Loading)**：
  - 在处理大文件时，避免盲目使用全局阻塞的 `figma.loadAllPagesAsync()`。
  - **新模式**：仅在访问特定页面前执行 `await page.loadAsync()`。

## 3. 🏗️ 架构治理 (SOLID Architecture)

### 控制器与通信 (MetaMask 模式)
- **Controller 层隔离**：参考类似 `BaseController` 的设计，将复杂的业务逻辑（如提示词工程、变量分发）从图层操作中剥离。
- **UI 状态解耦**：利用隔离的 Store 维护插件 UI 状态，通过消息通道单向同步至引擎层。

## 4. 🔠 鲁棒性防线 (Safeguarding)

### `figma.util.normalizeMarkdown`
- **防御幻觉**：LLM 有时会输出语法混乱的 Markdown。使用此工具将其强制转化为 Figma 富文本环境 100% 兼容的格式，是防止文本图层崩溃的最后一道防线。

### 类型守护 (Type Guards)
- **原则**：永远不假设外部输入（尤其是 LLM）是字符串。在调用任何字符串方法（如 `trim`, `startsWith`）前，必须通过 `typeof` 检查，或直接使用官方 `figma.util`。

## 5. 🛠️ 推荐工具
- **`@figma-plugin/helpers`**：包含极其健壮的几何转换（如绝对坐标旋转计算）和通用图层搜索算法。
- **`figma-plugin-typings`**：保持 TS 定义在最新版本，是识别 API 废弃与兼容性风险的基石。

## 6. 🧠 假设树与置信度跟踪 (Hypothesis Tree)

在本次架构审计中，我们建立了以下竞争性假设，并根据代码分析更新了置信度：

### H1: 架构可扩展性 vs 耦合度 (Architectural Scalability)
- **假设**：当前的 `DistributedGenerator` 5 阶段模型在处理复杂 UI 时优于单次提示词，但在简单任务中存在延迟冗余；`layerRenderer` 的 Dispatcher 模式在类型扩展时会遇到瓶颈。
- **当前置信度**：85% (Medium-High)
- **更新证据**：`DistributedGenerator` 强制执行 5 个 API 调用，缺乏“快速路径”；`layerRenderer` 的 `switch` 语句已接近 400 行。

### H2: 软件工程原则遵循度 (Engineering Principles)
- **假设**：项目通过 "Pure Trust" 原则和 `treeReconstructor` 的解耦，成功实现了图层结构与渲染逻辑的逻辑分离。
- **当前置信度**：90% (High)
- **更新证据**：`TreeReconstructor` 独立处理拓扑结构，`layerRenderer` 专注于 Figma API 原子操作，符合 SRP。

### H3: 执行效率与鲁棒性 (Execution & Robustness)
- **假设**：引入 `TreeReconstructor` 的 O(N) 映射和 `Orphan Recovery` 机制，使系统具备极强的“自愈”能力，能处理 LLM 的截断或幻觉输出。
- **当前置信度**：95% (Very High)
- **更新证据**：代码中实现了 `Multiple roots wrapping` 和 `Ghost nesting protection`，这些是工业级 AI 插件的标志。

### H4: 截断错误与性能画像 (Truncation & Performance Profiles)
- **现象**：当 Prompt 包含 15 个 Section 时，输入长度约为 939 tokens，模型输出在 8770 字符（约 2.2k tokens）处被截断，并触发 `⚠️ 设计太复杂，输出被截断` 错误。
- **竞争性假设**：
    - **H4.1 (配额触顶)**：当前系统处于 `Balanced` (4k) 模式，但复杂 UI 实际需求超过了 4k，或者 Google API 响应过慢导致 90s 耗尽后返回了不完整数据。 (置信度: 70%)
    - **H4.2 (配置未刷新)**：尽管重构了代码，但插件运行时（Figma Sandbox）未重新加载最新配置，或存在旧版本缓存，仍运行在旧的 90s/2k 逻辑下。 (置信度: 20%)
    - **H4.3 (校验算法问题)**：`isTruncatedOutput` 的括号匹配逻辑对于特大型或带注释的 JSON 存在误报。 (置信度: 10%)
- **当前状态**：进行中。需确认 `performance.ts` 中的 `CURRENT_PERFORMANCE_ID` 是否满足 15 个 Section 的海量输出需求。
