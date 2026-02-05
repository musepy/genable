# 研究报告：生成失败日志分析 (Generation Failure Analysis)

**日期**: 2026-01-20
**来源**: 用户提供的 Chrome Console 日志
**主题**: "Empty Children" 导致的级联截断故障 (The Cascade Failure of Empty Children to Truncation)

## 1. 现象描述 (Phenomenon)

通过分析提供的日志，我们观察到一个非常一致的故障模式 (Failure Pattern)。该模式通常包含两个阶段：

### 阶段一：结构性违规 (Structural Violation)
在第一次生成尝试中，模型虽然输出了完整的 JSON (ADJACENCY_LIST)，但未能通过系统的结构校验。
- **错误**: `Structural violation (empty children) detected on attempt 1.`
- **含义**: 模型生成了一个容器节点 (如 FRAME)，但 `children` 数组为空，或者没有任何子节点链接到它。这违反了我们对“容器必须包含内容”的隐式或显式约束。

### 阶段二：致命截断 (Fatal Truncation)
系统触发重试机制 (Attempt 2 & 3)，试图修复上述结构错误。然而，后续的尝试均以更严重的错误告终。
- **错误**: `Fatal truncated output detected` (Raw input length: 0)
- **最终报错**: `ChatError: ⚠️ 设计太复杂，输出被截断`
- **含义**: 在尝试修复结构错误时，模型似乎陷入了某种输出陷阱，导致回复被强制切断（达到 token 上限）或输出为空。

## 2. 假设树 (Hypothesis Tree)

| ID | 假设 (Hypothesis) | 置信度 | 理由 (Rationale) |
| :--- | :--- | :--- | :--- |
| **H1** | **过度纠正导致膨胀 (Over-correction Inflation)** | **90%** | (已验证) 代码显示重试 Prompt 要求 "Every container MUST have nested content"。当模型试图填充所有空容器时，内容量激增，导致 Token 溢出。 |
| **H2** | **ADJACENCY_LIST 格式的脆弱性** | **60%** | 邻接表格式要求显式的 ID 引用。如果模型在第一次尝试中未能正确建立父子链接 (Parent-Child Links)，系统会将其视为 "empty children"。 |
| **H3** | **Prompt 上下文过载** | **75%** | (已验证) 重试逻辑 (`generator.ts:355-359`) 将完整的 `rawText` (上次的错误输出) 塞回历史记录。对于大型 UI，这会立即消耗大量 Context Window，留给新生成的空间极少。 |

## 3. 代码逻辑分析 (Code Logic Analysis)

经过对 `src/services/gemini/generator.ts` 的深入审查，我们定位了问题的根源：

### 3.1 过于严格的校验 (Strict Validation)
函数 `isStructuralViolation` (Lines 246-264) 强制要求所有 FRAME/GROUP/SECTION 必须有子节点。
```typescript
if (!node.children || !Array.isArray(node.children) || node.children.length === 0) {
    if (node.type === 'SECTION') return false; 
    return true; // 视为致命错误
}
```
**问题**: 在实际设计中，空的 Frame 是合法的（例如作为占位符、背景层或尚未填充的容器）。将其视为致命错误并强制重试是不必要的。

### 3.2 昂贵的重试策略 (Expensive Retry Strategy)
当检测到此错误时，代码通过 `ValidationLoop` (Lines 348-361) 触发重试。
核心问题在于 Feedback Prompt：
> "ERROR: Structural Integrity Violation... Every container MUST have nested content to be visible."

这迫使 LLM 编造内容来填充空容器，直接导致了 **H1 (过度纠正)** 的发生。此外，将失败的巨大 JSON 塞回 History 导致了 **H3 (上下文过载)**。

## 4. 与近期改动 (Reasoning Layer) 的关系分析

**结论**: **无关 (Unrelated)**

- **代码隔离**: 当前正在开发的 `ReasoningEngine` 和 `minisearch` 逻辑尚未被主逻辑引入。
- **日志证据**: 日志显示系统仍在使用旧的加载逻辑。
- **故障性质**: 故障属于 Validation & Retry Loop 的原有行为。

## 5. 建议的解决方案 (Proposed Solution)

**核心理念**: 从 "Reject & Retry" (拒绝并重试) 转向 "Heal & Accept" (修复并接受)。

### 策略：Post-Processor Healing (推荐)

不要因为空子节点而拒绝生成结果，也不要浪费 Token 让 LLM 重写。相反，我们在 Post-Processing 阶段自动修复它。

1.  **修改 `isStructuralViolation`**: 放宽条件，不再视 `children: []` 为致命错误。或者完全移除此检查。
2.  **新增 `EmptyContainerHealer` 规则**: 在 `src/services/postProcessor/rules` 中添加一个规则。
    - **检测**: 也是 Frame 且 `children` 为空。
    - **修复**: 
        - 方案 A: 自动注入一个 "Empty State" 的文本节点 (e.g. "Empty Container")。
        - 方案 B: 给 Frame 添加一个显眼的填充色或描边，使其可见。
        - 方案 C: 什么都不做（最安全），仅仅允许它存在。

**预期收益**:
- **消除截断**: 不再强制模型生成冗余内容。
- **降低延迟**: 省略了昂贵的重试步骤 (2-3次 API 调用)。
- **提高成功率**: 即使部分内容为空，用户也能得到可视化结果。

## 6. 行动计划 (Action Plan)

1.  **Stop the Bleeding**: 修改 `generator.ts`，暂时禁用或放宽 `isStructuralViolation`。
2.  **Implement Healing**: 在 PostProcessor 中添加逻辑来处理空容器（如果认为是必要的话）。
