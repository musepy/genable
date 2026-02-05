# 设计系统完整架构知识库

本文档包含 12 个主流设计系统的完整架构规范，涵盖颜色、字体、间距、阴影、组件等全部设计 Token。

---

## 目录

1. [Material Design 3 (Google)](#1-material-design-3-google)
2. [Apple Human Interface Guidelines](#2-apple-human-interface-guidelines)
3. [Carbon Design System (IBM)](#3-carbon-design-system-ibm)
4. [Ant Design (Alibaba)](#4-ant-design-alibaba)
5. [Atlassian Design System](#5-atlassian-design-system)
6. [Adobe Spectrum](#6-adobe-spectrum)
7. [Microsoft Fluent Design 2](#7-microsoft-fluent-design-2)
8. [Chakra UI](#8-chakra-ui)
9. [shadcn/ui](#9-shadcnui)
10. [Arco Design (ByteDance)](#10-arco-design-bytedance)
11. [Shopify Polaris](#11-shopify-polaris)
12. [Salesforce Lightning](#12-salesforce-lightning)

---

# 1. Material Design 3 (Google)

**官方文档**: [material.io](https://material.io)

## 1.1 颜色系统

### 核心颜色角色 (Key Color Roles)
| 角色 | 用途 |
|------|------|
| **Primary** | 品牌主色，用于主按钮、FAB、选中状态 |
| **Secondary** | 次要元素，如筛选器、次级按钮 |
| **Tertiary** | 对比强调色，如输入框高亮 |
| **Neutral** | 背景、表面 |
| **Neutral Variant** | 中性变体 |

### 色调调色板 (Tonal Palette)
每个颜色角色生成 13 个色调：
```
0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100
```

### HCT 色彩空间
- **Hue**: 色相
- **Chroma**: 饱和度
- **Tone**: 明度 (0=黑, 100=白)

## 1.2 字体排版 (Typography)

### Type Scale (15 样式)
| 样式 | 字号 (sp) | 行高 | 字重 | 用途 |
|------|----------|------|------|------|
| Display Large | 57 | 64 | 400 | 大屏数字/标题 |
| Display Medium | 45 | 52 | 400 | - |
| Display Small | 36 | 44 | 400 | - |
| Headline Large | 32 | 40 | 400 | 主标题 |
| Headline Medium | 28 | 36 | 400 | - |
| Headline Small | 24 | 32 | 400 | - |
| Title Large | 22 | 28 | 400 | 副标题 |
| Title Medium | 16 | 24 | 500 | - |
| Title Small | 14 | 20 | 500 | - |
| Body Large | 16 | 24 | 400 | 正文 |
| Body Medium | 14 | 20 | 400 | - |
| Body Small | 12 | 16 | 400 | - |
| Label Large | 14 | 20 | 500 | 按钮文字 |
| Label Medium | 12 | 16 | 500 | - |
| Label Small | 11 | 16 | 500 | 小标签 |

## 1.3 间距系统

- **基准单位**: 4dp
- **常用值**: 4, 8, 12, 16, 24, 32, 48, 64dp

## 1.4 层级/阴影 (Elevation)

| Level | dp | 用途 |
|-------|-----|------|
| 0 | 0 | 平面 |
| 1 | 1 | 轻微浮起 |
| 2 | 3 | 卡片 |
| 3 | 6 | 模态 |
| 4 | 8 | 悬浮 |
| 5 | 12 | 拖拽 |

## 1.5 圆角系统

| Token | 值 |
|-------|-----|
| None | 0dp |
| Extra Small | 4dp |
| Small | 8dp |
| Medium | 12dp |
| Large | 16dp |
| Extra Large | 28dp |
| Full | 50% |

## 1.6 CSS Design Tokens

### Button Tokens (示例)
```css
--md-filled-button-container-color: var(--md-sys-color-primary)
--md-filled-button-label-text-color: var(--md-sys-color-on-primary)
--md-filled-button-container-shape: var(--md-sys-shape-corner-full)
--md-filled-button-container-height: 40px
```

## 1.7 Button 规范

| 属性 | 值 |
|------|-----|
| 默认高度 | 40dp |
| 内边距 | 16dp (水平), 24dp (large) |
| 圆角 | Full rounded (默认) |
| 字体 | Label Large (14sp, Medium) |
| 最小宽度 | 64dp |

### Button 变体
| 类型 | 用途 | 特征 |
|------|------|------|
| Filled | 主要操作 | 实心背景 |
| Outlined | 次要操作 | 边框，无背景 |
| Text | 低优先级 | 无边框，无背景 |
| Elevated | 浮起效果 | 带阴影 |
| Tonal | 填充调性 | 柔和背景色 |

## 1.8 Input Field 规范

| 属性 | 值 |
|------|-----|
| 默认高度 | 56dp (Filled), 48dp (Outlined) |
| 标签字体 | Body Small |
| 输入字体 | Body Large |
| 圆角 | 4dp (top) Filled, 4dp (all) Outlined |

## 1.9 Card 规范

### 变体类型
| 类型 | Elevation | 特征 |
|------|-----------|------|
| **Elevated** | Level 1 | 带阴影，适度分离 |
| **Filled** | Level 0 | 实心背景，无阴影 |
| **Outlined** | Level 0 | 边框，无阴影 |

### 尺寸规范
| 属性 | 值 |
|------|-----|
| 圆角 | 12dp (默认) |
| Padding | 16dp (内容区左右) |
| 卡片间距 | 8dp (建议) |
| 移动端边距 | 8dp |
| 内部圆角计算 | Outer radius - padding |

## 1.10 Checkbox 规范

| 属性 | 值 |
|------|-----|
| 尺寸 | 18dp × 18dp |
| 触控区域 | 48dp × 48dp (最小) |
| Label 间距 | 16dp (右侧) |
| 圆角 | 2dp |

### 状态
- Unchecked
- Checked (✓ checkmark)
- Indeterminate (- dash)
- Disabled

## 1.11 Radio 规范

| 属性 | 值 |
|------|-----|
| 外圈直径 | 20dp |
| 内圈直径 | 10dp (选中时) |
| 触控区域 | 48dp × 48dp |
| Label 间距 | 16dp (右侧) |

## 1.12 Switch 规范

| 属性 | 值 |
|------|-----|
| 轨道宽度 | 52dp |
| 轨道高度 | 32dp |
| Thumb 直径 | 16dp (未选中), 24dp (选中) |
| 触控区域 | 48dp × 48dp |

### 状态
- Off (thumb 左侧)
- On (thumb 右侧)
- Disabled

## 1.13 Select 规范

| 属性 | 值 |
|------|-----|
| 默认高度 | 56dp (Filled), 48dp (Outlined) |
| 下拉图标 | 24dp × 24dp |
| 图标右边距 | 12dp |
| 选项高度 | 48dp (默认) |

---


# 2. Apple Human Interface Guidelines

**官方文档**: [developer.apple.com/design](https://developer.apple.com/design)

## 2.1 语义颜色系统

### 颜色类别
| 类别 | 示例 Token | 说明 |
|------|-----------|------|
| **Label Colors** | label, secondaryLabel, tertiaryLabel, quaternaryLabel | 文本层级 |
| **Background Colors** | systemBackground, secondarySystemBackground, tertiarySystemBackground | 背景层级 |
| **Fill Colors** | systemFill, secondarySystemFill | UI 填充 |
| **System Colors** | systemBlue, systemGreen, systemRed | 系统预设色 |

### 系统颜色 Hex 值 (Light Mode 参考)
| 颜色 | Hex | 用途 |
|------|-----|------|
| **System Blue** | #007AFF | 交互元素、链接、主按钮 |
| **System Green** | #34C759 | 成功状态 |
| **System Red** | #FF3B30 | 错误/删除操作 |
| **System Orange** | #FF9500 | 警告 |
| **System Yellow** | #FFCC00 | 注意 |
| **System Purple** | #5856D6 | 强调 |
| **System Gray** | #8E8E93 | 中性元素 |

### Light/Dark Mode
- 语义颜色自动适配 Light/Dark Mode
- Dark Mode 使用 **base** (暗) 和 **elevated** (亮) 两种背景
- 避免使用纯黑 (#000000)，推荐深灰变体

### 对比度要求
- 最低: 4.5:1 (正常文本)
- 推荐: 7:1 (大文本)

## 2.2 字体排版 (Dynamic Type)

### 系统字体
- **San Francisco Pro** (SF Pro): iOS/macOS
- **New York**: 衬线体

### 字号范围
| Text Style | 默认大小 (pt) | 字重 |
|-----------|--------------|------|
| Large Title | 34 | Regular |
| Title 1 | 28 | Regular |
| Title 2 | 22 | Regular |
| Title 3 | 20 | Regular |
| Headline | 17 | Semibold |
| Body | 17 | Regular |
| Callout | 16 | Regular |
| Subheadline | 15 | Regular |
| Footnote | 13 | Regular |
| Caption 1 | 12 | Regular |
| Caption 2 | 11 | Regular |

### 规则
- 最小字号: **11pt**
- 使用系统 Text Styles (如 Body, Title1, Caption2)
- 避免 Ultralight, Thin, Light 字重
- 支持动态字体缩放 (无障碍)

## 2.3 间距系统

### 标准间距值 (pt)
| Token | 值 | 用途 |
|-------|-----|------|
| 4 | 4pt | 最小间距 |
| 8 | 8pt | 紧凑间距 |
| 12 | 12pt | 小间距 |
| 16 | 16pt | 标准间距 |
| 20 | 20pt | 中等间距 |
| 24 | 24pt | 大间距 |
| 32 | 32pt | 超大间距 |

## 2.4 Button 规范

| 属性 | 值 |
|------|-----|
| 最小触控区域 | **44 × 44 pt** |
| 常见圆角 | 10-12pt |
| Apple Pay 按钮 | 4pt 圆角 |
| 胶囊形 | height / 2 |

---

# 3. Carbon Design System (IBM)

**官方文档**: [carbondesignsystem.com](https://carbondesignsystem.com)

## 3.1 颜色系统

### Gray 调色板 (Hex 值)
| Token | Hex | 用途 |
|-------|-----|------|
| Gray 10 | #f4f4f4 | 次要背景 |
| Gray 20 | #e0e0e0 | 微妙边框 |
| Gray 40 | #a8a8a8 | 占位文本 |
| Gray 50 | #8d8d8d | 中度对比边框 |
| Gray 60 | #6f6f6f | 三级文本 |
| Gray 70 | #525252 | 次要文本 |
| Gray 80 | #393939 | 主要文本 (Dark) |
| Gray 100 | #161616 | 主要文本/高对比边框 |

### 主题 (Themes)
- White Theme: `$ui-background` = #ffffff
- Gray 10 Theme: `$ui-01` = #f4f4f4
- Gray 90/100 Theme: Dark UI

## 3.2 字体系统

### Type Scale
| Token | 字号 | 行高 | 字重 | 用途 |
|-------|------|------|------|------|
| heading-01 | 14px | 18px | 600 | 小标题 |
| heading-02 | 16px | 22px | 600 | 次要标题 |
| heading-03 | 20px | 26px | 400 | 主标题 |
| heading-04 | 28px | 36px | 400 | 大标题 |
| heading-05 | 32px | 40px | 300 | 超大标题 |
| body-short-01 | 14px | 18px | 400 | 简短文本 |
| body-long-01 | 14px | 20px | 400 | 长文本 |
| body-short-02 | 16px | 22px | 400 | 大正文 |
| label-01 | 12px | 16px | 400 | 小标签 |

## 3.3 间距系统 (Spacing Scale)

### 基本原则
- 使用 **2/4/8 倍数**
- 支持 Component Spacing 和 Layout Spacing 两套

### Spacing Tokens
| Token | 值 |
|-------|-----|
| $spacing-01 | 2px |
| $spacing-02 | 4px |
| $spacing-03 | 8px |
| $spacing-04 | 12px |
| $spacing-05 | 16px |
| $spacing-06 | 24px |
| $spacing-07 | 32px |
| $spacing-08 | 40px |
| $spacing-09 | 48px |
| $spacing-10 | 64px |
| $spacing-11 | 80px |
| $spacing-12 | 96px |
| $spacing-13 | 160px |

## 3.4 栅格系统 (2x Grid)

- 16 列响应式布局
- 基于 **除2/乘2** 原则
- 边距: 5% (移动端可调)

## 3.5 阴影/层级 (Elevation)

| Level | box-shadow 值 |
|-------|----------------|
| 0 | none |
| 1 | 0 2px 6px rgba(0,0,0,0.3) |
| 2 | 0 4px 8px rgba(0,0,0,0.1) |
| 3 | 0 8px 16px rgba(0,0,0,0.1) |

## 3.6 Button 规范

| Size | Height | Padding Left | Padding Right |
|------|--------|--------------|---------------|
| 2XL | 80px | 16px | 64px |
| XL | 64px | 16px | 64px |
| LG | 48px | 16px | 64px |
| MD | 40px | 16px | 64px |
| SM | 32px | 16px | 64px |
| XS | 24px | 16px | 64px |

---

# 4. Ant Design (Alibaba)

**官方文档**: [ant.design](https://ant.design)

## 4.1 颜色系统

### Token 层级
| 层级 | 说明 |
|-----|------|
| **Seed** | 种子值，修改会影响下游 |
| **Map** | 映射值，从 Seed 派生 |
| **Alias** | 别名，最终使用值 |

### 颜色分类
| 类别 | Token 示例 | 说明 |
|------|-----------|------|
| Primary | colorPrimary | 品牌主色 (#1677ff 蓝) |
| Neutral | colorTextBase | 文本/背景/边框 |
| Functional | colorSuccess, colorWarning, colorError, colorInfo | 状态色 |

### 基础调色板
- 12 核心色
- 每色 10 阶渐变
- 推荐使用第 6 阶作为主色

## 4.2 字体系统

### Type Scale
| Token | 字号 | 行高 | 字重 | 用途 |
|-------|------|------|------|------|
| font-size-sm | 12px | 20px | 400 | 小文本 |
| font-size-base | 14px | 22px | 400 | 正文 (基础) |
| font-size-lg | 16px | 24px | 400 | 大文本 |
| font-size-xl | 20px | 28px | 400 | 副标题 |
| heading-1 | 38px | 46px | 600 | h1 标题 |
| heading-2 | 30px | 38px | 600 | h2 标题 |
| heading-3 | 24px | 32px | 600 | h3 标题 |
| heading-4 | 20px | 28px | 600 | h4 标题 |
| heading-5 | 16px | 24px | 600 | h5 标题 |

### 字体原则
- 基础字号: 14px
- 默认行高: 1.4 倍 (中文适配)
- 段落间距: 至少 1.5 倍字号 (WCAG AAA)

## 4.3 间距系统

### Spacing Tokens
| Token | 值 | 用途 |
|-------|-----|------|
| padding-xs | 8px | 最小内边距 |
| padding-sm | 12px | 小内边距 |
| padding-md | 16px | 中等内边距 |
| padding-lg | 24px | 大内边距 |
| padding-xl | 32px | 超大内边距 |
| margin-xs | 8px | 最小外边距 |
| margin-sm | 12px | 小外边距 |
| margin-md | 16px | 中等外边距 |
| margin-lg | 24px | 大外边距 |
| margin-xl | 32px | 超大外边距 |

## 4.4 Button 规范

| Size | 描述 |
|------|------|
| small | 紧凑 |
| default | 标准 |
| large | 强调 |

| Shape | 效果 |
|-------|------|
| default | 小圆角 |
| round | 胶囊形 |
| circle | 圆形 (icon-only) |

## 4.5 Card 规范

### 尺寸
| Size | 描述 |
|------|------|
| default | 标准卡片 |
| small | 紧凑卡片 |

### 规范
| 属性 | 值 |
|------|-----|
| Padding | 根节点含 padding 样式 |
| 圆角 | 通过 token 自定义 |
| 阴影 | box-shadow (可通过 token 配置) |

## 4.6 Checkbox 规范

| 属性 | 值 | 说明 |
|------|-----|------|
| 图标尺寸 | 默认 | 通过 `transform: scale()` 调整 |
| Label padding | 有间距 | 语义 DOM 控制 |
| 缩放示例 | `scale(1.5)` | 应用到 `.ant-checkbox-inner` |

### 定制方法
- Design Tokens: 通过 `ConfigProvider` 的 `theme` 属性
- 语义 DOM: 使用 `classNames` 和自定义 CSS
- Component Tokens: 组件级别定制

## 4.7 Select 规范

### 尺寸
| Size | Height | 用途 |
|------|--------|------|
| small | 24px | 紧凑表单 |
| default | 32px | 标准（默认） |
| large | 40px | 强调/宽表单 |

### 定制
- `size` prop 控制整体高度
- 语义 DOM 样式: 通过 `classNames` 和 `styles` 对象
- 内部 padding 通过覆盖 `.ant-select-selection` 类

---


# 5. Atlassian Design System

**官方文档**: [atlassian.design](https://atlassian.design)

## 5.1 设计 Token 概述

### 命名规则
```
[属性].[角色].[强调].[交互状态]
例: color.background.danger.bold.hovered
```

## 5.2 颜色系统

### 颜色 Token 类型
| 类型 | 用途 |
|------|------|
| color.text.* | 文本颜色 |
| color.background.* | 背景色 |
| color.icon.* | 图标色 |
| color.border.* | 边框色 |

### 主题支持
- Light / Dark Mode
- WCAG AA 对比度

## 5.3 间距系统

### 基准单位: 8px

| Token | 值 |
|-------|-----|
| space.0 | 0px |
| space.050 | 4px |
| space.100 | 8px |
| space.150 | 12px |
| space.200 | 16px |
| space.300 | 24px |
| space.400 | 32px |
| space.600 | 48px |
| space.800 | 64px |
| space.1000 | 80px |

## 5.4 层级 (Elevation)

| Level | 说明 |
|-------|------|
| Sunken | 凹陷 |
| Default | 默认 |
| Raised | 浮起 |
| Overlay | 覆盖层 |

## 5.5 字体系统

- 使用 **rem** 单位 (1rem = 16px)
- 支持未来的 Typography Theming

---

# 6. Adobe Spectrum

**官方文档**: [spectrum.adobe.com](https://spectrum.adobe.com)

## 6.1 颜色系统

### Token 类型
| 类型 | 说明 |
|------|------|
| Global Tokens | 具体颜色值 (如 blue-900) |
| Alias Tokens | 语义化别名 (随主题变化) |

### 主题
- Light / Dark / Darkest
- 自动适配设备 Color Mode

## 6.2 字体系统

### 字体家族
| 字体 | 用途 |
|------|------|
| Adobe Clean | 主字体 |
| Adobe Clean Serif | 衬线 |
| Adobe Clean Han | 中日韩 |
| Source Code Pro | 等宽/代码 |

### Type Scale
- 比例: **1.125** (Major Second)
- 行高倍数: 1.3x (拉丁) / 1.5x (汉字)

## 6.3 间距系统

| Token | 值 |
|-------|-----|
| spacing-50 | 2px |
| spacing-75 | 4px |
| spacing-100 | 8px |
| spacing-200 | 16px |
| spacing-300 | 24px |

## 6.4 尺寸系统

- T-Shirt Sizing: XS, S, M, L, XL
- 增量: Desktop 8px

## 6.5 Button 规范

### 尺寸 (T-Shirt Sizing)
| Size | 用途 |
|------|------|
| XS | 紧凑 UI |
| S | 小按钮 |
| M | 标准 (默认) |
| L | 大按钮 |
| XL | 特大按钮 |

### 状态
- Default
- Hover
- Focus (蓝色 ring)
- Disabled
- Pending (loading spinner)

## 6.6 Input Field 规范

### 尺寸
| Size | 用途 |
|------|------|
| S | 紧凑表单 |
| M | 标准 |
| L | 大表单 |
| XL | 特大表单 |

### 样式
- Default: 可见背景
- Quiet: 无背景，简洁布局

## 6.7 圆角系统

| 用途 | 值 |
|------|-----|
| 默认 (Desktop) | 4px |
| 默认 (Mobile) | 5px |
| 基础按钮 | Full rounded |

---

# 7. Microsoft Fluent Design 2

**官方文档**: [fluent2.microsoft.design](https://fluent2.microsoft.design)

## 7.1 Token 层级

| 层级 | 说明 |
|------|------|
| **Global Tokens** | 原始值 (hex/px) |
| **Alias Tokens** | 语义化 (支持 Light/Dark/High Contrast) |
| **Control Tokens** | 组件级别 |

## 7.2 颜色系统

### 调色板类型
| 类型 | 用途 |
|------|------|
| Neutral | 表面/文本基础 |
| Shared | Microsoft 365 共享色 |
| Brand | 产品品牌色 |
| Status | 状态指示 |

## 7.3 字体系统

### 平台字体
| 平台 | 字体 |
|------|------|
| Windows/Web | Segoe UI |
| macOS/iOS | San Francisco Pro |
| Android | Roboto |

## 7.4 间距系统

### 基准单位: 4px

| Token | 值 |
|-------|-----|
| sizeNone | 0px |
| size20 | 2px |
| size40 | 4px |
| size80 | 8px |
| size120 | 12px |
| size160 | 16px |
| size240 | 24px |
| size320 | 32px |
| size400 | 40px |
| size480 | 48px |
| size560 | 56px |

## 7.5 阴影/层级 (Elevation)

### Shadow System
- Key Shadow (关键阴影): 定义边缘
- Ambient Shadow (环境阴影): 暗示距离
- 阴影通过模糊值定义 (shadow-2 = 2px blur, shadow-64 = 64px blur)

### Shadow Tokens
| Token | 用途 |
|-------|------|
| shadow-2 | 卡片、FAB pressed |
| shadow-4 | 轻微浮起 |
| shadow-8 | 弹出层 |
| shadow-16 | 模态 |
| shadow-28 | 浮动元素 |
| shadow-64 | 最大浮起 |

### Luminosity 调整
- 根据背景颜色亮度调整阴影不透明度
- 确保品牌色上的一致视觉效果

## 7.6 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| Small | 2px | < 32px 组件 |
| Medium | 4px | 按钮、下拉 |
| Large | 8px | 大按钮 |
| X-Large | 12px | 超大组件 |
| Circle | 50% | 圆形元素 |

---

# 8. Chakra UI

**官方文档**: [chakra-ui.com](https://chakra-ui.com)

## 8.1 Button 尺寸

| Size | 高度约值 |
|------|---------|
| xs | 24px |
| sm | 32px |
| md | 40px |
| lg | 48px |
| xl | 56px |

## 8.2 间距系统

- 基于 4px 网格
- 支持自定义 theme

## 8.3 颜色系统

- 预设调色板: gray, red, orange, yellow, green, teal, blue, cyan, purple, pink
- 每色 10 阶 (50-900)

---

# 9. shadcn/ui

**官方文档**: [ui.shadcn.com](https://ui.shadcn.com)

## 9.1 CSS 变量 (Design Tokens)

### 核心颜色 Tokens
```css
--background: 默认背景色
--foreground: 默认文本色
--primary: 主色
--primary-foreground: 主色上文本
--secondary: 次要色
--secondary-foreground: 次要色上文本
--muted: 柔和背景/文本
--muted-foreground: 柔和元素文本
--accent: 强调色 (hover)
--accent-foreground: 强调色上文本
--destructive: 删除/危险操作
--destructive-foreground: 删除按钮文本
--card: 卡片背景
--card-foreground: 卡片文本
--popover: 弹出层背景
--popover-foreground: 弹出层文本
--border: 边框色
--input: 输入框边框色
--ring: 焦点指示器颜色
--radius: 圆角大小
```

## 9.2 Button 尺寸

| Size | Height | Padding | Tailwind |
|------|--------|---------|----------|
| sm | 36px | px-3 | h-9 |
| default | 40px | px-4 py-2 | h-10 |
| lg | 44px | px-8 | h-11 |
| icon | 40px | - | h-10 w-10 |
| icon-sm | 36px | - | h-9 w-9 |
| icon-lg | 44px | - | h-11 w-11 |

## 9.3 圆角

- 默认: `rounded-md` (≈6px)
- 可通过 radius 变量组自定义

## 9.4 颜色系统

- 使用 CSS Variables
- 支持 Light/Dark Mode (通过 `.dark` class)
- 主题化通过 Tailwind 配置
- HSL 颜色空间 (便于计算变体)

## 9.5 Input Field 规范

| Size | Height | 特征 |
|------|--------|------|
| sm | 36px | h-9 |
| default | 40px | h-10 |
| lg | 44px | h-11 |

## 9.6 Card 规范

### 组件结构
| 组件 | 用途 |
|------|------|
| `<Card>` | 主容器 |
| `<CardHeader>` | 标题区域 |
| `<CardTitle>` | 主标题 |
| `<CardDescription>` | 描述文本 |
| `<CardContent>` | 主内容区 |
| `<CardFooter>` | 底部操作区 |

### Tailwind 类名
| 用途 | 常用类名 |
|------|----------|
| 圆角 | `rounded-lg` (≈8px) |
| 阴影 | `shadow-sm` |
| 边框 | `border` |
| Padding | `p-6` (Card), `p-4` (CardContent) |

## 9.7 Checkbox 规范

| 属性 | Tailwind 类名 | 实际值 |
|------|--------------|--------|
| 尺寸 | `h-4 w-4` | 16px × 16px |
| 圆角 | `rounded-sm` | ≈2px |
| 边框 | `border-primary` | 1px |
| Label 间距 | `space-x-2` | 8px |

### 状态类名
```tsx
peer-disabled:cursor-not-allowed
peer-disabled:opacity-70
data-[state=checked]:bg-primary
```

## 9.8 Radio 规范

| 属性 | Tailwind 类名 | 实际值 |
|------|--------------|--------|
| 外圈 | `h-4 w-4` | 16px 直径 |
| 内圈 | - | 8px 直径 (选中) |
| 圆形 | `rounded-full` | 完全圆形 |

## 9.9 Switch 规范

| 属性 | Tailwind 类名 | 实际值 |
|------|--------------|--------|
| 轨道宽度 | `w-11` | 44px |
| 轨道高度 | `h-6` | 24px |
| Thumb 直径 | `h-5 w-5` | 20px |
| 圆角 | `rounded-full` | 完全圆形 |

---


# 10. Arco Design (ByteDance)

**官方文档**: [arco.design](https://arco.design)

## 10.1 颜色系统

### 主色 (Primary Colors)
- 默认主色: **#165DFF** (Blue-6)
- 13 种预设主色可选

### 基础色板 (Hex 值示例)
| 颜色 | 等级 | Hex | 无障碍等级 |
|------|------|-----|------------|
| **Blue-1** | - | #E8F7FF | AAA |
| **Blue-5** | - | #57A9FB | AAA |
| **Blue-6** | 主色 | #3491FA | AA |
| **Blue-10** | - | #001A4D | - |
| **Green-1** | - | #E8FFEA | AAA |
| **Green-6** | - | #00B42A | AAA |
| **Green-10** | - | #004D1C | - |
| **Red-6** | 错误 | #F53F3F | AA |
| **Orange-6** | 警告 | #FF7D00 | AAA |
| **Yellow-6** | 注意 | #FADC19 | AAA |

## 10.2 字体系统

### 行高规则
- 西文: 1.2x font-size
- 中文: 1.4x font-size (默认)
- 段落间距: 至少 1.5x font-size (WCAG AAA)

### 常用行高
| 行高 | 用途 |
|------|------|
| 20px | 小文本 |
| 32px | 正文 |
| 36px | 副标题 |
| 40px | 主标题 |
| 44px | 大标题 |

## 10.3 间距系统

### 组件尺寸
| Size | 值 | 用途 |
|------|-----|------|
| mini | 24px | Input/Button |
| small | 28px | Input/Button |
| medium (default) | 32px | Input/Button |
| large | 36px | Input/Button |

## 10.4 Button 尺寸

| Size | Height |
|------|--------|
| mini | 24px |
| small | 28px |
| medium | 32px |
| large | 36px |

## 10.5 形状

| Shape | 效果 |
|-------|------|
| circle | 圆形 |
| round | 胶囊形 |
| square | 直角 |

## 10.6 Token 系统

- 使用 Less 变量
- 支持主题定制 (Design Lab)
- 13 色调色板，每色 10 阶渐变

---

# 11. Shopify Polaris

**官方文档**: [polaris.shopify.com](https://polaris.shopify.com)

## 11.1 间距系统 (Middle-Out Scale)

### Spacing Tokens
| Token | 值 | 说明 |
|-------|-----|------|
| spacingNone | 0 | 无间距 |
| spacingExtraTight | 4px | 极紧凑 |
| spacingTight | 8px | 紧凑 |
| spacingBaseTight | 12px | 基础紧凑 |
| spacingBase | 16px | 基础 (默认) |
| spacingLoose | 20px | 宽松 |
| spacingExtraLoose | 32px | 超宽松 |

### Middle-Out 原则
- 从 Base 向两侧扩展
- Small 数字越大 → 值越小 (small-300 < small-100)
- Large 数字越大 → 值越大 (large-300 > large-100)

## 11.2 颜色系统

### HSLuv 色彩空间
- 12 核心色，每色 10-16 阶色调
- 语义化 Tokens: `--p-color-text`, `--p-color-background`
- 对比度: 4.5:1 (正常文本), 7:1 (大文本), 3:1 (UI 组件)

## 11.3 字体系统

### Font Size Tokens (示例)
| Token | 值 | 用途 |
|-------|-----|------|
| --p-font-size-300 | 12px | 小文本 |
| --p-font-size-400 | 16px | 正文 |
| --p-font-size-500 | 20px | 副标题 |
| --p-font-size-600 | 24px | 标题 |

## 11.4 Button 规范

| 属性 | 值 |
|------|-----|
| 最小触控 | 44 × 44px |
| 默认高度 | ~36px |

## 11.5 颜色系统

- 通过 Theme Customizer 配置
- 支持品牌色定制
- npm package: `@shopify/polaris-tokens`

---

# 12. Salesforce Lightning

**官方文档**: [lightningdesignsystem.com](https://lightningdesignsystem.com)

## 12.1 间距系统

### 基准单位: 4px

| Token | 值 |
|-------|-----|
| xxx-small | 2px |
| xx-small | 4px |
| x-small | 8px |
| small | 12px |
| medium | 16px |
| large | 24px |
| x-large | 32px |
| xx-large | 48px |

## 12.2 Button 规范

| 属性 | 值 |
|------|-----|
| 移动端行高 | 2.75rem (44px) |
| 全宽类 | `.slds-button_stretch` |

## 12.3 颜色系统

- 使用 Design Tokens
- 通过 Styling Hooks 自定义

---

# 通用设计原则汇总

## 触控尺寸
| 标准 | 最小值 |
|------|--------|
| Apple HIG | 44pt |
| Material 3 | 48dp (推荐) |
| WCAG | 24px (最低) |

## 间距基准
| 设计系统 | 基准 |
|---------|------|
| Material 3 | 4dp |
| Carbon / Atlassian | 8px |
| Fluent | 4px |

## 圆角规律
| 类型 | 范围 |
|------|------|
| 小圆角 | 2-4px |
| 中圆角 | 6-8px |
| 大圆角 | 12-16px |
| 胶囊形 | height / 2 |

## Token 层级架构
```
┌─────────────────────────────────────────┐
│  Reference / Global / Seed Tokens       │  ← 原始值
├─────────────────────────────────────────┤
│  System / Alias / Map Tokens            │  ← 语义化
├─────────────────────────────────────────┤
│  Component / Control Tokens             │  ← 组件级别
└─────────────────────────────────────────┘
```

---

*文档版本: v2.0 - 完整架构版*
*最后更新: 2024-12-24*
