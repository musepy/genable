# 后处理层技术债务分析

## 1. 问题概述

后处理层存在两套独立系统处理相同语义，导致：
- 双重修正
- 优先级不明确
- 隐式覆盖用户/LLM 意图

---

## 2. 系统架构

```
LLM 输出
    ↓
sanitizeLayer (layerRenderer.ts)     ← 系统 A
    ↓
postProcessor (postProcessor/index.ts) ← 系统 B
    ↓
Figma 渲染
```

---

## 3. 重叠逻辑矩阵

| 语义 | sanitizeLayer | postProcessor 规则 | 冲突风险 |
|:---|:---|:---|:---|
| **CARD** | L130-145: layoutMode, padding, radius, gap | CardSemanticDefaults, CardMinPaddingCorrection | 🔴 高 |
| **BUTTON** | L80-124: layoutMode, alignment, height, children | V2PhysicsConstraintRule | 🟡 中 |
| **DIVIDER** | L58-75: sizing, height, fills | V2PhysicsConstraintRule | 🟡 中 |
| **SWITCH** | L145-190: layout, sizing, children | V2PhysicsConstraintRule | 🟡 中 |
| **TEXT** | L22-48: textAutoResize, sizing, strokes | HeadingLabelTextHug, ParagraphTextAutoResize | 🔴 高 |

---

## 4. 竞争性假设

### H-AA: 双重修正假设 (置信度: 90%)
同一属性被修正两次，第二次可能覆盖第一次。

**证据**: CARD.layoutMode 在 sanitizeLayer L133 设置后，可能被 CardSemanticDefaults L210 再次检查。

### H-AB: 优先级冲突假设 (置信度: 80%)
postProcessor 有 RulePriority 系统，sanitizeLayer 没有。

**RulePriority 值**:
```typescript
CRITICAL = 100  // V2PhysicsConstraintRule, flexConsistencyRule
HIGH = 80       // HeadingLabelTextHug
MEDIUM = 50     // CardMinPaddingCorrection, ParagraphTextAutoResize
LOW = 20        // CardSemanticDefaults
```

**问题**: sanitizeLayer 总是先执行，无视 postProcessor 的优先级。

### H-AC: 隐式覆盖假设 (置信度: 95%)
以下规则会静默覆盖 LLM/用户意图：

| 规则 | 覆盖行为 | 可见性 |
|:---|:---|:---|
| V2PhysicsConstraintRule | 强制 height/width 在范围内 | ❌ 无日志 |
| HeadingLabelTextHug | 强制 sizing=HUG | ❌ 无日志 |
| CardMinPaddingCorrection | 强制 padding ≥ minPadding | ❌ 无日志 |
| flexConsistencyRule | 强制 Flex 布局规则 | ❌ 无日志 |

---

## 5. P2 覆盖范围评估

当前 P2 实现只在 [sanitizeLayer](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts#14-258) 收集 CorrectionLog：
- ✅ layerRenderer.ts CARD layoutMode 修正
- ❌ postProcessor 所有规则未收集

**缺口**: ~70% 的修正操作未被记录

---

## 6. 建议方案

### 方案 A: 统一到 postProcessor (推荐)
- 将 sanitizeLayer 逻辑迁移到 postProcessor 规则
- 所有规则都有 priority 和 CorrectionLog
- 单一入口，可追溯

### 方案 B: 扩展 P2 到 postProcessor
- 保持现有架构
- 在 postProcessor 中添加 CorrectionLog 收集
- 最小改动

### 方案 C: 废弃 postProcessor 大部分规则
- sanitizeLayer 已覆盖核心语义
- 只保留 physics 和 flex 规则作为安全网
- 减少复杂度

---

## 7. 方案详细评估

### 方案 A: 统一到 postProcessor ⭐ 用户倾向

**工作内容**:
1. 将 sanitizeLayer 中的 7 个语义处理 (DIVIDER, BUTTON, CARD, SWITCH, TEXT×2) 迁移为 postProcessor 规则
2. 每个规则添加 priority 和 CorrectionLog 支持
3. 删除 sanitizeLayer 中的重复逻辑
4. 更新调用入口

**工作量估算**:
| 任务 | 文件 | 代码行 | 时间 |
|:---|:---|:---|:---|
| 新建 sanitize 规则 | `rules/sanitize.ts` | ~200 行 | 30 分钟 |
| 添加 CorrectionLog | [types.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/types.ts), 各规则 | ~50 行 | 15 分钟 |
| 删除 sanitizeLayer 逻辑 | [layerRenderer.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts) | -150 行 | 10 分钟 |
| 更新调用链 | [main.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/main.ts) | ~10 行 | 5 分钟 |
| 测试验证 | - | - | 20 分钟 |
| **总计** | | ~110 行净增 | **80 分钟** |

**风险**:
- 🟡 中: 迁移过程可能遗漏边界情况
- 🟢 低: 有单元测试覆盖

**收益**:
- ✅ 单一入口，所有修正可追溯
- ✅ 统一优先级系统 (RulePriority)
- ✅ CorrectionLog 覆盖率 100%
- ✅ 消除双重修正问题

---

### 方案 B: 扩展 P2 到 postProcessor

**工作内容**:
1. 在 postProcessor/index.ts 的 processNode 中收集 CorrectionLog
2. 将 CorrectionLog 传递到 feedbackEngine
3. 保持 sanitizeLayer 不变

**工作量估算**: ~40 分钟

**风险**:
- 🔴 高: 保留双系统，技术债务未解决
- 🟡 中: 优先级冲突问题仍存在

**收益**:
- ✅ 最小改动
- ✅ CorrectionLog 覆盖率提升到 ~80%

---

### 方案 C: 废弃 postProcessor 大部分规则

**工作内容**:
1. 禁用 semanticRules 中与 sanitizeLayer 重叠的规则
2. 只保留 physicsRules 和 flexConsistencyRule

**工作量估算**: ~20 分钟

**风险**:
- 🔴 高: 丢失 CardMinPaddingCorrection 等安全网
- 🟡 中: 需要确认 sanitizeLayer 完全覆盖

**收益**:
- ✅ 大幅减少复杂度
- ✅ 明确单一入口 (sanitizeLayer)

---

## 8. 推荐决策

| 维度 | A | B | C |
|:---|:---|:---|:---|
| 技术债务解决 | ✅ 完全 | ❌ 未解决 | 🟡 部分 |
| CorrectionLog 覆盖 | 100% | ~80% | 30% |
| 工作量 | 80 min | 40 min | 20 min |
| 长期维护性 | ✅ 最佳 | ❌ 最差 | 🟡 中等 |

**推荐: 方案 A** (与用户倾向一致)

---

## 9. 方案 A 实施计划

1. [ ] 创建 `rules/sanitize.ts` 迁移 7 个语义处理
2. [ ] 为每个规则添加 CorrectionLog 收集
3. [ ] 删除 [layerRenderer.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/rendering/layerRenderer.ts) 中的 sanitizeLayer 语义处理
4. [ ] 更新 [postProcessor/types.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/postProcessor/types.ts) 扩展 CorrectionLog
5. [ ] 验证构建和单元测试
6. [ ] 手动验证 CARD/BUTTON/SWITCH 生成

**是否继续执行方案 A？**
