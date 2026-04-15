# 错误处理与回滚策略：Pencil vs 我们

> 研究对象：batch_design 的两级容错模型 vs 我们 createExecutor 的 continue 策略
> 来源：Pencil MCP batch_design tool description + 我们的 createTool.ts

---

## 一、Pencil 的两级容错模型

从 `batch_design` tool description 中确认：

### 1.1 硬失败 → 全回滚

> "If one of the operations fails, all previously executed operations in that block will be rolled back."
> "Operations execute sequentially; on error, all operations in the list will be rolled back."

操作执行出错（节点不存在、属性无效等）→ 整个 batch 的所有已执行操作撤销，画布恢复到调用前状态。

### 1.2 软问题 → 不回滚，返回警告

> "A list of potential issues will be returned in the response message. Try to fix them in the next batch_design call."

操作执行成功但存在潜在问题（推测：布局溢出、文本不可见、`fill_container` 在无 layout 父节点下无效等）→ 保留结果，附带警告列表，LLM 在下一次 batch_design 里修复。

### 1.3 两级对照

| 级别 | 触发条件 | 画布状态 | LLM 下一步 |
|------|---------|---------|-----------|
| 硬失败 | 操作执行出错 | 全回滚，恢复原样 | 改错，重写整个 batch |
| 软问题 | 操作成功但有隐患 | 保留，不回滚 | 下一个 batch_design 里修复 |

---

## 二、我们的 continue 策略

来自 `createTool.ts`：

```typescript
const onError = 'continue';
const rollbackMode = 'none';
```

只有一级——部分失败时成功的保留，失败的报错：

```typescript
// 返回给 LLM 的结构
{
  idMap: { "Card": "200:1", "Title": "200:2" },  // 成功的
  created: 7,
  failed: 3,
  errors: [{ op: "line8", error: "..." }]         // 失败的
}
```

tool description 里的指引：

```
## Handling partial failures
DO NOT regenerate the entire design on partial failure. Instead:
1. Check the errors array to identify which specific operations failed.
2. Use the idMap to reference nodes that were successfully created.
3. Call create again with ONLY the corrected failed operations, using real Figma IDs from idMap as parent references.
```

---

## 三、对比分析

### 3.1 失败路径的 LLM 认知负担

| 任务 | Pencil（全回滚） | 我们（保留成功） |
|------|----------------|----------------|
| 理解当前状态 | 简单——画布和调用前一样 | 复杂——画布上有半成品，需要理解 idMap |
| 决定下一步 | 简单——改错，重写全部 | 复杂——读 errors + 读 idMap + 确定 parentId + 只补失败部分 |
| 出错概率 | 低——重写是简单任务 | 高——拼接容易再次出错，可能需要多轮修复 |

### 3.2 成本分析

**直觉上**：我们保留成功部分更"高效"——不用重复创建已成功的节点。

**实际上**：Pencil 的全回滚可能整体更优——

1. **失败是小概率事件。** 大部分 batch 全部成功，回滚路径很少走。
2. **我们的 partial failure 指引是永久成本。** tool description 里的 3 条规则每次 LLM 调用都要读，不管有没有失败。占 system prompt token + 注意力。
3. **补建失败部分比重写全部更难。** LLM 需要拼接 parentId、理解半成品状态，容易再次出错，可能花 2-3 轮才修好。而 Pencil 的"改一行重写"是简单任务，一轮搞定。
4. **重写的 token 成本有限。** 一个 25 ops 的 batch 重写大概几百 token，远小于多轮修复的累计成本。

**结论**：Pencil 的选择不是"用 token 换简单性"，而是"在所有场景下都更简单，且总成本可能更低"。

### 3.3 我们的 anomalies 雏形

我们在 createExecutor 里有类似 Pencil 软问题的机制：

```typescript
if (Array.isArray((result as any).anomalies) && (result as any).anomalies.length > 0) {
  receipt.anomalies = (result as any).anomalies.slice(0, 5);
}
```

但没有 Pencil 那么明确地分层——anomalies 和 errors 混在同一个返回结构里，LLM 不容易区分"需要回滚重做"和"继续做但顺便修一下"。

---

## 四、潜在改进方向

### 方案 A：引入回滚能力

将 `rollbackMode` 改为 `'all'`，失败时撤销所有已创建节点。简化 tool description（删掉 partial failure 的 3 条规则）。

- 优点：LLM 认知负担大幅降低，失败处理更可靠
- 代价：需要实现回滚逻辑（删除已创建的节点），重写时多花几百 token
- 适合场景：失败率低时（大部分 batch 全部成功）

### 方案 B：明确区分硬失败和软问题

保留 continue 策略，但在返回结果里明确分层：

```typescript
{
  idMap: {...},
  created: 7,
  warnings: [{ node: "200:3", issue: "frame has align but no layout" }],  // 软问题
  errors: [{ op: "line8", error: "invalid property" }]                     // 硬失败
}
```

LLM 对 warnings 可以在后续步骤修复，对 errors 需要立即处理。

### 方案 C：混合策略

- 失败数 ≤ 2 → continue，保留成功的，只补失败的（简单修复）
- 失败数 ≥ 3 → 全回滚，重写（复杂修复不如重来）

---

## 五、总结

| 维度 | Pencil | 我们 | 评价 |
|------|--------|------|------|
| 硬失败 | 全回滚 | 保留成功，报错失败 | Pencil 更简单可靠 |
| 软问题 | 保留 + 警告列表 | anomalies（雏形） | 方向一致，我们可加强 |
| LLM 认知负担 | 低 | 高 | Pencil 更优 |
| Token 效率 | 失败时重写浪费少量 | 每次调用都付 partial failure 指引成本 | 综合可能 Pencil 更优 |
| 实现复杂度 | 需要回滚能力 | 当前实现简单 | 我们更简单（但代价转嫁给 LLM） |
