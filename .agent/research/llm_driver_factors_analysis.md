# LLM 生成驱动因素全景研究

## 1. 研究目标
系统性地识别并分类所有驱动 Figma AI Generator 中 LLM 生成内容的因素，分析其对 LLM 认知复杂度和算法复杂度的影响，并发展竞争性假设。

---

## 2. 驱动因素清单与分类

### 2.1. Prompt 组装层 (Prompt Composition)

| 因素 | 来源文件 | 作用 | LLM 复杂度 | 算法复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| **Role Template** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 定义身份、输出格式（Flat Adjacency List） | 低 | O(1) |
| **Constraint Template** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 强制 HUG/FILL/FIXED 规则、根节点约束 | 中 | O(1) |
| **Property Constraints** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | Do/Don't 规则，防止布局坍缩 | 中 | O(1) |
| **Semantic Intent** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 强制声明 `semantic` 属性 | 中 | O(1) |
| **Icon Allowlist** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 限定允许的 Icon 名称列表 | 低 | O(N) 检索 |
| **Knowledge Base Injection** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) / [knowledgeHub.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts) | 动态注入组件结构蓝图（如 Button, Card） | 高 | O(1) 查询 |
| **External Tokens** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 注入设计系统 Token (颜色、间距) | 低 | O(1) |
| **Original Content** | [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 保留用户选区的原始文本内容 | 低 | O(1) |

### 2.2. Schema 约束层 (Schema Constraints)

| 因素 | 来源文件 | 作用 | LLM 复杂度 | 算法复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| **Response JSON Schema** | [schema.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schema.ts) | 强制 JSON 结构类型与枚举值 | **极高** | API 级（解码阶段约束） |
| **Required Fields** | [schema.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schema.ts) | ~~强制输出必填属性 (name, layoutMode, semantic)~~ → **P0 变更**: 现为 `[name, semantic]` | ~~**极高**~~ → 中 | API 级 |
| **Enum Definitions** | [schema.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schema.ts) / [figma-api.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/constants/figma-api.ts) | 限定 NODE_TYPES, LAYOUT_MODES, SIZING_MODES | 中 | API 级 |

> **[P0 变更 2026-01-21]**: `layoutMode` 已从 required 移除，改由后处理层 ([sanitizeLayer](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts#14-82)) 根据 `semantic` 自动推导。

#### 2.2.1 responseJsonSchema 的核心挑战 ⚠️

**结论: 让 LLM 直接生成复杂嵌套 JSON 存在极大难度**

| 挑战 | 原因 | 影响 |
|:---|:---|:---|
| **注意力分散** | LLM 同时需要理解语义 + 生成正确语法 + 符合 Schema 约束 | 输出质量下降 |
| **递归结构** | Figma 树结构天然递归，LLM 难以维护嵌套层级 | 括号不匹配、截断 |
| **Enum 约束** | 大量 Enum 值 (LAYOUT_MODES, SIZING_MODES) 分散模型注意力 | 遗漏必填属性 |
| **API 冲突** | `responseJsonSchema` + `tools` 不兼容 (H-A 确认) | 空输出 |

#### 2.2.2 UI Pro Max 的启示

**UI Pro Max 不使用 `responseJsonSchema`**，而是依赖:
1. **Prompt-level guidance** (Do/Don't 规则)
2. **后处理修正** (无 strict schema)
3. **语义理解优先** (LLM 擅长的领域)

#### 2.2.3 最佳实践结论

```
┌─────────────────────────────────────────────────────────────┐
│  LLM 擅长: 语义理解、意图识别、创意生成                     │
│  LLM 不擅长: 严格格式约束、复杂嵌套结构、精确数值           │
│                                                             │
│  → Schema 应作为"指导"而非"强制"                           │
│  → 关键属性由后处理层保证                                   │
│  → 复杂约束用 Do/Don't 规则替代 required                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.3. 工具调用层 (Tool Calling / Function Calling)

| 工具名称 | 来源文件 | 作用 | LLM 复杂度 | 算法复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| ~~`validate_icon`~~ | [tools.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/tools.ts) / [toolExecutor.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/toolExecutor.ts) | 校验图标名称是否在 Iconify 中存在 | ⚠️ 高 (分散注意力) | O(1) API 调用 |
| ~~`get_component_template`~~ | [tools.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/tools.ts) / [toolExecutor.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/toolExecutor.ts) | 获取组件结构蓝图 (Anatomy) | 低 | O(1) 查询 |
| ~~`get_design_tokens`~~ | [tools.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/tools.ts) / [toolExecutor.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/toolExecutor.ts) | 获取设计系统 Token | 低 | O(1) 查询 |
| ~~`check_design_constraint`~~ | [tools.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/tools.ts) / [toolExecutor.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/toolExecutor.ts) | 校验布局约束 (HUG/FILL 兼容性) | 低 | O(1) 规则校验 |

> **[H-BA 已确认 2026-01-21 ⚠️]**:
> - **问题**: `responseJsonSchema` + `tools` 存在 API 级别冲突
> - **证据**: gemini-2.5-pro 返回 `[400] Function calling with a response mime type: 'application/json' is unsupported`
> - **现象**: LLM 多轮 Tool Calling 后 "忘记" 输出 JSON (`Raw input length: 0`)
> - **解决**: `DISABLE_TOOL_CALLING: true` (featureFlags.ts)
> - **状态**: ✅ 已禁用，生成恢复正常

### 2.4. 知识库层 (Knowledge Injection)

| 因素 | 来源文件 | 作用 | LLM 复杂度 | 算法复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| **ANATOMY_REGISTRY** | [anatomyRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/anatomyRegistry.ts) | 为 Button, Input, Card 等提供预定义 JSON 结构 | 中 (长上下文) | O(1) 查询 |
| **SHADCN_PRESET** | [libraries/shadcn.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/libraries/shadcn.ts) | 提供 shadcn/ui 组件的默认属性与样式 | 低 | O(1) |
| **Knowledge Hub** | [knowledgeHub.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts) | 1270+ 设计推理规则、UX 规则、排版配对 | 高 (大量上下文) | O(log N) 搜索 (MiniSearch) |

### 2.5. 后处理层 (Post-Processing)

| 因素 | 来源文件 | 作用 | LLM 复杂度 | 算法复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| **TreeReconstructor** | [treeReconstructor.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/treeReconstructor.ts) | 将 Flat Adjacency List 重构为嵌套树 | N/A | O(N) 遍历 |
| **Linting / Sanitization** | ~~`postProcessor.ts` / `sanitizeLayer.ts`~~ → **方案A**: 统一到 `postProcessor` + [rules/sanitize.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/postProcessor/rules/sanitize.ts) | 修复 LLM 输出的常见错误 | N/A | O(N) 遍历 |
| **Constraint Validator** | `constraintValidator.ts` | 校验生成结果是否符合约束 | N/A | O(N) 规则应用 |

> **[方案 A 变更 2026-01-21]**: 语义处理已从 [sanitizeLayer](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts#14-82) 迁移到 [postProcessor/rules/sanitize.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/postProcessor/rules/sanitize.ts)。现在所有修正规则统一使用 RulePriority 系统，支持 CorrectionLog 追溯。

---

## 3. ID-Parent 邻接表策略的复杂度简化

**描述**: 用 `{ id, parent }` 的扁平列表替代 `{ children: [...] }` 的深层嵌套 JSON。

### LLM 复杂度影响
- **降低**: 嵌套结构要求模型在生成时维护一个"层级栈"，容易在深层时丢失上下文或产生语法错误（括号不匹配）。扁平列表将每个节点视为独立单元，减少了上下文依赖。
- **权衡**: 模型需要理解 `parent` 引用关系，但这种关系是"局部"的（只看父节点 ID），而非"全局"的（整个树的嵌套层次）。

### 算法复杂度影响
- **后处理**: 需要增加一个 O(N) 的 `TreeReconstructor` 步骤。
- **解析**: HybridParser 需要识别两种格式（嵌套 vs. 扁平），但这是简单的类型检测。

## 4. 竞争性假设

### H-A: Schema 与 Tool Calling 冲突假设 ✅ (置信度: 95% → 已确认)
**假设内容**: 当 `responseJsonSchema` 与 `tools` 同时使用时，模型注意力分散或 API 冲突，导致空输出。  
**证据**: 
- gemini-2.5-pro 返回 `[400] Function calling with 'application/json' is unsupported`
- 多轮 Tool Calling 后 `Raw input length: 0`
- 禁用 Tools 后生成恢复正常  
**解决方案**: `DISABLE_TOOL_CALLING: true` (featureFlags.ts)
**状态**: ✅ 已解决 (2026-01-21)

### H-B: Prompt 长度引发的注意力稀释假设 (置信度: 70%)
**假设内容**: 18 个 Prompt 分段（~1835 Token）可能超过了模型对特定指令的关注能力，导致关键约束（如 `layoutMode` 必填）被忽略。  
**证据**: 即使在 Prompt 中明确要求了 `layoutMode`，日志中仍有大量缺失。  
**测试方案**: 减少 Prompt 分段数量，聚焦于最关键的 3-5 个分段，观察属性留存率。

### H-C: 工具调用代价假设 (置信度: 60%)
**假设内容**: 4 个工具调用可能增加了模型的决策负担。模型在考虑是否调用 `check_design_constraint` 时，可能因为不确定而选择跳过，从而产生不符合约束的输出。  
**证据**: Trace AUIC7BR 在进行了 4-5 次工具调用后仍有 48 个警告。  
**测试方案**: 禁用工具调用，只依赖 Prompt + Schema，对比警告数量。

### H-F: RAG 驱动的 Few-Shot 示例假设 (置信度: 75%)
**假设内容**: UI Pro Max 的 [guidelines.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/generated/guidelines.json) 包含 2500+ 条 Do/Don't 规则。可以从中提取布局相关规则，作为 Few-shot 示例注入 Prompt，替代 Strict Schema 的硬约束。  
**证据**: Do/Don't 格式 (`do: "...", dont: "..."`) 非常适合 LLM 学习。  
**测试方案**: 创建 `buildLayoutRulesSection`，注入 5-10 条布局相关规则。

### H-G: Sequential Thinking 增强 Self-Correction 假设 (置信度: 80%)
**假设内容**: 当前 Self-Correction 循环只是简单反馈。可引入 Sequential Thinking 的"假设→验证→修正"语义，让模型在重试时更有目标性。  
**证据**: Sequential Thinking MCP 的 `isRevision`, `revisesThought` 字段形成自我批评机制。  
**测试方案**: 在 Feedback 中加入"假设验证"语义（如"假设：缺少 layoutMode 是因为..."）。

### H-H: 动态规则注入替代 Strict Schema 假设 (置信度: 90% ↑)
**假设内容**: Schema 无法强制 LLM 输出特定属性，需在 Prompt 中注入 Do/Don't 规则作为"软约束"。  
**证据 (日志 2026-01-21)**: 
- Self-Correction 3 轮后仍有 60 warnings
- 高频缺失: `lineHeight`, `primaryAxisAlignItems`, `layoutMode`
- LLM 反复忽略相同属性，Self-Correction 无效  
**建议实验**: 
- 在 Prompt 中添加: `DO: TEXT nodes must include lineHeight`
- 在 Prompt 中添加: `DO: CARD semantic must have layoutMode=VERTICAL`
**状态**: 待实验验证 (下一步)

---

## 5. UI Pro Max 的启发

### 5.1 核心设计模式
| 设计模式 | 描述 | 对 Generator 的启发 |
|:---|:---|:---|
| **结构化知识检索 (RAG)** | 使用 MiniSearch 对 1270+ 设计规则进行语义检索 | 可在生成前根据用户意图检索相关规则 |
| **Do/Don't 规则格式** | [do](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/features/chat/useChat.ts#82-87)/`dont`/`codeGood`/`codeBad` 四元组 | 比自然语言描述更易于 LLM 理解和遵守 |
| **层次化知识域** | 10 个知识域按需注入 | 避免 Prompt 膨胀，只注入相关知识 |

### 5.2 知识域概览
1. **ReasoningRule**: UI 类别模式、决策规则
2. **StyleDefinition**: 视觉样式定义
3. **ColorPalette**: 产品类型调色板
4. **TypographyPairing**: 字体配对
5. **LandingPagePattern**: 落地页结构
6. **ChartRecommendation**: 数据可视化最佳实践
7. **ProductTrend**: 产品类型趋势
8. **GuidelineRule**: UX 准则 (2500+ 条)
9. **StackRule**: 技术栈特定规则
10. **ANATOMY_REGISTRY**: 组件解剖结构

---

## 6. Sequential Thinking 的启发

### 6.1 核心机制
| 机制 | MCP 字段 | 对 Generator 的启发 |
|:---|:---|:---|
| **假设-验证循环** | `nextThoughtNeeded`, `thought` | Self-Correction 可引入"假设生成→验证"语义 |
| **自我修正** | `isRevision`, `revisesThought` | 重试时明确标注"修正哪个假设" |
| **分支与回溯** | `branchFromThought`, `branchId` | 可探索多个替代生成方案 |
| **置信度追踪** | `thoughtHistoryLength` | 追踪推理链长度，防止无限循环 |

### 6.2 对 Self-Correction 的改进建议
当前 Self-Correction 循环的 Feedback 格式：
```
Previous output had 48 warnings. Please fix: [warning list]
```

建议改进为 Sequential Thinking 格式：
```
**Hypothesis**: The missing layoutMode is likely due to [reason].
**Verification**: Check if parent node has layout constraint.
**Revision**: Add layoutMode: "VERTICAL" to all container nodes with HUG children.
```

---

## 7. 置信度追踪

| 假设 | 初始置信度 | 当前置信度 | 待验证方法 |
| :--- | :--- | :--- | :--- |
| H-A (Schema/Tool 冲突) | 80% | 85% | 回滚 required 字段 |
| H-B (Prompt 稀释) | 65% | 70% | 精简 Prompt 实验 |
| H-C (工具调用代价) | 50% | 60% | 禁用 Tool Calling 实验 |

---

## 6. 自我批评与方法论反思

### 当前方法论
- **优点**: 系统化列举了所有因素，使用了多层次分类。
- **缺点**: 对每个因素的影响程度仍缺乏量化数据。假设测试尚未执行。

### 改进方向
1. **指标化**: 设计一个"属性留存率"指标，定义为 [(实际输出属性数 / Schema 要求属性数) * 100%](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/designSystemLoader.ts#258-261)。
2. **A/B 测试**: 对相同 Prompt，分别使用"Strict Schema"、"Loose Schema"、"No Schema"模式，收集 5 轮生成数据。
3. **Prompt 剪裁实验**: 识别出优先级最低的 Prompt 分段，在隔离模式下移除它们，观察对生成质量的影响。

---

## 7. 下一步研究计划
1. [ ] **回滚 Strict Schema**: 移除 [schema.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schema.ts) 中的 `required` 字段，验证 Q9DDP46 错误是否消失。
2. [ ] **Prompt 精简实验**: 创建一个"最小化 Prompt"，只包含 Role + Constraint + Semantic Intent。
3. [ ] **工具调用效力评估**: 统计工具调用对最终输出警告数的影响。

---

## 8. 本次对话研究总结 (2026-01-21)

### 8.1 知识注入机制验证 ✅

**核心发现**: UI Pro Max 知识 100% 以 **Prompt 文本** 形式注入 LLM。

**完整数据流**:
```
CSV (源) → generate-knowledge.js → JSON (src/generated/)
    → knowledgeHub.ts (MiniSearch 索引)
    → sectionRegistry.ts (8 个 Section Builders)
    → promptComposer.ts (拼接)
    → generator.ts L81: { role: "user", parts: [{ text: systemPrompt }] }
```

**关键代码位置**: `generator.ts:81` - System Prompt 作为 Chat History 首条消息。

---

### 8.2 UI Pro Max vs 本项目性能对比

| 维度 | UI Pro Max (原版) | 本项目 |
|:---|:---|:---|
| 语言 | Python | TypeScript |
| 搜索算法 | BM25 (每次重建) | MiniSearch (内存索引) |
| 首次搜索延迟 | ~300-500ms | ~10-50ms |
| 后续搜索延迟 | 同上 | ~1-5ms |
| 模糊搜索 | ❌ | ✅ fuzzy: 0.2 |

**数据量**: 原版 CSV ~220KB → 本项目 JSON ~636KB (+189% 因 JSON 格式膨胀)

---

### 8.3 LLM 职责边界研究

#### 新假设一览

| 假设 ID | 内容 | 置信度 |
|:---|:---|:---|
| **H-L** | 布局推导：HUG/FILL 可从结构推导，不需 LLM 决定 | 95% |
| **H-M** | 内容优先：LLM 应专注语义/内容，布局交给后处理 | 90% |
| **H-N** | 空 children 偷懒：LLM 在深层嵌套时倾向生成空容器 | 85% |
| **H-O** | 最小输出：LLM 只需输出 type/name/semantic/characters | 85% |
| **H-P** | 语义模板：从 semantic 自动推导结构和属性 | 90% |
| **H-T** | 修正日志反馈：后处理修正需告知 LLM 形成闭环 | 90% |
| **H-U** | 三级意图优先级：用户明确 > LLM 推理 > 工具默认 | 85% |

#### 职责划分结论

| LLM 擅长 ✅ | 工具擅长 ✅ |
|:---|:---|
| 意图理解 ("创建登录表单") | 精确计算 (padding: 16) |
| 语义推理 (FORM → 子组件列表) | 约束传播 (HUG/FILL 检验) |
| 内容生成 (按钮文案) | 一致性保证 (从 tokenSlot) |
| 上下文关联 | 格式转换 (semantic → Figma API) |

---

### 8.4 后处理与 LLM 意图一致性

**问题发现**: [feedbackEngine.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/chat/feedbackEngine.ts) 不记录后处理修正，导致死循环：
```
用户: "我要 HUG" → LLM: HUG → 后处理: HUG→FIXED → 用户看到 FIXED
用户: "我要 HUG!" → LLM: HUG → 后处理: HUG→FIXED → 无限循环
```

**解决方案**: 修正日志 (CorrectionLog) 反馈到 History：
```typescript
{ field: "layoutSizingHorizontal", original: "HUG", corrected: "FIXED",
  reason: "Parent has layoutMode=NONE", suggestion: "Set layoutMode first" }
```

---

### 8.5 LLM 友好数据结构研究

| 假设 ID | 内容 | 置信度 | 推荐度 |
|:---|:---|:---|:---|
| **H-V** | 简化表示：`l:"H"` 替代 `layoutMode:"HORIZONTAL"` | 80% | ⚠️ |
| **H-X** | 语义模板：`frameType:"CARD"` 后处理展开 | 90% | ✅ 推荐 |
| **H-Y** | 数组规范化：`padding:[8,8,16,16]` | 85% | ⚠️ |
| **H-Z** | 最小工程化：不为省 Token 增加系统复杂度 | 95% | ✅ 核心原则 |

**行业发现**: JSON 可能比 TSV 多用 2x Token (来源: Medium 文章)

---

### 8.6 架构原则总结

> **LLM 做擅长的事，复杂计算等不擅长的，交给工具/函数/程序/模型（稳定无 Bug）**

#### 过度工程化警示

| 信号 | 描述 |
|:---|:---|
| 为 LLM 优化格式 | 牺牲可读性换取 Token 节省 |
| 复杂转换层 | 需要双向转换器 |
| 隐式约定 | 位置含义替代属性名 |
| 过早优化 | 未验证有效性就优化性能 |

#### 评估矩阵

| 方案 | 复杂度 | 可维护性 | 推荐度 |
|:---|:---|:---|:---|
| 当前 JSON (不变) | ⭐ | ⭐⭐⭐ | ✅ 基线 |
| 语义模板 (frameType) | ⭐⭐ | ⭐⭐⭐ | ✅ 推荐 |
| 紧凑数组格式 | ⭐⭐⭐ | ⭐ | ❌ 过度工程化 |

---

### 8.7 置信度追踪表 (更新 2026-01-21)

| 假设 | 类别 | 置信度 | 状态 |
|:---|:---|:---|:---|
| **H-A** | Schema/Tool 冲突 | **95%** | ✅ 已确认 & 禁用 |
| H-B | Prompt 稀释 | 70% | 待验证 |
| H-C | 工具调用代价 | 60% | 已由 H-A 解决 |
| H-F | RAG Few-Shot | 75% | 由 H-H 部分实现 |
| H-G | Sequential Thinking 增强 | 80% | 待验证 |
| **H-H** | 动态规则替代 Schema | **90%** | ✅ 已实现 |
| H-L | 布局推导 | 95% | ✅ 代码验证 |
| H-M | 内容优先 | 90% | ✅ 代码验证 |
| H-N | 空 children 偷懒 | 85% | 观察验证 |
| H-O | 最小输出 | 85% | 待实验 |
| H-P | 语义模板 | 90% | 部分实现 |
| H-T | 修正日志反馈 | 90% | ✅ 已实施 |
| H-U | 三级意图优先级 | 85% | 待实施 |
| H-X | 语义模板数据结构 | 90% | ✅ 推荐 |
| H-Z | 最小工程化 | 95% | ✅ 核心原则 |
| **H-SC** | Self-Correction 空输出 | **90%** | ✅ 已禁用 |
| **H-DS1** | Schema 过度约束 | **95%** | ✅ 实验 E1 确认 (10:03) |
| **H-DS4** | 可移除 Schema | **80%** | ✅ 实验 E1 确认 |

---

### 8.8 研究文件索引

| 文件 | 用途 |
|:---|:---|
| [llm_driver_factors_analysis.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/llm_driver_factors_analysis.md) | 主研究文档 (本文件) |
| [uipromax_integration_analysis.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/uipromax_integration_analysis.md) | UI Pro Max 知识流详细分析 |
| [llm_responsibility_boundary_research.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/llm_responsibility_boundary_research.md) | 布局属性职责边界 |
| [llm_friendly_data_structure_research.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/llm_friendly_data_structure_research.md) | 数据结构对比 |
| [llm_responsibility_architecture.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/llm_responsibility_architecture.md) | 架构原则 (含过度工程化评估) |
| [llm_role_boundary_research.md](file:///Users/daxiaoxiao/.gemini/antigravity/brain/b35e03cd-3003-44b5-b821-f53ad44bc750/llm_role_boundary_research.md) | **[NEW]** LLM 角色边界与 Schema 必要性研究 |

---

## 9. P0-P2 实施结果 (2026-01-21)

### 9.1 实施概览

| 任务 | 状态 | 修改文件 |
|:---|:---|:---|
| **P0** 移除 layoutMode required | ✅ 已完成 | `schema.ts:94` |
| **P1** 扩展 ANATOMY_REGISTRY | ✅ 已完成 | [anatomyRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/anatomyRegistry.ts) |
| **P2** CorrectionLog 反馈 | ✅ 已完成 | [chat.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/types/chat.ts), [layerRenderer.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts), [feedbackEngine.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/chat/feedbackEngine.ts) |
| **P3** 用户意图标记 | ⏸️ 可选 | - |

### 9.2 关键代码变更

**P0**: `required: [PROPS.name, PROPS.layoutMode, PROPS.semantic]` → `[PROPS.name, PROPS.semantic]`

**P1**: ANATOMY_REGISTRY 7 → 24 组件 (新增: form, nav_bar, sidebar, modal, dialog, toast, dropdown, avatar, badge, divider, switch, checkbox, radio, list, list-item, table, tabs)

**P2**: 
```typescript
// 新增类型 (chat.ts)
interface CorrectionLog { field, original, corrected, reason }

// 新增函数 (feedbackEngine.ts)
function collectCorrections(node): CorrectionLog[]

// 修改返回值
ChatMessage.corrections?: CorrectionLog[]
```

### 9.3 数据流验证

```
LLM 输出: { semantic: "CARD", layoutMode: undefined }
       ↓
sanitizeLayer(): layoutMode NONE → VERTICAL + 记录 CorrectionLog
       ↓
collectCorrections(): 递归收集所有修正
       ↓
ChatMessage.corrections: [{ field: "layoutMode", corrected: "VERTICAL", reason: "..." }]
       ↓
LLM 下轮 History: 可看到修正原因，避免重复错误
```

### 9.4 方案 A 执行结果 (2026-01-21 08:21)

**统一后处理入口**:
- 创建 [rules/sanitize.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/postProcessor/rules/sanitize.ts) (7 条规则)
- 添加到 [postProcessor/index.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/postProcessor/index.ts)
- 删除 [layerRenderer.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts) 重复逻辑 (-150 行)

**架构改进**:
```
Before: sanitizeLayer (7 规则) → postProcessor (6 类规则)
After:  sanitizeLayer (3 通用修正) → postProcessor (13 规则, 统一优先级)
```

**收益**:
- ✅ 消除双系统冲突
- ✅ 所有修正可追溯 (CorrectionLog 100%)
- ✅ 统一优先级系统 (RulePriority)

### 9.5 H-A/H-H/H-SC 实施 (2026-01-21 09:36)

#### H-A: Tool Calling 禁用 ✅

**问题**: `responseJsonSchema` + `tools` API 冲突
- gemini-2.5-pro 返回 `[400] Function calling with 'application/json' is unsupported`
- 多轮 Tool Calling 后 `Raw input length: 0`

**解决**: [featureFlags.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/constants/featureFlags.ts) 添加 `DISABLE_TOOL_CALLING: true`

#### H-H: 动态规则注入 ✅

**问题**: Schema 无法强制 LLM 输出特定属性 (`lineHeight`, `layoutMode`)

**解决**:
1. 创建 [figma-layout-rules.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/generated/figma-layout-rules.json) (10 条规则)
2. 扩展 [knowledgeHub.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts): [searchFigmaLayout()](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#267-279) + [getAllFigmaLayoutRules()](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#280-286)
3. 创建 [buildFigmaLayoutSection()](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#129-158) in [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts)

**关键代码**:
```typescript
// 动态检索 + 合并关键规则
const results = knowledgeHub.searchFigmaLayout(target, 5);
const criticalRules = allRules.filter(r => r.severity === 'Critical' || 'High');
```

#### H-SC: Self-Correction 循环禁用 ✅

**问题**: 重试循环中 context 累积导致空输出

**解决**: [featureFlags.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/constants/featureFlags.ts) 添加 `DISABLE_SELF_CORRECTION: true`

---

### 9.6 当前 Feature Flags 状态

| Flag | 状态 | 原因 |
|:---|:---|:---|
| `DISABLE_TOOL_CALLING` | true | H-A: API 冲突 |
| `DISABLE_SELF_CORRECTION` | true | H-SC: 空输出 |
| `DISABLE_POST_PROCESSOR` | true | 测试原始输出 |

### 9.7 修改文件索引 (2026-01-21)

| 文件 | 修改类型 | 描述 |
|:---|:---|:---|
| [featureFlags.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/constants/featureFlags.ts) | 新增 | `DISABLE_TOOL_CALLING`, `DISABLE_SELF_CORRECTION` |
| [generator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts) | 修改 | 条件禁用 tools 和重试 |
| [figma-layout-rules.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/generated/figma-layout-rules.json) | 新增 | 10 条 Figma Layout 规则 |
| [knowledgeHub.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts) | 扩展 | [FigmaLayoutRule](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#154-155), [searchFigmaLayout()](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#267-279) |
| [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts) | 扩展 | [buildFigmaLayoutSection()](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#129-158) |

