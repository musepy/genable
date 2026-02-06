# Figma 插件环境下的 Agent 深度优化方案研究 (Phase 2)

> **目标**: 在 Figma 插件的特殊限制下（40次迭代上限、高延迟 API 调用），实现复杂 UI（如表格、仪表盘）的高效生成。

---

## 一、 Figma 环境的核心瓶颈分析

在 Figma 插件中，Agent 面临的挑战不同于纯代码环境：

1.  **节点序列依赖 (Sequential Dependency)**: 
    *   Figma 节点通常需要先有父节点（Parent ID），才能创建子节点。
    *   **后果**: LLM 倾向于“先创建父容器 -> 等待返回 ID -> 再创建子项”，导致迭代次数随嵌套深度呈线性爆炸。
2.  **SceneGraph 状态不透明**:
    *   LLM 只能看到它“创建”过的节点，无法实时感知插件环境中发生的微小布局变化（如 Auto Layout 自动调整后的坐标）。
    *   **后果**: LLM 会生成冗余的 `setNodeLayout` 调用来“确保”位置正确。
3.  **API 调用成本与粒度错位**:
    *   原子化的操作（如 `setX`, `setY`）在 Figma 中成本高且容易触发不必要的重绘。
    *   **后果**: 每一个琐碎的属性修改都占用一次 Agent 思考周期。

---

## 二、 针对性设计方案：虚拟层与幂等层

### 2.1 方案：虚拟层引用 (Virtual Hierarchical References) —— 解决序列依赖

这是最适合 Figma 的设计。目前我们已有 `opId` + `nodeRef`，应进一步强化：

*   **设计思路**: 引入“零延时嵌套”机制。允许在一次 `batchOperations` 中定义完整的树状结构。
*   **实现建议**:
    ```json
    // 给 LLM 的推荐模式：一站式创建
    {
      "opId": "table", "action": "createNode", "params": { "type": "FRAME" },
      "children": [
        { "opId": "row1", "action": "createNode", "params": { "parentRef": "table" } },
        { "opId": "cell1", "action": "createNode", "params": { "parentRef": "row1" } }
      ]
    }
    ```
*   **收益**: 将 3 次迭代（父->子->孙）压缩为 1 次。

### 2.2 方案：智能幂等补丁库 (Idempotent Patch Layer) —— 解决无条件重复

借鉴 React Virtual DOM 的 Diff 思想：

*   **设计思路**: 在 `toolCallHandler` 层维护一份 `LastScan` 缓存。
*   **实现建议**: 
    1.  Agent 发起 `applyDesignPatch(nodeId, { fills: ['#FF0000'] })`。
    2.  Handler 在执行前检查：`if (cache[nodeId].fills === '#FF0000') return skip()`。
    3.  即使 LLM 因为“怕出错”而重复调用，系统也会在物理层面静默跳过，不消耗任何 Figma API 资源或显式的 API 计数。
*   **收益**: 消除 30% 以上的“保险式”冗余操作。

### 2.3 方案：事务化布局感知 (Transactional Layout Awareness)

*   **设计思路**: 当一个 `batchOperations` 完成后，系统自动返回受影响范围内所有节点的“最新状态快照”。
*   **收益**: LLM 在 Iteration N+1 就能看到 Iteration N 之后精确的坐标和大小，无需再进行“探测式”读取。

---

## 三、 主流方案对比 (Claude Code vs. Figma Context)

| 维度 | Claude Code (文件系统) | Figma Plugin (视觉图谱) | 建议方向 |
| :--- | :--- | :--- | :--- |
| **变更单元** | 文本行 (Diff) | 属性集 (Styles/Layout) | **属性补丁 (Property Patching)** |
| **冲突检测** | 原始字符串匹配 | `expectState` 对比 | **乐观执行 + 状态回写** |
| **状态回显** | Shell 输出 | 节点树 JSON | **增量 DSL 返回** |

---

## 四、 结论与落地建议

对于 Figma 插件，**“多看少动、成批操作”**是核心指南。

1.  **短期内 (Quick Win)**: 
    *   在 `applyDesignPatch` 中实现基于 JSON Hash 的**指纹去重 (Fingertpints)**。
    *   更新 System Prompt，强制 LLM 采用“逻辑组件”作为批处理边界。
2.  **长期计划**:
    *   建立插件侧的 **Shadow Node Tree**。Agent 的所有操作先作用于 Shadow Tree，最后一次性 Sync 到物理 Canvas。

---
*注：本研究旨在提供架构指导，不修改现有 `iteration-limit-and-diff-cache-analysis.md` 文档。*
