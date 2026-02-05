---
name: design-anti-patterns
description: Identifies and prevents common UI anti-patterns in AI-generated code, including layer confusion, spatial instability, and token hardcoding. Use when developing UI components, reviewing styles, or designing hover/interaction feedback. Keywords: anti-pattern, opacity, hover, scale, hardcode, token.
---

# Design Anti-Patterns

> **触发时机**: 开发 UI 组件、审查样式代码、hover/交互反馈设计时自动应用

---

## 1. 层级混淆 (Layer Confusion)

**症状**：hover 改变整体 opacity，导致文字变浅

```tsx
// ❌ 错误：整体变透明
<div style={{ opacity: isHovered ? 0.6 : 1 }}>
  <span>Text</span>
</div>

// ✅ 正确：只改背景层
<div style={{ background: isHovered ? 'var(--gray-4)' : 'var(--gray-3)' }}>
  <span>Text</span>
</div>
```

---

## 2. 空间稳定性违规 (Spatial Instability)

**症状**：hover 使用 scale() 放大按钮

```tsx
// ❌ 错误：尺寸变化干扰认知
.button:hover { transform: scale(1.1); }

// ✅ 正确：阴影/颜色变化
.button:hover { 
  box-shadow: 0 4px 12px var(--gray-a5);
  background: var(--gray-4);
}
```

---

## 3. Token 硬编码 (Token Hardcoding)

**症状**：直接写数值而非引用 Token

| 类型 | 错误 | 正确 |
|------|------|------|
| opacity | `0.6` | `var(--gray-a11)` |
| padding | `6px` | `var(--space-2)` (8px) |
| color | `#646464` | `var(--gray-11)` |
| shadow | `rgba(0,0,0,0.1)` | `var(--gray-a5)` |

---

## 3.1 Typography Mismatch (字体失配)

**症状**：Font Size 和 Line Height 不配对使用

```tsx
// ❌ 错误：字号和行高不匹配
<span style={{
  fontSize: tokens.fontSize[3],  // 16px
  lineHeight: `${tokens.lineHeight[1]}px`, // 16px (太紧)
}}>

// ✅ 正确：成对使用
<span style={{
  fontSize: tokens.fontSize[3],  // 16px
  lineHeight: `${tokens.lineHeight[3]}px`, // 24px
}}>
```

**配对表**:
| Level | Font | Line-Height |
|-------|------|-------------|
| 1 | 12px | 16px |
| 2 | 14px | 20px |
| 3 | 16px | 24px |

---

## 4. Base-4 违规 (Base-4 Violation)

**症状**：使用非 4 的倍数作为间距

| 禁止值 | 对齐到 |
|--------|--------|
| 2px | `space-1` (4px) 或光学调整 |
| 6px | `space-2` (8px) |
| 10px | `space-3` (12px) |

**例外**：组件内部光学调整允许非 4 倍数，但必须注释公式

---

## 5. 检查清单

在提交 UI 代码前确认：

- [ ] Hover 只改变背景色，不改变 opacity
- [ ] 没有 transform: scale() 用于交互反馈
- [ ] opacity 使用 alpha scale token
- [ ] 间距符合 Base-4 规则

---

## 6. 命名不一致 (Naming Inconsistency)

**症状**：混用 shadcn/Radix/自定义命名

| 错误 | 正确 | 原因 |
|------|------|------|
| `muted` | `surface` | 功能不明确 |
| `mutedForeground` | `textSecondary` | 层级 + 功能 |
| `foreground` | `textPrimary` | 层级清晰 |

**原则**：采用 `bg/surface/border/text` + 状态后缀 (`Hover/Active`)
