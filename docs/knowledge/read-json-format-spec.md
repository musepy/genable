# Agent 读取 JSON 格式规格

> 讨论日期: 2026-03-20 | 对照 Pencil MCP 数据格式设计

## 设计原则

- **读取用嵌套 JSON**，写入保持 flat-ops（读写不对称但各取所长）
- **属性直接放节点上**，无 `props` 包裹（`node.width` 不是 `node.props.width`）
- **中间名**：既不是极短缩写（w/h/p）也不是 Figma 原名（itemSpacing），是 LLM 友好的中间名
- **平铺**：不按类别分组属性
- **默认值省略**：opacity:1、radius:0 等不输出
- **枚举用 CSS 值**：row/column 不是 HORIZONTAL/VERTICAL

## 节点 JSON 结构

```json
{
  "type": "frame",
  "id": "1167:27356",
  "name": "Card",
  "layout": "row",
  "width": 500,
  "height": 600,
  "gap": 16,
  "padding": "24 16",
  "align": "center",
  "fill": "#FFFFFF",
  "radius": 12,
  "opacity": 0.9,
  "children": [
    {
      "type": "text",
      "id": "1167:27357",
      "name": "Title",
      "content": "Dashboard",
      "fontSize": 18,
      "fontWeight": "Bold",
      "fontFamily": "Inter",
      "fill": "#111827"
    },
    {
      "type": "instance",
      "id": "1167:27358",
      "name": "Submit",
      "component": "Button",
      "variant": {"Size": "Large", "State": "Default"},
      "width": 120,
      "height": 40,
      "children": [...]
    },
    "..."
  ],
  "_more": 5
}
```

## 属性命名映射

### 中间名（JSON 输出用）→ Figma 原名

| 中间名 | Figma 原名 | 旧缩写（写入别名） |
|--------|-----------|-------------------|
| `width` | `width` | `w` |
| `height` | `height` | `h` |
| `padding` | `paddingTop/Right/Bottom/Left` | `p` |
| `gap` | `itemSpacing` | — |
| `crossGap` | `counterAxisSpacing` | — |
| `layout` | `layoutMode` | — |
| `align` | `primaryAxisAlignItems + counterAxisAlignItems` | — |
| `alignMain` | `primaryAxisAlignItems` | — |
| `alignCross` | `counterAxisAlignItems` | — |
| `fontSize` | `fontSize` | `size` |
| `fontWeight` | `fontWeight` | `weight` |
| `fontFamily` | `fontFamily` | `font` |
| `radius` | `cornerRadius` | `corner` |
| `content` | `characters` | — |
| `fill` | `fills` (单色时) | `bg` |
| `fills` | `fills` (多色时) | — |
| `stroke` | `strokes + strokeWeight + strokeAlign` | — |
| `shadow` | `effects` | — |
| `opacity` | `opacity` | — |
| `rotation` | `rotation` | `rotate` |
| `overflow` | `clipsContent` | — |
| `wrap` | `layoutWrap` | — |
| `textAlign` | `textAlignHorizontal` | — |
| `lineHeight` | `lineHeight` | `leading` |
| `letterSpacing` | `letterSpacing` | `tracking` |
| `minWidth` | `minWidth` | `minW` |
| `maxWidth` | `maxWidth` | `maxW` |
| `minHeight` | `minHeight` | `minH` |
| `maxHeight` | `maxHeight` | `maxH` |
| `positioning` | `layoutPositioning` | — |
| `pin` | `constraints` | — |

## 枚举值映射（CSS 风格）

| 属性 | Figma 值 | JSON 输出 |
|------|---------|----------|
| layout | `HORIZONTAL` / `VERTICAL` | `"row"` / `"column"` |
| align | `MIN` / `CENTER` / `MAX` / `SPACE_BETWEEN` | `"flex-start"` / `"center"` / `"flex-end"` / `"space-between"` |
| sizing | `FILL` / `HUG` / `FIXED` | `"fill"` / `"hug"` (FIXED 不输出) |
| textAlign | `LEFT` / `CENTER` / `RIGHT` | `"left"` / `"center"` / `"right"` |
| strokeAlign | `INSIDE` / `OUTSIDE` / `CENTER` | `"inside"` / `"outside"` / `"center"` |
| overflow | `true` / `false` | `"hidden"` / 不输出 |

## 节点类型

| type 值 | 含义 | 备注 |
|---------|------|------|
| `"frame"` | 容器 | Frame/Group/Section |
| `"text"` | 文本 | 有 content/fontSize 等 |
| `"rect"` | 矩形 | Rectangle |
| `"ellipse"` | 椭圆 | — |
| `"line"` | 线条 | — |
| `"vector"` | 矢量 | Vector/Polygon/Star/Boolean |
| `"icon"` | 图标 | 有 iconName |
| `"component"` | 组件定义 | reusable 母版 |
| `"instance"` | 组件实例 | 有 component/variant |

## 特殊字段

### 组件/实例信息（Figma 结构信息）

```json
// 组件定义
{"type": "component", "id": "...", "name": "Button", ...}

// 组件实例
{
  "type": "instance",
  "id": "...",
  "name": "Submit",
  "component": "Button",
  "variant": {"Size": "Large", "State": "Default"},
  ...
}
```

### 截断标记

与 Pencil 一致：children 数组末尾放 `"..."`，`_more` 表示剩余数量。

```json
{
  "children": [
    {"type": "text", "name": "Item 1"},
    {"type": "text", "name": "Item 2"},
    "..."
  ],
  "_more": 42
}
```

Agent 看到 `"..."` + `_more` 就知道 children 不完整，需要深入读取。

### 填充值

| 场景 | JSON 表达 |
|------|----------|
| 单色 | `"fill": "#FFFFFF"` |
| 多色/渐变 | `"fills": ["#FF0000", {"type": "GRADIENT_LINEAR", ...}]` |
| 透明 | `"fill": "transparent"` |
| 无填充 | 不输出 fill 字段 |

### Padding 压缩

| 场景 | JSON 表达 |
|------|----------|
| 四边相同 | `"padding": 24` |
| 上下/左右对称 | `"padding": "24 16"` |
| 四边不同 | `"padding": "24 16 20 12"` |
| 全 0 | 不输出 |

### 默认值（不输出）

- `layout`: 无 auto-layout 时不输出（不输出 `"none"`）
- `sizing`: `"fixed"` 时不输出
- `align`: `"flex-start"` 时不输出
- `radius`: 0 不输出
- `opacity`: 1 不输出
- `visible`: true 不输出
- `padding`: 全 0 不输出
- `gap`: 0 不输出
- `rotation`: 0 不输出

## ID 策略

保持 Figma 原生 ID（`"1167:27356"`）。Agent 日常用路径操作（`/Header/Card`），ID 供精确引用。

## 与写入格式的关系

| | 读取 | 写入 |
|--|------|------|
| 格式 | JSON | flat-ops 文本 |
| 属性名 | 中间名（width/fontSize） | 中间名 + 缩写别名（w/size） |
| 嵌套 | children 数组 | 缩进或 parent 引用 |

Agent 读到 `"width": 500`，写入时可以用 `width:500` 或 `w:500`，都被接受。
