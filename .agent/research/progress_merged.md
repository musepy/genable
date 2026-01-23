# 进度笔记 (合并版 2026-01-21)

## 已完成 ✅

### 研究与验证 (b35e03cd)
- **H-A**: Tool Calling 与 JSON Schema API 冲突 → 禁用
- **H-SC**: Self-Correction 循环导致空输出 → 禁用
- **H-DS1**: Schema 限制 LLM 能力 → 禁用 Schema
- **E1 实验**: 无 Schema 输出 +12.5%，质量更高

### 研究与验证 (0754d321 新增)
- **H-100px**: 100px 布局坍缩问题 → 源头治理 (resize 1x1 + HUG 回退)
- **H-OverCorrection**: 过度矫正风险审计 → 确认为"翻译"而非"改稿"
- **H-Dual-Track**: 知识双轨制 (SHADCN vs ANATOMY) → 已诊断，优先级 P1

### 代码变更 (b35e03cd)
- `schema.ts`: @deprecated
- `schemaGenerator.ts`: @deprecated
- `generator.ts`: 简化 responseSchema 逻辑
- `figma-layout-rules.json`: 10 条布局规则
- `knowledgeHub.ts`: searchFigmaLayout()
- `sectionRegistry.ts`: buildFigmaLayoutSection()

### 代码变更 (0754d321 新增)
- `layerRenderer.ts`: 100px 源头重置 + HUG 默认回退
- `layoutCalculator.ts`: 全局清理 `|| 100` 魔法数字
- `frameRenderer.ts`: FIXED 模式尺寸兜底改为 1px
- `figma-api.ts`: 新增 CSS 对齐别名 (START→MIN)
- `tokens.json`: 扩展 fontWeight 方言支持

---

## Feature Flags

| Flag | 状态 |
|:---|:---|
| `DISABLE_TOOL_CALLING` | true |
| `DISABLE_SELF_CORRECTION` | true |
| `DISABLE_RESPONSE_SCHEMA` | true |
| `DISABLE_POST_PROCESSOR` | true (测试模式) |

---

## 当前架构

```
Prompt (Do/Don't 规则 + KnowledgeHub RAG)
    ↓
LLM (纯 JSON, 意图优先方言)
    ↓
PostProcessor (RulePriority 系统 + CorrectionLog)
    ↓
Figma Renderer (1px 初始化 + HUG 智能回退)
```

---

## 下一步

1. **启用 PostProcessor** 测试完整流程
2. **知识合一**: 合并 SHADCN_PRESET 到 ANATOMY_REGISTRY
3. **语义检索**: 迁移 Anatomy 到 KnowledgeHub.searchAnatomy()
