# 架构与软件工程原则深度分析报告

## 1. 核心问题综述
项目目前处于从 “实验性脚本” 向 “工业级引擎” 转型的十字路口。虽然功能强大，但在软件工程规范上存在 “过度耦合” 和 “真理源碎片化” 的严重问题。

## 2. 软件工程原则评估

### A. SSOT (单一真理源) 的缺失与碎片化
- **现状**：关于一个组件（如 “Card”）的知识散落在四个维度：
  1. **描述性数据** (`generated/*.json`): 告诉 LLM 什么时候用卡片。
  2. **结构蓝图** ([anatomyRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/anatomyRegistry.ts)): 告诉 LLM 卡片长什么样（JSON 结构）。
  3. **预设逻辑** ([shadcn.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/libraries/shadcn.ts)): 告诉系统卡片的默认属性。
  4. **硬编码提示词** ([sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts)): 提示词模板中手动重写了组件属性。
- **技术债务**：这种 **“知识孤岛”** 结构违反了 SSOT。当属性名变更时，必须在 4 个不相关的模块中同步修改，否则会引发生成的 “幻觉” 或渲染失败。

### B. SRP (单一职责原则) 与上帝服务
- **现状**：[generator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts) 已经退化为一个 **“上帝服务 (God Service)”**。
- **职责堆积**：
  1. 封装 API 细节（Gemini SDK 调用）。
  2. 控制生成管道（超时、重试循环）。
  3. 执行 **数据转换**（调用 [TreeReconstructor](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/treeReconstructor.ts#21-123) 将 Adjacency List 转为 Tree）。
  4. 承载 **防御性逻辑**（[isStructuralViolation](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts#242-267)）。
- **后果**：该文件极难进行单元测试。API 层的变动（如更换模型）会迫使转换逻辑也要重新回归。

### C. SOLID 原则违反
- **开闭原则 (OCP)**：目前增加一种新的生成约束或校验规则，往往需要修改 [generator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts) 中的 `while` 循环逻辑。系统对扩展是不开放的。
- **接口隔离原则 (ISP)**：`NodeLayer` 接口承载了太多。它既是 LLM 的输出契约，也是重构器的输入，还是渲染器的输入。在不同阶段，它的 props 完整性要求完全不同，导致下游环节充满了防御性的 `if (!node.props)` 检查。

## 3. 技术债务与逻辑漏洞 (Code-Level Audit)

### 1. “失效”的自纠错循环 (The "Void" Validation Loop)
在 [generateLayoutWithValidation](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts#268-440) 中，存在一个关键的逻辑缺陷：
- **代码表现**：[isStructuralViolation](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts#242-267) 函数在第 254 行将约束放宽（标记为 `[Constraint Relaxed]`），允许空容器通过验证以避免死循环。
- **后果**：由于几乎所有结构错误都被“放行”，`hasBlockingErrors` 很难被触发。这意味着系统所谓的“语义纠错”只是形式，它不会因为节点缺失、空 Frame 等严重质量问题触发重新生成。

### 2. Token 爆炸与历史清理缺失
- **现象**：在 Retry 过程中，`history` 只是简单地追加原始 JSON。
- **风险**：如果发生 2 次重试，上下文将包含 3 份巨大的 JSON 字符串。
- **后果**：这会迅速填满 Token 窗口，导致后续尝试更容易发生 **强制截断 (Truncation)**，从而形成恶性循环。

### 3. 流式模式下的超时暗哨
- **现象**：非流式模式使用 `Promise.race` 实现了显式超时，但流式模式（`sendMessageStream`）没有显式的超时控制。
- **风险**：如果 API 建立连接后挂起，或传输极慢，系统将无限期等待，阻塞 UI 线程或造成死锁。

### 4. 脆弱的类型绑定 (Fragile Binding)
[sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) 使用字符串模板手写 DSL 规则，与代码中的 `figma-api.ts` 常量脱钩。

---

## 4. 架构演进假设与校准

### H1: 管道化解耦 (置信度: 95%)
- **方案**：将生成过程抽象为 `Fetch -> Parse -> Reconstruct -> Sanitize -> Validate`。
- **收益**：[generator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts) 只负责 Fetch。Parse 与 Reconstruct 独立，可单独进行大规模 Case 测试。

### H2: 语义驱动的“强”重试 (置信度: 80%)
- **方案**：将 `hasBlockingErrors` 扩展为包含指定级别的语义错误，并移除 [isStructuralViolation](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts#242-267) 的宽松补丁。

### H3: 历史压缩策略 (置信度: 85%)
- **方案**：在 Retry 历史中，将旧的 model 输出压缩为摘要（例如：“输出 45 个节点，由于空容器被拒绝”），而非保留原始万行 JSON。

## 5. 方法论自我批评
此前的修复只是在“打补丁”。如果不能从架构层面解耦职责，系统的稳定性将始终处于不可控状态。

## 6. 研究笔记与校准
根据对 Gemini API 的研究，虽然官方支持递归 Schema，但由于 UI 树深度不可控（导致超时或 API 拒绝），目前采用的 **“Adjacency List + 离线重构”** 是一项正确的工程决策，其主要债务在于 **“显式重构职责分配不均”**。
