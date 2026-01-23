# UI Pro Max 知识集成架构分析

## 1. 项目概览

UI Pro Max 是一个 **18.2k stars** 的开源 AI Skill，提供设计智能用于构建专业 UI/UX。本项目已将其知识库集成到 Figma AI Generator 中。

### 1.1 知识库规模
| 知识域 | 记录数 | 描述 |
|:---|:---|:---|
| Reasoning | ~50 | UI 类别模式、决策规则、反模式 |
| Styles | ~50 | 视觉样式定义 (渐变、玻璃态等) |
| Colors | ~97 | 产品类型调色板 |
| Typography | ~57 | 字体配对建议 |
| Landing | ~20 | 落地页结构模式 |
| Charts | ~25 | 数据可视化最佳实践 |
| Products | ~30 | 产品类型趋势 |
| Guidelines | ~99 | UX 准则 (Do/Don't) |
| Stacks | ~100+ | 技术栈特定规则 (9 个栈) |

---

## 2. 知识流向架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UI Pro Max Skill                                  │
│  /ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/                           │
│  ├── ui-reasoning.csv   (50 rules)                                          │
│  ├── styles.csv         (50 styles)                                         │
│  ├── colors.csv         (97 palettes)                                       │
│  ├── typography.csv     (57 pairings)                                       │
│  ├── landing.csv        (20 patterns)                                       │
│  ├── charts.csv         (25 types)                                          │
│  ├── products.csv       (30 trends)                                         │
│  ├── ux-guidelines.csv  (50 rules)                                          │
│  ├── web-interface.csv  (30 rules)                                          │
│  ├── react-performance.csv (20 rules)                                       │
│  └── stacks/            (12 stack-specific CSVs)                            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      generate-knowledge.js (ETL)                            │
│  - 读取 CSV 文件                                                             │
│  - 转换为标准化 JSON 结构                                                    │
│  - 处理格式错误 (unclosed quotes)                                           │
│  - 输出到 src/generated/                                                     │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   src/generated/ (JSON 知识库)                              │
│  ├── reasoning.json     ├── landing.json     ├── guidelines.json           │
│  ├── styles.json        ├── charts.json      ├── stacks.json               │
│  ├── colors.json        ├── products.json                                   │
│  └── typography.json                                                         │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   knowledgeHub.ts (MiniSearch 索引服务)                     │
│  class KnowledgeHubService {                                                 │
│    private reasoningIndex: MiniSearch<ReasoningRule>;                       │
│    private stylesIndex: MiniSearch<StyleDefinition>;                        │
│    ... (9 个索引)                                                            │
│                                                                              │
│    searchReasoning(query, limit): SearchResult[]                            │
│    searchStyles(query, limit): SearchResult[]                               │
│    ... (9 个搜索方法)                                                        │
│  }                                                                           │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   sectionRegistry.ts (Prompt 注入点)                        │
│  [8 个 Section Builders 使用 knowledgeHub 进行动态知识注入]                 │
│                                                                              │
│  ├── buildReasoningContextSection  → 注入推理规则 (pattern, antiPatterns)   │
│  ├── buildTypographyContextSection → 注入字体配对 (headingFont, bodyFont)   │
│  ├── buildStyleContextSection      → 注入视觉样式 (colors, effects)         │
│  ├── buildLandingPatternSection    → 注入落地页结构 (sections, cta)         │
│  ├── buildChartContextSection      → 注入图表建议 (bestChart, library)      │
│  ├── buildProductContextSection    → 注入行业趋势 (primaryStyle)            │
│  ├── buildGuidelineContextSection  → 注入 Do/Don't 规则                     │
│  └── buildStackContextSection      → 注入技术栈约束                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   promptComposer.ts (Prompt 组装器)                         │
│  - 按优先级排序 Section Builders                                             │
│  - 过滤启用的 Sections (Feature Flags)                                       │
│  - 拼接最终 System Prompt                                                    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Gemini API                                           │
│  - 接收 System Prompt + 用户请求                                            │
│  - 生成 Figma JSON 结构                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 知识注入点详细分析

### 3.1 Section Builders 对照表

| Section Builder | Knowledge Hub 方法 | 模板字段 | 触发条件 | 分数阈值 |
|:---|:---|:---|:---|:---|
| [buildReasoningContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#385-404) | [searchReasoning](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#225-228) | pattern, colorMood, antiPatterns | intent.target 存在 | 0.4 |
| [buildTypographyContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#413-428) | [searchTypography](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#238-241) | headingFont, bodyFont | intent.target 存在 | 0.3 |
| [buildStyleContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#436-451) | [searchStyles](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#229-232) | primaryColors, effects | intent.modifiers.variant | 0.3 |
| [buildLandingPatternSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#460-478) | [searchLanding](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#242-245) | sections, cta, conversion | query 包含 "landing/hero" | 无 |
| [buildChartContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#489-507) | [searchCharts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#246-249) | bestChart, library | query 包含 "chart/data" | 0.3 |
| [buildProductContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#515-530) | [searchProducts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#250-253) | type, primaryStyle | intent.target 存在 | 0.4 |
| [buildGuidelineContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#540-552) | [searchGuidelines](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#254-257) | do, dont (3条) | intent.target 存在 | 无 |
| [buildStackContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#561-573) | [searchStackRules](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#258-270) | guideline, codeGood | designSystemContext.skillName | 无 |

### 3.2 当前利用率分析

**已利用的知识域 (8/9)**:
- ✅ Reasoning rules
- ✅ Typography pairings
- ✅ Styles
- ✅ Landing patterns
- ✅ Charts
- ✅ Products
- ✅ Guidelines
- ✅ Stacks

**未充分利用的知识**:
- ⚠️ Colors (独立调色板建议): 未见专门的 `buildColorContextSection`
- ⚠️ Anti-patterns: 只在 Reasoning 中部分使用，未专门强调

---

## 4. 竞争性假设

### H-I: Guidelines Do/Don't 利用不足假设 (置信度: 90%)
**假设内容**: 当前 [buildGuidelineContextSection](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts#540-552) 只注入最多 3 条规则，且没有针对 Layout 约束进行专项筛选。这导致 LLM 可能漏掉关键的 Layout Do/Don't 规则。  
**证据**: 日志中反复出现 `HUG/FILL sizing requires Auto Layout` 警告。  
**验证方案**: 创建专项 `buildLayoutGuidelinesSection`，硬编码注入 Layout 相关的 5-10 条核心规则。

### H-J: 分数阈值过高假设 (置信度: 70%)
**假设内容**: 0.3-0.4 的分数阈值可能导致很多相关知识被过滤掉，特别是当用户 query 不精确时。  
**证据**: 日志中未见 Reasoning 或 Typography 注入的证据。  
**验证方案**: 降低阈值到 0.2，或使用 fallback 策略（无匹配时注入默认规则）。

### H-K: Color 知识未专门注入假设 (置信度: 85%)
**假设内容**: `knowledgeHub.searchColors` 方法存在，但没有对应的 `buildColorContextSection`。这意味着产品特定的调色板建议从未被注入到 Prompt 中。  
**证据**: grep 结果中 [searchColors](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#234-237) 未被任何 sectionRegistry 调用。  
**验证方案**: 创建 `buildColorContextSection`，注入产品类型对应的调色板。

---

## 5. 研究计划

- [x] 追踪 UI Pro Max CSV → JSON 转换管道
- [x] 研究 knowledgeHub.ts MiniSearch 索引机制
- [x] 分析 sectionRegistry.ts 中的 8 个知识注入点
- [ ] 创建专项 `buildLayoutGuidelinesSection` 注入 Layout Do/Don't
- [ ] 验证 Color 知识的缺失并补充注入
- [ ] 评估分数阈值对知识召回率的影响

---

## 6. 自我批评

### 方法论优点
- 系统地追踪了从源到 Prompt 的完整知识流
- 使用 grep 和 file outline 工具高效定位关键代码

### 方法论缺点
- 未执行实际的知识检索测试（如调用 [searchGuidelines('layout')](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts#254-257) 看返回什么）
- 对 MiniSearch 的 BM25 算法特性缺乏深入理解

### 改进方向
1. 编写一个调试脚本，测试不同 query 下各知识域的检索结果
2. 分析 [guidelines.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/generated/guidelines.json) 中实际有多少 Layout 相关规则
