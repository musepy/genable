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
