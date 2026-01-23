# UI Pro Max 研究笔记 (Research Notes)

## 1. 知识编码与数据建模分析 ([ui-reasoning.csv](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv))

### 观察 (Observations)
- **双层架构 (Two-Layer Architecture):**
    - **第一层：推理 (策略层):** [ui-reasoning.csv](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv) 充当“元配置”或“策略选择器”。它不直接包含原始样式值（如十六进制代码、字体），而是包含如何选择这些值的**规则**。
    - **第二层：原始数据 (资产层):** 其他 CSV 文件（如 `styles.csv`, `colors.csv`，在 [core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py) 中引用）包含实际的设计令牌和资产。
- **推理表关键列:**
    - `UI_Category`: 触发器（用户意图）。
    - `Recommended_Pattern`: 高层布局策略。
    - `Style_Priority`: 用于增强/过滤原始数据检索的关键词。
    - `Decision_Rules`: 特定逻辑约束的 JSON 数据（例如 `if_ux_focused`, `must_have`）。
    - `Anti_Patterns`: 显式的“负向约束”，用于防止常见的不良设计习惯。

### 洞察 (Insight)
核心优势在于 `Style_Priority`（样式优先级）列。它将高层意图（如“SaaS”）转化为低层搜索关键词（如“极简主义”、“扁平化设计”），从而引导检索引擎。**这是一个语义翻译层。**

## 2. 检索机制分析 ([core.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py))

### 观察 (Observations)
- **确定性 (Determinism):** 使用 BM25（经典信息检索）而非向量搜索或 LLM 生成。在这个关键词定义明确的领域，这通常**更快且更不可预测**。
- **领域检测 (Domain Detection):** [detect_domain](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/core.py#194-215) 基于关键词密度创建了一个简单的路由逻辑。
- **结构化搜索:** 它类似于 "RAG" (检索增强生成) 系统，但更准确地说是 **"RAC" (检索增强配置)**。它检索的是结构化的配置片段，而不是文本块。

### 洞察 (Insight)
UI Pro Max 通过严格从“黄金集合”（CSVs）中检索，避免了样式的“幻觉”。LLM 的角色（推测在管道后期）仅仅是组装这些有效的片段，而不是凭空创造它们。

## 3. 决策逻辑分析 ([design_system.py](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/design_system.py))

### 观察 (Observations)
- **编排流程 (Orchestration Flow):**
    1.  **识别类别:** 从 `product` 搜索或查询中识别。
    2.  **加载策略:** 在 [ui-reasoning.csv](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv) 中找到匹配行。
    3.  **传播约束:** 使用策略中的 `style_priority` 对颜色、排版等的搜索进行加权。
    4.  **合成:** 将“策略”（推理）与“战术”（检索到的资产）结合。
- **Master + Override 模式:** [persist_design_system](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/ui-ux-pro-max-skill/skills/ui-ux-pro-max/scripts/design_system.py#490-539) 函数实现了“主文件”（全局默认值）和“页面覆盖”模式。这反映了 CSS/设计系统的“层叠”特性。

## 4. 与当前项目的对比

| 特性 | 当前项目 (`figma-ai-generator`) | UI Pro Max |
| :--- | :--- | :--- |
| **配置源** | 静态 JSON (`constraints.json`)，通过 ID 加载。 | 基于查询/意图的动态 CSV 搜索。 |
| **逻辑** | 隐式或硬编码在引擎中（主要部分）。 | 显式编码在 `Decision_Rules` JSON 中。 |
| **样式选择**| 通常是 Prompt 的一部分或是固定的。 | 从独立的“样式”数据库中检索。 |
| **验证** | 后处理检查 (`sanitizeLayer`)。 | 预选（仅检索有效样式）。 |

## 5. 复制策略 (草案)

要复制 "UI Pro Max" 的优势，我们不应仅仅复制代码，而应**采纳其架构**：
1.  **提取“推理”**: 创建 `intent_strategies.json`（或保留 CSV），将用户意图映射到约束。
2.  **检索优先**: 不要让 Gemini 产生颜色幻觉，而是根据意图从批准的 `palettes.json` 中检索调色板。
3.  **语义翻译**: 实现如下逻辑：`System ID`（例如 "shadcn"）不仅仅是一个静态文件，还可以通过意图进行“调优”（例如 "shadcn + 暗黑模式 + saas" -> 特定的覆盖配置）。
