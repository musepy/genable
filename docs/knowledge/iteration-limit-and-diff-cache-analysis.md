# 迭代次数触顶与 Diff 缓存机制分析

> 创建时间: 2025-02-06
> 更新时间: 2025-02-06
> 分析范围: 迭代触顶根因分析 + 主流 AI Agent 状态管理对比研究

---

## 更新日志

### 2025-02-06: inspectDesign 循环检测误触发修复

**问题**: `inspectDesign` 工具被循环检测器误判为"相同操作"，导致任务提前终止。

**修复内容** (agentRuntime.ts):

1. **签名生成改进** (第 1225-1231 行):
   - 新增 `inspectDesign` 的指纹处理，包含 `mode` 和 `depth` 参数
   - 签名从 `inspectDesign[nodeId]` 变为 `inspectDesign[nodeId|mode:hierarchy|depth:5]`

2. **智能截断** (第 1488-1521 行):
   - 保留子节点骨架结构（id, name, type）最多 2 层深度
   - 每层最多保留 20 个子节点
   - Agent 可以看到子节点结构，避免盲目重复调用

---

## 一、问题概述

### 1.1 现象描述

- **迭代次数触顶 (Max Iteration 40)**: Agent 在执行复杂表格（如 Scorecard）设计任务时，达到 40 次迭代上限并报错退出
- **批处理优化失效**: 即便有 `autoBatchToolCalls` 机制，仍无法有效降低迭代次数
- **applyDesignPatch 无 diff 缓存**: 对布局/样式/属性无条件重复应用，导致循环或多余工具调用

### 1.2 根本原因

| 问题层面 | 具体问题 | 影响 |
|---------|---------|------|
| **架构层** | `autoBatchToolCalls` 只处理单响应内的批处理 | 无法跨迭代优化 |
| **门槛层** | `toolCalls.length < 2` 直接返回 | 单工具调用无法优化 |
| **Prompt层** | 缺乏复杂组件的批处理示例 | LLM 不知道如何正确批处理 |
| **认知层** | LLM 过度拆解任务粒度 | 每个原子操作 = 1 次迭代 |
| **状态层** | 无 patch 指纹缓存 | 重复操作无法检测和跳过 |
| **约束层** | Figma 父子创建顺序限制 | LLM 保守执行，不敢并行 |

---

## 二、现有机制分析

### 2.1 自动批处理机制 (`autoBatchToolCalls`)

**位置**: `agentRuntime.ts` 第 259-286 行

```typescript
private autoBatchToolCalls(toolCalls: LLMToolCall[], mode: AgentMode): LLMToolCall[] {
  if (mode !== 'EXECUTION') return toolCalls;
  if (!toolCalls || toolCalls.length < 2) return toolCalls;  // ⚠️ 问题1

  const batched: LLMToolCall[] = [];
  let buffer: LLMToolCall[] = [];

  for (const tc of toolCalls) {
    if (this.AUTO_BATCH_TOOL_NAMES.has(tc.name)) {
      buffer.push(tc);
      continue;
    }
    flush();  // ⚠️ 问题2：遇到非批处理工具会中断
    batched.push(tc);
  }
  flush();
  return batched;
}
```

**问题点**:

1. **门槛过高**: 需要 LLM 在同一响应中生成 2+ 工具调用才能触发
2. **无法跨迭代合并**: 如果 LLM 每次只生成 1 个工具调用，自动批处理完全失效
3. **中断逻辑**: 遇到非 `AUTO_BATCH_TOOL_NAMES` 的工具会 flush 缓冲区

### 2.2 迭代消耗模式（典型案例）

```
Iteration 13: createNode (row-1)
Iteration 14: setNodeLayout (row-1)
Iteration 15: createNode (cell-1-1)
Iteration 16: createNode (cell-1-2)
Iteration 17: setNodeLayout (cell-1-1)
Iteration 18: applyDesignPatch (cell-1-1)  // 可能是重复的
...
```

**问题**:
- 每个原子操作占用一次迭代
- `createNode` 和 `setNodeLayout` 被分成不同迭代
- `applyDesignPatch` 可能重复应用相同样式

### 2.3 applyDesignPatch 缺乏幂等性

```typescript
// 当前：无条件执行
applyDesignPatch({
  patches: [
    { nodeId: "123", styles: { fill: "#FF0000" } }
  ]
})
// 即使节点已经是 #FF0000，仍然执行 API 调用并消耗迭代
```

---

## 三、主流 AI 编码 Agent 对比研究

### 3.1 Claude Code

| 特性 | 实现方式 |
|------|---------|
| **主循环** | 单线程 while 循环，工具调用时继续，纯文本响应时终止 |
| **状态持久化** | `memory.md` + `todo.md` 存储在磁盘，上下文压缩时保留 |
| **Diff 机制** | `Edit` 工具使用 `old_string → new_string` 精确替换 |
| **操作去重** | 通过审计轨迹（audit trail）跟踪所有变更，支持回滚 |
| **上下文管理** | 92% 使用率时触发压缩，关键状态转移到 Markdown 文档 |

**关键洞察**: Claude Code 的 Edit 工具**天然具有幂等性**——如果 `old_string` 已经变成了 `new_string`，操作会失败而不是重复执行。这是一种**隐式的 no-op 检测**。

**来源**: [ZenML LLMOps Database](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding)

### 3.2 Cline

| 特性 | 实现方式 |
|------|---------|
| **双工具模式** | `write_to_file`（全量覆盖）+ `replace_in_file`（差异编辑） |
| **Diff 算法** | Order-invariant multi-diff apply，支持乱序 diff 块 |
| **多格式支持** | Anthropic 用 `--/+++`，Gemini/xAI 用 `>>>/<<<` |
| **变更追踪** | 所有修改记录在 VS Code Timeline，支持回滚 |
| **成功率优化** | 通过评估框架持续优化，Sonnet 达 96.2% diff 成功率 |

**关键洞察**: Cline 的 `replace_in_file` 如果找不到匹配的旧内容，会**报告失败而非静默执行**。这防止了重复应用相同的补丁。

**来源**: [Cline Blog](https://cline.bot/blog/improving-diff-edits-by-10)

### 3.3 Roo Code

| 特性 | 实现方式 |
|------|---------|
| **模式隔离** | Architect/Code/Debug/Ask 模式，每个模式限制可用工具 |
| **跨模式上下文** | 智能提示管理保持会话一致性 |
| **任务记忆** | 自动持久化上下文，支持多轮编码会话 |
| **Sticky Models** | 每个模式保留状态偏好 |

**关键洞察**: 通过**模式级别的工具限制**减少无效操作。

### 3.4 对比总结

| 特性 | Claude Code Edit | Cline replace_in_file | 我们的 applyDesignPatch |
|------|-----------------|----------------------|---------------------|
| **前置检查** | ✅ old_string 必须存在 | ✅ 搜索文本必须匹配 | ❌ 无 |
| **幂等性** | ✅ 相同操作不重复执行 | ✅ 已应用的 diff 会失败 | ❌ 无限重复 |
| **变更追踪** | ✅ 审计轨迹 | ✅ Timeline 记录 | ❌ 无 |
| **No-op 检测** | ✅ 隐式（匹配失败） | ✅ 隐式（匹配失败） | ❌ 无 |

---

## 四、学术界前沿方案

### 4.1 Agentic Plan Caching (APC)

**核心思想**: 将计划阶段与执行阶段分离缓存

```
新任务 → 提取关键词 → 精确匹配缓存 → 命中？
                                    ↓ 是
                         轻量 LM 适配计划模板 → 执行
                                    ↓ 否
                         完整规划 → 执行 → 提取模板 → 存入缓存
```

**效果**: 成本降低 46.62%，准确率保持 96.67%

**来源**: [arXiv - Agentic Plan Caching](https://arxiv.org/html/2506.14852v1)

### 4.2 Tool Cache Agent

专门针对工具调用的缓存系统：

| 组件 | 功能 |
|------|------|
| **缓存键** | 工具名 + 规范化参数哈希 |
| **过期策略** | 工具级别的 TTL 配置 |
| **失效规则** | 跨工具依赖追踪，状态变更时级联失效 |
| **智能判断** | 区分确定性工具（可缓存）和易变工具（不缓存） |

**来源**: [OpenReview - Tool Cache Agent](https://openreview.net/forum?id=tX3YcbNa5w)

### 4.3 Prompt Caching

主流 LLM 提供商（OpenAI、Anthropic、Google）的内置功能：
- 复用之前计算的 KV 张量
- API 成本降低 41-80%
- TTFT 改善 13-31%

**来源**: [arXiv - Don't Break the Cache](https://arxiv.org/html/2601.06007)

---

## 五、推荐解决方案

### 5.1 方案 1：Patch 指纹缓存（轻量级）

**复杂度**: 低 | **开发时间**: 2-3 小时 | **无 API 改动**

```typescript
// 会话级别的 patch 指纹缓存
class PatchCache {
  private appliedPatches = new Map<string, Set<string>>();

  private normalizeAndHash(nodeId: string, patch: any): string {
    // 规范化：排序键、移除 undefined、数值精度对齐
    const normalized = JSON.stringify(patch, Object.keys(patch).sort());
    return `${nodeId}:${hashString(normalized)}`;
  }

  shouldApply(nodeId: string, patch: any): boolean {
    const fingerprint = this.normalizeAndHash(nodeId, patch);
    const nodePatches = this.appliedPatches.get(nodeId) || new Set();

    if (nodePatches.has(fingerprint)) {
      console.log(`[PatchCache] Skip no-op: ${fingerprint}`);
      return false;
    }

    nodePatches.add(fingerprint);
    this.appliedPatches.set(nodeId, nodePatches);
    return true;
  }

  invalidate(nodeId: string): void {
    this.appliedPatches.delete(nodeId);
  }

  clear(): void {
    this.appliedPatches.clear();
  }
}

// 使用示例
const patchCache = new PatchCache();

async function applyDesignPatchWithCache(patches: Patch[]): Promise<Result> {
  const results = [];
  let skippedCount = 0;

  for (const patch of patches) {
    if (!patchCache.shouldApply(patch.nodeId, patch)) {
      results.push({ nodeId: patch.nodeId, status: 'skipped', reason: 'duplicate' });
      skippedCount++;
      continue;
    }

    // 执行实际的 patch 操作
    const result = await executeDesignPatch(patch);
    results.push(result);
  }

  return {
    results,
    skippedCount,
    message: skippedCount > 0 ? `Skipped ${skippedCount} duplicate patches` : undefined
  };
}
```

### 5.2 方案 2：节点状态快照对比（中等复杂度）

**复杂度**: 中 | **开发时间**: 1 天 | **需要额外 Figma API 调用**

```typescript
// 执行前获取节点当前状态，对比后跳过 no-op
async function applyDesignPatchWithDiff(patches: Patch[]): Promise<Result> {
  const results = [];

  for (const patch of patches) {
    // 获取节点当前状态
    const currentState = await getNodeProperties(patch.nodeId);
    const changes = computeActualChanges(currentState, patch);

    if (Object.keys(changes).length === 0) {
      results.push({
        nodeId: patch.nodeId,
        status: 'no-op',
        skipped: true,
        reason: 'Node already has desired state'
      });
      continue;
    }

    // 只应用实际变更
    await applyChanges(patch.nodeId, changes);
    results.push({
      nodeId: patch.nodeId,
      status: 'applied',
      changes,
      changedProperties: Object.keys(changes)
    });
  }

  return {
    results,
    skippedCount: results.filter(r => r.skipped).length,
    appliedCount: results.filter(r => !r.skipped).length
  };
}

function computeActualChanges(current: any, patch: any): any {
  const changes: any = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'nodeId') continue;

    // 深度比较，考虑数值精度（Figma 使用浮点数）
    if (!deepEqual(current[key], value, { tolerance: 0.01 })) {
      changes[key] = value;
    }
  }

  return changes;
}

function deepEqual(a: any, b: any, options: { tolerance?: number } = {}): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;

  // 数值比较（考虑精度）
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < (options.tolerance || 0.001);
  }

  // 数组比较
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i], options));
  }

  // 对象比较
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key], options));
  }

  return false;
}
```

### 5.3 方案 3：声明式 Patch（Claude Code 风格）

**复杂度**: 高 | **开发时间**: 2-3 天 | **需要改 LLM prompt 和工具定义**

```typescript
// 类似 Claude Code 的 old_string → new_string 模式
interface DeclarativePatch {
  nodeId: string;
  expect?: Partial<NodeProperties>;  // 期望的当前值（可选）
  apply: Partial<NodeProperties>;    // 要设置的新值
}

export const applyDeclarativePatchDefinition: ToolDefinition = {
  name: 'applyDeclarativePatch',
  category: 'modify',
  description: `
[SUPER TOOL] Apply changes with optional state expectation.
If 'expect' is provided and doesn't match current state, returns conflict error.
If current state already equals 'apply', returns no-op without changes.
`,
  parameters: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'Target node ID' },
            expect: {
              type: 'object',
              description: 'Expected current state (optional, for conflict detection)'
            },
            apply: {
              type: 'object',
              description: 'Desired final state'
            }
          },
          required: ['nodeId', 'apply']
        }
      }
    },
    required: ['patches']
  }
};

// 执行逻辑
async function executeDeclarativePatch(patch: DeclarativePatch): Promise<PatchResult> {
  const current = await getNodeProperties(patch.nodeId);

  // 1. 冲突检测（如果提供了 expect）
  if (patch.expect) {
    const conflicts = findConflicts(current, patch.expect);
    if (conflicts.length > 0) {
      return {
        nodeId: patch.nodeId,
        status: 'conflict',
        conflicts,
        message: `Expected state doesn't match. Conflicts: ${conflicts.join(', ')}`
      };
    }
  }

  // 2. No-op 检测
  const changes = computeActualChanges(current, patch.apply);
  if (Object.keys(changes).length === 0) {
    return {
      nodeId: patch.nodeId,
      status: 'no-op',
      message: 'Node already has desired state'
    };
  }

  // 3. 执行变更
  await applyChanges(patch.nodeId, changes);
  return {
    nodeId: patch.nodeId,
    status: 'applied',
    changes
  };
}
```

### 5.4 方案 4：增强 Prompt 指导（无代码改动）

在 `EXECUTION` 模式的 prompt 中添加批处理示例：

```typescript
export const BATCH_PATTERN_EXAMPLES = `
## TABLE/SCORECARD BATCH PATTERN (MANDATORY)

When creating table-like structures:
1. Use ONE batchOperations call per ROW (not per cell)
2. Include ALL cells of a row + their layout in the same batch
3. Example for a 3-column row:

\`\`\`json
{
  "operations": [
    { "opId": "row", "action": "createNode", "params": { "type": "FRAME", "name": "Row-1" } },
    { "opId": "cell-1", "action": "createNode", "params": { "type": "FRAME", "parentRef": "row" } },
    { "opId": "cell-2", "action": "createNode", "params": { "type": "FRAME", "parentRef": "row" } },
    { "opId": "cell-3", "action": "createNode", "params": { "type": "FRAME", "parentRef": "row" } },
    { "opId": "layout-row", "action": "setNodeLayout", "params": { "nodeRef": "row", "layoutMode": "HORIZONTAL" } }
  ]
}
\`\`\`

4. ANTI-PATTERN: Creating each cell in separate iterations = WRONG
5. ANTI-PATTERN: Calling applyDesignPatch multiple times with same styles = WRONG

## PATCH DEDUPLICATION RULE
- Before calling applyDesignPatch, verify the change is necessary
- If you already applied a style in this session, DO NOT apply it again
- If unsure, skip the patch and move to the next task
`;
```

---

## 六、与迭代触顶的直接关联

| 问题 | 影响 | 解决后的收益 |
|------|------|------------|
| 重复 patch 无条件执行 | 每次重复 = 1 次迭代消耗 | 消除 20-40% 的无效迭代 |
| LLM 不知道当前状态 | 生成冗余的"保险"操作 | 减少 LLM 的保守行为 |
| 无法检测循环 | 相同 patch 反复应用 | 提前终止循环 |
| 单工具调用不触发批处理 | 每个操作 = 1 次迭代 | 通过缓冲合并降低迭代 |

**预估效果**: 结合 Patch 缓存 + 批处理优化，可将 Scorecard 这类复杂组件的迭代次数从 40+ 降低到 15-20 次。

---

## 七、实施优先级

| 优先级 | 方案 | 开发时间 | 预期收益 | 风险 |
|-------|------|---------|---------|------|
| P0 | 方案 1 (Patch 指纹缓存) | 2-3h | 中高 | 低 |
| P0 | 方案 4 (增强 Prompt) | 1h | 中 | 无 |
| P1 | 方案 2 (节点状态对比) | 1d | 高 | 中（额外 API 调用） |
| P2 | 方案 3 (声明式 Patch) | 2-3d | 非常高 | 中（需要 prompt 改动） |

---

## 八、参考资料

### 主流 Agent 架构

- [ZenML - Claude Code Agent Architecture](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding)
- [Cline Blog - Improving Diff Edits by 10%](https://cline.bot/blog/improving-diff-edits-by-10)
- [GitHub - Cline Source Code](https://github.com/cline/cline)
- [Cline Tools Guide](https://docs.cline.bot/exploring-clines-tools/cline-tools-guide)

### 学术研究

- [arXiv - Agentic Plan Caching](https://arxiv.org/html/2506.14852v1)
- [OpenReview - Tool Cache Agent](https://openreview.net/forum?id=tX3YcbNa5w)
- [arXiv - Don't Break the Cache](https://arxiv.org/html/2601.06007)

### Figma API

- [Figma Plugin API - NodeChange](https://www.figma.com/plugin-docs/api/NodeChange/)
- [Figma Plugin API - DocumentChange](https://www.figma.com/plugin-docs/api/DocumentChange/)
- [Figma Plugin API - Editing Properties](https://www.figma.com/plugin-docs/editing-properties/)

---

## 九、后续行动项

- [ ] 实现 PatchCache 类并集成到 toolCallHandler
- [ ] 在 applyDesignPatch 返回值中增加 skipped 统计
- [ ] 添加 TABLE/SCORECARD 批处理示例到 EXECUTION prompt
- [ ] 评估节点状态对比的 API 调用开销
- [ ] 设计 PatchCache 的失效策略（节点删除、父节点变更等）
