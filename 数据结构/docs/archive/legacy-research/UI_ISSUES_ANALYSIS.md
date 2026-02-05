# UI 问题深度分析文档

## 核心问题分类

---

## 1️⃣ Token 引用错误的根本原因分析

### 问题现象
```css
--panel-default: {Panel.translucent};
--tokens-colors-accent-contrast: {Tokens.Colors.white-contrast};
--tokens-colors-accent-surface: {Colors.Accent.Accent Alpha.2};
```

### 为什么会这样？

#### 来源追踪
1. **Figma Design System Export** 
   - Figma 中的 Token 插件导出时，生成的是这种格式
   - `{Category.TokenName}` 是 Figma 的 **占位符格式**
   - 需要后续的转换工具（如 Style Dictionary）才能变成有效 CSS

2. **缺失的转换步骤**
   ```
   Figma Export (JSON)
        ↓
   Figma Tokens Plugin (生成 {Panel.translucent} 格式)
        ↓
   ❌ Style Dictionary Transform 缺失
        ↓
   CSS Variables (应该是 rgba(255,255,255,0.8) 或 var(--custom-*))
   ```

3. **为什么开发者没发现？**
   - 这些变量在 CSS 中是"无效的但不报错"
   - 浏览器会默默忽略无效的 CSS 变量声明
   - 组件样式看起来"正常"（因为有其他 fallback）

#### 技术细节
- **Figma 导出格式**: `{集合.Token名}`
- **CSS 合法格式**: `rgba()`, `#hex`, `var(--*)` 等
- **浏览器行为**: 
  ```
  --invalid-value: {Some.Token};  /* 浏览器解析失败，忽略整行 */
  color: var(--invalid-value, red);  /* fallback 到 red，不是 {Some.Token} */
  ```

---

### 可识别性差的体现

#### 具体影响
```
场景：某个按钮的背景应该是 "Panel.translucent" (半透明白)
┌─────────────────────────────────────────────┐
│ CSS 期望                                     │
├─────────────────────────────────────────────┤
│ background: var(--panel-default);           │
│ /* --panel-default: rgba(255,255,255,0.8)*/ │
└─────────────────────────────────────────────┘
                    ↓
        ❌ 实际浏览器看到的
┌─────────────────────────────────────────────┐
│ CSS 实际                                     │
├─────────────────────────────────────────────┤
│ background: var(--panel-default);           │
│ /* --panel-default: {Panel.translucent} */ │ ← 无效!
│ /* 浏览器忽略，不使用任何背景色              │
└─────────────────────────────────────────────┘
                    ↓
        🔍 可视结果
┌─────────────────────────────────────────────┐
│ 按钮背景：透明或继承父级背景                 │
│ 与设计稿不符，违反对比度要求                 │
│ 色弱用户看不清                               │
└─────────────────────────────────────────────┘
```

---

## 2️⃣ Color Token 缺失的连锁反应

### 问题现象
```typescript
// colors.ts 声明（有这些值）
export const colors = {
  success: 'var(--success-9)',
  error: 'var(--error-9)',
  warning: 'var(--warning-9)',
}

// css.ts 定义（缺少这些变量）
:root {
  /* 有 Radix 的所有颜色: */
  --amber-1: #FEFDFB;
  --amber-2: #FEFBE9;
  /* ... 等 */
  
  /* 缺少这些: */
  /* ❌ --success-1 到 --success-12 */
  /* ❌ --error-1 到 --error-12 */
  /* ❌ --warning-1 到 --warning-12 */
}
```

### 连锁反应

#### 1. 直接影响：样式无效

```css
/* css.ts 第 1129-1134 */
.error-banner {
  background: var(--error-1);      /* ❌ --error-1 未定义 */
  border: 1px solid var(--error-6); /* ❌ --error-6 未定义 */
  color: var(--error-11);           /* ❌ --error-11 未定义 */
}

浏览器解析：
┌─────────────────────────────────┐
│ background: [无效-忽略]          │
│ border: [无效-忽略]              │
│ color: [无效-忽略]               │
└─────────────────────────────────┘

结果：.error-banner 失效，无法正确显示错误样式
```

#### 2. 运行时影响：组件渲染异常

```typescript
// 假设某个 Alert 组件
function Alert({ variant = 'error' }) {
  return (
    <div style={{
      background: variant === 'error' 
        ? tokens.colors.error  // 值是 'var(--error-9)'
        : tokens.colors.success, // 值是 'var(--success-9)'
    }}>
      {/* 内容 */}
    </div>
  );
}

// 浏览器尝试应用样式：
background: var(--error-9);
/* --error-9 未定义，浏览器使用初始值或继承 */
/* 用户看不到预期的红色警告背景 */
```

#### 3. 可访问性问题：对比度失效

```
需求 (WCAG AA)：错误文本对背景的对比度 ≥ 4.5:1

设计本意：
┌─────────────────────────────┐
│ background: #FED5D4 (淡红)  │
│ color: #911D1A (深红)       │ → 对比度 ✅ 7.2:1
└─────────────────────────────┘

实际渲染 (Token 无效)：
┌─────────────────────────────┐
│ background: 继承/白色/默认   │
│ color: 继承/黑色/默认        │ → 对比度 ❌ 可能不符
└─────────────────────────────┘
```

#### 4. 维护性问题：不可追踪

开发者调试流程：
```
1. 看到 .error-banner 样式无效
2. 打开 Chrome DevTools
3. 看到 background: var(--error-1) ✓ (看起来对啊)
4. 但 --error-1 值显示 "undefined" 或 "(invalid)"
5. 查阅文档... 文档写的是 --error-1 应该存在
6. 在 css.ts 中搜索... 找不到 --error-1 定义
7. 15 分钟后才意识到是 Token 缺失问题
   → 开发时间浪费，用户体验受损
```

---

### 为什么会缺失？

#### 假设场景
```
设计师工作流：
1. 在 Figma 中创建了 success/error/warning 颜色变量
2. 使用 Figma Tokens Plugin 导出为 tokens.json

导出结果：
{
  "success": {
    "0": "#...",
    "1": "#...",
    ...
  }
}

开发者工作流：
1. ❌ 忘记将 success/error/warning 转换为 CSS
2. ✅ 只转换了 amber, grass, crimson（Radix scales）
3. ✅ 在 TypeScript 中创建了 colors.ts 引用它们
4. 代码审查时没发现（因为没有自动化检查）

结果：
- colors.ts 指向不存在的 CSS 变量
- 运行时才会出错
```

---

## 3️⃣ Font Weight 非法值的影响

### 问题代码
```typescript
// src/ui/design-system/tokens/typography.ts
export const fontWeight = {
  bold: 'Bold',      // ❌ CSS 不认识
  light: 'Light',    // ❌ CSS 不认识
  medium: 'Medium',  // ❌ CSS 不认识
  regular: 'Regular' // ❌ CSS 不认识
}

// 在组件中使用
<span style={{ fontWeight: tokens.fontWeight.medium }}>
  文字
</span>

// 浏览器尝试应用：
<span style="font-weight: Medium;">
  /* ❌ 浏览器不认识 'Medium', 使用初始值 400 (normal) */
</span>
```

### CSS 标准要求

```css
/* 合法的 font-weight 值 */
font-weight: 100;       /* thin */
font-weight: 200;       /* extralight */
font-weight: 300;       /* light */
font-weight: 400;       /* normal (default) */
font-weight: 500;       /* medium */
font-weight: 600;       /* semibold */
font-weight: 700;       /* bold */
font-weight: 800;       /* extrabold */
font-weight: 900;       /* black */
font-weight: normal;    /* 等同于 400 */
font-weight: bold;      /* 等同于 700 */
```

### 实际影响

#### 文本可读性降低

```
设计稿期望：
┌──────────────────────┐
│ 标题（Bold 700）     │ ← 明显加粗，视觉层级清晰
│ 内容（Regular 400）  │
│ 辅助（Light 300）    │ ← 明显变细，降低视觉权重
└──────────────────────┘

实际渲染：
┌──────────────────────┐
│ 标题（Font: Medium） │ ← 浏览器无视，使用默认 400
│ 内容（Font: Regular）│ ← 跟标题一样粗，无层级差
│ 辅助（Font: Light）  │ ← 仍然是 400，没有变细
└──────────────────────┘

后果：
- 用户难以区分不同重要性的内容
- 易疲劳感（无视觉休息）
- 无障碍性降低（色弱/视力差用户更难）
```

#### 代码跟踪困难

```typescript
// Button.tsx 第 31 行
fontWeight: tokens.fontWeight.medium,
/* 值是 'Medium' */
/* ✅ 在代码中看起来合理 */
/* ❌ 但在浏览器中无效 */

// 调试步骤
1. 看到按钮字体"不够粗"
2. 检查 CSS
3. 看到 font-weight: Medium  ✓ 看起来对
4. 查 MDN 文档... 'Medium' 不是合法值
5. 才意识到 tokens.fontWeight.medium = 'Medium' 是错的
   → 需要改成 500
```

---

## 4️⃣ 样式分散导致的维护成本

### 问题映射

#### Button 组件的 4 处定义

```
需求：修改所有按钮的高度从 40px 到 48px
```

**文件 1**: `src/ui/styles.ts`
```typescript
btnPrimaryStyle = {
  height: '40px',  // ← 需要改成 48px
  padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
}
```

**文件 2**: `src/ui/components/Button.tsx`
```typescript
const sizeStyles: Record<...> = {
  sm: {
    height: tokens.size.button.sm,  // ← 可能需要检查
  },
  md: {
    height: 40,  // ← 需要改成 48px
  },
  lg: {
    height: tokens.size.button.xl,  // ← 可能需要检查
  }
}
```

**文件 3**: `src/ui/design-system/tokens/css.ts`
```css
--tokens-space-button-height-1: {Spacing.5};  /* 24px → 需要同步 */
--tokens-space-button-height-2: {Spacing.6};  /* 32px → 需要同步 */
```

**文件 4**: `src/ui/components/Header.tsx`
```typescript
width: 28,   // ← icon button 的高宽，也要统一吗？
height: 28,
```

### 修改成本分析

```
❌ 错误流程（需要 4-5 处改动）
1. 改 styles.ts
2. 改 Button.tsx (3 处)
3. 改 css.ts (4 处)
4. 改 Header.tsx (如果统一)
5. 查找其他硬编码的 40px... (未知数)
6. 交叉验证... (容易遗漏)

结果：
- 🐛 遗漏其中某一处，UI 不一致
- ⏱️ 修改时间长
- 😰 改完后需要完整回归测试
- 📝 修改记录难以追踪（4 个文件的 git diff）
```

---

### Color Token 映射不一致的级联效应

#### 问题链

```
css.ts：
--colors-semantic-success-1: var(--green-1);  ← 使用 green scale

colors.ts：
success: 'var(--success-9)',  ← 期望 success scale

使用处：
tokens.colors.success  → 'var(--success-9)'
/* 但 css.ts 中没定义 --success-9 */
/* 浏览器降级到 var(--green-1)... 不对 */
/* 实际上是 invalid，无法降级 */
```

#### 可能的 Bug 场景

```typescript
// 某个 Alert 组件
function Alert({ severity = 'info' }) {
  const colorMap = {
    info: tokens.colors.accent,    // → var(--accent-9) ✓
    success: tokens.colors.success, // → var(--success-9) ❌ 未定义
    error: tokens.colors.error,     // → var(--error-9) ❌ 未定义
    warning: tokens.colors.warning  // → var(--warning-9) ❌ 未定义
  };
  
  return (
    <div style={{ background: colorMap[severity] }}>
      {/* 
        error 和 warning 的背景颜色永远无效
        用户无法区分三种告警级别
        可能导致用户忽视重要的错误提示
      */}
    </div>
  );
}
```

---

## 5️⃣ 可访问性缺陷的用户影响

### 无 ARIA 属性的后果

#### 场景 1：盲人用户用屏幕阅读器

```html
<!-- Header.tsx 当前代码 -->
<button 
  className={getIconBtnClass(newChatVisible, newChatEnabled)}
  onClick={onNewChat}
  aria-disabled={!newChatEnabled}
>
  <Plus size={12} />
  <span>{t.newDesign}</span>  <!-- 只有这个被读到 -->
</button>

<!-- 屏幕阅读器朗读内容 -->
"新设计 按钮"  ✓ 这还不够

<!-- 期望的信息 -->
"新设计 按钮，当前状态：禁用"  ← 需要 aria-label 或 title
```

#### 场景 2：键盘用户

```
问题：某些按钮无法用 Tab 键访问

当前代码：
<div style={{ /* icon button styles */ }}>
  {/* 没有 role="button" 或 <button> 标签 */}
</div>

键盘用户的体验：
1. 按 Tab 键循环焦点
2. 跳过了这个 "按钮"（实际是 div）
3. 无法通过键盘操作它
4. 必须用鼠标
   → 用户沮丧，功能不可达
```

#### 场景 3：视力障碍用户

```
现状：某些颜色对比度不足

css.ts 定义的颜色可能是：
--gray-11: #b4b4b4  (浅灰)
--gray-12: #eeeeee  (超浅灰)

对比度：
#b4b4b4 vs #eeeeee = 1.3:1  ❌ WCAG 要求 4.5:1

用户体验：
- 正常人：能看清
- 色弱/近视用户：分不清
- 低视力用户：根本看不见
   → 无法使用该 UI
```

---

### 可识别性问题的具体表现

```
用户视点（对比度问题）：

┌─────────────────────────────┐
│ 灰色背景 (#eeeeee)           │
│                             │
│ 浅灰文字 (#b4b4b4)：看不清   │ ← 用户投诉
│                             │
│ 黑色文字 (#000000)：清晰     │
└─────────────────────────────┘

设计视点：
"这只是辅助文本，应该浅一点啊"

开发视点：
"Token 就是这么定义的，我照着用啊"

用户视点：
"我看不见，这是什么？"
```

---

## 6️⃣ 深色模式配置的混乱

### 问题结构

```css
/* 定义 1：媒体查询 (行 1056-1079) */
@media (prefers-color-scheme: dark) {
  :root {
    --gray-1: #111111;
    --gray-2: #191919;
    /* ... 完整的 gray 色阶 */
    
    /* ❌ 但 success/error/warning 没定义 */
  }
}

/* 定义 2：属性选择器 (行 1082-1087) */
[data-theme="dark"] {
  --color-background: var(--gray-1);
  --color-surface: var(--gray-2);
  /* ❌ 只有 4 个变量 */
  
  --gray-1: #111111;
  --gray-12: #eeeeee;
}
```

### 优先级冲突

```
浏览器解析（按 CSS 级联规则）：

用户系统设置：深色模式
┌──────────────────────────────┐
│ @media (prefers-color-scheme: dark)
│   ↓ 优先级：媒体查询
│   --gray-1: #111111 ✓
└──────────────────────────────┘

开发者手动设置：浅色主题
┌──────────────────────────────┐
│ <html data-theme="light">
│ [data-theme="dark"] {         ❌ 选择器不匹配
│   --gray-1: #111111           ← 未应用
│ }
└──────────────────────────────┘

结果：
- 系统设置深色 + 开发者设置浅色 = 用户困惑
- 无法通过 data-theme 覆盖媒体查询
  （CSS 级联原则：属性选择器优先级是 0-1-0，媒体查询不影响优先级）
```

### 功能性问题

```
情景 1：用户系统是深色，网站要求浅色
<html data-theme="light">

期望：浅色显示
实际：
  @media (prefers-color-scheme: dark) 匹配  ✓
  --gray-1 = #111111  (深色)
  → 显示深色（违背 data-theme 意图）

情景 2：用户系统是浅色，网站检测后强制深色
<html data-theme="dark">

期望：深色显示
实际：
  [data-theme="dark"] 选择器匹配  ✓
  但这个规则内的变量不完整
  --success-1 etc. 未定义
  → 成功/失败提示无色
```

---

## 7️⃣ Letter Spacing 精度问题

### 问题代码

```typescript
// css.ts
--typography-letter-spacing-1: 0.03999999910593033;  /* 浮点溢出 */
--typography-letter-spacing-9: -0.4000000059604645;
```

### 技术根源

```
Figma 导出流程：

Figma UI (小数设计)
  ↓
Figma 内部表示 (IEEE 754 浮点数)
  ↓
JSON 导出 (完整精度输出)

Figma JSON:
{
  "letter-spacing": 0.03999999910593033  ← 这是浮点近似值
}

实际设计值：
设计师可能输入的是 0.04em，但 Figma 内部存储为 0.04 的浮点近似值
导出时完整保留，导致看起来很奇怪的数字
```

### 实际影响（微乎其微）

```css
/* 两种写法在浏览器中的渲染差异：*/

letter-spacing: 0.03999999910593033em;
  → 浏览器计算: 0.64px (12px 字体)
  → 完全无法感知的差异

letter-spacing: 0.04em;
  → 浏览器计算: 0.64px
  → 相同结果

可视差异：几乎为 0
代码可维护性：⬆️ 大幅提升
```

---

## 8️⃣ 字体族备选方案不足

### 现状问题

```css
--typography-font-family-text: SF Pro;
/* ❌ SF Pro 是苹果字体，仅在 macOS 11+ 和 iOS 可用 */
```

### 跨平台体验

```
macOS 用户：
  ✓ SF Pro 可用
  ✓ 看到最佳设计

Windows 用户：
  ❌ SF Pro 不可用
  ❓ 浏览器使用默认衬线字体 (Times New Roman)
  ✗ 外观完全不同，看不到设计本意

Android 用户：
  ❌ SF Pro 不可用
  ❓ 浏览器使用默认字体 (Noto Sans)
  ✓ 相对好一点

最坏情况 (无 fallback)：
Windows + IE 11:
  → serif (衬线字体，完全错误)
```

---

## 总结：三层问题模型

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户层 (用户看到的问题)                                         │
├─────────────────────────────────────────────────────────────────┤
│ • 按钮看不清 (Token 占位符)                                     │
│ • 错误提示无法识别 (Color Token 缺失)                           │
│ • 无法用键盘操作 (缺 ARIA)                                      │
│ • 不同设备外观不同 (字体备选)                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 开发者层 (维护的难度)                                           │
├─────────────────────────────────────────────────────────────────┤
│ • 样式分散在多个文件，修改耗时                                   │
│ • Token 映射不一致，容易出 Bug                                  │
│ • 调试困难，需要在多个文件间跳转                                 │
│ • 无自动化检查，靠人工审查容易遗漏                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 架构层 (设计系统的完整性)                                       │
├─────────────────────────────────────────────────────────────────┤
│ • Token 定义与使用不同步 (CSS vs TS)                           │
│ • Figma ↔ 代码的转换工具链不完整                                │
│ • 无文档/规范，新开发者易踩坑                                   │
│ • 主题系统配置冲突 (媒体查询 vs 属性选择器)                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 问题优先级与风险评估

### 影响用户体验的问题（立即修复）
1. **Token 占位符** → 导致部分样式无效
2. **Color Token 缺失** → 功能性功能（错误提示）失效
3. **ARIA 缺失** → 无障碍用户无法使用

### 影响可维护性的问题（2 周内修复）
4. **样式分散** → 维护成本高
5. **Semantic Color 冗余** → 团队协作困难
6. **深色模式混乱** → 主题系统不可靠

### 代码质量问题（1 月内优化）
7. **Letter Spacing 精度** → 可读性低，但实际影响微小
8. **字体备选** → 仅影响无 fallback 的老旧浏览器
9. **Font Weight 格式** → 已有 workaround，但应规范化

---

**文档完成时间**: 2026-01-28
