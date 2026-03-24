# HTML → Figma 编译器可行性分析

> 基于 `@figma/plugin-typings@1.109.0` 的 Mixin 类型系统，分析 HTML/CSS 到 Figma 节点的确定性映射。

---

## 1. 结论

| CSS 子集 | 覆盖率 | 映射精度 | 方法 |
|----------|--------|---------|------|
| Flexbox 布局 | ~90% 现代 UI | 精确 | 确定性编译 |
| 视觉属性 (色/边/角/影) | ~95% | 精确 | 查表 |
| 文本排版 | ~85% | 精确（需字体解析） | 查表 + 字体库 |
| Grid 布局 | ~10% 场景 | 近似 | layoutWrap 降级 |
| Float / Inline | 遗留场景 | 不精确 | 计算 px 硬编码 |

**对 Flexbox + 常用视觉属性（覆盖现代 UI ~90%），可以写确定性编译器，不需要 LLM。**

---

## 2. 精确映射表

### 2.1 节点类型映射

```
HTML 元素                            Figma 节点类型
──────────────────────────────────────────────────────────────
<div> (有 display:flex)          →   FrameNode (layoutMode != 'NONE')
<div> (无 flex，纯包裹)          →   FrameNode (layoutMode: 'NONE')
<span>, <p>, <h1-h6>, <label>   →   TextNode
<img src="...">                  →   RectangleNode + fills: [{type:'IMAGE'}]
<svg>                            →   VectorNode 或 FrameNode(含子 vector)
<input>, <button>                →   FrameNode + 子 TextNode
<hr>                             →   RectangleNode (h:1)
<ul>/<ol>                        →   FrameNode (layout:column)
<li>                             →   FrameNode (layout:row) + 子 TextNode
<table>                          →   FrameNode 嵌套（Figma TableNode 不适合 UI）
<a>                              →   TextNode (fills 设为链接色)
<video>/<audio>                  →   RectangleNode (占位)
```

### 2.2 Flexbox → AutoLayoutMixin

```
CSS                                  Figma AutoLayoutMixin             精度
──────────────────────────────────────────────────────────────────────────
display: flex                    →   layoutMode: 'HORIZONTAL'         精确
flex-direction: column           →   layoutMode: 'VERTICAL'           精确
flex-direction: row-reverse      →   layoutMode: 'HORIZONTAL'         ⚠️ 需 itemReverseZIndex
flex-wrap: wrap                  →   layoutWrap: 'WRAP'               精确
gap: 16px                        →   itemSpacing: 16                  精确
row-gap: 8px                     →   itemSpacing: 8 (主轴方向时)      精确
column-gap: 12px                 →   counterAxisSpacing: 12           精确
padding: 24px                    →   paddingTop/Right/Bottom/Left:24  精确
padding: 16px 24px               →   paddingTop/Bottom:16,            精确
                                     paddingLeft/Right:24

justify-content: flex-start      →   primaryAxisAlignItems: 'MIN'     精确
justify-content: center          →   primaryAxisAlignItems: 'CENTER'  精确
justify-content: flex-end        →   primaryAxisAlignItems: 'MAX'     精确
justify-content: space-between   →   primaryAxisAlignItems:           精确
                                     'SPACE_BETWEEN'
justify-content: space-around    →   ✗ Figma 无此选项                 降级为 SPACE_BETWEEN
justify-content: space-evenly    →   ✗ Figma 无此选项                 降级为 SPACE_BETWEEN

align-items: flex-start          →   counterAxisAlignItems: 'MIN'     精确
align-items: center              →   counterAxisAlignItems: 'CENTER'  精确
align-items: flex-end            →   counterAxisAlignItems: 'MAX'     精确
align-items: stretch             →   counterAxisAlignItems: 'MIN'     精确
                                     + child.layoutAlign: 'STRETCH'
align-items: baseline            →   counterAxisAlignItems: 'BASELINE' 精确

align-content: space-between     →   counterAxisAlignContent:         精确
(仅 wrap 模式)                       'SPACE_BETWEEN'
```

### 2.3 尺寸 → LayoutMixin / AutoLayoutChildrenMixin

```
CSS                  父节点上下文        Figma                          精度
──────────────────────────────────────────────────────────────────────────
width: 400px         任意            →   resize(400,h)                  精确
                                        layoutSizingH: 'FIXED'
height: 300px        任意            →   resize(w,300)                  精确
                                        layoutSizingV: 'FIXED'
width: 100%          父是 flex       →   layoutSizingH: 'FILL'          精确
width: auto          父是 flex       →   layoutSizingH: 'HUG'           精确
width: fit-content   任意            →   layoutSizingH: 'HUG'           精确
width: min-content   任意            →   layoutSizingH: 'HUG'           近似
width: max-content   任意            →   layoutSizingH: 'HUG'           近似
flex: 1              父是 flex       →   layoutSizingH: 'FILL'          精确
                                        layoutGrow: 1
flex-grow: 2         父是 flex       →   layoutGrow: 2                  精确
flex-shrink: 0       父是 flex       →   layoutGrow: 0                  近似
min-width: 200px     任意            →   minWidth: 200                  精确
max-width: 600px     任意            →   maxWidth: 600                  精确
position: absolute   父是 flex       →   layoutPositioning: 'ABSOLUTE'  精确
top/left/right/bottom  absolute     →   x, y (需计算)                   精确

width: 100%          父非 flex       →   resolve to px, FIXED           ⚠️ 需布局计算
width: 50%           父非 flex       →   resolve to px, FIXED           ⚠️ 需布局计算
width: calc(100%-32px) 任意          →   resolve to px, FIXED           ⚠️ 需布局计算
```

### 2.4 视觉属性 → GeometryMixin / BlendMixin

```
CSS                                  Figma                            精度
──────────────────────────────────────────────────────────────────────────
background-color: #FFF           →   fills: [{type:'SOLID',           精确
                                       color:{r:1,g:1,b:1}}]
background-color: rgba(0,0,0,.5) →   fills: [{type:'SOLID',           精确
                                       color:{r:0,g:0,b:0},
                                       opacity:0.5}]
background: linear-gradient(     →   fills: [{type:'GRADIENT_LINEAR', 精确
  to bottom, #F00, #00F)               gradientStops:[...],
                                       gradientTransform:...}]
background: radial-gradient(...) →   fills: [{type:'GRADIENT_RADIAL', 精确
                                       ...}]
background-image: url(...)       →   fills: [{type:'IMAGE',           精确
                                       imageHash:...,                  (需上传图片)
                                       scaleMode:'FILL'}]
background-size: cover           →   scaleMode: 'FILL'                精确
background-size: contain         →   scaleMode: 'FIT'                 精确

border: 1px solid #000           →   strokes: [{type:'SOLID',...}]    精确
                                     strokeWeight: 1
                                     strokeAlign: 'INSIDE'
border-width: 1px 2px 3px 4px   →   strokeTopWeight:1,               精确
                                     strokeRightWeight:2,             (IndividualStrokesMixin)
                                     strokeBottomWeight:3,
                                     strokeLeftWeight:4
border-style: dashed             →   dashPattern: [8, 8]              近似 (CSS 不定义间距)
border-style: dotted             →   dashPattern: [2, 2]              近似

border-radius: 12px              →   cornerRadius: 12                 精确
border-radius: 8px 12px 0 0     →   topLeftRadius:8,                 精确
                                     topRightRadius:12,
                                     bottomLeftRadius:0,
                                     bottomRightRadius:0

opacity: 0.8                     →   opacity: 0.8                     精确
mix-blend-mode: multiply         →   blendMode: 'MULTIPLY'            精确
overflow: hidden                 →   clipsContent: true                精确
overflow: visible                →   clipsContent: false               精确

box-shadow: 0 4px 8px #0002      →   effects: [{                      精确
                                       type:'DROP_SHADOW',
                                       offset:{x:0,y:4},
                                       radius:8,
                                       color:{r:0,g:0,b:0,a:0.13}
                                     }]
box-shadow: inset 0 2px 4px #000 →   effects: [{                      精确
                                       type:'INNER_SHADOW',...}]
filter: blur(4px)                →   effects: [{                      精确
                                       type:'LAYER_BLUR',
                                       radius:4}]
backdrop-filter: blur(8px)       →   effects: [{                      精确
                                       type:'BACKGROUND_BLUR',
                                       radius:8}]
```

### 2.5 文本 → TextNode + NonResizableTextMixin

```
CSS                                  Figma                            精度
──────────────────────────────────────────────────────────────────────────
font-family: Inter               →   fontName: {family:'Inter',       精确
                                       style:'Regular'}
font-size: 24px                  →   fontSize: 24                     精确
font-weight: 400                 →   fontName: {style:'Regular'}      ⚠️ 需字体映射
font-weight: 700                 →   fontName: {style:'Bold'}         ⚠️ 需字体映射
font-style: italic               →   fontName: {style:'Italic'}      ⚠️ 需字体映射
font-weight:700 + font-style:    →   fontName: {style:'Bold Italic'} ⚠️ 需字体映射
  italic
line-height: 1.5                 →   lineHeight:                      精确
                                       {unit:'PERCENT', value:150}
line-height: 32px                →   lineHeight:                      精确
                                       {unit:'PIXELS', value:32}
letter-spacing: 0.5px            →   letterSpacing:                   精确
                                       {unit:'PIXELS', value:0.5}
letter-spacing: 0.02em           →   letterSpacing:                   精确
                                       {unit:'PERCENT', value:2}
text-align: center               →   textAlignHorizontal: 'CENTER'    精确
text-align: justify              →   textAlignHorizontal: 'JUSTIFIED' 精确
vertical-align: middle           →   textAlignVertical: 'CENTER'      近似 (CSS 语义不同)
text-decoration: underline       →   textDecoration: 'UNDERLINE'      精确
text-decoration: line-through    →   textDecoration: 'STRIKETHROUGH'  精确
text-transform: uppercase        →   textCase: 'UPPER'                精确
text-transform: lowercase        →   textCase: 'LOWER'                精确
text-transform: capitalize       →   textCase: 'TITLE'                精确
white-space: nowrap +            →   textAutoResize: 'TRUNCATE'       精确
  overflow: hidden +                 textTruncation: 'ENDING'
  text-overflow: ellipsis
-webkit-line-clamp: 3            →   maxLines: 3                      精确
                                     textTruncation: 'ENDING'
word-break: break-all            →   ✗ Figma 无此属性                  忽略
```

#### font-weight 映射表（需字体库配合）

```
CSS weight    常见 Figma style    注意事项
─────────────────────────────────────────────
100           Thin                不是所有字体都有
200           ExtraLight
300           Light
400           Regular             默认
500           Medium
600           SemiBold
700           Bold
800           ExtraBold
900           Black
```

⚠️ **这不是 1:1 映射**——Figma 用字体文件里的 style 字符串（如 `'SemiBold Italic'`），不同字体的命名不统一。编译器需要加载字体文件，查询实际可用的 style 列表。

---

## 3. 不可精确映射的 CSS 特性

### 3.1 语义鸿沟

| CSS 特性 | 问题 | 降级方案 |
|---------|------|---------|
| `display: grid` | Figma 无 Grid 布局 | 简单网格 → `layoutWrap: 'WRAP'` + 固定宽度子项；复杂网格 → 嵌套 Frame 模拟 |
| `display: inline` / `inline-block` | Figma 无 inline 概念 | 将同行 inline 元素包进一个 `layout:row` 的 Frame |
| `float: left/right` | Figma 无 float | 转为 auto-layout row |
| `position: fixed` / `sticky` | Figma 无滚动上下文 | 绝对定位近似 |
| CSS 继承 (color, font 级联) | Figma 不继承样式 | 编译时展平到每个叶子节点 |
| `::before` / `::after` | Figma 无伪元素 | 创建实际子 Frame/Text 节点 |
| `:hover` / `:active` / `:focus` | Figma 是静态画布 | 映射到 Reaction（原型交互），或为每个状态生成独立 Frame |
| `@media` 响应式 | Figma 无断点概念 | 每个断点生成一个顶层 Frame |
| `transition` / `animation` | Figma 节点模型无动画 | 丢弃（或映射到 prototype transition） |
| `transform: skew/perspective` | Figma 只有 rotation | 丢弃 |
| `em` / `rem` / `vh` / `vw` | Figma 只有 px | 编译时根据上下文计算为 px |
| `calc()` | Figma 无运算 | 编译时求值为 px |
| `z-index` (非 flex 上下文) | Figma 用节点顺序 | 按 z-index 排序子节点 |

### 3.2 需要布局引擎的场景

```
场景                            为什么需要布局引擎
──────────────────────────────────────────────────────────────
width: 50%（父非 flex）       需要计算父节点实际宽度 → 得出 px 值
margin: 0 auto（块级居中）    需要知道父宽度和自身宽度 → 转为 auto-layout + CENTER
display: block（多个 div）    需要知道这些 div 隐式垂直堆叠 → 转为 column layout
line-height（多行文本高度）    需要字体 metrics + 字符数 → 计算文本框高度
table-layout                  需要列宽计算 → 转为固定宽度 Frame 嵌套
```

---

## 4. 编译器架构

```
HTML + Computed CSS
      │
      ▼
┌──────────────────┐
│ 1. Parser        │  html → DOM AST
│                  │  css  → computed styles (per node)
│                  │  getComputedStyle() 或 CSS parser
└────────┬─────────┘
         │  { tag, computedStyle, children[] }
         ▼
┌──────────────────┐
│ 2. Classifier    │  DOM 元素 → Figma 节点类型
│                  │  div+flex → FrameNode
│                  │  p/h1/span → TextNode
│                  │  img → RectangleNode
│                  │  规则见 §2.1
└────────┬─────────┘
         │  { figmaType, computedStyle, children[] }
         ▼
┌──────────────────┐
│ 3. Mixin         │  CSS 属性 → Figma Mixin 字段
│    Resolver      │  纯查表，每条规则是确定性映射
│                  │  display:flex → AutoLayoutMixin.layoutMode
│                  │  gap:16 → AutoLayoutMixin.itemSpacing
│                  │  background:#FFF → MinimalFillsMixin.fills
│                  │  规则见 §2.2 - §2.5
└────────┬─────────┘
         │  { figmaType, mixinProps: { layoutMode, fills, ... }, children[] }
         ▼
┌──────────────────┐
│ 4. Sizing        │  最复杂的一步
│    Resolver      │  CSS 尺寸语义 → Figma FIXED/HUG/FILL
│                  │  width:400px → FIXED
│                  │  width:100% + 父是 flex → FILL
│                  │  width:auto → HUG
│                  │  flex:1 → FILL + layoutGrow:1
│                  │  width:50% + 父非 flex → 需微型布局引擎
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5. Font          │  CSS font-weight 数字 → Figma style 字符串
│    Resolver      │  需要加载字体文件查询可用 styles
│                  │  700 → 'Bold'? 'SemiBold'? 取决于字体
│                  │  组合: 700+italic → 'Bold Italic'
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 6. Style         │  CSS 继承展平 → 每个叶子节点自带完整样式
│    Flattener     │  因为 Figma 无样式继承
│                  │  父 div { color: #333 } → 所有子 Text fills:#333
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 7. Emitter       │  FigmaIR → 输出
│                  │  选项 A: Figma Plugin API 调用序列
│                  │  选项 B: mk 命令序列（你们的 agent DSL）
│                  │  选项 C: Figma REST API payload
└──────────────────┘
```

### 各步骤复杂度

| 步骤 | 类型 | 复杂度 | 说明 |
|------|------|--------|------|
| Parser | 确定性 | 低 | 现成库 (htmlparser2, css-tree) |
| Classifier | 查表 | 低 | 有限规则集 |
| Mixin Resolver | 查表 | 中 | 映射条目多但每条确定 |
| **Sizing Resolver** | **上下文依赖** | **高** | **需微型布局引擎** |
| **Font Resolver** | **查字体库** | **中高** | **需加载字体文件** |
| Style Flattener | 树遍历 | 中 | CSS 继承规则固定 |
| Emitter | 序列化 | 低 | 直接输出 |

---

## 5. 输入选择：HTML string vs Computed DOM

| 输入方式 | 优势 | 劣势 |
|---------|------|------|
| **HTML + CSS 源码** | 离线处理，无需浏览器 | 需自己实现 CSS 计算（选择器优先级、继承、层叠） |
| **Computed DOM** (getComputedStyle) | 浏览器已完成所有 CSS 计算 | 需浏览器环境，所有值已解析为 px |
| **Chrome DevTools Protocol** | 可远程获取 computed styles | 需 headless browser |

**建议用 Computed DOM**——让浏览器做它擅长的事（CSS 计算），编译器只做 Figma 映射。

---

## 6. 与 LLM 方案的关系

```
确定性编译器                      LLM
────────────────────────────────────────────────────────────
结构 + 布局 + 视觉属性映射       设计意图推断
已知 CSS 属性 → Figma 属性        "这个卡片应该有圆角和阴影"
100% 可复现，可测试                 语义分组和命名
零 token 成本                      风格一致性判断
不能处理设计意图                    不能保证结构精确

→ 编译器处理 what（结构），LLM 处理 why（意图）
```
