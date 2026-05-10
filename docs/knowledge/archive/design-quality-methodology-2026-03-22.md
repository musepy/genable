# 设计质量分析方法论

> 2026-03-22 session 总结。从 autoresearch 引擎搭建到 padding 遗漏根因分析的完整思路链。

## 1. 问题发现路径

### 1.1 从分数到视觉

benchmark 跑出 `spacingCompleteness: 67%`, `fillCompleteness: 67%` 时，这只是一个数字。
关键步骤是**从分数还原到视觉**：

```
分数异常 → 找到同一 prompt 的多次输出 → 截图对比 → 人眼确认"差在哪"
```

方法：
- 用 Figma MCP (`get_screenshot`) 批量截图同一 prompt 的不同 run
- 肉眼对比"好的"和"差的"，建立直觉：间距挤、没有容器、padding 缺失
- 这一步不能跳过——数字本身不告诉你失败模式的"形状"

### 1.2 从视觉到结构

看到"间距有问题"后，下一步是**量化到节点级别**：

```
截图对比 → Figma MCP get_design_context → 对比节点树的属性差异
```

方法：
- 用 `get_design_context` 拿到完整节点树的 Tailwind 代码
- 对比好的/差的版本在同一层级节点上的属性差异
- 示例发现：好版本的 Toggle Row 有 `p-[16px]`，差版本没有

### 1.3 从结构到分布

发现"有的有 padding 有的没有"后，关键问题是：**这是注意力衰减（前有后无）还是其他模式？**

```
节点属性差异 → 提取 JSX 原文 → 按行号/位置统计属性出现率
```

方法：
- 从 dev bridge 结果目录找到原始 `toolCallDetails` 中的 JSX markup
- 按 JSX 行号将所有 `<frame>` 标签标注 padding/gap/layout/bg 的有无
- 按位置四分位统计覆盖率
- 画出 `[█···················]` 式的位置分布图

### 1.4 从分布到根因

分布分析的结论颠覆了初始假设：

| 假设 | 预测的分布 | 实际分布 | 结论 |
|------|-----------|---------|------|
| 注意力衰减 | 前高后低（如 90%→30%） | **全局均匀**（20% 或 80%） | ✗ 不是衰减 |
| 角色分配不稳定 | 某类节点一致有/无 | Toggle 有 padding，容器没有 | ✓ LLM 对"谁该有 padding"的判断不一致 |

## 2. Agent 行为分析方法论

### 2.1 行为分类

从 dev bridge 的 `toolCallDetails` 提取 tool call 序列，按模式分类：

| 模式 | 序列特征 | 出现率 | 质量特征 |
|------|---------|--------|---------|
| **One-shot** | `man → jsx → inspect` | ~80% | 质量取决于单次 JSX 的注意力分配 |
| **Refine** | `inspect → jsx → inspect → edit ×N → inspect` | ~10% | padding 覆盖率 78-90%（最高） |
| **No-knowledge** | `jsx → inspect` | ~10% | 跳过知识查询，质量随机 |

### 2.2 行为-质量关联

找到行为模式后，**用节点 ID 反向匹配**到具体产出：

```
trigger ID → tree.json 中搜索目标节点 ID → 确认哪个 trigger 创建了哪个设计
→ 比较该 trigger 的 tool call 模式 vs 设计质量
```

关键发现：Refine 模式（14 次 edit）产出的页面 padding 覆盖率 78-90%，One-shot 模式只有 20-50%。
但 GOOD 页面也可能来自 One-shot——说明质量是概率性的，Refine 模式只是提高了下限。

### 2.3 创建归因

多次 benchmark 在同一画布上累积节点时，需要**找首次出现**来确认创建者：

```python
# 按时间排序所有 trigger，找每个节点 ID 的首次出现
for trigger in sorted_by_time:
    if nodeId in tree.json and nodeId not in seen:
        seen[nodeId] = trigger  # 这个 trigger 创建了此节点
```

## 3. 质量度量方法论

### 3.1 三套独立评分（不合并权重）

| 评分系统 | 文件 | 测什么 | 维度 |
|----------|------|--------|------|
| **属性完整性** | `evaluate.ts` | "属性有没有" | layout, text, sizing, spacing, fill, efficiency, errorFree |
| **设计美学** | `designQuality.ts` | "看起来好不好" | hierarchy, spacing consistency, color, typography, structure, weight, coverage, slop |
| **布局质量** | `layoutOracle.ts` (planned) | "布局对不对" | grid, alignment, spacing uniformity, grouping, hierarchy, whitespace, overflow |

### 3.2 Process metrics vs Design metrics

**不要把 process metrics 混入质量判断：**

- `toolEfficiency`（tool calls / nodes 比值）是过程指标，不是设计质量
- `errorFreeRate` 是过程指标
- timeout 的 prompt（`nodes=0`）必须从评分中排除，否则一个 flaky prompt 毁掉整个 run

引擎的 keep/revert 判断只看 design metrics（layout, fill, text, sizing, spacing），不看 process metrics。

### 3.3 方差与阈值

- Kimi K2.5 在相同 prompt 上的分数标准差 ~1.5-2.0 分
- keep 阈值设为 ≥2.0（> 1 sigma）才有统计意义
- ±1 分的变化是噪声，不要当作信号
- 如果 5 个 prompt 的方差 > 3.0，需要增加 prompt 数量

### 3.4 基线管理

- 基线必须在**当前条件下**录制（同一模型、同一画布状态、同一 prompt 集）
- 画布必须在录制前清空（`rm /*`），否则旧节点累积稀释分数
- 每轮 benchmark 前也要清画布，否则评估器计数不准
- 基线过期 = 分数不可比 → 所有 keep/revert 判断失效

## 4. Autoresearch 引擎方法论

### 4.1 核心循环

```
读 baseline → 找最弱维度 → LLM 分析 + 生成结构化编辑
→ 应用到 CORE.md → build → benchmark → 比较维度分数
→ keep（目标维度 ↑≥2 且无回归）/ revert → 记录日志 → 循环
```

### 4.2 安全边界

- LLM 只能通过 `add_rule` / `modify_rule` / `remove_rule` 操作编辑 prompt
- Section 必须存在、`old_pattern` 必须精确匹配一处
- 每次编辑前备份，build 失败自动回滚
- 每 10 轮暂停出 checkpoint，人类审查

### 4.3 已验证的问题

| 问题 | 根因 | 修复 |
|------|------|------|
| toolEfficiency -20 导致误 revert | timeout prompt 的 nodes=0 使比值爆炸 | 排除 process metrics |
| 每轮分数都比 baseline 低 ~7 分 | 基线在不同条件下录制 | 清画布后重录 baseline |
| 节点累积稀释分数 | 画布不在轮次间清空 | 引擎需加清画布步骤 |
| LLM modify_rule 字段缺失 | 模型 JSON 格式不稳定 | 优先 add_rule + 字段名容错 |

### 4.4 LLM 选择

- Kimi K2.5 比 qwen3.5-plus 格式稳定性更好（edit 成功率 100% vs 33%）
- 分析 prompt 需要较强推理能力，不要用 Flash 级模型
- DashScope coding plan API (`coding.dashscope.aliyuncs.com`) 支持 Kimi K2.5

## 5. 关键发现摘要

### 5.1 Padding 遗漏是"角色分配"问题，不是"注意力衰减"

- 分布证据：padding 覆盖率在 JSX 的前/中/后段均匀，不是前高后低
- 真实模式：LLM 有时只给 Toggle 组件加 padding（因为它是"可交互元素"），跳过容器 frame
- 不同 run 的覆盖率差异巨大（20% vs 80%），但同一 run 内部均匀 → 是全局决策，不是逐节点衰减

### 5.2 Refine 模式是天然的质量补全机制

- Agent 自发出现的 `inspect → jsx → inspect → edit ×14 → inspect` 模式
- Padding 覆盖率：Refine 78-90% vs One-shot 20-50%
- 但只有 ~10% 的 run 自发出现 → 如果能引导为标准行为，spacing 问题基本解决

### 5.3 Persistent Memory 是隐性质量因子

- `_token_snapshot` 注入了完整的设计系统 context（72 colors + 12 fonts + 25 spacing tokens）
- 中文记忆（layout lessons, node leakage）可能影响 agent 行为
- Autoresearch 引擎测量的是 CORE.md + memory + token snapshot 的综合效果，不只是 CORE.md

### 5.4 Agent 行为与质量的关系是概率性的

- One-shot 模式也能产出 GOOD 页面（36279），只是概率低
- Refine 模式提高的是**下限**，不是上限
- man 知识查询对间距质量几乎无影响（GOOD 页面的 man 调用失败了）

## 6. 下一步方向

1. **引导 Refine 模式**：在 CORE.md 或 WORKFLOW.md 中加规则，让 agent 在创建后主动 inspect + edit 补全 spacing
2. **CORE.md spacing 规则更新**：明确"哪些 frame 必须有 padding"——容器 frame（有子节点）≠ 组件 frame（如 Toggle）
3. **引擎改进**：清画布步骤、token snapshot 影响隔离、prompt 数量增加到 10 个
4. **Phase B (Design Critic Agent)**：Refine 模式数据验证了运行时 oracle 的可行性
