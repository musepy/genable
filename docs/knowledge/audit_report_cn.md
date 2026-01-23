# 审计报告: 设计系统加载策略 (Design System Loader)

**审计对象**: `src/services/designSystemLoader.ts`
**核心关注**: SSOT (单一数据源), 工程原则, 健壮性
**日期**: 2026-01-14

---

## 执行摘要 (Executive Summary)

**严重性**: 高 (用户体验不可预测)
**结论**: 当前的实现违反了 **"Generic vs Specific" (通用与专用)** 以及 **"Explicit over Implicit" (显式优于隐式)** 的核心原则。

`detectSystem` 函数使用了一种过于简单的关键词匹配策略（Naive approach），它会根据普通名词（如 "Apple"）强制覆盖用户的意图。这种 "魔法 (Magic)" 行为违反了 **最小惊讶原则 (Principle of Least Surprise)**。

---

## 1. 问题分析 (Problem Analysis)

### 问题代码
```typescript
detectSystem(prompt: string): DesignSystemId {
    const lp = prompt.toLowerCase();
    // 🚨 问题: "apple" 是一个通用名词（品牌/公司），而不仅仅是设计系统 ID
    if (lp.includes('ios') || lp.includes('apple') || lp.includes('hig')) return 'ios-hig';
    // ...
}
```

### 失败场景
*   **用户意图**: "创建一个带有 Google 和 **Apple** 登录按钮的卡片" (内容描述)
*   **系统误判**: "用户提到了 'Apple'，将整个 UI 切换为 **iOS HIG** 风格" (上下文切换)
*   **后果**: 用户得到了一个 iOS 风格的卡片，而不是默认的或预期的 Shadcn 风格。

---

## 2. 违背原则 (Principle Violations)

### 🔴 SSOT (单一数据源) 违规
*   **现状**: "当前设计系统" 的真理来源是**瞬态的 (Transient)**，随着每次 Prompt 中的随机关键词而变化。
*   **理想**: "当前设计系统" 应该是一个**持久化状态 (Persistent State)**（如用户设置），作为唯一的真理来源 (SSOT)。Prompt 只有在明确要求时（如 "Make it in iOS style"）才能覆盖它。

### 🔴 显式 > 隐式 (Explicit > Implicit)
*   系统试图从内容描述中推断配置（隐式）。
*   "Apple" (内容) $\neq$ "iOS Style" (配置)。
*   **修正**: 配置的变更必须是 **显式的 (Explicit)**（例如：UI 选择器，或强意图关键词如 "iOS style"）。

### 🔴 健壮性 (Robustness) - 误报
*   `apple`, `android` 是过于通用的内容词汇，容易导致误报。
*   `ios`, `material`, `shadcn` 是相对安全的设计术语。

---

## 3. 工程原则对齐分析

基于 `/code-quality` 和 `/engineering-principles` 的评估：

| 维度 | 状态 | 分析 |
| :--- | :--- | :--- |
| **Simplicity (简单性)** | ⚠️ 警告 | 虽然代码本身很简单（`includes`），但导致了复杂且令人困惑的用户行为。 |
| **Determinism (确定性)** | ❌ 失败 | 同样的请求（"Apple 按钮"）产生的结果取决于内部隐藏的关键词列表，用户无法预测。 |
| **SoC (关注点分离)** | ⚠️ 警告 | `useChat` 混合了 **内容生成** 与 **系统配置**。这两个应该是截然不同的阶段或意图。 |

---

## 4. 改进建议 (Recommendations)

### 立即修复 (P0 - Quick Win)
**收窄启发式范围 (Heuristic Scope)。**
移除通用名词，仅保留特定的设计术语。

```diff
- if (lp.includes('ios') || lp.includes('apple') || lp.includes('hig')) return 'ios-hig';
+ // 要求显式的风格意图
+ if (lp.includes('ios style') || lp.includes('apple design') || lp.includes('use hig')) return 'ios-hig';
```

### 架构修复 (P1 - Robust Solution)
**采用 "显式默认，隐式覆盖" (Explicit-Default, Implicit-Override) 模式。**

1.  **状态 (State)**: 在 `PluginData` 中添加 `selectedSystem` (用户设置)。这是 SSOT。
2.  **覆盖 (Override)**: `detectSystem` 仅在置信度极高时（强意图）返回非空值。
3.  **决议 (Resolution)**:
    ```typescript
    const activeSystem = strongIntentSystem || userSettings.system || 'shadcn';
    ```

### 战略目标 (Strategic Goal)
**意图识别 (Intent Recognition)**
将检测逻辑移出正则匹配，进入 `recognizeIntent` (LLM/NLP) 层，以区分语义：
*   "Draw an **Apple**" (内容 Intent) -> 不切换系统
*   "Draw an **iOS** App" (风格 Intent) -> 切换系统

---

## 5. 价值评估与行动判定 (Value Assessment & Action)

### ✅ 正面价值 (保留 / Retain)
| 维度 | 评价 | 说明 |
| :--- | :--- | :--- |
| **模块核心设计** | ⭐⭐⭐⭐ | 这里的 Slot 模式、Registry 和统一接口 (`DesignSystemSlot`) 是优秀的架构设计，符合开闭原则 (OCP)。 |
| **关注点分离** | ⭐⭐⭐⭐ | 成功将引擎逻辑与具体的系统配置解耦，这是系统可扩展的基石。 |

### ⚠️ 问题区域 (改进 / Improve)
| 维度 | 评价 | 问题 |
| :--- | :--- | :--- |
| **`detectSystem`** | ⭐⭐ | **职责越界**。它目前不仅是"检测器"，还作为"自动决策者"干预了全局配置。需要降级为"建议器"或仅处理高置信度场景。 |
| **副作用** | ⭐⭐ | `setSystem` 改变全局单例状态，这在长期看应重构为依赖注入 (DI) 模式。 |

### 🎯 综合结论
**不要抛弃模块，而是修正行为。**
`DesignSystemLoader` 的骨架是健康的，也是未来支持更多设计系统所必需的。在此基础上，我们将执行以下行动：
1.  **修复** `detectSystem` 的逻辑缺陷 (P0)。
2.  **引入** User Preference 作为真正的 SSOT (P1)。
3.  **保留** 现有的 Registry 和 Slot 架构。

---

## 6. 价值主张 (Value Proposition)

实施这些变更将带来：
1.  **增加信任**: 用户不再需要与工具的"自作聪明"做斗争。
2.  **解锁高级工作流**: 用户可以自由描述内容，而无需担心意外的风格漂移。
3.  **对齐 SSOT**: 设计系统将成为稳定、可预测的平台基础。
