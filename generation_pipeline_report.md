# 生成链路问题报告 (Generation Pipeline Issue Report)

## 执行摘要 (Executive Summary)
当前的生成链路严重依赖**启发式后处理**（即“补丁”）来修复 LLM 输出的低质量代码。这种架构极其脆弱，难以维护，并且违反了项目的 **Software 3.0** 和 **重构文化 (Refactoring Culture)** 标准。
系统没有使用合规的求解器或标准化的生成方式，而是依赖“魔术字符串”匹配和硬编码的“条件-动作”规则来强制修正布局。

---

## 1. 架构反模式：依赖启发式 (Architectural Anti-Patterns)

### A. 对“魔术字符串”的依赖 (Magic String Dependency)
逻辑依赖于偶然的命名约定，而不是明确的意图。
- **证据**：`layout.ts.bak` 中检查 `name.includes('button')` 或 `name.includes('nav')`。
- **风险**：如果 LLM 将节点命名为 "SubmitAction" 而不是 "SubmitButton"，布局就会崩溃。如果用户提示词是 "Clickable Area"（可点击区域），也会失败。
- **违规**：`refactoring-culture.md` (上下文优化)。AI 必须“猜”出不可见的关键词才能触发正确的行为。

### B. 冲突的“补丁”逻辑 (Conflicting "Patch" Logic)
规则应用了相互冲突的变更，且缺乏全局的冲突解决策略。
- **证据**：
    - `ButtonContainerHugCorrection` 强制 `vertical: HUG`。
    - `PercentageWidthToFillCorrection` 强制 `horizontal: FILL`。
    - `EqualWidthChildrenCorrection` 强制子节点为 `FILL`。
- **风险**：一个名为 "ButtonContainer 100%" 的节点可能会同时触发多条规则。最终状态取决于 `ALL_RULES` 数组中随意的排列顺序（顺序耦合）。
- **违规**：`engineering-principles.md` (简单性与鲁棒性)。

### C. 硬编码的“魔术数字” (Hardcoded "Magic Numbers")
- **证据**：`PercentageWidthToFillCorrection` 寻找 `/\d+%/`。`NavigationFlexibleLayoutCorrection` 检查 `width % 40 === 0`。
- **风险**：这些启发式规则极其脆弱。如果设计采用了 `39px` 的模块间距，导航栏检查就会失败。

---

## 2. 工作流合规性违规 (Workflow Compliance Violations)

### ❌ 重构文化 (Software 3.0)
> *"标准化 > 优雅 (Standardization > Elegance)"*
- **现状**：代码试图通过从文本命名中推断意图来表现得“聪明”。
- **要求**：标准化的、声明式的 Schema（例如：`semantic: "BUTTON"` 应在 Schema 中显式隐含 `layout: "HUG"`，而不是后期打补丁）。

### ❌ 工程原则 (Engineering Principles)
- **现状**：“启发式规则”充当了一个隐形的控制层。
- **要求**：**基于求解器的方法 (Solver-based approach)**。布局求解器（如 GRIDS）应根据约束条件（Fill/Hug）从数学上确定最佳布局，而不是事后修正。

### ❌ Figma 插件工程规范
- **现状**：规则直接修改属性 (Props)，缺乏状态管理验证。
- **要求**：**状态机驱动 (State-Machine Driven)**。生成过程应在初始阶段就产生合法的状态。

---

## 3. 建议 (Recommendations)

1.  **放弃启发式 (Abandon Heuristics)**：停止添加像 `PercentageWidthToFillCorrection.ts` 这样的文件。
2.  **转向求解器 (Shift to Solver)**：采用用户历史记录中提到的 GRIDS 布局求解器，或类似的基于约束的引擎。
3.  **声明式 Schema (Declarative Schema)**：LLM 应该输出**约束 (Constraint)**，而不是**视觉结果 (Visual)**。
    - 错误做法：输出一个名为 "Row" 的 frame，并寄希望于 `postProcessor` 把它变成 AutoLayout。
    - 正确做法：直接输出 `{ type: "FRAME", layoutMode: "HORIZONTAL", layoutSizingHorizontal: "FIXED" }`。
    - ⚠️ 注意：不要使用 `primaryAxisSizingMode` 或 `counterAxisSizingMode`，这些属性已被移除。
4.  **重新实现 (Re-implementation)**：根据 `refactoring-culture.md`，不要重构现有的这些规则。直接删除它们，并实现一个干净的、消费 Schema 的 `LayoutEngine`。
