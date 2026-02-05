---
name: radix-tokens
description: Ensures UI code follows Radix Scale token conventions for spacing, colors, typography, and radius. Use when developing UI components, auditing styles, or checking token compliance. Keywords: spacing, color, typography, radius, tokens, CSS variables, design system.
---

# Radix Token System

> **触发时机**: 开发 UI 组件、审计样式代码、检查 Token 合规性时自动应用

基于 Radix UI 官方规范，确保代码一致性。

## 核心规则

### 1. 间距 (Space)

**只使用 `--space-1` ~ `--space-9`**

| 值 | px | 用途 |
|----|-----|------|
| 1 | 4 | 图标间距 |
| 2 | 8 | chip 内边距 |
| 3 | 12 | 紧凑容器 |
| 4 | 16 | 标准容器 |
| 5 | 24 | section 间距 |
| 6-9 | 32-64 | 大分隔 |

❌ 禁止: `padding: 6px`, `margin: 10px`
✅ 正确: `padding: var(--space-2)`, `gap: var(--space-3)`

---

### 2. 圆角 (Radius)

**只使用 `--radius-1` ~ `--radius-6`**

| 用途 | 推荐 |
|------|------|
| 小元素 | radius-1, radius-2 |
| 卡片/Popover | radius-3, radius-4 |
| 大容器 | radius-5, radius-6 |
| 胶囊按钮 | radius-full |

**iOS 连续圆角 (Squircle)**

使用 `corner-shape: var(--corner-shape)` 或添加 `.ios-radius` 类。

❌ 禁止: `border-radius: 8px`
✅ 正确: `border-radius: var(--radius-2)`

---

### 3. 字号 (Size)

**只使用 Radix size 1-3 (3 级系统)**

| Size | px | Line-Height | 用途 |
|------|-----|-------------|------|
| 1 | 12 | **16px** | Caption, Badge, Helper |
| 2 | 14 | **20px** | Body, List, Button |
| 3 | 16 | **24px** | Title, Heading |

❌ 禁止: `font-size: 10px`, `font-size: 11px`, `font-size: 13px`
✅ 正确: `font-size: var(--font-size-1)` 或 `tokens.fontSize[1]`

---

### 3.1 Typography Pairing (字体配对原则)

> **核心规则**: Font Size 和 Line Height 必须成对使用，不可单独修改其中一个。

| 配对 | Font | Line-Height | Token |
|------|------|-------------|-------|
| Level 1 | 12px | 16px | `fontSize[1]` + `lineHeight[1]` |
| Level 2 | 14px | 20px | `fontSize[2]` + `lineHeight[2]` |
| Level 3 | 16px | 24px | `fontSize[3]` + `lineHeight[3]` |

**理由**:
- 确保垂直节奏 (Vertical Rhythm) 对齐 4px 网格
- 防止"字大行紧"或"字小行松"的视觉失调

❌ 禁止:
```tsx
// 只改字号，不改行高
fontSize: tokens.fontSize[3],
lineHeight: `${tokens.lineHeight[1]}px`,
```

✅ 正确:
```tsx
// 成对使用
fontSize: tokens.fontSize[2],
lineHeight: `${tokens.lineHeight[2]}px`,
```

**使用 Radix step 范围规范**

| 用途 | Step |
|------|------|
| 页面背景 | 1-2 |
| 组件背景 | 3 (默认), 4 (hover), 5 (active) |
| 边框 | 6 (弱), 7 (默认), 8 (hover) |
| 实心按钮 | 9 (默认), 10 (hover) |
| 文本 | 11 (次要), 12 (主要) |

❌ 禁止: `color: #646464`
✅ 正确: `color: var(--gray-11)`

---

### 5. 阴影与透明度 (Shadow & Alpha)

**使用 Radix alpha scale 代替 rgba/opacity**

| 用途 | Alpha Step | 等效 opacity |
|------|------------|-------------|
| 极淡背景 | `var(--gray-a1)` | ~1% |
| Hover 背景 | `var(--gray-a3)` | ~6% |
| 阴影 | `var(--gray-a5)` | ~10% |
| Disabled 文字 | `var(--gray-a11)` | ~60% |

❌ 禁止: `rgba(0,0,0,0.12)`, `opacity: 0.6`
✅ 正确: `background: var(--gray-a3)`, `color: var(--gray-a11)`

---

### 6. 交互反馈 (Interaction Feedback)

**Hover/Active 使用颜色阶梯变化**

| 状态 | Color Step | 说明 |
|------|------------|------|
| 默认 | step 3 | 可交互元素背景 |
| Hover | step 4 | 悬停反馈 |
| Active/按下 | step 5 | 点击反馈 |
| Disabled | alpha-11 | 60% 透明度 |

**空间稳定性原则**

✅ 允许的反馈方式：
- 颜色变化 (background step 3→4→5)
- 阴影变化 (box-shadow)
- 边框变化 (border-color step 7→8)

❌ 禁止的反馈方式：
- 尺寸变化 (`transform: scale()`)
- 透明度变化 (`opacity`) - 会影响文字
- 位移变化 (`margin`/`padding` 改变)

---

## 快速查表

| 需求 | 查表 |
|------|------|
| hover 背景 | step 4 |
| 默认边框 | step 7 |
| 标准间距 | space-3, space-4 |
| 卡片圆角 | radius-3 |
| 正文字号 | size 2 (14px) |

---

## 检查清单

- [ ] 所有 px 值是否使用 CSS 变量?
- [ ] 间距是否在 space-1 ~ space-9 范围内?
- [ ] 颜色是否使用 step 规范?
- [ ] 是否有硬编码的 rgba?
- [ ] 硬编码值是否有注释说明原因?
- [ ] Hover 只改变背景色，不改变 opacity?
- [ ] 没有 transform: scale() 用于交互反馈?
- [ ] Font Size 和 Line Height 成对使用?

---

## ⚠️ 常见反模式 (Anti-Patterns)

> **核心症状 → 修复对照表**

### 1. 层级混淆 (Layer Confusion)

**症状**: hover 改变整体 opacity，导致文字变浅

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

### 2. 空间稳定性违规 (Spatial Instability)

**症状**: hover 使用 scale() 放大按钮

```tsx
// ❌ 错误：尺寸变化干扰认知
.button:hover { transform: scale(1.1); }

// ✅ 正确：阴影/颜色变化
.button:hover { 
  box-shadow: 0 4px 12px var(--gray-a5);
  background: var(--gray-4);
}
```

### 3. Token 硬编码对照表

| 类型 | 错误 | 正确 |
|------|------|------|
| opacity | `0.6` | `var(--gray-a11)` |
| padding | `6px` | `var(--space-2)` (8px) |
| color | `#646464` | `var(--gray-11)` |
| shadow | `rgba(0,0,0,0.1)` | `var(--gray-a5)` |

### 4. Base-4 违规

**症状**: 使用非 4 的倍数作为间距

| 禁止值 | 对齐到 |
|--------|--------|
| 2px | `space-1` (4px) 或光学调整 |
| 6px | `space-2` (8px) |
| 10px | `space-3` (12px) |

---

## 例外：光学调整 (Optical Adjustments)

> **原则**：Token 用于**组件之间**的间距，而非**组件内部**的视觉平衡。

以下场景**允许**使用硬编码值，但**必须添加注释**说明原因：

| 场景 | 原因 | 示例 |
|------|------|------|
| 组件内部光学调整 | 基于数学/视觉比例 | Toggle: `(24px - 20px) / 2 = 2px` |
| 图标/SVG 内边距 | 视觉重心调整 | Icon 内部留白 |
| 边框 + 内容对齐 | 1px 边框补偿 | 按钮文字微调 |
| 动画偏移量 | 精确控制视觉效果 | Hover 偏移 1-2px |

### 正确示例

```tsx
// ✅ 明确注释为什么使用硬编码
padding: '2px', // Optical: (24 - 20) / 2 = 2px, not a spacing token

// ✅ 边框补偿
marginTop: '-1px', // Compensate for 1px border visual offset
```

### 错误示例

```tsx
// ❌ 无注释的硬编码
padding: '2px',

// ❌ 本应使用 token 的间距
gap: '6px', // Should be space-2 (8px) or space-1 (4px)
```

### 判断标准

```
是组件之间的距离？ → 使用 Token
是组件内部的视觉平衡？ → 允许硬编码，但必须注释
```

---

## 命名规范 (Naming Convention)

> 采用 **Vercel Geist 风格**：功能驱动 + Radix step 底层

### 核心原则

| 原则 | 说明 |
|------|------|
| **功能驱动** | `surfaceHover` 比 `muted` 直观 |
| **状态编号** | 1(默认)→2(hover)→3(active) |
| **层级分离** | bg / surface / border / text 四层 |
| **保留 Radix step** | 底层用 gray-1~12，上层命名更友好 |

### 颜色命名映射

| 层级 | Token 名 | Radix Step | 用途 |
|------|----------|------------|------|
| 背景 | `bg1` | gray-1 | 页面背景 |
| 背景 | `bg2` | gray-2 | 次要背景 |
| 表面 | `surface` | gray-3 | 组件默认 |
| 表面 | `surfaceHover` | gray-4 | 组件悬停 |
| 表面 | `surfaceActive` | gray-5 | 组件按下 |
| 边框 | `border` | gray-6 | 默认边框 |
| 边框 | `borderHover` | gray-7 | 悬停边框 |
| 边框 | `borderActive` | gray-8 | 按下边框 |
| 文字 | `textSecondary` | gray-11 | 次要文字 |
| 文字 | `textPrimary` | gray-12 | 主要文字 |

### 迁移映射 (shadcn → Vercel)

| 旧名 | 新名 | 说明 |
|------|------|------|
| `muted` | `surface` | 更直观 |
| `mutedForeground` | `textSecondary` | 功能明确 |
| `foreground` | `textPrimary` | 层级清晰 |
| `borderSubtle` | `borderLight` | |
| `borderStrong` | `borderHover` | 状态驱动 |
| `cardShadow` | `shadow` | 简化 |
