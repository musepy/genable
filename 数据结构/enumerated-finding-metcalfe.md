# Figma Agent Prompt 效率与性能分析报告

## 1. 概述

分析对象：嵌套的 Figma 设计 Agent 系统提示词，包含：
- 外层：Claude Code 系统提示词 (~8000+ tokens)
- 内层：Figma Agent 动态组合提示词 (~4000 tokens)

---

## 2. Token 效率分析

### 2.1 当前预算分配

```
core:      20% (1000 tokens) - 身份 + 指令（不可压缩）
tools:     15% (800 tokens)  - 工具定义
examples:  30% (1500 tokens) - 示例（高优先级）
context:   20% (1000 tokens) - RAG 知识（可压缩）
selection: 15% (500 tokens)  - 当前选择（可截断）
```

### 2.2 问题识别

| 问题 | 严重程度 | 位置 |
|------|----------|------|
| **示例占比过高 (30%)** | 中等 | `DEFAULT_TOKEN_RATIOS.examples` |
| **中文 token 估算不准** | 高 | `estimateTokens()` 使用 4 字符/token，中文实际 ~1.5-2 tokens/字 |
| **总预算 4000 过小** | 高 | 17+ 工具场景下可能截断关键信息 |

### 2.3 优化建议

- 将 `examples` 比例从 30% 降至 20%
- 中文字符系数从 0.6 改为 1.5
- 根据工具数量动态调整总预算

---

## 3. LLM 注意力模式分析

### 3.1 优势

| 设计 | 效果 |
|------|------|
| **优先级排序** | `agent-identity` (1) → `mode-guidance` (1.2) → `tool-format` (2) - 关键指令前置 |
| **Phase-based 工具分组** | 清晰的 4 阶段划分帮助 LLM 理解执行顺序 |
| **CRITICAL 标记** | 高信号词引导注意力 |

### 3.2 问题

| 问题 | 严重程度 | 描述 |
|------|----------|------|
| **重复身份声明** | 中等 | `AGENT_CORE_PROMPT` (line 244) 与 `AGENT_IDENTITY` (line 6) 内容重复 |
| **CRITICAL 过度使用** | 中等 | 多处使用导致信号稀释 |
| **指令粒度不一致** | 低 | 有的极具体（HUG requires Auto Layout），有的模糊（Use reasonable defaults） |

### 3.3 注意力友好度评分

```
Primacy (开头重要性):    ★★★★☆  关键指令在前
Recency (结尾重要性):    ★★★☆☆  selection-context 放在中后部
Signal Density:          ★★★☆☆  有效指令/总 token 比例一般
Cognitive Load:          ★★☆☆☆  嵌套结构增加认知负担
```

---

## 4. 矛盾点检测

### 4.1 外层 vs 内层提示词矛盾

| 方面 | 外层 (Claude Code) | 内层 (Figma Agent) | 冲突等级 |
|------|-------------------|-------------------|---------|
| **详细程度** | 鼓励详细解释 | "Be Concise", "Avoid verbose narration" | **高** |
| **工具调用格式** | `<function_calls>` XML | Gemini native function calling | 中等（已通过 provider 处理） |
| **任务跟踪** | TodoWrite 工具 | `new_task`, `update_todo_list` 工具 | 低（不同域） |

### 4.2 内部矛盾

| 位置 | 矛盾描述 |
|------|----------|
| `EXECUTION` mode | 说 "Do NOT update todo lists unless a tool fails"，但期望调用 `summarize_progress` |
| `AGENT_CORE_PROMPT` vs `AGENT_IDENTITY` | 两处定义身份，措辞略有差异 |

---

## 5. 模式切换设计评估

### 5.1 三种模式定义

```
PLANNING:      分析需求，探索 Figma 状态，列出具体步骤
EXECUTION:     严格工具调用，避免文字聊天
VERIFICATION:  验证输出，检查视觉一致性
```

### 5.2 切换逻辑（agentRuntime.ts:462-472）

```typescript
if (plan.length > 0) {
    if (activeStep) {
        mode = 'EXECUTION';
    } else if (plan.every(s => s.status === 'completed')) {
        mode = 'VERIFICATION';
    }
}
```

### 5.3 问题

| 问题 | 影响 |
|------|------|
| **无提前验证入口** | 只有所有步骤完成才进入 VERIFICATION |
| **热切换开销** | 每次迭代重建系统提示词可能导致注意力漂移 |
| **模式边界模糊** | PLANNING 和 EXECUTION 之间的过渡点不够清晰 |

---

## 6. Phase-Based 工具组织有效性

### 6.1 当前分组

```
Phase 1: Information Gathering (Parallel)
  - read: getSelection, getVariables, getStyles, getNodeDSL
  - knowledge: searchDesignKnowledge, getComponentAnatomy, getFigmaLayoutRules

Phase 2: Planning (Sequential)
  - plan: planDesign, new_task, update_todo_list, summarize_progress

Phase 3: Execution (Sequential, respect dependencies)
  - create: createNode, createIcon
  - modify: setNodeLayout, setNodeStyles, updateNodeProperties, applyDesignPatch

Phase 4: Validation (Parallel)
  - validate: validateLayout
```

### 6.2 优势

- 清晰的并行/串行标记
- 依赖提示 `(after: xxx)` 帮助 LLM 理解顺序

### 6.3 问题

| 问题 | 建议 |
|------|------|
| `dependencies` 字段使用不一致 | 标准化所有工具的依赖声明 |
| Phase 4 验证工具单一 | 增加视觉一致性验证工具 |

---

## 7. 中英文混合影响

### 7.1 当前混合情况

- 代码注释：中文（`// 身份 (不可压缩)`）
- 示例用户输入：中文（`User: "优化当前选中的元素布局"`）
- 指令文本：英文

### 7.2 影响评估

| 维度 | 纯英文 | 中英混合 | 影响 |
|------|--------|----------|------|
| Token 估算 | 准确 | **偏差大** | 可能截断重要内容 |
| 模型理解 | 原生 | 跨语言 | 可能稀释注意力 |
| 术语一致性 | 高 | 低 | "HUG" vs "自适应" 等 |

### 7.3 建议

- 系统提示词统一使用英文
- 用户示例可保留双语，但标注语言

---

## 8. 嵌套结构对 LLM 处理的影响

### 8.1 结构可视化

```
┌─────────────────────────────────────────────────┐
│ Claude Code Outer Prompt (~8000+ tokens)        │
│   ├─ Safety rules (安全规则)                    │
│   ├─ Tool definitions (52+ tools)              │
│   └─ Plan mode instructions (规划模式)          │
├─────────────────────────────────────────────────┤
│ Figma Agent Inner Prompt (~4000 tokens)         │
│   ├─ agent-identity                            │
│   ├─ mode-guidance                             │
│   ├─ provider-instructions                     │
│   ├─ tool-format                               │
│   ├─ tool-examples                             │
│   ├─ selection-context                         │
│   └─ optional-knowledge                        │
└─────────────────────────────────────────────────┘
```

### 8.2 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| **上下文窗口饱和** | 高 | 外层+内层可能超过 12000 tokens |
| **指令遮蔽** | 中 | 内层规则可能覆盖外层约束 |
| **注意力碎片化** | 中 | 多层级指令增加处理复杂度 |
| **优先级混乱** | 高 | 无明确声明哪层规则优先 |

### 8.3 建议

- 在内层提示词开头声明与外层的关系
- 减少外层冗余内容（如非必要的安全规则）

---

## 9. 综合评分

| 维度 | 评分 (1-10) | 说明 |
|------|------------|------|
| **Token 效率** | 6/10 | Liquid budgeting 好，但估算不准、预算偏小 |
| **指令清晰度** | 7/10 | Phase-based 分组好，但有重复和矛盾 |
| **LLM 注意力友好度** | 6/10 | 优先级排序好，但嵌套增加负担 |
| **模式切换设计** | 5/10 | 概念清晰，但实现有漏洞 |
| **可维护性** | 7/10 | 模块化设计好，但多处重复 |
| **多语言支持** | 4/10 | 中英混合导致多种问题 |

**总体评分: 5.8/10**

---

## 10. 改进优先级

### P0 (立即)
1. 修复中文 token 估算（`estimateTokens` 函数）
2. 消除 `AGENT_CORE_PROMPT` 与 `AGENT_IDENTITY` 重复

### P1 (1-2 周)
1. 统一系统提示词语言为英文
2. 修复 EXECUTION 模式中的 todo 更新矛盾

### P2 (2-4 周)
1. 增加提前验证入口点
2. 标准化所有工具的 `dependencies` 声明
3. 添加指令层级优先级声明

### P3 (1-2 月)
1. 实现基于任务复杂度的动态 token 预算
2. 建立提示词 A/B 测试框架
3. 引入注意力可视化工具进行优化

---

## 11. 🚨 核心问题：Figma Parent-Child 约束处理不足

### 11.1 Figma 硬性约束

**Figma API 强制规则**：没有 parent 的节点无法拥有子元素。创建子节点时必须提供有效的 `parentId`。

```
Parent 必须先存在 → 才能创建 Child
                    ↓
             parentId 必须是已创建节点返回的真实 ID
```

### 11.2 当前 Prompt 中的相关指导

| 位置 | 内容 | 有效性评估 |
|------|------|-----------|
| `rendererTools.ts:23` | "parent must exist before child" | ✅ 有提及但不够显眼 |
| `rendererTools.ts:140` | `PARENT_NOT_FOUND` 错误定义 | ✅ 有但只是错误恢复 |
| `promptComposer.ts:307-318` | Example 2 示例 | ⚠️ 仅一个示例，位置靠后 |
| `promptComposer.ts:318` | "Always use nodeId from createNode response. Never guess IDs." | ⚠️ CRITICAL 但埋在示例中 |

### 11.3 问题分析：为什么 LLM 仍然出错

#### 问题 1: 并行调用诱惑

LLM 看到多个 `createNode` 调用时，倾向于并行发起：

```typescript
// LLM 错误理解（并行）
createNode({type: "FRAME", name: "Card"})      // 同时发起
createNode({type: "TEXT", name: "Title", parentId: ???})  // parentId 不存在！
```

**根因**: Prompt 中没有在 `createNode` 工具定义的显眼位置说明 **"绝对不能并行创建父子关系的节点"**

#### 问题 2: parentId 的不确定性

当前 `createNode` 定义：
```typescript
parentId: {
  description: 'ID of the parent node (from createNode response). If omitted, adds to current page.'
}
```

**问题**:
- "If omitted, adds to current page" 让 LLM 认为 parentId 是可选的
- 没有强调 **"必须等待前一个 createNode 返回 nodeId 后才能使用"**

#### 问题 3: dependencies 字段形同虚设

```typescript
// createNodeDefinition
dependencies: []  // 空！但实际上 child 依赖 parent

// setNodeLayoutDefinition
dependencies: ['createNode']  // 有，但仅针对 modify 工具
```

**问题**: `createNode` 的 `dependencies` 为空，无法表达 "child createNode 依赖 parent createNode"

#### 问题 4: 示例位置和强度不足

当前示例在 `TOOL_EXAMPLES` 中（priority 3），位置靠后。且只有一个父子创建示例。

**对比**: Error Recovery 示例与 Parent-Child 示例权重相同，但 Parent-Child 是更常见的失败模式。

### 11.4 修复建议

#### P0 级别修复（立即）

**1. 在 `createNode` 工具描述中添加醒目警告**

```typescript
// rendererTools.ts createNodeDefinition.description
description: `
[ATOMIC] Create FRAME, TEXT, RECTANGLE, ELLIPSE, or LINE.

⚠️ SEQUENTIAL CONSTRAINT (Figma Hard Rule):
- When creating parent-child hierarchy, MUST wait for parent's nodeId before creating child
- NEVER call createNode for child in parallel with parent
- parentId MUST be the exact nodeId returned by a previous createNode call

Returns: {nodeId: "124:567"} - Use this exact ID for subsequent child nodes.
`
```

**2. 修改 parentId 参数描述**

```typescript
parentId: {
  type: 'string',
  description: `[BLOCKING DEPENDENCY] Parent node ID from a COMPLETED createNode call.
⚠️ You MUST wait for the parent createNode to return before using this parameter.
If omitted, node is added to current page (no parent).
NEVER use a predicted or placeholder ID.`
}
```

**3. 添加专门的 Parent-Child 规则到 AGENT_IDENTITY**

```typescript
// agentPrompts.ts
export const AGENT_PARENT_CHILD_RULE = `
## PARENT-CHILD CREATION RULE (Figma Hard Constraint)
- Figma nodes cannot have children unless the parent exists first
- When building hierarchies:
  1. Create parent node → Wait for response → Get nodeId
  2. Create child node with parentId = parent's nodeId
- NEVER attempt parallel creation of parent and children
- This is a Figma API limitation, not a suggestion
`;
```

#### P1 级别修复（1-2周）

**4. 增加更多父子创建示例**

```typescript
// 添加到 TOOL_EXAMPLES
### Example 4: Multi-Level Hierarchy (Parent → Child → Grandchild) ⚠️
User: "Create a card with header containing title and icon"

**Step 1 - Root container:**
createNode({type: "FRAME", name: "Card"})
→ Returns: {nodeId: "100:1"} // WAIT for this!

**Step 2 - Child using parent ID:**
createNode({type: "FRAME", name: "Header", parentId: "100:1"})
→ Returns: {nodeId: "100:2"} // WAIT for this!

**Step 3 - Grandchild using child ID:**
createNode({type: "TEXT", name: "Title", parentId: "100:2", characters: "Card Title"})

⚠️ Each step MUST complete before the next starts. NO parallel creation!
```

**5. 在工具分组中添加依赖警告**

```typescript
// promptComposer.ts serializeToolsByPhase
### 🛠 Phase 3: Execution (Sequential, respect dependencies)
⚠️ CRITICAL: createNode calls with parent-child relationships MUST be sequential.
Wait for parent nodeId before creating children.

- **createNode**: Create nodes. Sequential when building hierarchies.
- **setNodeLayout**: Configure Auto Layout (requires nodeId from createNode)
```

#### P2 级别修复（长期）

**6. 实现运行时依赖检测**

在 `agentRuntime.ts` 中增加预检测：

```typescript
// 检测同一批次中的父子关系
function detectParentChildInBatch(toolCalls: LLMToolCall[]): Warning[] {
  const createCalls = toolCalls.filter(tc => tc.name === 'createNode');
  const warnings: Warning[] = [];

  for (const call of createCalls) {
    if (call.args?.parentId) {
      // 检查 parentId 是否引用了同批次中另一个 createNode 的预期结果
      const parentInBatch = createCalls.find(c =>
        c.args?.name === call.args.parentId || // LLM 可能错误使用 name 作为 ID
        c !== call // 任何其他 createNode 都可能是预期的 parent
      );
      if (parentInBatch) {
        warnings.push({
          type: 'PARALLEL_PARENT_CHILD',
          message: `Cannot create "${call.args.name}" in parallel with its potential parent. Must wait for parent nodeId.`
        });
      }
    }
  }
  return warnings;
}
```

### 11.5 修复优先级总结

| 优先级 | 修复项 | 预期效果 |
|--------|--------|----------|
| **P0** | `createNode` 描述添加 SEQUENTIAL CONSTRAINT 警告 | 减少 60%+ 并行创建错误 |
| **P0** | `parentId` 参数描述强化 BLOCKING DEPENDENCY | 让 LLM 理解必须等待 |
| **P1** | 添加 AGENT_PARENT_CHILD_RULE 到身份部分 | 前置关键规则 |
| **P1** | 增加多级层次创建示例 | 强化正确模式 |
| **P2** | 运行时依赖检测 | 防止错误执行 |

---

## 12. 验证方法

完成优化后，通过以下方式验证：

1. **Token 使用率测试**: 对比优化前后的 `estimateTokens` 准确度
2. **任务成功率**: 运行标准测试任务集，比较成功率
3. **模式切换日志**: 检查 PLANNING → EXECUTION → VERIFICATION 过渡是否正确
4. **Parent-Child 创建测试**: 专门测试多层级节点创建场景
   - 测试用例: "创建一个卡片，包含标题、描述和按钮"
   - 预期: 100% 串行创建，无 PARENT_NOT_FOUND 错误
5. **用户反馈**: 收集使用体验评价

---

## 13. 修订后综合评分

| 维度 | 原评分 | 问题识别后评分 | 说明 |
|------|--------|---------------|------|
| **Token 效率** | 6/10 | 6/10 | 无变化 |
| **指令清晰度** | 7/10 | **5/10** | Parent-Child 规则不够显眼 |
| **LLM 注意力友好度** | 6/10 | **4/10** | 关键约束埋在示例中 |
| **模式切换设计** | 5/10 | 5/10 | 无变化 |
| **可维护性** | 7/10 | 7/10 | 无变化 |
| **Figma 约束表达** | N/A | **3/10** | 新增维度，严重不足 |

**修订后总体评分: 5.0/10**

Parent-Child 约束是 Figma Agent 最常见的失败模式之一，当前 prompt 对此的处理严重不足，需要作为 **P0 优先级**立即修复。
