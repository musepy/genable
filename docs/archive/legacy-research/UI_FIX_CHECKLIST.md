# UI 问题修复检查清单

## 📌 快速参考

| 优先级 | 问题 | 文件 | 修复复杂度 | 预计时间 |
|-------|------|------|----------|--------|
| 🔴 P0 | Token 占位符 | css.ts | ⭐ 低 | 30 min |
| 🔴 P0 | Color Token 缺失 | css.ts | ⭐ 低 | 45 min |
| 🔴 P0 | Font Weight 非法值 | typography.ts | ⭐ 低 | 15 min |
| 🟡 P1 | 样式分散 | styles.ts + 5 组件 | ⭐⭐⭐ 高 | 3-4 h |
| 🟡 P1 | ARIA 缺失 | Header.tsx 等 | ⭐⭐ 中 | 2-3 h |
| 🟡 P1 | Color 映射不一致 | css.ts + colors.ts | ⭐⭐ 中 | 1.5 h |
| 🟡 P2 | 深色模式配置 | css.ts | ⭐⭐ 中 | 1 h |
| 🟢 P3 | Line Height 单位 | typography.ts | ⭐ 低 | 20 min |
| 🟢 P3 | Letter Spacing 精度 | css.ts | ⭐ 低 | 15 min |
| 🟢 P3 | 字体备选方案 | css.ts | ⭐ 低 | 20 min |

**总预计工时**: 13-14 小时 (分阶段实施)

---

## 🔴 Phase 1: 关键修复 (1-2 天内完成)

### ✅ Task 1.1: 修复 css.ts Token 占位符
**文件**: `src/ui/design-system/tokens/css.ts`  
**行号**: 963, 988-1007  
**工作量**: 30 分钟

#### 需要修改的行

```
Line 963:   --panel-default: {Panel.translucent};
Line 988:   --tokens-colors-accent-contrast: {Tokens.Colors.white-contrast};
Line 989:   --tokens-colors-accent-surface: {Colors.Accent.Accent Alpha.2};
Line 990:   --tokens-colors-black-contrast: {Colors.Default.black};
Line 995:   --tokens-colors-white-contrast: {Colors.Default.white};
Line 996:   --tokens-space-button-height-1: {Spacing.5};
Line 997:   --tokens-space-button-height-2: {Spacing.6};
Line 998:   --tokens-space-button-height-3: {Spacing.7};
Line 999:   --tokens-space-button-height-4: {Spacing.8};
Line 1000:  --tokens-space-menu-item-height-1: {Spacing.5};
Line 1001:  --tokens-space-menu-item-height-2: {Spacing.6};
Line 1002:  --tokens-space-table-cell-min-height-1: 36px;  (✅ 已正确)
Line 1003:  --tokens-space-table-cell-min-height-2: 44px;  (✅ 已正确)
Line 1004:  --tokens-space-table-cell-min-height-3: {Spacing.8};
Line 1005:  --tokens-space-table-cell-padding-1: {Spacing.2};
Line 1006:  --tokens-space-table-cell-padding-2: {Spacing.3};
Line 1007:  --tokens-space-table-cell-padding-3: {Spacing.4};
```

#### 修复映射

| 原值 | 修复后 | 说明 |
|-----|-------|------|
| `{Panel.translucent}` | `rgba(255, 255, 255, 0.8)` | 白色半透明 |
| `{Tokens.Colors.white-contrast}` | `#ffffff` | 白色 |
| `{Colors.Accent.Accent Alpha.2}` | `var(--accent-2)` | 指向 Radix |
| `{Colors.Default.black}` | `#000000` | 黑色 |
| `{Colors.Default.white}` | `#ffffff` | 白色 |
| `{Spacing.5}` | `var(--space-5)` | 24px |
| `{Spacing.6}` | `var(--space-6)` | 32px |
| `{Spacing.7}` | `var(--space-7)` | 40px |
| `{Spacing.8}` | `var(--space-8)` | 48px |
| `{Spacing.2}` | `var(--space-2)` | 8px |
| `{Spacing.3}` | `var(--space-3)` | 12px |
| `{Spacing.4}` | `var(--space-4)` | 16px |

#### 验证方法
```bash
# 1. 编辑文件后，运行以下检查
grep -n "{" src/ui/design-system/tokens/css.ts | grep -v "keyframes"
# 应该返回 0 个匹配（除了 @keyframes 块外）

# 2. Chrome DevTools - Elements 标签页
# 选中任意元素，打开 Styles
# 确认所有 var(--*) 都显示有效的颜色值，不显示 "(invalid)"
```

---

### ✅ Task 1.2: 添加缺失的 Color Scale
**文件**: `src/ui/design-system/tokens/css.ts`  
**位置**: `:root {}` 块内，在现有颜色定义后  
**工作量**: 45 分钟

#### 需要添加的颜色

在 `--crimson-a12` 后（约第 138 行）添加：

**Success Scale (Green)**
```css
/* Success / Green */
--success-1: #fbfefc;
--success-2: #f4fbf6;
--success-3: #e6f6eb;
--success-4: #d6f1df;
--success-5: #c4e8d1;
--success-6: #adddc0;
--success-7: #8eceaa;
--success-8: #65ba74;
--success-9: #46a758;
--success-10: #3e9b4f;
--success-11: #2a7e3b;
--success-12: #203c25;
--success-a1: rgba(0, 192, 0, 0.016);
--success-a2: rgba(0, 153, 0, 0.039);
--success-a3: rgba(0, 151, 0, 0.086);
--success-a4: rgba(0, 159, 7, 0.145);
--success-a5: rgba(0, 147, 5, 0.212);
--success-a6: rgba(0, 143, 10, 0.302);
--success-a7: rgba(1, 139, 15, 0.42);
--success-a8: rgba(0, 141, 25, 0.604);
--success-a9: rgba(0, 134, 25, 0.725);
--success-a10: rgba(0, 123, 23, 0.757);
--success-a11: rgba(0, 101, 20, 0.835);
--success-a12: rgba(0, 32, 6, 0.875);
```

**Error Scale (Red - 使用 Crimson)**
```css
/* Error / Crimson (already defined, just create aliases) */
--error-1: var(--crimson-1);
--error-2: var(--crimson-2);
--error-3: var(--crimson-3);
--error-4: var(--crimson-4);
--error-5: var(--crimson-5);
--error-6: var(--crimson-6);
--error-7: var(--crimson-7);
--error-8: var(--crimson-8);
--error-9: var(--crimson-9);
--error-10: var(--crimson-10);
--error-11: var(--crimson-11);
--error-12: var(--crimson-12);
--error-a1: var(--crimson-a1);
--error-a2: var(--crimson-a2);
--error-a3: var(--crimson-a3);
--error-a4: var(--crimson-a4);
--error-a5: var(--crimson-a5);
--error-a6: var(--crimson-a6);
--error-a7: var(--crimson-a7);
--error-a8: var(--crimson-a8);
--error-a9: var(--crimson-a9);
--error-a10: var(--crimson-a10);
--error-a11: var(--crimson-a11);
--error-a12: var(--crimson-a12);
```

**Warning Scale (Amber - 已存在，创建别名)**
```css
/* Warning / Amber (already defined, just create aliases) */
--warning-1: var(--amber-1);
--warning-2: var(--amber-2);
--warning-3: var(--amber-3);
--warning-4: var(--amber-4);
--warning-5: var(--amber-5);
--warning-6: var(--amber-6);
--warning-7: var(--amber-7);
--warning-8: var(--amber-8);
--warning-9: var(--amber-9);
--warning-10: var(--amber-10);
--warning-11: var(--amber-11);
--warning-12: var(--amber-12);
--warning-a1: var(--amber-a1);
--warning-a2: var(--amber-a2);
--warning-a3: var(--amber-a3);
--warning-a4: var(--amber-a4);
--warning-a5: var(--amber-a5);
--warning-a6: var(--amber-a6);
--warning-a7: var(--amber-a7);
--warning-a8: var(--amber-a8);
--warning-a9: var(--amber-a9);
--warning-a10: var(--amber-a10);
--warning-a11: var(--amber-a11);
--warning-a12: var(--amber-a12);
```

#### 验证方法
```bash
# 在浏览器 DevTools 中运行
const colors = ['success', 'error', 'warning'];
colors.forEach(color => {
  for(let i = 1; i <= 12; i++) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${color}-${i}`);
    if (!value.trim()) {
      console.warn(`Missing --${color}-${i}`);
    }
  }
});
// 应该没有 "Missing" 警告
```

---

### ✅ Task 1.3: 修复 Font Weight 值
**文件**: `src/ui/design-system/tokens/typography.ts`  
**工作量**: 15 分钟

#### 修改

```typescript
// 错误的
export const fontWeight = {
  bold: 'Bold',
  light: 'Light',
  medium: 'Medium',
  regular: 'Regular',
}

// 正确的
export const fontWeight = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}
```

#### 需要检查的使用点

```
// 找出所有使用 tokens.fontWeight 的地方
grep -r "tokens.fontWeight" src/ui/

可能的匹配：
- src/ui/styles.ts:61
- src/ui/components/Button.tsx:31
- src/ui/components/ui/Card.tsx:82
- src/ui/components/Header.tsx:60,86
```

#### 验证方法
```bash
# 确认修改后，运行格式化
npm run format src/ui/design-system/tokens/typescript.ts

# 在 DevTools 中检查
const span = document.querySelector('span');
console.log(window.getComputedStyle(span).fontWeight);
// 应该返回 "400" 或 "500" 等数值，不是 "Medium"
```

---

## 🟡 Phase 2: 一致性修复 (2-3 天)

### ⚠️ Task 2.1: 统一 Semantic Color 定义
**文件**: `src/ui/design-system/tokens/css.ts`  
**行号**: 891-962  
**工作量**: 1.5 小时

#### 当前问题
```css
/* 行 891-962：定义了冗余的 semantic colors */
--colors-semantic-success-1: var(--green-1);
--colors-semantic-info-1: var(--sky-1);  /* ❌ --sky-1 不存在 */
/* ... 72 行冗余定义 */
```

#### 解决方案

**方案 A**（推荐）：删除冗余，使用通用名
```css
/* 删除所有 --colors-semantic-* */
/* 改用直接的 --success-*, --error-*, --warning-* */
```

**方案 B**：保留并修正映射
```css
--colors-semantic-success-1: var(--success-1);
--colors-semantic-success-2: var(--success-2);
/* ... 完整的 12 步 */

--colors-semantic-error-1: var(--error-1);
/* ... 完整的 12 步 */

--colors-semantic-warning-1: var(--warning-1);
/* ... 完整的 12 步 */

--colors-semantic-info-1: var(--sky-1);  /* 改用 blue */
```

建议采用**方案 A**，因为现有代码中并未使用 `--colors-semantic-*` 变量。

#### 检查清单
- [ ] 搜索 `--colors-semantic` 确认无处使用
- [ ] 删除或修正这 72 行定义
- [ ] 验证 colors.ts 中的映射正确

---

### ⚠️ Task 2.2: 修复深色模式配置
**文件**: `src/ui/design-system/tokens/css.ts`  
**行号**: 1056-1087  
**工作量**: 1 小时

#### 当前问题
```css
/* 两套规则，优先级混乱 */
@media (prefers-color-scheme: dark) {
  :root { /* 媒体查询方式 */ }
}

[data-theme="dark"] {
  /* 属性选择器方式，定义不完整 */
}
```

#### 修复步骤

**Step 1**: 补全 `prefers-color-scheme: dark` 中的所有 color scales
```css
@media (prefers-color-scheme: dark) {
  :root {
    /* 现有的 gray 定义保留 */
    --gray-1: #111111;
    /* ... */
    
    /* 添加深色模式的 success/error/warning */
    --success-1: #0d2420;
    --success-2: #112b24;
    /* ... 完整 12 步 */
    
    --error-1: #2d1215;
    /* ... 完整 12 步 */
    
    --warning-1: #2f2415;
    /* ... 完整 12 步 */
  }
}
```

**Step 2**: 移除或重构 `[data-theme="dark"]` 规则
```css
/* 方案 1：删除，仅用 prefers-color-scheme */
/* [data-theme="dark"] 删除 */

/* 方案 2：改用 data-theme 方式 */
[data-theme="dark"] {
  /* 定义所有需要的变量 */
  color-scheme: dark;
  --gray-1: #111111;
  /* ... 完整 */
}
```

建议采用**方案 1**，因为 prefers-color-scheme 是标准方式。

#### 验证
```bash
# 在深色模式系统下测试
macOS: 系统偏好设置 → 通用 → 外观 → 深色
Windows: 设置 → 个性化 → 颜色 → 深色

页面应该显示深色主题，所有颜色应可见
```

---

### ⚠️ Task 2.3: 增加 ARIA 属性
**文件**: 多个组件  
**工作量**: 2-3 小时

#### 需要修改的组件

**Header.tsx**
```typescript
// New Chat Button
<button 
  className={getIconBtnClass(...)}
  aria-label={t.newDesign}  // ✅ 添加
  aria-disabled={!newChatEnabled}  // ✅ 已有，保留
  disabled={!newChatEnabled}  // ✅ 添加
  onClick={onNewChat}
>

// Settings Button
<button
  aria-label="Settings"  // ✅ 添加
  aria-controls="settings-panel"  // ✅ 如果有 panel id
  onClick={onSettingsClick}
>

// Theme Toggle
<button 
  role="switch"  // ✅ 已有
  aria-label={t.themeLabel(theme)}  // ✅ 改进
  aria-checked={theme === 'dark'}  // ✅ 已有
  onClick={onToggleTheme}
>
```

**Button.tsx**
```typescript
// 添加通用的 aria-label 支持
export interface ButtonProps {
  // ... 现有 props
  ariaLabel?: string;  // ✅ 添加
  ariaPressed?: boolean;  // ✅ 如果是 toggle
  ariaDescribedBy?: string;  // ✅ 如果有帮助文本
}

export function Button({
  // ...
  ariaLabel,
  ariaPressed,
  ariaDescribedBy,
  // ...
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-describedby={ariaDescribedBy}
      // ... 其他属性
    >
```

**其他组件** (Input, Card, 等)
- [ ] 搜索所有 `<button>` 标签
- [ ] 搜索所有 `role="button"` div
- [ ] 为每个添加 `aria-label` 或使用语义 HTML

#### 验证工具
```bash
# 安装 axe DevTools
# Chrome: https://chrome.google.com/webstore/detail/axe-devtools/lhdoppojpmngadmnkpklempisson

# 或在 DevTools Console 中运行
import { axe } from 'https://cdn.jsdelivr.net/npm/axe-core@latest/axe.min.js';
axe.run((results) => {
  console.log(results.violations);  // 显示所有无障碍问题
});
```

---

## 🟢 Phase 3: 代码质量改进 (1-2 天)

### 🟢 Task 3.1: 优化 Typography Token
**文件**: `src/ui/design-system/tokens/typography.ts`  
**工作量**: 40 分钟

#### Line Height
```typescript
// 错误：使用像素值（绝对）
lineHeight: {
  1: 16,
  2: 20,
  3: 24,
}

// 正确：使用无单位比率（相对）
lineHeight: {
  1: 1.25,   // 16/12
  2: 1.43,   // 20/14
  3: 1.5,    // 24/16
  4: 1.44,   // 26/18
  5: 1.4,    // 28/20
  6: 1.25,   // 30/24
  7: 1.29,   // 36/28
  8: 1.14,   // 40/35
  9: 1.0,    // 60/60
}
```

#### Letter Spacing
```typescript
// 精度过高
letterSpacing: {
  1: 0.03999999910593033,
  9: -0.4000000059604645,
}

// 简化（使用 em 单位）
letterSpacing: {
  1: '0.04em',
  2: '0em',
  3: '0em',
  4: '-0.04em',
  5: '-0.08em',
  6: '-0.1em',
  7: '-0.12em',
  8: '-0.16em',
  9: '-0.4em',
}
```

---

### 🟢 Task 3.2: 改进字体族
**文件**: `src/ui/design-system/tokens/css.ts` (行 1008-1011)  
**工作量**: 20 分钟

#### 修改
```css
/* 错误 */
--typography-font-family-code: Menlo;
--typography-font-family-emphasis: Times New Roman;
--typography-font-family-quote: Times New Roman;
--typography-font-family-text: SF Pro;

/* 正确（添加备选） */
--typography-font-family-text: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
--typography-font-family-code: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
--typography-font-family-emphasis: 'Georgia', 'Times New Roman', serif;
--typography-font-family-quote: 'Georgia', 'Garamond', serif;
```

---

## 📋 验证清单

### 修复后检查

- [ ] **CSS 验证**
  ```bash
  # 所有 CSS 变量有效（无红色波浪线）
  grep -n "{" src/ui/design-system/tokens/css.ts | grep -v "@keyframes"
  # 返回：0 matches
  ```

- [ ] **TypeScript 验证**
  ```bash
  npm run build
  # 编译无错误
  ```

- [ ] **浏览器测试**
  - [ ] Chrome DevTools → Styles 标签，所有 `var(--*)` 显示正确值
  - [ ] 浅色模式正常
  - [ ] 深色模式正常
  - [ ] 字体正确加粗/变细
  - [ ] 按钮、卡片、文本正常显示

- [ ] **可访问性测试**
  - [ ] axe DevTools 无关键问题
  - [ ] 屏幕阅读器可读 (macOS Safari + VoiceOver)
  - [ ] 键盘导航完整 (Tab + Enter + Shift+Tab)
  - [ ] 颜色对比度 ≥ 4.5:1 (Lighthouse)

- [ ] **跨浏览器测试**
  - [ ] Chrome/Edge (最新版)
  - [ ] Firefox (最新版)
  - [ ] Safari (macOS + iOS)
  - [ ] Windows 10/11 + Chrome

---

## 📝 提交注意事项

### Commit 消息格式

```
fix(ui): 修复 CSS Token 占位符

- 修复 css.ts 中的 6 个无效 Token 占位符
- 添加缺失的 success/error/warning color scale
- 修复 Font Weight 非法值（Bold → 700）

Fixes #[issue-number]
```

### 相关文件
```
src/ui/design-system/tokens/
  - css.ts (主要修改)
  - colors.ts (映射检查)
  - typography.ts (Font Weight 修复)

src/ui/
  - components/Header.tsx (ARIA 属性)
  - components/Button.tsx (字体权重引用)
  - styles.ts (检查是否需要调整)
```

---

## 🎯 预期效果

### 修复前后对比

| 指标 | 修复前 | 修复后 |
|-----|-------|-------|
| CSS 变量有效性 | 60% | 100% |
| Color Token 完整性 | 50% | 100% |
| 可访问性评分 | 70/100 | 95+/100 |
| 可维护性 | 低 | 中 |
| 跨浏览器一致性 | 75% | 98% |

---

**最后更新**: 2026-01-28  
**状态**: 待实施  
**优先级**: P0 → P1 → P2
