# Figma ↔ CSS/Tailwind 完整属性映射

> 三方交叉推断: figma-node-system.md (Figma 类型) + get_design_context (Figma→Tailwind) + capture.js (CSS→Figma)
> 分析日期: 2026-03-18

---

## 数据源说明

| 来源 | 方向 | 可信度 | 覆盖范围 |
|------|------|--------|---------|
| `get_design_context` 实际返回 | Figma → Tailwind | 高（Figma 官方生成） | 仅覆盖测试节点涉及的属性 |
| capture.js `Mt` 字典 (150+ CSS 属性) | CSS → Figma (反推) | 中（差值字典，非直接映射） | CSS 全量 |
| figma-node-system.md | Figma 属性全集 | 高（typings 源） | Figma 全量 |
| 我们的 executor (expandShorthands + handlers) | 工具参数 → Figma API | 高（自有代码） | 我们支持的子集 |

---

## 1. 布局 (AutoLayoutMixin → CSS Flexbox)

### 1.1 容器属性

| Figma 属性 | Figma 值 | CSS 属性 | CSS/Tailwind 值 | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|-----------------|--------------|--------------|
| `layoutMode` | `HORIZONTAL` | `display` + `flex-direction` | `flex` (row) | `display: flex` + `flexDirection: row` | `layout:row` |
| `layoutMode` | `VERTICAL` | `display` + `flex-direction` | `flex flex-col` | `display: flex` + `flexDirection: column` | `layout:column` |
| `layoutMode` | `NONE` | `position` | (无 flex，children 用 absolute) | `position: relative/absolute` | `layout:none` |
| `itemSpacing` | number | `gap` | `gap-[Npx]` | `columnGap` / `rowGap` | `gap:N` |
| `counterAxisSpacing` | number | `gap` (cross) | — | `rowGap` / `columnGap` | `crossGap:N` |
| `layoutWrap` | `WRAP` | `flex-wrap` | `flex-wrap` | `flexWrap: wrap` | `wrap:wrap` |
| `layoutWrap` | `NO_WRAP` | `flex-wrap` | `flex-nowrap` | `flexWrap: nowrap` | `wrap:nowrap` |
| `paddingTop` | number | `padding-top` | `pt-[N]` / `py-[N]` | `paddingTop` | `pt:N` |
| `paddingBottom` | number | `padding-bottom` | `pb-[N]` / `py-[N]` | `paddingBottom` | `pb:N` |
| `paddingLeft` | number | `padding-left` | `pl-[N]` / `px-[N]` | `paddingLeft` | `pl:N` |
| `paddingRight` | number | `padding-right` | `pr-[N]` / `px-[N]` | `paddingRight` | `pr:N` |
| `primaryAxisAlignItems` | `MIN` | `justify-content` | `justify-start` | `justifyContent: flex-start` | `alignMain:start` |
| `primaryAxisAlignItems` | `CENTER` | `justify-content` | `justify-center` | `justifyContent: center` | `alignMain:center` |
| `primaryAxisAlignItems` | `MAX` | `justify-content` | `justify-end` | `justifyContent: flex-end` | `alignMain:end` |
| `primaryAxisAlignItems` | `SPACE_BETWEEN` | `justify-content` | `justify-between` | `justifyContent: space-between` | `alignMain:space-between` |
| `counterAxisAlignItems` | `MIN` | `align-items` | `items-start` | `alignItems: flex-start` | `alignCross:start` |
| `counterAxisAlignItems` | `CENTER` | `align-items` | `items-center` | `alignItems: center` | `alignCross:center` |
| `counterAxisAlignItems` | `MAX` | `align-items` | `items-end` | `alignItems: flex-end` | `alignCross:end` |
| `counterAxisAlignItems` | `BASELINE` | `align-items` | `items-baseline` | `alignItems: baseline` | `alignCross:baseline` |
| `counterAxisAlignItems` | `STRETCH` (from observed output) | `align-content`? | `content-stretch` | `alignContent: stretch` | — |
| `clipsContent` | `true` | `overflow` | `overflow-clip` | `overflow: hidden` | `overflow:hidden` |
| `clipsContent` | `false` | `overflow` | `overflow-visible` | `overflow: visible` | — |
| `itemReverseZIndex` | boolean | `flex-direction` | (CSS 无直接等价) | — | `reverseZ:true` |
| `strokesIncludedInLayout` | boolean | — | (CSS 无等价) | — | `strokesInLayout:true` |

> **注意**: Figma 的 `primaryAxisAlignItems` 语义取决于 `layoutMode`。HORIZONTAL 时主轴=水平，VERTICAL 时主轴=垂直。CSS 的 `justify-content` 始终沿主轴。映射关系一致，但语义容易混淆。

### 1.2 子节点属性 (AutoLayoutChildrenMixin)

| Figma 属性 | Figma 值 | CSS 属性 | CSS/Tailwind 值 | 我们的工具参数 |
|------------|----------|----------|-----------------|--------------|
| `layoutSizingHorizontal` | `FILL` | `width` | `w-full` / `flex-[1_0_0]` | `w:fill` / `width:fill` |
| `layoutSizingHorizontal` | `HUG` | `width` | `shrink-0` (+ auto width) | `w:hug` / `width:hug` |
| `layoutSizingHorizontal` | `FIXED` | `width` | `w-[Npx]` | `w:N` |
| `layoutSizingVertical` | `FILL` | `height` | `h-full` | `h:fill` / `height:fill` |
| `layoutSizingVertical` | `HUG` | `height` | `shrink-0` | `h:hug` / `height:hug` |
| `layoutSizingVertical` | `FIXED` | `height` | `h-[Npx]` | `h:N` |
| `layoutGrow` | 1 | `flex-grow` | `flex-[1_0_0]` | `layoutGrow:1` |
| `layoutAlign` | `STRETCH` | `align-self` | `self-stretch` | `layoutAlign:STRETCH` |
| `layoutAlign` | `CENTER` | `align-self` | `self-center` | `layoutAlign:CENTER` |
| `layoutPositioning` | `ABSOLUTE` | `position` | `absolute` | `positioning:ABSOLUTE` |
| `layoutPositioning` | `AUTO` | `position` | (static, 随 flex 流) | — |

> **get_design_context 观察**: `layoutSizingHorizontal: FILL` 在同时有 `layoutGrow:1` 时输出 `flex-[1_0_0]`，否则输出 `w-full`。`HUG` 统一输出 `shrink-0`。

---

## 2. 尺寸与定位 (DimensionAndPositionMixin + LayoutMixin)

| Figma 属性 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|--------------|--------------|
| `width` | `width` | `w-[Npx]` / `size-[N]` (w==h) | `width` | `w:N` / `width:N` |
| `height` | `height` | `h-[Npx]` / `size-[N]` (w==h) | `height` | `h:N` / `height:N` |
| `minWidth` | `min-width` | `min-w-[N]` | `minWidth` | `minW:N` |
| `maxWidth` | `max-width` | `max-w-[N]` | `maxWidth` | `maxW:N` |
| `minHeight` | `min-height` | `min-h-[N]` | `minHeight` | `minH:N` |
| `maxHeight` | `max-height` | `max-h-[N]` | `maxHeight` | `maxH:N` |
| `x` | `left` | `left-[Npx]` | `left` | `x:N` |
| `y` | `top` | `top-[Npx]` | `top` | `y:N` |
| `rotation` | `transform: rotate()` | `rotate-[Ndeg]` | `transform` / `rotate` | `rotation:N` |
| `constrainProportions` | `aspect-ratio` | `aspect-[w/h]` | `aspectRatio` | `lockRatio:true` |
| `constraints.horizontal` | — | (CSS 无直接等价，用 inset) | `position` + `inset` | `constraints:H,V` |
| `constraints.vertical` | — | — | — | `constraints:H,V` |

> **get_design_context 观察**: `size-full` 用于 w=100% + h=100%。`size-[Npx]` 用于 w==h 的正方形。`h-px` 用于高度 1px 的分割线。

---

## 3. 填充与颜色 (MinimalFillsMixin)

| Figma 属性 | Figma 值 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|----------|--------------|--------------|
| `fills` (frame/shape) | `[{type:'SOLID', color:{r,g,b}, opacity}]` | `background-color` | `bg-[#hex]` / `bg-white` | `backgroundColor` | `fill:#hex` / `bg:#hex` |
| `fills` (text) | `[{type:'SOLID', color}]` | `color` | `text-[#hex]` / `text-white` | `color` | `fill:#hex` |
| `fills` | `[]` (空) | — | (无背景) | `backgroundColor: transparent` | `fill:transparent` |
| `fills` | `[{type:'GRADIENT_LINEAR', gradientStops}]` | `background-image` | `bg-gradient-*` | `backgroundImage: linear-gradient(...)` | `fill:GRADIENT_LINEAR(...)` |
| `fills` | `[{type:'IMAGE', imageHash}]` | `background-image: url()` | `<img src>` | `backgroundImage: url(...)` | (图片节点) |
| `opacity` | 0-1 | `opacity` | `opacity-[N]` | `opacity` | `opacity:N` |

> **颜色命名**: get_design_context 识别 CSS 命名色 (`white`, `black`)，非命名色用 `#hex`。capture.js 中 `backgroundColor` 默认值是 `rgba(0,0,0,0)` (透明)。

### 3.1 Figma 颜色格式 vs CSS

```
Figma:  { r: 0.15, g: 0.16, b: 0.17 }  (0-1 浮点)
CSS:    rgb(38, 41, 43)                   (0-255 整数)
Hex:    #26292B
Tailwind: text-[#26292B] / bg-[#26292B]
```

转换: `cssValue = Math.round(figmaValue * 255)`

---

## 4. 描边与边框 (MinimalStrokesMixin + IndividualStrokesMixin)

| Figma 属性 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|--------------|--------------|
| `strokes` | `border-color` | `border-[#hex]` | `borderTopColor` 等 (四边) | `stroke:#hex` |
| `strokeWeight` | `border-width` | `border` / `border-[Npx]` | `borderTopWidth` 等 | `strokeW:N` |
| `strokeAlign: INSIDE` | — | (CSS border 默认在内部) | — | `strokeAlign:INSIDE` |
| `strokeAlign: CENTER` | — | (CSS 无等价，需 outline) | — | `strokeAlign:CENTER` |
| `strokeAlign: OUTSIDE` | `outline` | `outline` | `outlineWidth` + `outlineColor` | `strokeAlign:OUTSIDE` |
| `strokeTopWeight` | `border-top-width` | `border-t-[N]` | `borderTopWidth` | `strokeT:N` |
| `strokeRightWeight` | `border-right-width` | `border-r-[N]` | `borderRightWidth` | `strokeR:N` |
| `strokeBottomWeight` | `border-bottom-width` | `border-b-[N]` | `borderBottomWidth` | `strokeB:N` |
| `strokeLeftWeight` | `border-left-width` | `border-l-[N]` | `borderLeftWidth` | `strokeL:N` |
| `strokeJoin` | `border-join` (无) | — | — | `strokeJ:MITER` |
| `strokeCap` | `stroke-linecap` (SVG) | — | `strokeLinecap` | `strokeC:ROUND` |
| `dashPattern` | `border-style: dashed` | `border-dashed` | `strokeDasharray` | `dash:10,5` |

> **关键差异**: Figma strokes 支持 CENTER/OUTSIDE 对齐，CSS border 只有 inside。Figma `strokeAlign: OUTSIDE` 更接近 CSS `outline`。capture.js 中 `borderTopStyle: "none"` 是默认值 — 有 border 时变为 `solid`。

> **get_design_context 观察**: `strokes: [{color: #d1d5db}], strokeWeight: 1` → `border border-[#d1d5db] border-solid`

---

## 5. 圆角 (CornerMixin + RectangleCornerMixin)

| Figma 属性 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|--------------|--------------|
| `cornerRadius` (统一) | `border-radius` | `rounded-[Npx]` | `borderTopLeftRadius` 等 (四角) | `radius:N` |
| `cornerRadius: 9999` | `border-radius: 9999px` | `rounded-full` | — | `radius:full` |
| `topLeftRadius` | `border-top-left-radius` | `rounded-tl-[N]` | `borderTopLeftRadius` | `topLeftRadius:N` |
| `topRightRadius` | `border-top-right-radius` | `rounded-tr-[N]` | `borderTopRightRadius` | `topRightRadius:N` |
| `bottomRightRadius` | `border-bottom-right-radius` | `rounded-br-[N]` | `borderBottomRightRadius` | `bottomRightRadius:N` |
| `bottomLeftRadius` | `border-bottom-left-radius` | `rounded-bl-[N]` | `borderBottomLeftRadius` | `bottomLeftRadius:N` |
| `cornerSmoothing` | — | (CSS 无等价) | — | `smooth:N` |

> **capture.js**: 四角独立存储 (`borderTopLeftRadius: "0px"` 默认值)，Figma 统一 `cornerRadius` 在 CSS 中展开为四角。
> **cornerSmoothing**: Figma 独有的 iOS 风格圆角平滑，CSS/Tailwind 无法表达。

---

## 6. 文本 (NonResizableTextMixin + TextNode 自有属性)

| Figma 属性 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|--------------|--------------|
| `characters` | (text content) | — | — | `characters:Text` |
| `fontSize` | `font-size` | `text-[Npx]` | `fontSize` (默认 `16px`) | `fontSize:N` |
| `fontName.family` | `font-family` | `font-['Family',sans-serif]` | `fontFamily` (默认 `Times`) | `font:Name` |
| `fontName.style` (含 weight) | `font-weight` | `font-bold` / `font-medium` / `font-normal` | `fontWeight` (默认 `400`) | `weight:bold` |
| `fontName.style` (italic) | `font-style` | `italic` / `not-italic` | `fontStyle` (默认 `normal`) | — |
| `letterSpacing` | `letter-spacing` | `tracking-[N]` | `letterSpacing` (默认 `normal`) | `tracking:N` |
| `lineHeight` | `line-height` | `leading-[N]` / `leading-[normal]` | `lineHeight` (默认 `normal`) | `leading:N` |
| `textAlignHorizontal` | `text-align` | `text-left` / `text-center` / `text-right` | `textAlign` (默认 `start`) | `textAlign:CENTER` |
| `textAlignVertical` | `vertical-align` | — | `verticalAlign` (默认 `baseline`) | `textAlignVertical:TOP` |
| `textAutoResize: NONE` | (固定宽高) | `w-[N] h-[N]` | `width` + `height` (固定) | `textAutoResize:NONE` |
| `textAutoResize: HEIGHT` | (宽固定，高自适应) | `w-[N]` (无固定 h) | `width` (固定) + `height: auto` | — |
| `textAutoResize: WIDTH_AND_HEIGHT` | (全自适应) | `whitespace-nowrap` | — | — |
| `textAutoResize: TRUNCATE` | (截断) | `overflow: hidden` + `text-overflow: ellipsis` | `overflow: hidden` | — |
| `textCase` | `text-transform` | `uppercase` / `lowercase` / `capitalize` | `textTransform` (默认 `none`) | `textCase:UPPER` |
| `textDecoration` | `text-decoration` | `underline` / `line-through` | `textDecorationLine` (默认 `none`) | `textDecoration:UNDERLINE` |
| `paragraphSpacing` | `margin-bottom` (段落间) | — | `marginBottom` | — |
| `paragraphIndent` | `text-indent` | — | `textIndent` (默认 `0px`) | — |
| `textTruncation: ENDING` | `text-overflow: ellipsis` | `truncate` | — | `textTruncation:ENDING` |
| `maxLines` | `-webkit-line-clamp` | `line-clamp-N` | — | `maxLines:N` |

> **get_design_context 观察**: 字体输出格式为 `font-['Inter:Bold',sans-serif]`，将 family+weight 编码到单个 CSS font-family 值中（非标准，Figma 特有格式）。

### 6.1 Figma fontName vs CSS font

```
Figma:  { family: "Inter", style: "Bold" }
CSS:    font-family: 'Inter'; font-weight: 700;
Tailwind (get_design_context): font-['Inter:Bold',sans-serif] font-bold
```

Figma 的 `fontName.style` 是字符串（"Regular", "Bold", "Semi Bold", "Medium", "Light"），不是 CSS 数字 weight。映射关系：

| Figma style | CSS font-weight | Tailwind |
|-------------|----------------|----------|
| Thin | 100 | `font-thin` |
| ExtraLight / UltraLight | 200 | `font-extralight` |
| Light | 300 | `font-light` |
| Regular / Normal | 400 | `font-normal` |
| Medium | 500 | `font-medium` |
| SemiBold / DemiBold | 600 | `font-semibold` |
| Bold | 700 | `font-bold` |
| ExtraBold / UltraBold | 800 | `font-extrabold` |
| Black / Heavy | 900 | `font-black` |

---

## 7. 效果 (BlendMixin)

| Figma 属性 | Figma 值 | CSS 属性 | Tailwind | capture.js 键 | 我们的工具参数 |
|------------|----------|----------|----------|--------------|--------------|
| `effects[].type: DROP_SHADOW` | `{offset, radius, spread, color}` | `box-shadow` | `shadow-[...]` | `boxShadow` (默认 `none`) | `shadow:ox,oy,blur,spread,#color` |
| `effects[].type: INNER_SHADOW` | `{offset, radius, spread, color}` | `box-shadow: inset` | `shadow-inner` | `boxShadow: inset ...` | `shadow:inset,ox,oy,blur,spread,#color` |
| `effects[].type: LAYER_BLUR` | `{radius}` | `filter: blur()` | `blur-[N]` | `filter: blur(Npx)` | `blur:N` |
| `effects[].type: BACKGROUND_BLUR` | `{radius}` | `backdrop-filter: blur()` | `backdrop-blur-[N]` | `backdropFilter: blur(Npx)` | `bgblur:N` |
| `blendMode` | MULTIPLY, SCREEN... | `mix-blend-mode` | `mix-blend-multiply` | `mixBlendMode` (默认 `normal`) | `blend:MULTIPLY` |
| `opacity` | 0-1 | `opacity` | `opacity-[N]` | `opacity` (默认 `1`) | `opacity:N` |
| `isMask` | boolean | `mask` / `clip-path` | — | `clipPath` | `isMask:true` |
| `maskType` | ALPHA / LUMINOSITY | — | — | — | `maskType:ALPHA` |

### 7.1 Shadow 格式对比

```
Figma:   { type: 'DROP_SHADOW', offset: {x:0, y:2}, radius: 4, spread: 0, color: {r,g,b,a} }
CSS:     box-shadow: 0px 2px 4px 0px rgba(0,0,0,0.2);
capture.js 默认: boxShadow: "none"
```

---

## 8. 约束 (ConstraintMixin)

| Figma constraints | CSS 等价 | 说明 |
|-------------------|----------|------|
| `horizontal: MIN` | `left: Npx` | 固定距左 |
| `horizontal: MAX` | `right: Npx` | 固定距右 |
| `horizontal: CENTER` | `left: 50%; transform: translateX(-50%)` | 水平居中 |
| `horizontal: STRETCH` | `left: Npx; right: Npx` | 拉伸 |
| `horizontal: SCALE` | `left: N%; width: N%` | 按比例缩放 |
| `vertical: MIN` | `top: Npx` | 固定距上 |
| `vertical: MAX` | `bottom: Npx` | 固定距下 |
| `vertical: CENTER` | `top: 50%; transform: translateY(-50%)` | 垂直居中 |
| `vertical: STRETCH` | `top: Npx; bottom: Npx` | 拉伸 |
| `vertical: SCALE` | `top: N%; height: N%` | 按比例缩放 |

> **注意**: 约束只在 `layoutMode: NONE` (非 auto-layout) 或 `layoutPositioning: ABSOLUTE` 时生效。Auto-layout 子节点的约束被忽略。

---

## 9. CSS 有但 Figma 无的属性

这些 CSS 属性在 capture.js `Mt` 字典中有，但 Figma 节点体系中**没有对应属性**：

| CSS 属性 | capture.js 默认值 | 为什么 Figma 没有 |
|----------|-------------------|------------------|
| `display: grid` | `""` | Figma 只有 auto-layout (flex)，无 grid |
| `gridTemplateColumns/Rows` | `none` | 同上 |
| `position: sticky/fixed` | `static` | Figma 只有 absolute + auto |
| `margin` | `0px` | Figma 用 itemSpacing/padding 替代 |
| `float` | — | Figma 无浮动概念 |
| `overflow: scroll/auto` | `visible` | Figma 只有 clip/visible |
| `cursor` | `auto` | Figma 无光标样式 |
| `transition/animation` | `all` | Figma 用原型交互替代 |
| `z-index` | `auto` | Figma 用图层顺序（children 数组 index） |
| `list-style-*` | `disc` / `outside` | Figma 无列表样式 |
| `column-count/width` | `auto` | Figma 无多列布局 |
| `content` (::before/::after) | `normal` | Figma 无伪元素 |
| `writing-mode` | `horizontal-tb` | Figma 无 vertical-rl 等 |
| `text-indent` | `0px` | Figma 有 `paragraphIndent`，但较少用 |
| `word-break/overflow-wrap` | — | Figma 文本换行由 textAutoResize 控制 |
| `box-sizing` | `content-box` | Figma 始终是 border-box 语义 |

---

## 10. Figma 有但 CSS 无的属性

| Figma 属性 | 所属 Mixin | 说明 |
|------------|-----------|------|
| `cornerSmoothing` | CornerMixin | iOS 风格平滑圆角 (0-1)，CSS 无法表达 |
| `strokeAlign: CENTER` | MinimalStrokesMixin | CSS border 只能在 inside |
| `itemReverseZIndex` | AutoLayoutMixin | 反转子元素 z 轴顺序 |
| `strokesIncludedInLayout` | AutoLayoutMixin | 描边是否参与布局计算 |
| `layoutGrids` | FrameNode | 布局网格（设计辅助线），不渲染 |
| `guides` | FrameNode | 参考线，不渲染 |
| `reactions` | ReactionMixin | 原型交互（CSS 用 JS 实现） |
| `componentPropertyDefinitions` | ComponentPropertiesMixin | 组件属性系统 |
| `boundVariables` | SceneNodeMixin | 变量绑定 |
| `pluginData` | PluginDataMixin | 插件私有数据 |
| `arcData` | EllipseNode | 扇形弧度 |
| `vectorNetwork` / `vectorPaths` | VectorNode | 矢量路径编辑 |
| `pointCount` / `innerRadius` | PolygonNode / StarNode | 多边形/星形参数 |

---

## 11. 完整的 Mixin → CSS 映射总览

按 figma-node-system.md 的 Mixin 结构，标注每个属性的 CSS 对应：

```
Mixin                          Figma 属性                    CSS 对应          映射质量
─────────────────────────────────────────────────────────────────────────────────────

身份与元数据 (无 CSS 对应)
  BaseNodeMixin                id                            data-node-id       ✅ 精确
                               name                          data-name          ✅ 精确
  SceneNodeMixin               visible                       visibility/display ⚠️ 近似
                               locked                        —                  ✗ 无

尺寸与定位
  DimensionAndPositionMixin    x, y                          left, top          ✅ 精确
                               width, height                 width, height      ✅ 精确
                               minWidth, maxWidth            min-width, max-w   ✅ 精确
                               minHeight, maxHeight          min-height, max-h  ✅ 精确
                               relativeTransform             transform          ⚠️ 矩阵格式不同
  LayoutMixin                  rotation                      transform:rotate() ✅ 精确
                               layoutSizingH/V               width/flex-grow    ⚠️ 多种映射
  ConstraintMixin              constraints                   position+inset     ⚠️ 近似

自动布局
  AutoLayoutMixin              layoutMode                    display+flex-dir   ✅ 精确
                               padding*                      padding-*          ✅ 精确
                               itemSpacing                   gap                ✅ 精确
                               counterAxisSpacing            row-gap/column-gap ✅ 精确
                               primaryAxisAlignItems         justify-content    ✅ 精确
                               counterAxisAlignItems         align-items        ✅ 精确
                               layoutWrap                    flex-wrap          ✅ 精确
                               itemReverseZIndex             —                  ✗ 无
                               strokesIncludedInLayout       —                  ✗ 无
  AutoLayoutChildrenMixin      layoutAlign                   align-self         ✅ 精确
                               layoutGrow                    flex-grow          ✅ 精确
                               layoutPositioning             position           ✅ 精确

填充与描边
  MinimalFillsMixin            fills (solid)                 background-color   ✅ 精确
                               fills (gradient)              background-image   ⚠️ 格式不同
                               fills (image)                 background-image   ⚠️ URL vs imageHash
  MinimalStrokesMixin          strokes                       border-color       ✅ 精确
                               strokeWeight                  border-width       ✅ 精确
                               strokeAlign                   —/outline          ⚠️ 有限
                               dashPattern                   border-style       ⚠️ 有限
  IndividualStrokesMixin       stroke*Weight                 border-*-width     ✅ 精确

圆角
  CornerMixin                  cornerRadius                  border-radius      ✅ 精确
                               cornerSmoothing               —                  ✗ 无
  RectangleCornerMixin         top/bottomLeft/RightRadius    border-*-radius    ✅ 精确

混合与效果
  MinimalBlendMixin            opacity                       opacity            ✅ 精确
                               blendMode                     mix-blend-mode     ✅ 精确
  BlendMixin                   effects (DROP_SHADOW)         box-shadow         ✅ 精确
                               effects (INNER_SHADOW)        box-shadow:inset   ✅ 精确
                               effects (LAYER_BLUR)          filter:blur        ✅ 精确
                               effects (BACKGROUND_BLUR)     backdrop-filter    ✅ 精确
                               isMask                        mask/clip-path     ⚠️ 近似

文本
  NonResizableTextMixin        characters                    text content       ✅ 精确
                               fontSize                      font-size          ✅ 精确
                               fontName                      font-family+weight ⚠️ 格式不同
                               textCase                      text-transform     ✅ 精确
                               textDecoration                text-decoration    ✅ 精确
                               letterSpacing                 letter-spacing     ✅ 精确
                               lineHeight                    line-height        ✅ 精确
                               paragraphSpacing              margin-bottom      ⚠️ 近似
  TextNode 自有                textAlignHorizontal           text-align         ✅ 精确
                               textAlignVertical             vertical-align     ⚠️ 近似
                               textAutoResize                width+height+wrap  ⚠️ 复合映射

映射质量图例: ✅ 精确 1:1 | ⚠️ 近似/格式不同 | ✗ 无 CSS 等价
```

---

## 12. 数据流总结

```
                    capture.js                    Figma 服务端
                    (客户端)                       (黑盒)
                       │                              │
CSS computed styles ───→ Mt 差值字典 ───→ JSON ──POST──→ 还原为 Figma 节点
                       │                              │
                       │                              │
Figma 节点树 ─────────────────────────────────────────→ React+Tailwind 代码
                                                      │
                                              get_design_context
                                                      │
                                                      ↓
                                          本文档的映射规则表
```

两个方向的映射并非完全对称：
- **Code→Figma** (capture.js): 150+ CSS 属性 → ~80 Figma 属性（有损，grid/margin/float 等丢失）
- **Figma→Code** (get_design_context): ~80 Figma 属性 → React+Tailwind（冗余，输出默认值如 relative/not-italic）
- **核心交集**: ~60 个属性有精确双向映射（布局、尺寸、颜色、文字、圆角、阴影）
