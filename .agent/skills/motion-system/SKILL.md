---
name: motion-system
description: Motion and animation design system based on Apple HIG, Material Design 3, and Radix conventions. Use when adding animations, designing transitions, or reviewing animation code. Keywords: animation, transition, easing, duration, motion, keyframes.
---

# Motion System

> **触发时机**: 添加动效、设计过渡效果、审查动画代码时自动应用

**哲学**: 快、精准、清爽 (Fast, Precise, Crisp)

---

## 1️⃣ 原则层 (Apple HIG)

### 核心原则

| 原则 | 检查问题 |
|------|---------|
| **有目的** | 这个动画传达了什么状态或反馈？ |
| **克制** | 是否可以更简单或完全不用动画？ |
| **自然** | 入场和离场是否物理一致？ |
| **可取消** | 用户能否中断动画继续操作？ |
| **无障碍** | 是否支持 reduce-motion？ |

### 物理一致性规则

```
入场方向 → 离场方向 (反向)
─────────────────────────
向上滑入 → 向下滑出
放大入场 → 缩小离场
淡入     → 淡出
```

---

## 2️⃣ Token 层 (Radix + M3)

### Duration Token

| Token | 值 | 适用场景 |
|-------|-----|---------|
| `--duration-instant` | 0ms | 无过渡 |
| `--duration-fast` | 100ms | 微交互 (图标、按钮 hover) |
| `--duration-normal` | 150ms | 标准交互 (Popover、chips) |
| `--duration-slow` | 250ms | 内容展开 |
| `--duration-slower` | 350ms | 页面级过渡 |

### Easing Token

| Token | 曲线 | 用途 |
|-------|------|------|
| `--ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | 通用 |
| `--ease-enter` | `cubic-bezier(0.0, 0, 0.2, 1)` | 入场 (减速) |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 离场 (加速) |
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | 弹性效果 |

### 组合 Token

| Token | 定义 | 用途 |
|-------|------|------|
| `--transition-micro` | `100ms var(--ease-default)` | 图标/状态切换 |
| `--transition-default` | `150ms var(--ease-default)` | 主交互 |
| `--transition-expand` | `250ms var(--ease-default)` | 展开/折叠 |

---

## 3️⃣ 动画层 (Keyframes)

### 动画清单

| 动画名 | 类型 | 配对 |
|--------|------|------|
| `fadeInUp` | 入场 | `fadeOutDown` |
| `fadeIn` | 入场 | `fadeOut` |
| `popoverIn` | 入场 | `popoverOut` |
| `dotPulse` | 循环 | - |
| `spin` | 循环 | - |
| `marquee` | 循环 | - |

### 命名规则

```
{action}{Direction}{Modifier}
  ↓        ↓          ↓
fadeIn    Up        Fast
popover   In        -
slide     Left      Slow
```

---

## 4️⃣ 决策树

```
用户操作发生
    │
    ├─ 需要反馈吗？
    │   ├─ 否 → 无动画
    │   └─ 是 → 什么类型？
    │           │
    │           ├─ hover/press → --transition-micro (100ms)
    │           ├─ 展开/折叠 → --transition-expand (250ms)
    │           ├─ 元素入场 → fadeInUp/popoverIn
    │           └─ 元素离场 → fadeOutDown/popoverOut
    │
    └─ 面积判断 (可选)
        ├─ <10% 屏幕 → fast (100ms)
        ├─ 10-50% 屏幕 → normal (150ms)
        └─ >50% 屏幕 → slow (250ms+)
```

---

## 5️⃣ 代码规范

### ✅ 正确用法

```typescript
// 使用 Token
style={{ transition: 'var(--transition-default)' }}

// 使用 CSS class
className="popover-content"  // 自动应用 popoverIn
```

### ❌ 禁止用法

```typescript
// 硬编码时长
style={{ transition: 'all 0.2s ease' }}

// 硬编码曲线
style={{ transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)' }}
```

---

## 6️⃣ 无障碍检查

```css
/* 必须在 tokens.ts 中包含 */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 📚 参考文件

- Token 定义: `src/ui/tokens.ts`
- 组件样式: `src/ui/styles.ts`
