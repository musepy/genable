# E2E 观察报告 — 2026-03-16 四轮连续测试

> 测试模型: kimi-k2.5 | 单会话连续 5 个设计 | 39 轮迭代 | 34 次工具调用 | ~448 节点

## 一、测试概况

4 次 trigger 在同一 agent 会话中连续执行（非 4 个独立会话），agent 在完成第一个任务（PricingTable）后自主生成了 4 个额外设计。

| 设计 | 是否用户要求 | mk 调用数 | 节点数 | 平均 batch | 错误 |
|------|------------|-----------|--------|-----------|------|
| PricingTable | 是 | 3 | 67 | 22.3 | 0 |
| Dashboard | 否（自主） | 9 | 157 | 17.4 | 0 |
| Team Members | 否（自主） | 2 | 117 | 58.5 | 8 failed |
| Food Delivery | 否（自主） | 5 | 96 | 19.2 | 0 |
| Kanban Board | 否（自主） | 5 | 129 | 25.8 | 0 |

## 二、跨设计学习能力分析

### 结论：无真正学习行为

Agent 在同一会话的 5 个设计中**没有展现出系统性学习**。具体证据：

#### 2.1 属性选择：随机波动，非收敛

| 属性 | D1:PT | D2:Dash | D3:Team | D4:Food | D5:Kanban |
|------|-------|---------|---------|---------|-----------|
| `pattern:` vs `layout:` | 18:0 | 0:60 | 33:0 | 0:22 | 0:40 |
| `lucide:*`（不支持） | 12 | 26 | 24 | 13 | 0 |
| `h:hug`/`w:hug` | 0 | 0 | 0 | 32/11 | 40/16 |

- `pattern:` vs `layout:` 来回切换（D1→D2 改、D3 又回、D4→D5 又改），不是从错误学习
- `h:hug`/`w:hug` 在 D4/D5 突然出现，但 D1-D3 从未使用，原因不明
- `lucide:*` icon 语法在 D1-D4 持续使用（共 75 次），每次都被静默丢弃，D5 归零仅因 Kanban 不需要 icon

#### 2.2 批次大小：无收敛趋势

```
D1: 22, 22, 23          （按卡片拆）
D2: 8, 22, 9, 20, 14, 19, 26, 26, 13  （按 section 拆，最佳）
D3: 61, 56              （暴力两批，严重退化）
D4: 21, 11, 28, 27, 9   （按 section 拆，恢复合理）
D5: 21, 36, 27, 18, 27  （按列拆，基本合理）
```

D3 在 D2 之后严重退化到 61 节点/批次。D4/D5 恢复合理，但这是任务结构差异（Food Delivery 天然按区域分），不是从 D3 失败学到教训。

#### 2.3 错误处理：无修复行为

- D3 的 8 个 PARTIAL_FAILURE（`pattern:` + `w:fill` 冲突）→ 未修复就截图结束
- D2 的 4 个 HUG_FILL_CYCLE（含明确修复建议 `patchNode`）→ 完全忽略
- `borderBottom`/`borderColor` 在 D2 出现 12 次被拒 → D3-D5 未再出现，但可能是不需要而非学习

#### 2.4 组件复用：5 个设计零复用

- 0 次 `reusable`
- 0 次 `ref()`
- 0 次 `clone()`
- 0 次 `cp`
- Agent 读了 5 次 examples 帮助文档（含 reusable/ref 示例），但从未应用

#### 2.5 有微弱改善的信号

- D4 首次使用 `stroke:#E5E7EB strokeW:1`（正确）替代 D2 的 `borderBottom`（CSS 错误）
- D3 将 `align:center`（错误）改为 `textAlign:center`（正确）
- D5 首次使用 `lineHeight:'140%'`

**但这些更可能是 LLM 自然输出波动，而非从前序错误学习。**

#### 2.6 根因：上下文架构阻断了跨 turn 学习

上下文的 3 层架构中，`summary` 层只保留语义摘要（"创建了一个 Dashboard"），不保留 batch 语法细节和具体错误信息。每个新 turn 的 `turnMessages` 被清空，agent 看不到前序 turn 的具体操作和错误。**跨 turn 学习在结构上就不可能发生。**

## 三、布局问题 MCP 检查结果

### 严重问题

| 设计 | 节点 | 问题 |
|------|------|------|
| Dashboard | ChartArea (1058:12565) | 无 auto-layout，Header 和 Chart 绝对定位导致**完全重叠** |
| Kanban | 所有 12 个 Avatar | 文字绝对定位 `left:0 top:0`，字母偏左上角而非居中 |

### 中等问题

| 设计 | 节点 | 问题 |
|------|------|------|
| Dashboard | Header (1058:12562) | `items-start` 而非 `items-center`，缺 padding |
| Dashboard | TableArea 表头 | 列宽未与数据行对齐 |
| Team Members | Grid (1058:12720) | 行间距为 0，卡片固定 280px 不 fill |
| Team Members | Card 内容 | `items-start` 但文本 `text-center`，Badge/CTA 左对齐不一致 |
| Kanban | 4 列 | 固定 320px 不 fill，不自适应 |

### 轻微问题

| 设计 | 节点 | 问题 |
|------|------|------|
| Food Delivery | CategoryTabs | Tab 不 fill，右侧留白 |
| Dashboard | Chart bars | 7 个 bar 缺 gap，紧贴 |
| Food Delivery | CountBadge | Icon 和文字缺 gap |

### 布局错误模式

1. **绝对定位滥用**: CSS 心智模型泄露（`absolute` + `left/top`），在 Figma 应全用 auto-layout
2. **固定宽度 vs fill**: 卡片/列用固定 px 而非 fill sizing
3. **`items-start` 遗漏居中**: 容器该用 `items-center` 但默认 `items-start`

## 四、工作流质量

### 工作流混乱点

1. **幽灵设计**: Dashboard turn 开头创建无关 PricingTable（67 节点、5 次调用），EXAMPLES.md 被误当任务
2. **暴力批次**: Team Members 用 2 次 mk 创建 117 节点（61+56），触发 error 未修复
3. **`man` 仪式调用**: 5 次查询相同帮助文档，浪费 5 个迭代
4. **Error 后不修复**: Team Members 8 节点失败 + Dashboard 4 个 HUG_FILL_CYCLE，全部忽略

### 合理之处

- **Dashboard 分步创建最佳**: skeleton → sidebar → header → stats → chart → table rows
- **Kanban 按列拆分**: skeleton+列头 → 逐列填充卡片
- **Food Delivery 按区域**: TopBar → CategoryTabs → MenuList 上/下 → CartBar
- **无创建→编辑浪费**: 所有 mk 调用都是纯创建
- **截图验证**: 每个设计完成后都有 `cat(screenshot:true)` 验证

## 五、当前工具能力 vs 缺失（Unix 类比）

### 已有能力

| 能力 | Unix 等价 | 支持程度 |
|------|----------|--------|
| 批量创建 (batch mk) | heredoc + 多行命令 | 完全 |
| 复制 (cp) | `cp` | 单源→单目标 |
| Glob 匹配 | `ls *.txt` | 仅 `*` 通配符，仅最后一段 |
| 组件实例 (ref) | 符号链接 `ln -s` | 完全（含变体选择） |
| 组件定义 (reusable) | 库/模板 | 完全 |
| 变体矩阵 (clone+variantSet) | 参数化构建 | 完全 |
| 批量样式替换 (replace) | `sed s/old/new/g` | 10 个属性 |
| 富文本 | markdown | 完全 |

### 缺失能力

| 能力 | Unix 等价 | 影响 |
|------|----------|------|
| 循环 | `for i in {1..5}; do ...; done` | 创建 N 个同构节点需手写 N 行 |
| 变量替换 | `$VAR` | 颜色/间距无法参数化复用 |
| 管道组合 | `ls | grep | xargs` | 命令无法链式组合 |
| 多源/多目标克隆 | `cp {a,b,c} dest/` | batch cp 不支持 |
| 条件操作 | `if; then; fi` | 无法条件创建/跳过 |
| 正则匹配 | `ls | grep 'Pattern.*'` | glob 仅 `*`，不支持正则 |
| 跨批次符号 | 环境变量 | 下一批次无法引用上一批次的符号 |
| 模板/宏 | shell function / alias | 相同结构必须重复定义 |

### 重要备注：已有但未被使用的能力

**Agent 完全没有使用以下已存在的能力**:
- `reusable:true` — 定义组件（0 次使用）
- `ref()` — 实例化组件（0 次使用）
- `clone()` — 克隆节点树（0 次使用）
- `cp` — 复制节点（0 次使用）
- `variantSet()` — 创建变体集（0 次使用）

**这意味着当前瓶颈不仅是工具能力缺失，更是 LLM 对已有工具的利用率极低。**

## 六、与目标 Agent 的差距

### 当前状态 vs 目标

| 维度 | 当前 | 目标 |
|------|------|------|
| 任务边界 | 完成后继续自主生成无关设计 | 完成即停，明确 turn 边界 |
| 组件复用 | 0% — 所有重复结构逐个手写 | 自动识别重复模式 → reusable/ref |
| 错误恢复 | 忽略所有错误和修复建议 | 读取 error → 诊断根因 → 修复 |
| 布局质量 | 绝对定位混用、对齐遗漏、固定宽度 | auto-layout first，fill sizing |
| 批次策略 | 从 8 到 61 不等，无一致策略 | 基于复杂度自动决定分步粒度 |
| 上下文利用 | 读 5 次 examples 不用，跨 turn 遗忘 | 单次读取 → 应用 → 跨 turn 记忆 |
| 属性准确性 | CSS 属性泄露（border、align、lucide） | Figma 原生属性，无 CSS 心智模型 |
| Unix 能力利用 | 仅 mk、cat、man | cp/ref/clone/glob/replace 全面使用 |

### 需要重新考虑的架构问题

1. **批次上限**: 当前 20 节点建议值源自 prompt 而非架构硬限制，需要基于实际数据重新定义——可能按属性复杂度而非节点数限制
2. **Prompt/Workflow 重构**: PROGRESSIVE CREATION 规则写了但 LLM 不遵守（D3 暴力批次），需要更强的约束机制或 runtime 拦截
3. **组件复用引导**: 当前 EXAMPLES.md 有 reusable/ref 示例，但 LLM 读了 5 次不用。需要在 WORKFLOW 中加入强制规则：「检测到 3+ 同构节点时必须定义组件」
4. **错误修复闭环**: 当前 error 返回后 agent 可以选择忽略。需要 runtime 级别的 error-aware 机制——error 不修复则不允许进入下一步
5. **Turn 边界控制**: agent 完成任务后不停止，需要 hook 或 runtime 判断任务完成并强制结束 turn
6. **跨 turn 学习**: summary 层丢失了操作细节和错误信息，需要保留关键 pattern（如「pattern: 不可用」「icon 语法被拒绝」）
7. **CSS→Figma 映射**: 在 runtime 层拦截 CSS 属性（`borderBottom`→`stroke`, `align:center`→`textAlign:center`），而非期望 LLM 记住
8. **复杂度自动评估**: 在 design 调用前分析任务复杂度，自动决定分步策略和是否使用组件

### 距离目标的核心差距

**工具层**已经具备足够的能力（reusable、ref、clone、cp、replace 全部可用），但 **LLM 利用率为零**。这说明问题不在工具，而在：

1. **Prompt 约束力不足** — 写了规则但 LLM 不遵守
2. **Runtime 无防护** — 错误可忽略、批次可超标、任务可漂移
3. **上下文架构限制学习** — 跨 turn summary 丢失操作细节
4. **无复杂度感知** — agent 不知道"这个任务有 12 张同构卡片，应该用组件"

这不是单点修复能解决的问题，需要在编排层（AgentRuntime）、上下文管理、prompt 策略三个层面系统性重构。
