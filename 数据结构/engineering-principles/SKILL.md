---
name: engineering-principles
description: Applies simplicity-first engineering principles (YAGNI, SOLID, Rule of Three) for code reviews and architecture decisions. Use when reviewing code, evaluating abstractions, or making design choices. Keywords: YAGNI, SOLID, KISS, refactoring, abstraction, code review.
---

# Engineering Principles

> **触发时机**: 代码审查、架构决策、评估抽象程度时自动应用

---

## Core Rules

### Simplicity First

- Avoid inventing extra entities/components/abstractions without necessity
- Follow YAGNI (You Aren't Gonna Need It)
- Prefer composition over inheritance

### Modern Practices

- Use modern best practices by default
- Add backward compatibility / legacy workarounds **only when requested**

### Change Safety

- If the request is ambiguous, **confirm intent and scope** before non-trivial changes
- Prefer **minimal diffs**; avoid unrelated refactors unless requested

---

## SOLID Principles for Component Architecture

> Apply SOLID to UI components for clean, scalable design systems.

| Principle                     | Rule                                               | Example                                                                      |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| **S - Single Responsibility** | Each component does ONE thing well                 | A `Button` is just a `Button`, not `ButtonWithIconAndTooltip`                |
| **O - Open/Closed**           | Extend via props/variants, not source modification | Use `variant="primary"` instead of forking the component                     |
| **L - Liskov Substitution**   | All variants are interchangeable                   | `<Button variant="primary">` and `<Button variant="ghost">` work identically |
| **I - Interface Segregation** | Keep component APIs minimal                        | Don't expose internal state or unnecessary props                             |
| **D - Dependency Inversion**  | Depend on design tokens, not hardcoded values      | Use `--color-primary`, never `#3b82f6` directly                              |

---

## Code Anti-Patterns

> Patterns to actively avoid in component and styling code.

| Anti-Pattern                           | Why It's Bad                                          |
| -------------------------------------- | ----------------------------------------------------- |
| ❌ Hardcoded colors                    | Breaks theming, creates inconsistencies               |
| ❌ "God components"                    | Violates Single Responsibility, hard to test/maintain |
| ❌ Duplicated styles                   | Creates drift, bloats bundle size                     |
| ❌ Magic numbers                       | e.g., `padding: 12px` instead of `var(--space-3)`     |
| ❌ Inline styles for reusable patterns | Prevents reuse, bypasses design system                |

---

## Principles Checklist

| Principle    | Question to Ask                      |
| ------------ | ------------------------------------ |
| Necessity    | "Do we need this abstraction?"       |
| Simplicity   | "Is there a simpler approach?"       |
| Minimal Diff | "Can I make a smaller change?"       |
| Modern       | "Am I using current best practices?" |
| Clarity      | "Will future me understand this?"    |

---

## Examples

### Good: Minimal Change

```diff
- const result = items.filter(x => x.active).map(x => x.name);
+ const result = items.filter(x => x.active && x.visible).map(x => x.name);
```

### Avoid: Unnecessary Abstraction

```typescript
// Don't create a factory for a simple object
class UserFactory {
  create(name: string) {
    return { name };
  }
}

// Just use the object directly
const user = { name: "John" };
```

---

## Abstraction Decision Framework

> 基于 YAGNI, Rule of Three, Premature Abstraction 原则

### 写代码前必问的 3 个问题

```
1. 项目里有没有现成的能做这件事？
   ├─ 有 → 直接用
   └─ 没有 → 继续问...

2. 这段逻辑/组件会被几个地方用？
   ├─ 1 个地方 → 内联
   ├─ 2 个地方 → 忍受重复 (复制粘贴，标记 TODO)
   └─ 3+ 个地方 → 抽成独立模块

3. 我现在确定需要，还是在"预防未来"？
   ├─ 确定需要 → 做
   └─ 只是可能需要 → 不做
```

### 过度工程化的信号

| 信号                        | 说明                         |
| --------------------------- | ---------------------------- |
| 新增文件数 > 功能复杂度     | 3 个文件做 1 件简单事 = 警告 |
| 引用计数 = 1                | 只被 1 处使用的独立模块      |
| "以后可能需要"              | 正在预测未来                 |
| 创建 config/factory/manager | 单一用途不需要这些抽象       |

### 经典原则来源

| 原则              | 表述                                             | 来源                                |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| **YAGNI**         | "只在真正需要时才实现，不要因为预见需要而提前做" | Extreme Programming (1998)          |
| **Rule of Three** | "第 1 次直接做，第 2 次忍受重复，第 3 次再抽象"  | Martin Fowler, _Refactoring_ (1999) |
| **KISS**          | "保持简单"                                       | 美国海军设计原则 (1960)             |
