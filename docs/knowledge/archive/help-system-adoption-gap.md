# Help 系统 & Skill 触发：采纳失败分析

## 发现日期: 2026-03-15

## 现象

5 次 E2E trigger，0 次 help 查询，0 次 skill 触发。LLM 完全不使用 `query(source="help")` 来了解工具用法，component-set skill 也未被动态注入。

---

## 问题 1：Help 系统 — LLM 没有感知到知识缺口

Phase 3 瘦身 system prompt 时，移走了详细指南（~5000 tokens），但保留了：

- flat ops 完整语法（create/update/delete/ref + 属性命名 + shorthands + pattern）
- progressive creation 策略表 + 完整 card 示例
- scene graph 心智模型 + design dimensions（CORE.md 完整保留）

**这些残余信息已经足够 LLM 直接开始设计。** LLM 没有遇到"我不知道怎么做"的时刻，所以不会主动查 help。

### 与 guidelines/style 的对比

LLM **会**主动查 `guidelines` 和 `style`，因为：

| 因素 | guidelines / style | help |
|---|---|---|
| 知识缺口 | LLM 不知道 dashboard 的具体布局模板 | LLM 已经知道 flat ops 语法 |
| 返回内容的不可替代性 | 颜色方案、间距系统——LLM 无法自己编 | 工具用法——LLM 觉得自己已经会了 |
| 调用时机 | 设计开始前（明确的决策点） | 模糊（"需要详细指导时"） |

### 核心洞察

**On-demand help 只对 LLM 感知到知识缺口的场景有效。** 如果 system prompt 里的残余信息足以让 LLM 自信地开始工作，它永远不会查 help。这不是 nudge 措辞的问题——改成 "MUST query help" 就变成了变相预加载。

---

## 问题 2：Skill Trigger Pattern — 死代码

Skill 的 SKILL.md 定义了 `triggerPatterns` 和 `injectionType: dynamic`，但这两个字段**没有任何运行时逻辑使用**。

### 数据流（实际）

```
SKILL.md → skills-registry.json → skillRegistry.register()
    → knowledgeHub.indexSkills() → BM25 搜索被动命中
```

### 缺失环节

```
用户 prompt → ??? triggerPattern 匹配 → ??? 注入 skill body
```

`triggerPatterns` 被解析进 `skills-registry.json` 后再无消费方。

### 关键文件

| 文件 | 角色 | 是否使用 triggerPatterns |
|---|---|---|
| `.agent/skills/*/SKILL.md` | 定义 triggerPatterns | 仅定义 |
| `src/engine/agent/skills/SkillRegistry.ts` | 管理 skill 状态 | **未使用** |
| `src/engine/llm-client/context/system.ts` | 组装 system prompt | **完全不涉及 skill** |
| `src/engine/llm-client/knowledge/knowledgeHub.ts` | 索引 skill body | 通过 `searchAll()` 被动命中，不看 triggerPatterns |

### E2E 验证

Prompt: "Create a Button component set with Primary/Secondary/Ghost variants..."
- component-set skill **未被触发**（triggerPatterns 包含 "component set"、"variant" 等关键词，但无匹配代码）
- LLM 最终用 clone + variantSet 创建了 18 个变体（结构正确），但没有 skill 指导

---

## 修复方向

### 方案 A：trigger-based 动态注入
在 `agentRuntime.run()` 开头，拿用户 prompt 匹配 dynamic skill 的 triggerPatterns，匹配成功则注入 skill body 到 turn message。

```typescript
const matchedSkills = skillRegistry.getEnabled()
  .filter(s => s.injectionType === 'dynamic')
  .filter(s => s.triggerPatterns?.some(p => prompt.toLowerCase().includes(p.toLowerCase())))

if (matchedSkills.length > 0) {
  const ctx = matchedSkills.map(s => skillRegistry.getSkillBody(s.id)).join('\n\n')
  this.turnMessages.push({ role: 'user', content: `[Skill Reference]\n${ctx}` })
}
```

**优点**：按需注入，不增加静态 system prompt
**缺点**：每次 turn 的 message 序列不同

### 方案 B：通过 help 系统桥接
将 skill body 索引到 helpIndex，LLM 通过 `query(source="help", query="component-set")` 获取。

**优点**：复用已有 help 基础设施
**缺点**：仍依赖 LLM 主动查询（问题 1 已证明 LLM 不会主动查）

### 方案 C：混合 — trigger 检测 + help 提示（推荐）
trigger 匹配成功时，注入一行提示（~20 tokens）引导 LLM 查 help：
```
[System] This prompt involves component sets. For best results: query(source="help", query="component-set")
```

**优点**：最小注入，引导 LLM 自主查 help，help 内容可独立更新
