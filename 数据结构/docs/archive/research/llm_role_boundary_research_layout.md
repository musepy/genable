# LLM 布局角色边界研究报告

## 核心结论：语义驱动的混合治理架构 (Semantic-Driven Hybrid Governance)

布局关系的处理并非单一实体的责任，而是一个 **“LLM 提案 -> 代码审查与修复 -> 物理规律校验”** 的多级流水线。

---

## 1. 角色分工 (Role Distribution)

| 处理阶段 | 责任主体 | 核心职责 | 处理逻辑 |
| :--- | :--- | :--- | :--- |
| **架构设计 (Proposal)** | **LLM** | **层级与语义定义** | 基于 Prompt 中的 `STRUCTURAL_ANATOMY` 和 `Do/Don't` 规则，生成节点树和 `semantic` 标签。 |
| **协议约束 (Enforcement)** | **PostProcessor (Sanitize)** | **语义强制修正** | **无条件信任标签**。若 `semantic: BUTTON`，则代码强制覆盖 `layoutMode: HORIZONTAL` 和居中对齐，修正 LLM 的属性幻觉。 |
| **规律优化 (Optimization)** | **PostProcessor (Layout)** | **上下文关联修正** | 识别特定命名模式（如 `col-6` 或 `equal`）并自动应用 `FILL` 宽度或 `HUG` 容器。 |
| **物理安全 (Safety)** | **PostProcessor (Physics)** | **几何有效性保障** | 防止元素塌陷（<8px）、处理父子约束隔离、检测溢出。 |
| **逻辑验证 (Prosecution)** | **ConstraintValidator** | **数学正确性校验** | 检测“HUG 父节点 + FILL 子节点”等死循环逻辑，生成语义化反馈引导 LLM 自我修正。 |

---

## 2. 深度观察：布局中的“暗物质” (Dark Matter)

研究发现代码中存在大量**隐式契约**：
- **名称驱动的布局 (Name-Driven)**: `layout.ts` 通过正则表达式匹配 `container`, `column`, `equal` 等关键词来强制修改布局属性。这意味着 LLM 必须遵循特定的命名规范，布局才能“自动”变好。
- **语义降级处理**: 当 `semantic` 缺失时，后处理器会根据组件名称猜测语义（如 `isLikelyButton`）并补充警告或修正，形成了一层“软防御”。

---

## 3. 竞争性假设验证

### H1: LLM 核心论 (LLM-Centric) - [已推翻]
- **假设**: 既然移除了 JSON Schema，LLM 应该能自主处理所有布局细节（Gap, Padding, Align）。
- **反证**: `PostProcessor/rules/sanitize.ts` 对 `BUTTON`, `CARD`, `SWITCH` 等核心语义进行了 100% 的硬编码布局覆盖，说明 LLM 的精确数值预测在高保真设计中并不可靠。

### H2: 代码工具论 (Tool-Centric) - [部分成立]
- **假设**: LLM 只生成文本，代码通过类似 `flexbox-engine` 的工具处理所有布局。
- **现状**: 尚未实现全自动盒模型计算，代码仍然依赖 LLM 提供的初步 `layoutMode` 和 `parent` 关系。

### H3: 语义委托模型 (Semantic Delegation) - [胜出] ✅
- **结论**: LLM 的价值在于**理解意图并划分层级**。布局关系由 LLM 通过 `semantic` 标签 **“委托”** 给代码处理。代码作为“样板引擎”，根据标签填充标准的布局参数。

---

## 4. 优化建议：完美边界设计

1.  **强化语义契约**: 在 Prompt 中明确告知 LLM：“你只需关注 `semantic` 和层级，具体的 `layoutMode` 和 `alignItems` 将由后处理器注入，除非你有特殊设计需求”。
2.  **显式化命名空间**: 将 `layout.ts` 中的正则匹配规则（如 `col-*`）显式定义在 `constraints.json` 中，让 LLM 主动利用这些“快捷方式”。
3.  **闭环反馈**: 利用 `ConstraintValidator` 产生的结果，在 `DISABLE_SELF_CORRECTION` 关闭时，作为精准的 Retry Prompt。

---

## 置信度评估 (Confidence Levels)

- **H-Boundary**: 布局主要由语义标签驱动 code-fix. (置信度: 95%) 
- **### H-DS: Schema Over-constraint Hypothesis ✅ (Confidence: 95%) 
- **Finding**: Experiments in session `b35e03cd` confirmed that removing `responseJsonSchema` and `required` constraints improved output quality by 12.5% and solved the 400 API error (Schema/Tool conflict).
- **Strategy**: Pivot from "Strict Schema" to "Post-Processing + Do/Don't Rules".
- **Action**: Modified `generator.ts` and `featureFlags.ts` to disable Tool Calling and Strict Schema.
 (置信度: 95%) ✅ 确证
- **H-Physics**: 物理引擎层是保持渲染稳定的最后一道防线. (置信度: 90%)
- **H-RO**: 禁用 Schema 后 LLM 原始输出质量极高，结构完整. (置信度: 99%) ✅ 确证 (通过 GDTZ0SA 等日志)
- **H-PP (Padding Property Native)**: LLM 倾向于输出 shorthand `padding`，偶尔使用侧边属性. (置信度: 98%) ✅ 确证
- **H-CSS (Alignment Aliases)**: LLM 会混合使用 Figma 标准枚举与潜在的连字符变体 (如 `SPACE_BETWEEN`) . (置信度: 95%) ✅ 确证
- **H-FS (Font Style Precision)**: LLM 在处理复合权重（如 `Semi Bold`）时表现出不稳定性，空格的有无直接影响渲染. (置信度: 95%) ✅ 确证
