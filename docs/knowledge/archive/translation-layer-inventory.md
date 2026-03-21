# Translation Layer Inventory — 从 LLM 到 Figma API 的完整翻译栈

> 生成日期: 2026-03-20 | 基于 feat/dogfood-ui 分支当前代码

## 基本元素（Primitives）— 11 种可创建节点

| 节点类型 | Figma API 类型 | 角色 |
|---------|--------------|------|
| `frame` | FRAME | 万能容器（auto-layout / 静态） |
| `text` | TEXT | 文本 |
| `rect` | RECTANGLE | 矩形 |
| `ellipse` | ELLIPSE | 椭圆/圆 |
| `line` | LINE | 线条 |
| `vector` | VECTOR | 矢量路径 |
| `group` | GROUP | 分组（无 auto-layout） |
| `section` | SECTION | 组织分区 |
| `icon` | SVG→VECTOR | Iconify/自定义 SVG |
| `image` | RECTANGLE+IMAGE_FILL | 图片 |
| `component` | FRAME (reusable) | 可复用组件 |

操作类型：`variantset`、`ref`（实例）、`clone`、`delete`

---

## 翻译层堆栈

```
LLM 输出 (flat ops syntax)
  │
  ▼
Layer 1: Prop DSL 解析 (prop-dsl.ts)
  ├─ 类型推断: w:"fill" → string, gap:16 → number
  ├─ CSS text-transform: "uppercase Hello" → textCase:UPPER + "Hello"
  └─ 混合值: w:"100%" → layoutSizingHorizontal:"FILL"
  │
  ▼
Layer 2: Shorthand 展开 (expandShorthands.ts) — 60+ 个简写
  ├─ 布局: layout:'row' → layoutMode:'HORIZONTAL'
  ├─ 对齐: align:'center end' → primary:CENTER + counter:MAX
  ├─ 间距: padding:'10 20' → T:10 R:20 B:10 L:20 (CSS 风格)
  ├─ 尺寸: w:'fill' → layoutSizingHorizontal:'FILL'
  ├─ 画笔: fill:'#EEE' → fills:[{type:'SOLID',color:{r,g,b}}]
  ├─ 效果: shadow/blur/bgblur → effects 数组
  ├─ 圆角: radius:[8,8,0,0] → 四角独立
  ├─ 字体: weight:'semibold' → fontWeight:'Semi Bold'
  ├─ 描边: stroke:'#000 2 inside' → strokes + strokeWeight + strokeAlign
  └─ 模式: pattern:'row-fill' → layoutMode + sizing + fills 组合
  │
  ▼
Layer 3: 依赖注入 (propertyDependencies.ts) — 8 条门控规则
  ├─ 有 padding 但没 layoutMode → 自动注入 layoutMode:'VERTICAL'
  ├─ 有 counterAxisSpacing 但没 layoutWrap → 注入 layoutWrap:'WRAP'
  └─ 拓扑排序 → 保证 layoutMode 先于 sizing, fontName 先于 characters
  │
  ▼
Layer 4: Property Handlers (handlers/*.ts) — 10 个处理器
  ├─ variableBindingHandler: $varName → figma.variables 绑定
  ├─ styleRefHandler: textStyle:'Heading' → setTextStyleIdAsync()
  ├─ paintHandler: fills/strokes → Figma Paint 对象
  ├─ effectHandler: effects → Figma Effect 对象
  ├─ resizeHandler: width/height → node.resize()
  ├─ constraintsHandler: 'MIN,CENTER' → constraints 对象
  └─ defaultHandler: 直接 node[key] = value
  │
  ▼
Figma API (node.property = value)
```

---

## Shorthand 完整清单

### 布局

| Shorthand | 展开为 | 值 |
|-----------|--------|---|
| `layout` | `layoutMode` | `row`→HORIZONTAL, `column`→VERTICAL, `none`→NONE |
| `pattern` | 多属性组合 | `row`, `column`, `row-fill`, `column-fill`, `stack` |
| `align` | `primaryAxisAlignItems` + `counterAxisAlignItems` | 单值或双值，`center`, `start`, `end`, `spacebetween`, `baseline` |
| `justifyContent` | `primaryAxisAlignItems` | 同 align |
| `alignItems` | `counterAxisAlignItems` | 同 align |
| `alignMain` | `primaryAxisAlignItems` | 同 align |
| `alignCross` | `counterAxisAlignItems` | 同 align |

### 间距

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `padding` / `p` | `paddingTop/Right/Bottom/Left` | CSS 1-4 值语法 |
| `pt` / `pr` / `pb` / `pl` | 对应方向 padding | 数值或 `$varName` |
| `gap` | `itemSpacing` | 数值 |
| `crossGap` / `crossAxisGap` | `counterAxisSpacing` | 数值 |

### 尺寸

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `width` / `w` | `width` 或 `layoutSizingHorizontal` | `fill`/`hug`/数值/`123px` |
| `height` / `h` | `height` 或 `layoutSizingVertical` | 同上 |
| `sizing` | `layoutSizingHorizontal` + `layoutSizingVertical` | 单值或双值 |
| `sizingH` / `sizingV` | 对应方向 sizing | `FILL`/`HUG`/`FIXED` |
| `minW` / `maxW` / `minH` / `maxH` | 对应 min/max 约束 | 数值或 `$varName` |

### 画笔 & 效果

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `fill` / `background` / `bg` | `fills` | `transparent`/`none`→`[]`, `#color`, `$varName`, 数组 |
| `stroke` | `strokes` + `strokeWeight` + `strokeAlign` | `"#color 2 center"` 复合语法 |
| `shadow` | `effects` | XML 格式或数组 |
| `blur` | `effects` (layer blur) | 数值半径 |
| `bgblur` | `effects` (background blur) | 数值半径 |

### 圆角

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `radius` / `corner` | `cornerRadius` 或四角独立 | `full`→9999, 数组→四角, 数值 |
| `smooth` | `cornerSmoothing` | 0–1 |
| `borderRadius` | `cornerRadius` | 直通 |

### 字体

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `size` | `fontSize` | 数值或 `$varName` |
| `weight` | `fontWeight` | `thin`/`light`/`regular`/`medium`/`semibold`/`bold`/`black` |
| `font` | `fontFamily` | 字符串 |
| `textAlign` | `textAlignHorizontal` | `LEFT`/`CENTER`/`RIGHT`/`JUSTIFIED` |
| `tracking` | `letterSpacing` | 数值 |
| `lineHeight` / `leading` | `lineHeight` | ≤5 自动转百分比 (1.5→150%) |

### 描边细控

| Shorthand | 展开为 |
|-----------|--------|
| `strokeW` | `strokeWeight` |
| `strokeA` | `strokeAlign` (INSIDE/CENTER/OUTSIDE) |
| `strokeJ` | `strokeJoin` (MITER/BEVEL/ROUND) |
| `strokeC` | `strokeCap` (NONE/ROUND/SQUARE) |
| `dash` | `dashPattern` |
| `strokeT/R/B/L` | 四边独立描边粗细 |

### 其他

| Shorthand | 展开为 | 行为 |
|-----------|--------|-----|
| `overflow` | `clipsContent` | `hidden`/`clip`→true |
| `wrap` | `layoutWrap` | `wrap`→WRAP, `nowrap`→NO_WRAP |
| `blend` | `blendMode` | 直通 |
| `link` | `hyperlink` | URL 字符串 |
| `pin` | `constraints` | 约束字符串或对象 |
| `lockRatio` | `constrainProportions` | 布尔 |
| `positioning` | `layoutPositioning` | `ABSOLUTE`/`RELATIVE` |
| `strokesInLayout` | `strokesIncludedInLayout` | 布尔 |
| `reverseZ` | `itemReverseZIndex` | 布尔 |

---

## 依赖门控规则

| 门控条件 | 依赖属性 | 自动修复 |
|---------|---------|---------|
| `layoutMode != 'NONE'` | padding*, itemSpacing, align*, layoutWrap, sizing:HUG | 自动注入 `layoutMode:'VERTICAL'` |
| `layoutWrap == 'WRAP'` | counterAxisSpacing, counterAxisAlignContent | 自动注入 `layoutWrap:'WRAP'` |
| 父节点有 auto-layout | layoutAlign, layoutGrow, positioning, sizing:FILL | 仅警告 |
| `strokes` 非空 | strokeWeight/Align/Join/Cap, dashPattern, 四边独立描边 | — |
| `strokeJoin == 'MITER'` | strokeMiterLimit | — |
| `isMask` 为真 | maskType | — |
| `cornerRadius > 0` | cornerSmoothing | — |
| `textTruncation == 'ENDING'` | maxLines | — |

执行顺序：`layoutMode` → `width/height` → 其他；`fontName/fontSize/fontWeight` → `characters`

---

## Property Handler 管道（first-match-wins）

1. **variableBindingHandler** — `$varName` → Figma 变量绑定
2. **styleRefHandler** — `textStyle:'Heading'` → 样式引用
3. **paintHandler** — `fills`/`strokes` → Paint 对象
4. **effectHandler** — `effects` → Effect 对象
5. **unitValueHandler** — `lineHeight`/`letterSpacing` → 单位值
6. **resizeHandler** — `width`/`height` → `node.resize()`
7. **constraintsHandler** — 约束字符串 → 对象
8. **dashPatternHandler** — 虚线模式
9. **hyperlinkHandler** — 超链接
10. **defaultHandler** — 直接赋值兜底

---

## CSS 概念覆盖率

| CSS 概念 | 状态 | 实现方式 |
|---------|------|---------|
| Flexbox | ✅ 完整 | `layout:'row'/'column'` → Auto Layout |
| Padding | ✅ CSS 4 值语法 | `padding:'10 20 30 40'` |
| Gap | ✅ 主轴+交叉轴 | `gap` + `crossGap` |
| Align/Justify | ✅ | `align:'center end'` |
| Flex wrap | ✅ | `wrap:'wrap'` + `crossGap` |
| Min/Max sizing | ✅ | `minW`/`maxW`/`minH`/`maxH` |
| Fill/Hug/Fixed | ✅ | `w:'fill'`/`w:'hug'`/`w:200` |
| Box shadow | ✅ | `shadow` shorthand |
| Backdrop blur | ✅ | `bgblur` shorthand |
| Border radius | ✅ 含四角独立 | `radius:[8,8,0,0]` |
| Overflow hidden | ✅ | `overflow:'hidden'` |
| Typography | ✅ 含 rich text | `size`/`weight`/`font`/`leading`/`tracking` |
| CSS Variables | ✅ → Figma 变量 | `$collection/name` 语法 |
| Position absolute | ⚠️ 有限 | `positioning:'ABSOLUTE'`（父必须 auto-layout） |
| Z-index | ⚠️ 仅 reverseZ | 节点顺序 = 层级 |
| **CSS Grid** | ❌ 不存在 | — |
| **Responsive breakpoints** | ❌ 不存在 | — |

---

## 架构观察：当前翻译层的边界

### 所有 shorthand 都是 1:1 属性映射

当前 60+ 个 shorthand 全部是 **一个声明 → 同一节点的一组属性**。没有任何 **1:N 宏**（一个声明 → 多个节点）。

### CSS Grid = 基本元素的组合（宏）

```
CSS: display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px;

Figma 翻译（手动）:
  frame(root, {layout:'row', gap:16, w:'fill'})
    frame(_, {w:'fill'})   // column 1
    frame(_, {w:'fill'})   // column 2
    frame(_, {w:'fill'})   // column 3
```

`cols:3` 的本质是**宏展开**（一个声明 → 多个节点 action），不是属性翻译。

### Responsive breakpoints = 平行 frame 宏

```
mk /Card/ frame w:fill @mobile:w:100% @desktop:w:400

展开为三个平行 frame（desktop / tablet / mobile），
每个有不同的尺寸属性。
```

### 扩展方向

1. **属性级 shorthand（现有模式）**：`cols:3` 作为元数据，LLM 自己创建子 frame
   - 不改架构，依赖 LLM 理解展开规则

2. **宏展开（新能力）**：`layout:'grid' cols:3 gap:16` → expandShorthands 层自动生成子 frame action
   - LLM 零负担，但需要新的 action 级展开层（当前只有 property 级）

### 结论

**11 个基本元素已足够表达 Grid 和 Responsive**——缺的不是元素，是**组合编排层（macro expansion）**。
