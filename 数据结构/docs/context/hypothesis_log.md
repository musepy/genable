# 假设日志：UI Pro Max 复制研究 (Hypothesis Log)

## 🧪 活跃假设 (Active Hypotheses) - Library Reuse

| ID | 假设 (Hypothesis) | 置信度 | 目前证据 (Evidence so far) | 下一步验证 (Next Validation Step) |
| :--- | :--- | :--- | :--- | :--- |
| **H1 (知识)** | **推理与数据的分离是质量的关键。** | 100% ✅ | `reasoningEngine.ts` 验证。 | **(已完成)** |
| **H2 (检索)** | **确定性检索 (MiniSearch) > 生成式选择。** | 100% ✅ | `intentRecognizer.ts` 集成验证。 | **(已完成)** |
| **H3 (架构)** | **约束传播以意图为中心。** | 90% | `reasoningHints` 注入意图流。 | 验证下游 contextBuilder 消费。 |
| **H4 (复用)** | **构建时转译优于运行时适配。** | 100% ✅ | `generate-reasoning.js` 验证。 | **(已完成)** |
| **H5 (数据结构)** | **UI Pro Max 的 CSV 结构具有通用性。** | 90% | 12 个 CSV 分析完成，Tier 1-3 分层。 | 扩展适配器支持多文件。 |
| **H6 (Lib)** | **成熟的 NPM 库 (MiniSearch) 优于手动移植。** | 100% ✅ | 搜索功能正常工作。 | **(已完成)** |
| **H7 (扩展)** | **全量接入 ROI 正向。** | 75% | Tier 1 数据源价值高。 | 实施后测量 prompt token 减少。 |

## 🧊 已拒绝/改进的假设 (Rejected/Refined Hypotheses)

| ID | 假设 | 原因 |
| :--- | :--- | :--- |
| **H-DirectRun** | 直接在 Figma 插件中运行 `core.py`。 | **技术不可行**。Figma 插件仅支持 JavaScript/WebAssembly，不支持 Python 运行时。 |
| **H-ManualPort** | 手动将 `core.py` 逻辑移植到 TS。 | **非最佳实践**。存在现成的、经过实战检验的库 (`minisearch`)，造轮子违反 DRY 原则。 |

## 🧪 活跃假设 (Active Hypotheses) - Figma BigInt 运行时

| ID | 假设 (Hypothesis) | 置信度 | 目前证据 (Evidence so far) | 下一步验证 (Next Validation Step) |
| :--- | :--- | :--- | :--- | :--- |
| **BI-1 (环境)** | **Figma QuickJS 环境不支持 BigInt，直接调用触发运行时崩溃。** | 80% | 运行时标准明确禁止 BigInt，并强调会导致 “is not a function” 崩溃。 | 在 Desktop Figma 环境复现实例，记录错误堆栈与入口调用链。 |
| **BI-2 (构建路径)** | **绕过 build.js 的构建路径导致 BigInt guard 未注入，引发第三方库直接调用 BigInt。** | 65% | guard 仅在 build.js 注入，raw build 未覆盖。 | 对比 build.js 与 build:raw 输出头部，确认 guard 是否存在。 |
| **BI-3 (依赖触发)** | **第三方库内部 BigInt 检测触发调用（如 has-bigints），与 Figma 环境冲突。** | 50% | 依赖树包含 has-bigints/is-bigint，且运行时标准警告第三方库调用 BigInt。 | 追踪 bundle 中首次调用 BigInt 的位置（构建产物 grep + sourcemap）。 |
| **BI-4 (全局污染)** | **运行时或 polyfill 将 BigInt 绑定为非函数对象，导致 “BigInt is not a function”。** | 35% | BigInt 兼容性说明指出非可用环境中 BigInt 无法 polyfill。 | 在沙盒内打印 BigInt 类型与属性快照。 |
