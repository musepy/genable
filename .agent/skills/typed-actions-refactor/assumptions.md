# 假设、风险与置信度

> 记录本次重构的核心假设和竞争方案评估。  
> 每个假设用 🟢🟡🔴 标注置信度（高/中/低）。

---

## 核心假设

### H1: Gemini 能直接使用 Figma 原生属性名 🟢 置信度高

**依据**：
- Gemini 3 Flash 在 Function Calling 中对准确的 JSON schema 遵从度很高
- Figma Plugin API 属性名（`layoutMode`, `itemSpacing`, `cornerRadius`）是常见英语单词组合，模型语料中有大量相关内容
- 当前 DSL 的属性名和 Figma 原生名 90%+ 完全一致

**验证方式**：在 system prompt 中提供属性速查表，小规模测试 Agent 输出正确率

**风险**：`itemSpacing` vs 人类习惯的 `gap` 可能导致模型偶尔用错名字 → 可通过 ActionValidator 纠正

---

### H2: 去掉 TreeReconstructor 不会影响批量创建能力 🟢 置信度高

**依据**：
- TreeReconstructor 做的是 flat list → tree，而 ActionExecutor 处理的是有序 action list
- Agent 可以用 `tempId` + `parentId` 建立层级关系，执行器按序执行时自然建立子树
- 这和 Gemini CLI 的 `write_file` + `run_command` 模式类似 — 有序不需要 tree

**验证方式**：对比创建相同 UI 时的输出 token 数和成功率

---

### H3: Action list 模式下 Agent 的犯错率会降低 🟡 置信度中

**依据**：
- 减少翻译层意味着更少的 silent correction，Agent 获取的错误反馈更直接
- `updateProps` 比 `patch_node`(DSL) 更接近模型日常训练中见到的 API 调用模式

**不确定性**：
- 模型可能会 hallucinate 不存在的 Figma 属性名
- 没有 Normalizer 做兜底时，错误可能直接暴露给用户

**验证方式**：Phase 3 Shadow Run 中统计错误率

---

### H4: 读写分离可以解决 context overflow 问题 🟡 置信度中

**依据**：
- 当前 overflow 主要因 `read_node(hierarchy)` 返回完整 DSL tree
- 如果 read path 独立于 write path，可以为 read 做专门的压缩而不影响写入
- Agent 不再需要"读回完整 DSL 来验证输出格式是否正确"

**不确定性**：
- 即使分离了，Agent 仍可能频繁调 `read_node` 来验证操作结果
- 需要配合 toolResultCleaner 改进才能真正解决

---

## 竞争方案比较

### 方案 A: 修补现有 DSL Pipeline

| 维度 | 评分 |
|------|------|
| 实现速度 | ⭐⭐⭐⭐⭐ 快 |
| 长期维护 | ⭐⭐ 差 — 翻译层依然存在 |
| 错误面 | ⭐⭐ 大 — 6 层翻译不变 |
| Token 效率 | ⭐⭐⭐ 中等 |

做法：仅修复 context overflow（toolResultCleaner + NodeSerializer depth 限制）

### 方案 B: Typed Actions（本方案）

| 维度 | 评分 |
|------|------|
| 实现速度 | ⭐⭐⭐ 中等（2-3 周） |
| 长期维护 | ⭐⭐⭐⭐⭐ 好 — 1 层翻译 |
| 错误面 | ⭐⭐⭐⭐ 小 |
| Token 效率 | ⭐⭐⭐⭐ 好 |

### 方案 C: 完全拥抱 Figma REST API 格式

| 维度 | 评分 |
|------|------|
| 实现速度 | ⭐ 很慢 |
| 长期维护 | ⭐⭐⭐⭐⭐ 最好 |
| 错误面 | ⭐⭐⭐⭐⭐ 最小 |
| Token 效率 | ⭐⭐ 差 — Figma API 很 verbose |

> [!NOTE]
> **选择方案 B**：平衡了实现速度和架构质量。方案 C 的 Figma API 太 verbose，不适合 token-budget 受限的 Agent。

---

## 开放问题（待决策）

1. **`fills` 格式**：hex 数组 vs Figma Paint 对象？
   - 当前倾向：hex 数组 + executor 内部转换（Agent 输出更简洁）
   
2. **`padding` 便捷字段**：保留 `padding: 16` 统一设置？
   - 当前倾向：保留，executor 展开为 4 个 padding 字段
   
3. **迁移策略**：Shadow Run 并行 vs 直接替换？
   - 当前倾向：Shadow Run（更安全，但要做两套路由）

4. **read_node 的返回格式是否也要改**？
   - 当前倾向：暂不改，read path 的 DSL 仍然对 Agent 友好

---

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-02-28 | DSL 退为只读层 | 写入路径 6 层翻译是过度设计，40+ props 仅 4 个需要 key 翻译 |
| 2026-02-28 | 选择 Typed Actions 而非完全 REST API | Balance token budget vs 架构纯净度 |
| 2026-02-28 | 保留 fills/padding 便捷字段 | Agent 输出简洁性优先于 API 纯净性 |
