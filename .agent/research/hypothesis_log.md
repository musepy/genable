# 假设日志：UI Pro Max 复制研究 (Hypothesis Log)

## 🧪 活跃假设 (Active Hypotheses) - Library Reuse

| ID | 假设 (Hypothesis) | 置信度 | 目前证据 (Evidence so far) | 下一步验证 (Next Validation Step) |
| :--- | :--- | :--- | :--- | :--- |
| **H1 (知识)** | **推理与数据的分离是质量的关键。** | 85% | [DesignSystemGenerator](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/design_system.py#37-237) 依赖分离。 | 验证推理适配器。 |
| **H2 (检索)** | **确定性检索 (BM25) > 生成式选择。** | 95% | [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py) 稳定性。 | 测试 Prompt 替换。 |
| **H3 (架构)** | **约束传播以意图为中心。** | 85% | 优先级过滤逻辑。 | 映射 `patterns.json`。 |
| **H4 (复用)** | **构建时转译优于运行时适配。** | 90% | 环境限制 (Python vs Plugin Sandbox)。 | 检查构建集成。 |
| **H5 (数据结构)** | **UI Pro Max 的 CSV 结构具有通用性。** | 80% | 通用 Schema 设计。 | 映射 TS 接口。 |
| **H6 (Lib)** | **成熟的 NPM 库 (MiniSearch) 优于手动移植。** | 95% | 搜索结果显示 `minisearch` 轻量、支持浏览器环境、功能丰富（模糊匹配、前缀）。直接使用它比移植 Python 代码更稳健。 | **(已验证)** 推荐采用。 |

## 🧊 已拒绝/改进的假设 (Rejected/Refined Hypotheses)

| ID | 假设 | 原因 |
| :--- | :--- | :--- |
| **H-DirectRun** | 直接在 Figma 插件中运行 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py)。 | **技术不可行**。Figma 插件仅支持 JavaScript/WebAssembly，不支持 Python 运行时。 |
| **H-ManualPort** | 手动将 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py) 逻辑移植到 TS。 | **非最佳实践**。存在现成的、经过实战检验的库 (`minisearch`)，造轮子违反 DRY 原则。 |
