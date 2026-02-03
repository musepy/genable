# 插件 UI 审查报告

**日期**: 2026-01-28  
**审查范围**: `/src/ui` 目录  
**审查重点**: Token 引用错误、可识别性、设计系统一致性

---

## 📋 执行概览

### 关键发现
- **6 个严重的 Token 引用错误** (无法解析的占位符)
- **4 个 Color Token 缺失** (success/error/warning 未定义)
- **多个设计系统一致性问题**
- **可访问性覆盖不足**

### 优先级评级
| 类别 | 数量 | 严重程度 | 影响范围 |
|------|------|--------|--------|
| Token 引用错误 | 6 | 🔴 严重 | 全局 |
| Color Token 缺失 | 4 | 🔴 严重 | 功能组件 |
| 样式一致性 | 12+ | 🟡 中等 | 组件级 |
| 可访问性 | 8+ | 🟡 中等 | 交互组件 |

---

## 🔴 严重问题

### 1. CSS Token 引用错误 (css.ts 第 963-1007 行)

**位置**: `src/ui/design-system/tokens/css.ts`

**问题代码**:
```css
/* 行 963 */
--panel-default: {Panel.translucent};  /* ❌ 无法解析 */

/* 行 988-1007 */
--tokens-colors-accent-contrast: {Tokens.Colors.white-contrast};      /* ❌ */
--tokens-colors-accent-surface: {Colors.Accent.Accent Alpha.2};       /* ❌ */
--tokens-colors-black-contrast: {Colors.Default.black};               /* ❌ */
--tokens-colors-white-contrast: {Colors.Default.white};               /* ❌ */
--tokens-space-button-height-1: {Spacing.5};                          /* ❌ */
--tokens-space-button-height-2: {Spacing.6};                          /* ❌ */
--tokens-space-button-height-3: {Spacing.7};                          /* ❌ */
--tokens-space-button-height-4: {Spacing.8};                          /* ❌ */
--tokens-space-menu-item-height-1: {Spacing.5};                       /* ❌ */
--tokens-space-table-cell-min-height-3: {Spacing.8};                  /* ❌ */
--tokens-space-table-cell-padding-1: {Spacing.2};                     /* ❌ */
--tokens-space-table-cell-padding-2: {Spacing.3};                     /* ❌ */
--tokens-space-table-cell-padding-3: {Spacing.4};                     /* ❌ */
```

**影响**:
- CSS 变量无效，浏览器将忽略整行
- 依赖这些变量的样式 fallback 失效
- 低端设备/旧浏览器中布局错位

**根本原因**:
- 这些是从 Figma Design Tokens JSON 导出的原始占位符
- 未经过 Token 转换工具处理
- 混用了两种命名系统 (Radix vs. Figma)

**期望修复**:
```css
/* 应该映射到 Radix 标准 */
--panel-default: rgba(255, 255, 255, 0.8);
--tokens-colors-accent-contrast: #ffffff;
--tokens-colors-accent-surface: var(--accent-2);
--tokens-colors-black-contrast: #000000;
--tokens-colors-white-contrast: #ffffff;
--tokens-space-button-height-1: var(--space-5);  /* 24px */
--tokens-space-button-height-2: var(--space-6);  /* 32px */
/* ... 其他 */
```

---

### 2. Semantic Color Token 缺失

**位置**: `src/ui/design-system/tokens/colors.ts` 第 42-52 行

**问题**:
```typescript
// 定义了：
success: 'var(--success-9)',
warning: 'var(--warning-9)',
error: 'var(--error-9)',

// 但 css.ts 中未定义这些变量：
// ❌ --success-1 到 --success-12 不存在
// ❌ --warning-1 到 --warning-12 不存在  
// ❌ --error-1 到 --error-12 不存在
```

**受影响的组件**:
- `.error-banner` 样式 (css.ts 1129-1134)
- 所有使用 `tokens.colors.error` / `tokens.colors.success` / `tokens.colors.warning` 的组件
- 条件渲染 Badge/Alert 组件

**CSS 规则失效示例**:
```css
.error-banner {
  background: var(--error-1);      /* ❌ 未定义，fallback 无效 */
  border: 1px solid var(--error-6); /* ❌ */
  color: var(--error-11);           /* ❌ */
}
```

**期望修复方案**:
```typescript
// 添加到 css.ts :root
--success-1: #fbfefc;   /* Green scale */
--success-2: #f4fbf6;
/* ... 完整 12 步阶梯 */
--success-12: #193b2d;

--error-1: #fffcfc;     /* Red scale */
--error-2: #fff8f7;
/* ... 完整 12 步阶梯 */
--error-12: #3f1d1a;

--warning-1: #fefdfb;   /* Amber scale */
--warning-2: #fefbe9;
/* ... 完整 12 步阶梯 */
--warning-12: #4f3422;
```

---

### 3. Font Weight Token 值不合法

**位置**: `src/ui/design-system/tokens/typography.ts`

**问题**:
```typescript
fontWeight: {
  bold: 'Bold',      // ❌ CSS 需要数值 400-900 或关键字
  light: 'Light',    // ❌
  medium: 'Medium',  // ❌
  regular: 'Regular' // ❌
}
```

**影响**:
- CSS 不认识 'Bold', 'Medium' 等字符串值
- 文本权重无法被正确应用
- 跨浏览器渲染不一致

**期望修复**:
```typescript
fontWeight: {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}
```

**需要检查的文件**:
- Button.tsx 第 31, 78, 88 行 (使用 `tokens.fontWeight.medium`)
- Card.tsx 第 82 行 (使用 `tokens.fontWeight.semibold` - 该值也不存在!)
- Header.tsx 第 60, 86 行

---

## 🟡 中等问题

### 4. Color Token 一致性缺陷

**问题**: Color Scale 定义不完整

```typescript
// colors.ts 中声明的 Token
success: 'var(--success-9)',
successMuted: 'var(--success-3)',
successBorder: 'var(--success-6)',

// 但在 CSS Variables 中只定义了 Radix 标准色
// ❌ 缺少 success/error/warning 的完整 12 步色阶
// ✅ 有 amber-1 到 amber-12 (可用于 warning)
// ✅ 有 grass-1 到 grass-12 (可用于 success)
// ✅ 没有专门的 error/red scale 定义
```

**建议重新映射**:
```typescript
// colors.ts
success: 'var(--grass-9)',        // 使用现有的 grass scale
successMuted: 'var(--grass-3)',
successBorder: 'var(--grass-6)',

warning: 'var(--amber-9)',        // 已存在
warningMuted: 'var(--amber-3)',
warningBorder: 'var(--amber-6)',

error: 'var(--crimson-9)',        // 使用 crimson 替代 (Radix 有)
errorMuted: 'var(--crimson-3)',
errorBorder: 'var(--crimson-6)',
```

---

### 5. Semantic Token 命名与实现不符

**位置**: `src/ui/design-system/tokens/css.ts` 第 891-962 行

**问题**: 定义了冗余的 semantic colors，但从未被使用

```css
/* 这些都是重复定义，使用了 sky scale (实际不存在 --sky-* 变量) */
--colors-semantic-info-1: var(--sky-1);     /* ❌ --sky-1 未定义 */
--colors-semantic-info-2: var(--sky-2);     /* ❌ */
...
--colors-semantic-success-1: var(--green-1);
...
--colors-semantic-warning-1: var(--amber-1);
...

/* 而 JavaScript 中的 colors.ts 使用的是： */
success: 'var(--success-9)',               /* ❌ 不一致 */
warning: 'var(--warning-9)',               /* ❌ */
```

**代码可读性问题**:
- CSS 和 TS 定义的 semantic colors 映射不一致
- 开发者不知道用哪一套
- 维护难度高

---

### 6. 动态内联样式与 Token 混用

**位置**: 多个组件 (Header.tsx, Button.tsx 等)

**问题示例** (Header.tsx):
```typescript
// 混用硬编码值和 Token
style={{
  width: 28,              // ❌ 硬编码
  height: 28,             // ❌
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',  // ❌
  color: tokens.colors.textSecondary,  // ✅
  border: 'none',             // ❌
  borderRadius: 'var(--radius-full)',
  cursor: 'pointer',          // ❌
  transition: 'var(--transition-crisp)',
  // ...
}}
```

**影响**:
- 无法快速调整全局大小 (需改 12+ 处)
- Button 尺寸在多处定义，不易维护 (styles.ts + Button.tsx + Header.tsx)
- 难以在主题切换时更新

**期望修复**:
```typescript
// 应该定义在 tokens/layout.ts
export const size = {
  icon: 28,        // Icon button size
  button: {
    sm: 32,
    md: 40,
    lg: 48,
    xl: tokens.size.button.xl, // 已存在但值不清楚
  },
  // ...
};

// 组件中使用
width: tokens.size.icon,
height: tokens.size.icon,
```

---

### 7. 可访问性属性覆盖不足

**位置**: Button.tsx, Header.tsx 等交互组件

**问题**:
```typescript
// Button.tsx - 缺少焦点管理
<button style={{...}} disabled={...} {...props}>
  // ❌ 无 aria-label, aria-describedby
  // ❌ 无 aria-pressed (toggle 按钮)
  // ❌ 无 aria-current (active state)
</button>

// Header.tsx - 虽然有部分 aria，但不完整
<button 
  className={getIconBtnClass(...)}  // ❌ 类名不等于 aria-* 属性
  aria-disabled={...}
  // ❌ 缺少 aria-label（仅有 title，屏幕阅读器读不到）
>
  <Plus size={12} />
  <span>{t.newDesign}</span>
</button>

// 问题：className 用于样式，不应该用于语义
// 应该用 aria-* 属性表达语义
```

**建议修复**:
```typescript
<button
  aria-label={t.newDesign}
  aria-disabled={!newChatEnabled}
  disabled={!newChatEnabled}
  // ...
>
```

---

### 8. 深色模式配置冗余且不完整

**位置**: `src/ui/design-system/tokens/css.ts` 第 1056-1087 行

**问题**:
```css
/* 1. Dark Mode 在两处定义 */
@media (prefers-color-scheme: dark) {
  :root {
    --gray-1: #111111;
    // ... 28 个变量定义
  }
}

[data-theme="dark"] {
  --color-background: var(--gray-1);
  --color-surface: var(--gray-2);
  // ... 只有 4 个变量
}

/* 2. 问题：
   - 媒体查询 vs 属性选择器混用
   - 优先级/作用域不清
   - 其他 color scales (success/error/warning) 无深色覆盖
*/

/* 3. 颜色在深色模式下可能对比度不足 */
body { 
  color: var(--gray-12);  /* 浅色模式下是黑色, 深色模式下是浅色 - 对吗？ */
}
```

**期望修复**:
```css
/* 统一使用 prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  :root {
    /* 基础色阶 */
    --gray-1: #111111;
    // ... (已定义)
    
    /* 补充功能色 */
    --success-1: #0d2420;
    --success-2: #112b24;
    /* ... 完整 12 步 */
    
    --error-1: #2d1215;
    /* ... 完整 12 步 */
    
    --warning-1: #2f2415;
    /* ... 完整 12 步 */
    
    /* 语义色 */
    --colors-semantic-success-1: var(--success-1);
    /* ... */
  }
}

/* 移除 [data-theme="dark"]，仅用 prefers-color-scheme */
```

---

## 🟢 其他发现 (低优先级但值得注意)

### 9. Line Height Token 值单位不一致

**位置**: `src/ui/design-system/tokens/typography.ts`

```typescript
// CSS 中
--typography-line-height-1: 16px;  // 像素值（绝对）

// TypeScript 中应该的是无单位数值（相对）
lineHeight: {
  1: 16,    // ❌ 应该是 1.5 之类的比率
  2: 20,    // ❌
  // ...
}
```

**影响**:
- 行高无法相对于 font-size 缩放
- 更换字体大小时需要手动调整所有行高

**期望修复**:
```typescript
lineHeight: {
  1: 1.25,    // 16px ÷ 12px
  2: 1.43,    // 20px ÷ 14px
  3: 1.5,     // 24px ÷ 16px
  // ...
}
```

---

### 10. Letter Spacing 精度过高

**位置**: `src/ui/design-system/tokens/typography.ts` 和 css.ts

```css
--typography-letter-spacing-1: 0.03999999910593033;  /* 浮点数精度溢出 */
--typography-letter-spacing-7: -0.11999999731779099;
--typography-letter-spacing-9: -0.4000000059604645;
```

**影响**:
- 这些值来自 Figma 导出（原始浮点精度）
- 实际渲染差异微乎其微
- 代码可读性差

**期望修复**:
```css
--typography-letter-spacing-1: 0.04em;
--typography-letter-spacing-7: -0.12em;
--typography-letter-spacing-9: -0.4em;
```

---

### 11. 字体族备选方案不足

**位置**: `src/ui/design-system/tokens/css.ts` 第 1008-1011 行

```css
--typography-font-family-code: Menlo;               /* ❌ 不安全 */
--typography-font-family-emphasis: Times New Roman;  /* ❌ 过时 */
--typography-font-family-quote: Times New Roman;     /* ❌ */
--typography-font-family-text: SF Pro;              /* ❌ macOS only */
```

**问题**:
- SF Pro 仅在 macOS/iOS 可用，Windows 显示缺省字体
- Menlo/Times New Roman 不是网络安全字体
- 在组件中无地方使用这些字体

**期望修复**:
```css
--typography-font-family-code: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
--typography-font-family-text: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
--typography-font-family-emphasis: Georgia, 'Times New Roman', serif;
```

---

### 12. 组件样式定义分散

**受影响文件**:
- `src/ui/styles.ts` - 基础样式
- `src/ui/design-system/tokens/components.ts` - 组件 Token
- `src/ui/design-system/tokens/css.ts` 第 1099-1140 - 全局 CSS 类
- `src/ui/components/*.tsx` - 内联样式

**问题**:
- 同一组件的样式在多个文件中定义
- 修改 Button 样式需改 4-5 个地方
- 无单一真实源 (single source of truth)

**现有定义**:
```
Button 样式定义位置：
1️⃣ styles.ts: btnPrimaryStyle
2️⃣ Button.tsx: baseStyle + variantStyles + sizeStyles (inline)
3️⃣ css.ts: .submit-btn-active

Card 样式定义位置：
1️⃣ styles.ts: cardStyle
2️⃣ Card.tsx: cardStyle (inline)
3️⃣ css.ts: .card 类
```

---

## 📊 问题影响矩阵

| 问题 | 严重程度 | 修复难度 | 影响用户 | 受影响文件数 |
|-----|--------|--------|--------|-----------|
| Token 引用错误 (§1) | 🔴 严重 | 低 | 是 | 1 |
| Color Token 缺失 (§2) | 🔴 严重 | 低 | 是 | 3-5 |
| Font Weight 非法 (§3) | 🔴 严重 | 低 | 是 | 3 |
| Color 映射不一致 (§4) | 🟡 中 | 低 | 否 (隐患) | 2 |
| Semantic Token 冗余 (§5) | 🟡 中 | 中 | 否 | 2 |
| 硬编码值混用 (§6) | 🟡 中 | 中 | 是 | 8+ |
| 可访问性缺失 (§7) | 🟡 中 | 中 | 是 (残障人士) | 5+ |
| 深色模式配置 (§8) | 🟡 中 | 中 | 是 | 1 |
| Line Height 单位 (§9) | 🟢 低 | 低 | 否 | 1 |
| Letter Spacing 精度 (§10) | 🟢 低 | 极低 | 否 | 1 |
| 字体族备选 (§11) | 🟢 低 | 低 | 是 (部分) | 2 |
| 样式分散定义 (§12) | 🟡 中 | 高 | 否 (维护) | 4 |

---

## 🎯 行动计划 (优先级排序)

### Phase 1️⃣: 关键修复 (1-2 天)
**优先级**: 🔴 高 | **预期效果**: 恢复基础可访问性

- [ ] **修复 css.ts Token 占位符** (6 个)
  - 目标: 第 963, 988-1007 行
  - 方法: 替换 Figma 占位符为 Radix 标准值或 CSS 变量引用
  - 验证: 所有 CSS 变量应能被 Chrome DevTools 正确解析

- [ ] **添加缺失的 Color Scale** (success/error/warning)
  - 目标: css.ts :root 中添加完整的 12 步阶梯
  - 映射: 
    - success → grass scale
    - error → crimson scale
    - warning → amber scale
  - 测试: 确保所有 semantic colors 都有值

- [ ] **修复 Font Weight 值**
  - 目标: typography.ts 中改为数值 (300/400/500/600/700)
  - 影响: Button, Card, Header 组件自动获得正确权重

### Phase 2️⃣: 一致性修复 (2-3 天)
**优先级**: 🟡 中 | **预期效果**: 提升可维护性，规范设计系统

- [ ] **统一 Semantic Color 定义**
  - 整理: css.ts (行 891-962) 冗余定义，保留一套
  - 对齐: colors.ts 中的 success/error/warning 使用相同映射
  - 文档: 更新 Token 使用指南

- [ ] **整合样式定义**
  - 合并 styles.ts 和 components.ts 中的样式
  - 统一使用 Token，移除硬编码值
  - 示例: Button 尺寸改用 `tokens.size.button.sm` 而非 `32`

- [ ] **深色模式统一配置**
  - 移除 [data-theme="dark"] 属性选择器
  - 补全 prefers-color-scheme: dark 中的所有 color scales
  - 添加对比度检查 (WCAG AA 标准)

### Phase 3️⃣: 可访问性增强 (2-3 天)
**优先级**: 🟡 中 | **预期效果**: 支持屏幕阅读器，WCAG 2.1 AA 合规

- [ ] **增加 ARIA 属性**
  - Button 组件: 添加 aria-label, aria-pressed, aria-disabled
  - Header 组件: 确保所有交互元素有 aria-label
  - 审计工具: 使用 axe DevTools 验证

- [ ] **增强焦点管理**
  - 确保所有可交互元素可被键盘访问 (Tab 键)
  - 添加可见的焦点指示符 (focus-visible 样式)
  - 测试: 仅用键盘导航整个 UI

- [ ] **改进颜色对比度**
  - 验证: text 对 background 的对比比例 ≥ 4.5:1 (WCAG AA)
  - 检查: 深色模式下所有 color scales 的对比度
  - 工具: WAVE, Lighthouse, Contrast Ratio 检查器

### Phase 4️⃣: 优化与清理 (1-2 天)
**优先级**: 🟢 低 | **预期效果**: 代码整洁性，易维护性

- [ ] **精化 Typography Token**
  - 修改: line-height 使用无单位数值 (比率)
  - 简化: letter-spacing 精度，改用 em 单位
  - 审查: 所有字体族添加备选方案

- [ ] **补充文档**
  - 创建: Token 使用规范文档
  - 示例: 各类组件的标准样式模板
  - 维护: Token 变更日志

---

## 📈 验证标准

修复完成后应满足以下标准：

```
✅ CSS Validation
  - 所有 CSS 变量可被浏览器正确解析 (无红色波浪线)
  - :root 中所有 --color-* 变量有值 (不是占位符)
  
✅ Design System Coherence
  - 颜色映射一致 (css.ts ↔ colors.ts ↔ 组件)
  - 尺寸值统一定义 (tokens/layout.ts)
  - 字体值符合 CSS 规范

✅ Accessibility (WCAG 2.1 AA)
  - Lighthouse 可访问性评分 ≥ 95/100
  - 所有交互元素有 aria-label
  - 色对比度 ≥ 4.5:1 (文本)
  - 键盘导航完整

✅ Visual Consistency
  - 组件在明/暗两种主题下清晰可见
  - 字体权重/大小与设计稿一致
  - 间距/圆角等视觉属性统一
```

---

## 📝 附录：快速参考

### Token 修复映射表

| 原值 (无效) | 修复后 | 类别 | 来源 |
|----------|-------|------|------|
| `{Panel.translucent}` | `rgba(255, 255, 255, 0.8)` | 颜色 | Figma → Radix |
| `{Tokens.Colors.white-contrast}` | `#ffffff` | 颜色 | 常数 |
| `{Colors.Accent.Accent Alpha.2}` | `var(--accent-2)` | 颜色 | Radix |
| `{Colors.Default.black}` | `#000000` | 颜色 | 常数 |
| `{Spacing.5}` | `var(--space-5)` (24px) | 尺寸 | Radix |
| `Bold` | `700` | 字重 | CSS |
| `Medium` | `500` | 字重 | CSS |

### 项目相关文件快速导航

```
src/ui/design-system/
├── tokens/
│   ├── css.ts           ⚠️  问题区: 1-1140 (全文)
│   ├── colors.ts        ⚠️  映射需检查: 42-52
│   ├── typography.ts    ⚠️  值非法: fontWeight
│   ├── layout.ts        ✅  一般正常
│   ├── spacing.ts       ✅  一般正常
│   └── index.ts         ✅  聚合导出
├── components.ts        ⚠️  可能定义冗余
└── ...
├── styles.ts            ⚠️  硬编码值混用
├── components/
│   ├── Button.tsx       ⚠️  样式分散
│   ├── Header.tsx       ⚠️  样式分散 + 可访问性缺陷
│   ├── SettingsPanel.tsx ⚠️  可访问性缺陷
│   ├── ui/
│   │   └── Card.tsx     ⚠️  使用非法 fontWeight
│   └── ...
└── interactionStates.ts ✅  状态机定义良好
```

---

## 💡 建议

### 短期 (立即)
1. 优先处理 Phase 1️⃣ 中的 3 个关键修复，恢复基础功能
2. 在 PR 前进行 CSS 变量自动化验证 (linting)
3. 建立 Design Token 变更流程 (Figma → Export → Transform → Commit)

### 中期 (1-2 周)
1. 完成 Phase 2️⃣ 一致性修复，统一设计系统
2. 引入 Token 文档自动生成工具 (Storybook + Tokens Plugin)
3. 建立组件库的可视化回归测试

### 长期 (1-2 月)
1. 迁移到专业 Token 管理方案 (Figma Tokens Plugin / Style Dictionary)
2. 建立设计开发协作流程
3. 完整覆盖无障碍测试，获得 WCAG AAA 认证

---

**报告生成**: 2026-01-28  
**下一步**: 等待团队确认优先级，启动 Phase 1️⃣ 修复
