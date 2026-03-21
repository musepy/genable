# Workflow: 响应式 Landing Page 生成（MCP js + mk 混合）

> 目标: 给定品牌风格 + 内容，生成一个含复用组件、3 断点、Variable Mode 的 Landing Page
> 优化目标: 更快、更准确、更省 token

## 核心原则

1. **js 做架构，mk 做内容** — js 建变量/样式/组件集/绑定，mk 填内容（shorthand 省 token）
2. **一个设计，三个 mode** — 不 clone，用 Component Set variant 响应 mode 切换
3. **每步验证** — 每个 phase 结束 `cat -s` 验证，不积累错误
4. **批量操作** — 一次 js 调用尽量多做事，减少 round trip

## Phase 0: 规划（不执行代码，纯文本）

确认设计 spec:
- 品牌色（bg, accent, text, surface）
- 字体 family + weights
- 断点宽度（如 1440 / 768 / 375）
- Section 列表（NavBar, Hero, Features, Stats, Testimonials, CTA, Footer）
- 每个 section 在 3 个断点的布局差异（横排/竖排、显示/隐藏）

## Phase 1: Foundation — 一次 js 调用建完所有变量 + 样式

一次调用，建完所有基础设施。返回 ID map 供后续引用。

```js
// === Phase 1: Variables + Styles (单次调用) ===

// 0. Font preload
const fonts = ['Regular','Medium','Semi Bold','Bold'].map(s => ({family:'Inter',style:s}))
await Promise.all(fonts.map(f => figma.loadFontAsync(f)))

// 1. Responsive variable collection (3 modes)
const resp = figma.variables.createVariableCollection('Responsive')
resp.renameMode(resp.modes[0].modeId, 'Desktop')
const tabletModeId = resp.addMode('Tablet')
const mobileModeId = resp.addMode('Mobile')
const deskModeId = resp.modes[0].modeId

function fVar(name, d, t, m) {
  const v = figma.variables.createVariable(name, resp, 'FLOAT')
  v.setValueForMode(deskModeId, d)
  v.setValueForMode(tabletModeId, t)
  v.setValueForMode(mobileModeId, m)
  return v
}
function bVar(name, d, t, m) {
  const v = figma.variables.createVariable(name, resp, 'BOOLEAN')
  v.setValueForMode(deskModeId, d)
  v.setValueForMode(tabletModeId, t)
  v.setValueForMode(mobileModeId, m)
  return v
}

// Layout variables
const V = {
  containerPad:   fVar('layout/containerPad', 120, 40, 16),
  sectionPadV:    fVar('layout/sectionPadV', 96, 64, 48),
  sectionGap:     fVar('layout/sectionGap', 120, 80, 64),
  cardGap:        fVar('layout/cardGap', 24, 24, 16),
  // Typography
  heroTitle:      fVar('typo/heroTitle', 72, 56, 36),
  heroSub:        fVar('typo/heroSub', 20, 18, 16),
  sectionTitle:   fVar('typo/sectionTitle', 48, 40, 28),
  bodySize:       fVar('typo/body', 16, 16, 15),
  // Sizing
  btnPadH:        fVar('sizing/btnPadH', 32, 28, 24),
  btnPadV:        fVar('sizing/btnPadV', 16, 14, 12),
  iconSize:       fVar('sizing/iconSize', 48, 40, 36),
  // Visibility
  navLinks:       bVar('visibility/navLinks', true, true, false),
}

// 2. Color variable collection
const colors = figma.variables.createVariableCollection('Colors')
const cMode = colors.modes[0].modeId
function cVar(name, r, g, b) {
  const v = figma.variables.createVariable(name, colors, 'COLOR')
  v.setValueForMode(cMode, {r, g, b, a: 1})
  return v
}
const C = {
  bgPrimary:    cVar('bg/primary', 0.96, 0.94, 0.91),
  bgSurface:    cVar('bg/surface', 1, 1, 1),
  bgDark:       cVar('bg/dark', 0.10, 0.09, 0.08),
  textPrimary:  cVar('text/primary', 0.10, 0.09, 0.08),
  textSecondary:cVar('text/secondary', 0.42, 0.40, 0.38),
  textOnDark:   cVar('text/onDark', 0.96, 0.94, 0.91),
  accent:       cVar('accent/primary', 0.85, 0.47, 0.34),
  accentSubtle: cVar('bg/accentSubtle', 0.99, 0.94, 0.92),
  border:       cVar('border/default', 0.91, 0.89, 0.85),
}

// 3. Text Styles
function textStyle(name, style, size, lineH) {
  const s = figma.createTextStyle()
  s.name = name
  s.fontName = {family: 'Inter', style}
  s.fontSize = size
  s.lineHeight = {value: lineH, unit: 'PERCENT'}
  return s
}
const S = {
  h1: textStyle('Heading/H1', 'Bold', 72, 110),
  h2: textStyle('Heading/H2', 'Bold', 48, 110),
  h3: textStyle('Heading/H3', 'Semi Bold', 20, 140),
  body: textStyle('Body/Regular', 'Regular', 16, 160),
  bodyLg: textStyle('Body/Large', 'Regular', 20, 160),
  label: textStyle('Label/Medium', 'Medium', 14, 140),
  btnLabel: textStyle('Button/Label', 'Semi Bold', 16, 100),
  nav: textStyle('Nav/Link', 'Medium', 15, 100),
  stat: textStyle('Stat/Number', 'Bold', 48, 100),
}

// 返回所有 ID，供后续 phase 引用
return {
  respCollectionId: resp.id,
  modes: {desk: deskModeId, tablet: tabletModeId, mobile: mobileModeId},
  vars: Object.fromEntries(Object.entries(V).map(([k,v]) => [k, v.id])),
  colors: Object.fromEntries(Object.entries(C).map(([k,v]) => [k, v.id])),
  styles: Object.fromEntries(Object.entries(S).map(([k,v]) => [k, v.id])),
}
```

**验证**: 返回的 ID map 完整即成功，不需要截图。

## Phase 2: Atomic Components — js 创建组件 + 绑定变量

用 Phase 1 返回的 ID map 引用变量和样式。

```js
// === Phase 2: Atomic Components ===
// 传入 Phase 1 的 IDs（直接写死或从上一步复制）

// Helper: 获取变量（批量）
async function getVars(ids) {
  const entries = await Promise.all(
    Object.entries(ids).map(async ([k, id]) => [k, await figma.variables.getVariableByIdAsync(id)])
  )
  return Object.fromEntries(entries)
}
const V = await getVars({...})  // Phase 1 的 vars IDs
const C = await getVars({...})  // Phase 1 的 colors IDs

// Helper: 绑定 fill 变量
function bindFill(node, colorVar) {
  const fill = figma.variables.setBoundVariableForPaint(
    {type: 'SOLID', color: {r:0,g:0,b:0}}, 'color', colorVar
  )
  node.fills = [fill]
}

// --- Button/Primary Component ---
const btnP = figma.createComponent()
btnP.name = 'Button/Primary'
// ... layout props ...
// 绑定变量
btnP.setBoundVariable('paddingLeft', V.btnPadH)
btnP.setBoundVariable('paddingRight', V.btnPadH)
btnP.setBoundVariable('paddingTop', V.btnPadV)
btnP.setBoundVariable('paddingBottom', V.btnPadV)
bindFill(btnP, C.accent)
// label 用 textStyleId
const label = figma.createText()
label.textStyleId = S.btnLabel  // 引用 text style
btnP.appendChild(label)
label.characters = 'Button'
bindFill(label, C.textOnDark)

// --- Button/Secondary Component ---
// 同上，不同 fill + stroke

// --- FeatureCard Component ---
// 同上模式
```

**验证**: `cat /Button\// -s` 查看组件截图。

## Phase 3: Layout Components — Component Set 做响应式

**关键步骤**: 创建 CardGrid 和 NavBar 的 Component Set，不同 variant 对应不同断点布局。

```js
// === CardGrid Component Set ===
// Desktop variant: 3 columns horizontal
const gridDesktop = figma.createComponent()
gridDesktop.name = 'Breakpoint=Desktop'
gridDesktop.layoutMode = 'HORIZONTAL'
gridDesktop.itemSpacing = 24
// ... 3 个 FeatureCard instance，layoutSizingHorizontal = 'FILL'

// Tablet variant: 3 columns (tighter gap)
const gridTablet = figma.createComponent()
gridTablet.name = 'Breakpoint=Tablet'
gridTablet.layoutMode = 'HORIZONTAL'
gridTablet.itemSpacing = 16
// ... 3 个 FeatureCard instance

// Mobile variant: 1 column vertical
const gridMobile = figma.createComponent()
gridMobile.name = 'Breakpoint=Mobile'
gridMobile.layoutMode = 'VERTICAL'
gridMobile.itemSpacing = 16
// ... 3 个 FeatureCard instance

// Combine into Component Set
const gridSet = figma.combineAsVariants(
  [gridDesktop, gridTablet, gridMobile],
  figma.currentPage
)
gridSet.name = 'CardGrid'

// --- NavBar Component Set ---
// Desktop: logo + links + CTA (horizontal)
// Mobile: logo + CTA only (links hidden via BOOLEAN variable)
// 或者直接做 2 个 variant
```

**验证**: 在 Figma 中切换 variant 属性，确认 3 种布局都正确。

## Phase 4: Page Assembly — mk 填内容（省 token）

组件建好后，页面组装用 **mk**（不是 js），因为 mk 的 shorthand 更紧凑：

```bash
# mk 创建页面框架
mk /ClaudeLandingPage/ frame w:1440 layout:column bg:#F5F0E8

# NavBar instance
mk /ClaudeLandingPage/NavBar/ instance:NavBar/Breakpoint=Desktop sizingH:fill

# Hero Section
mk /ClaudeLandingPage/HeroSection/ frame layout:column align:center cross:center ph:120 pv:96 gap:48 bg:transparent sizingH:fill
mk /ClaudeLandingPage/HeroSection/Badge/ frame layout:row ph:16 pv:8 corner:100 bg:#FDF0EB
mk /ClaudeLandingPage/HeroSection/Badge/Label text size:14 weight:Medium fill:#DA7756 -- Introducing Claude 4
# ... 更多内容用 mk 填充，每行一个节点，非常紧凑
```

**mk vs js token 对比**:
- mk: `mk /Card/Title text size:24 weight:Bold fill:#1A1714 -- Card Title` = 1 行
- js: 8 行（createText + fontName + characters + fontSize + fills + appendChild + layoutSizing）

**验证**: `cat /ClaudeLandingPage/ -s` 截图检查 Desktop 版。

## Phase 5: Variable Binding — js 批量绑定

页面组装完后，一次 js 调用批量绑定所有 section 的变量：

```js
// === Phase 5: 批量绑定变量 ===
const page = figma.currentPage.findOne(n => n.name === 'ClaudeLandingPage')

// Helper: 递归查找并绑定
function bindSection(section, bindings) {
  for (const [prop, varObj] of Object.entries(bindings)) {
    section.setBoundVariable(prop, varObj)
  }
}

// 所有 section 的 padding 绑定容器变量
const sections = page.findAll(n =>
  n.parent === page && n.type === 'FRAME' && n.name !== 'NavBar'
)
for (const s of sections) {
  s.setBoundVariable('paddingLeft', V.containerPad)
  s.setBoundVariable('paddingRight', V.containerPad)
  s.setBoundVariable('paddingTop', V.sectionPadV)
  s.setBoundVariable('paddingBottom', V.sectionPadV)
}

// 标题字号绑定
const heroTitle = page.findOne(n => n.name === 'Title' && n.parent.name === 'HeroContent')
heroTitle.setBoundVariable('fontSize', V.heroTitle)
// ... 其他绑定
```

## Phase 6: Set Mode + Verify — 切 mode 截图验证

```js
// 设置页面的 variable mode
const collection = await figma.variables.getVariableCollectionByIdAsync(respCollectionId)

// Desktop (default)
page.setExplicitVariableModeForCollection(collection, deskModeId)
```

```bash
# 验证 Desktop
cat /ClaudeLandingPage/ -s

# 切 Tablet
js page.setExplicitVariableModeForCollection(collection, tabletModeId)
cat /ClaudeLandingPage/ -s

# 切 Mobile
js page.setExplicitVariableModeForCollection(collection, mobileModeId)
cat /ClaudeLandingPage/ -s
```

**每个断点截图后立即分析**：
- 文字有没有溢出/换行异常？
- 卡片布局是否正确切换？
- 间距是否合理？
- 元素可见性是否正确？

有问题 → 立即修 → 再截图 → 循环直到完成。

## Phase 7: 展示 — Clone 3 份并排展示（可选）

只有在验证完成后，才 clone 做并排展示：

```js
// 这一步纯粹是展示用，不是设计流程
const tablet = page.clone()
tablet.name += ' — Tablet'
tablet.resize(768, tablet.height)
tablet.x = page.x + 1600
tablet.setExplicitVariableModeForCollection(collection, tabletModeId)

const mobile = page.clone()
mobile.name += ' — Mobile'
mobile.resize(375, mobile.height)
mobile.x = tablet.x + 900
mobile.setExplicitVariableModeForCollection(collection, mobileModeId)
```

---

## Token 效率对比

| 步骤 | 旧 workflow | 新 workflow | 节省 |
|---|---|---|---|
| Variables | 2 次 js 调用 | **1 次** js 调用 | ~30% |
| 组件创建 | 全用 js（冗长） | js 建壳 + mk 填内容 | ~50% |
| 断点实现 | clone 3 份 + 手动改布局 | Component Set variant | ~70% |
| 修复迭代 | 3 轮修复仍未完成 | 每步验证，early catch | ~80% |
| 总计 | ~15 次 MCP 调用，多次失败重试 | ~8 次调用，0 重试 | **~60%** |

## 常见错误速查

| 错误信息 | 原因 | 修复 |
|---|---|---|
| `Cannot call with documentAccess: dynamic-page` | 用了同步 API | 改用 `Async` 版本 |
| `FILL can only be set on children of auto-layout` | appendChild 前设了 FILL | 先 append 再设 |
| `Unrecognized key 'a' in color` | stroke color 带了 alpha | 用 `opacity` 字段 |
| `Invalid enum value for counterAxisSizingMode` | 用了 'FILL' | 子节点用 `layoutSizingHorizontal` |
| `Cannot call setExplicitVariableModeForCollection with collection id` | 传了 string ID | 传 collection 对象 |

## Checklist

- [ ] Phase 0: 设计 spec 确认
- [ ] Phase 1: Variables + Styles（1 次 js 调用）
- [ ] Phase 2: Atomic Components（1-2 次 js 调用）
- [ ] Phase 3: Component Set variants（1-2 次 js 调用）
- [ ] Phase 4: Page assembly（多次 mk 调用，每 section 一次）
- [ ] Phase 5: Variable binding（1 次 js 调用）
- [ ] Phase 6: Mode 切换 + 逐断点截图验证（3 次 cat -s）
- [ ] Phase 7: 并排展示 clone（1 次 js 调用）
