# MCP js 命令生成 Landing Page — 过程记录与改进方案

> 日期: 2026-03-17
> 任务: 用 MCP `mcp__figma-plugin__run` 的 `js` 命令创建 Claude 风格 Landing Page，含复用组件、3 响应式断点、Variable Mode

## 1. 任务目标

- Claude 品牌风格 Landing Page（暖色调 #F5F0E8 底、#DA7756 accent、Inter 字体）
- 复用组件：Button、FeatureCard、TestimonialCard、NavBar
- 3 个响应式断点：Desktop 1440px、Tablet 768px、Mobile 375px
- 使用 Figma Variable Mode 驱动响应式数值变化

## 2. 执行步骤回顾

### Step 1: 创建 Variable Collection（成功）
```js
// Responsive 集合 + 3 modes
const collection = figma.variables.createVariableCollection('Responsive')
collection.renameMode(collection.modes[0].modeId, 'Desktop')
collection.addMode('Tablet')
collection.addMode('Mobile')

// 12 个 FLOAT 变量（layout/*, typo/*, sizing/*）
figma.variables.createVariable('layout/containerPadding', collection, 'FLOAT')
// setValueForMode() per mode
```

### Step 2: 创建 Color Variables（成功）
```js
// 独立 Colors 集合，10 个 COLOR 变量
figma.variables.createVariable('bg/primary', collection, 'COLOR')
// setValueForMode() with {r, g, b, a} — 注意 a 是 alpha 不是 opacity
```

### Step 3-4: 创建组件（成功，有踩坑）
- Button/Primary + Button/Secondary — 用 `figma.createComponent()` 创建
- FeatureCard — icon 用 `figma.createNodeFromSvg()` 导入
- TestimonialCard — avatar 用 `figma.createEllipse()`
- NavBar — 包含 Button 实例 `btnComp.createInstance()`

### Step 5-8: 组装 Landing Page（成功）
- 主框架 `figma.createFrame()` + 各 section
- 用组件实例填充：`component.createInstance()`
- 绑定变量：`node.setBoundVariable('paddingLeft', variable)`

### Step 9: 创建 3 断点（部分成功）
```js
// 用 clone 复制整个页面
const tablet = page.clone()
tablet.resize(768, tablet.height)
// 设置 variable mode
tablet.setExplicitVariableModeForCollection(collection, tabletModeId)
```

### Step 10: 修复 Mobile 布局（未完成）
- 改了 CardGrid 从 HORIZONTAL → VERTICAL
- 改了 Stats/Footer 布局方向
- **但没有验证修复效果，没有迭代到完成**

## 3. 最终状态（失败点）

### Desktop — 基本完成
- 所有 section 正常渲染
- 变量绑定生效，间距/字号正确

### Tablet — 部分失败
- 上半部分 OK，变量驱动的数值缩小生效
- **Footer 下方出现重复 section**（可能是 clone 后的布局溢出或者有额外节点）
- FeatureCard 3 列挤压但仍可读

### Mobile — 严重失败
- Hero section 基本 OK（变量驱动字号缩小）
- **FeatureCard grid**: 虽然改成了 VERTICAL，cards 宽度修复了，但截图显示 3 根黑条 — 可能是 card 内部的 content sizing 没有正确传播到所有实例层级
- **Stats section**: 数值正确竖排，但上方有大段空白
- **Testimonials section**: "Loved by teams everywhere" 逐字换行（section header maxWidth=600 但 Testimonials 的 header 可能没有正确 fill）
- **CTA section**: "Ready to get started?" 逐字换行（同样的 maxWidth 问题）
- **Footer**: 链接列重叠
- 大量空白间隙

## 4. API 踩坑记录

| # | 踩坑 | 正确做法 |
|---|---|---|
| 1 | `figma.variables.getVariableById()` | 必须用 `getVariableByIdAsync()` — dynamic-page mode |
| 2 | `node.layoutSizingHorizontal = 'FILL'` 在 appendChild 前设置 | **必须先 appendChild 再设 FILL** — 节点还没在 auto-layout 父容器中时不能设 FILL |
| 3 | `stroke.color = {r, g, b, a}` | stroke 的 color 不接受 `a` 字段，alpha 用 `stroke.opacity` 控制 |
| 4 | `counterAxisSizingMode = 'FILL'` | 顶层节点只有 `'FIXED' | 'AUTO'`，`FILL` 是 `layoutSizingHorizontal/Vertical` 的值 |
| 5 | `setExplicitVariableModeForCollection(collectionId, modeId)` | 第一个参数必须传 **collection 对象**不是 string ID |
| 6 | 组件实例 `layoutSizingHorizontal` | 改了 parent 的 layoutMode 后，子节点的 sizing 不自动适配，需要**逐个重设** |
| 7 | `counterAxisSizingMode` vs `layoutSizingHorizontal` | 顶层节点用 `primaryAxisSizingMode`/`counterAxisSizingMode`；子节点用 `layoutSizingHorizontal`/`layoutSizingVertical` |

## 5. 根因分析 — 为什么 Mobile 失败

### 5.1 根本方法论错误：clone + 手动改 ≠ 响应式设计

用 `page.clone()` + 手动改 `layoutMode` 的做法是**硬编码式响应式**，不是 Figma 原生响应式。正确做法：

**Component Set + Variable Mode = 真正的响应式**

```js
// 创建 CardGrid 组件，有 Breakpoint 属性
const desktop = figma.createComponent()
desktop.name = 'Layout=Desktop'
desktop.layoutMode = 'HORIZONTAL'

const mobile = figma.createComponent()
mobile.name = 'Layout=Mobile'
mobile.layoutMode = 'VERTICAL'

// 合成 Component Set
const set = figma.combineAsVariants([desktop, mobile], figma.currentPage)

// 用 STRING 变量 + component property 联动 mode
```

这样切换 Variable Mode 时，组件自动切换 variant，不需要 clone 三份。

### 5.2 没有用 Style 复用

```js
// 应该创建 Text Style 复用
const headingStyle = figma.createTextStyle()
headingStyle.name = 'Heading/H1'
headingStyle.fontName = { family: 'Inter', style: 'Bold' }
headingStyle.fontSize = 72
// 然后节点绑定 style
textNode.textStyleId = headingStyle.id
```

好处：改一处 style，所有绑定节点同步更新。

### 5.3 Variable 类型没有充分利用

只用了 `FLOAT` 和 `COLOR`，遗漏了：

| 类型 | 可以做什么 | 本次遗漏 |
|---|---|---|
| `STRING` | 按断点切换文本内容（如"Learn More"→"More"） | 没用 |
| `BOOLEAN` | 按断点显示/隐藏元素（如 mobile 隐藏 nav links） | 用了 `visible = false` 硬编码 |
| `COLOR` | 已使用 | OK |
| `FLOAT` | 已使用 | OK |

正确做法：NavBar 的 Links 应该绑定 `BOOLEAN` 变量，Desktop=true, Mobile=false，而不是在 clone 后手动设 `visible = false`。

### 5.4 修复循环不彻底

发现问题 → 修一轮 → 截图 → 宣布完成。但实际上：
- 修完 CardGrid layoutMode 后没验证 card 内部 content 的 sizing 传播
- Stats section 改成 VERTICAL 后子节点的 layoutSizingVertical 从 FILL 改成了 HUG 但可能还有残留的 fixed height
- 没有对 Testimonials/CTA 的 maxWidth 在窄屏做适配
- **应该持续循环：修 → 截图 → 分析 → 修 → 截图，直到所有 section 视觉正确**

## 6. 下次改进方案

### 6.1 架构：Component Set + Variable Mode

```
Component Set "Section/CardGrid"
├── Variant: Layout=Desktop  →  HORIZONTAL, 3 columns
├── Variant: Layout=Tablet   →  HORIZONTAL, 2 columns (wrap)
└── Variant: Layout=Mobile   →  VERTICAL, 1 column

Variable: layout/breakpoint (STRING)
  Desktop = "Desktop"
  Tablet  = "Tablet"
  Mobile  = "Mobile"

→ CardGrid instance.componentProperties.Layout = variable binding
→ 切换 mode 自动切换 variant
```

### 6.2 分层创建策略

1. **Variables 层**（先建完整变量系统）
   - FLOAT: spacing, sizing, typography
   - COLOR: brand colors (可以做 dark mode 扩展)
   - BOOLEAN: element visibility per breakpoint
   - STRING: breakpoint name (驱动 component set 切换)

2. **Styles 层**（创建可复用样式）
   - Text Styles: Heading/H1-H4, Body/Regular, Body/Small, Label
   - Paint Styles: 如果不用 variable，用 paint style 也行
   - Effect Styles: shadow, blur

3. **Components 层**（原子 → 组合）
   - Atoms: Button, Badge, Avatar, Icon
   - Molecules: FeatureCard, TestimonialCard, StatItem
   - Organisms: NavBar, Footer, Section (with CardGrid variant set)
   - 每个组件都绑定 variable 做响应式

4. **Page 层**（组装，只用实例）
   - 只创建一个 page frame
   - 设置 variable mode → 切换断点
   - 不需要 clone 三份

### 6.3 验证循环

```
每个 section 创建后：
1. cat /section/ -s  → 截图检查
2. 有问题 → 修复
3. 再 cat -s → 确认修复
4. 全部 section 完成后，切换 mode 验证 3 个断点
5. 有问题的断点 → 修复 → 截图 → 循环直到完成
```

**关键原则：不要在视觉未验证前宣布完成。**

### 6.4 Font 预加载模式

每次 js 调用开头批量加载所有需要的字体：
```js
const fonts = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Inter', style: 'Medium' },
  { family: 'Inter', style: 'Semi Bold' },
  { family: 'Inter', style: 'Bold' },
]
await Promise.all(fonts.map(f => figma.loadFontAsync(f)))
```

### 6.5 错误处理模式

```js
// 安全的属性设置 — 先 append 再设 sizing
parent.appendChild(child)
child.layoutSizingHorizontal = 'FILL'  // safe after append

// 安全的 variable 获取
const v = await figma.variables.getVariableByIdAsync(id)  // always async

// 安全的 stroke/fill — color 对象不带 a
node.strokes = [{ type: 'SOLID', opacity: 0.3, color: { r, g, b } }]
```

## 7. js 能力边界确认

### 能做且做得好
- Variable collection/mode/variable 创建 + 绑定
- Component 创建 + instance 创建
- SVG 导入 (`createNodeFromSvg`)
- Clone (`node.clone()`)
- 复杂查询 (`findAll` with predicates)
- 结构性布局修改 (`layoutMode`, `layoutWrap`)
- 视口控制 (`viewport.scrollAndZoomIntoView`)
- Font 加载 (`loadFontAsync`)

### 能做但不如 mk
- 常规节点创建 — js 写 Figma API 很冗长，mk 的 shorthand 紧凑得多
- 属性设置 — js 需要精确的 Figma API 属性名和格式，mk 有 shorthand 映射
- Font 处理 — mk 自动通过 fontBus 加载字体，js 需手动 loadFontAsync
- 错误恢复 — mk 有 executor rollback，js 出错就停

### 不能做
- 网络请求 (fetch blocked in sandbox)
- DOM 操作
- 动态 import
- eval() (blocked, use new Function() workaround)

## 8. 关键改进优先级

| 优先级 | 改进 | 影响 |
|---|---|---|
| P0 | 用 Component Set + Variable Mode 替代 clone | 真正的响应式，一份设计 3 种模式 |
| P0 | 修复验证循环 — 不放过视觉问题 | 质量保障 |
| P1 | 用 BOOLEAN variable 控制元素可见性 | 响应式隐藏 nav links 等 |
| P1 | 用 Text Style 复用排版 | 一处修改全局同步 |
| P2 | 用 STRING variable 驱动 variant 切换 | Component Set 联动 |
| P2 | Section 级别组件化 | 更好的复用和维护 |
