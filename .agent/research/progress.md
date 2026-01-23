# 进度笔记 (2026-01-21)

## 已完成 ✅

### 研究与验证
- **H-A**: Tool Calling 与 JSON Schema API 冲突 → 禁用
- **H-SC**: Self-Correction 循环导致空输出 → 禁用
- **H-DS1**: Schema 限制 LLM 能力 → 禁用 Schema
- **E1 实验**: 无 Schema 输出 +12.5%，质量更高

### 代码变更
- [schema.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schema.ts): @deprecated
- [schemaGenerator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/schemaGenerator.ts): @deprecated
- [generator.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/gemini/generator.ts): 简化 responseSchema 逻辑
- [figma-layout-rules.json](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/generated/figma-layout-rules.json): 10 条布局规则
- [knowledgeHub.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/knowledgeHub.ts): searchFigmaLayout()
- [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts): buildFigmaLayoutSection()

---

## Feature Flags

| Flag | 状态 |
|:---|:---|
| `DISABLE_TOOL_CALLING` | true |
| `DISABLE_SELF_CORRECTION` | true |
| `DISABLE_RESPONSE_SCHEMA` | true |
| `DISABLE_POST_PROCESSOR` | true |

---

## 当前架构

```
Prompt (Do/Don't 规则) → LLM (纯 JSON) → PostProcessor → Figma
```

## 下一步
- 启用 PostProcessor 测试完整流程
- 添加 fontWeight 规范化规则
