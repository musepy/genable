# Figma capture.js 深度技术分析

> 源文件: `docs/knowledge/figma-capture-pretty.js` (4579 行, 从 https://mcp.figma.com/mcp/html-to-design/capture.js 下载并 prettify)
> 分析日期: 2026-03-18

Figma 官方 **HTML-to-Design (H2D)** 前端捕获脚本。注入到任意网页，将 DOM 树序列化为结构化 JSON（布局+样式+资源），通过剪贴板或 HTTP POST 发送到 Figma，Figma 端再还原为节点树。

---

## 1. 整体架构与入口

IIFE 自执行函数，零外部依赖。

**入口** (第 4569-4577 行):
```js
window.figma.captureForDesign = fn;  // 程序化 API
$t({...});  // URL hash 自动触发
```

**两种触发方式**:
1. **URL Hash 自动触发** (`#figmacapture=xxx&figmaendpoint=xxx`): `Fr()` (第 1604 行) 解析 hash，提取 captureId/endpoint/delay/selector。Endpoint 白名单: figma.com, api.figma.com, mcp.figma.com 等 (第 1587-1594 行)
2. **程序化调用** `window.figma.captureForDesign(options)`: 外部代码直接调用

**三种流程**:
- `bn()` (第 4222 行) — Multi-capture automatic: 捕获后 POST 到 Figma 服务端
- `qr()` (第 4395 行) — Multi-capture selection: 用户手动选元素后捕获
- `fn()` (第 4521 行) — Clipboard: 捕获后写入剪贴板

---

## 2. DOM 遍历

核心递归: `Bt()` (第 1073 行)

```
jt(container, options)           # 主入口
  -> zt()                        # requestAnimationFrame 门控，确保布局完成
    -> Bt(node, assets, fonts)   # 递归分发
      -> or()  [ELEMENT_NODE]    # 处理元素
      -> Ve()  [TEXT_NODE]       # 处理文本
      -> null  [COMMENT_NODE]    # 忽略
```

**元素节点** `or()` (第 1099 行):
- 跳过: HEAD, SCRIPT, STYLE, NOSCRIPT, `data-h2d-ignore="true"`
- SVG: 克隆 + 内联 computed styles → `outerHTML`
- Canvas: `toBlob("image/png")` 栅格化
- Shadow DOM: 遍历 `shadowRoot.childNodes`
- Slot: 遍历 `assignedNodes({ flatten: true })`

**文本节点** `Ve()` (第 1349 行):
- `Range` API 获取 `getBoundingClientRect()`
- `getClientRects()` 按 `Math.round(rect.top)` 去重统计行数
- 支持 vertical writing mode

**节点 ID**: `Ot()` (第 934 行) — WeakMap + 递增计数器 `h2d-node-${++Lt}`

---

## 3. 样式提取

核心: `Rt()` (第 1306 行)

### 差值策略（关键设计）
维护默认值字典 `Mt` (第 1434-1585 行, ~150 个 CSS 属性)，**只输出与默认值不同的属性**。

### 覆盖属性范围

| 类别 | 属性 |
|------|------|
| 布局 | display, position, flexDirection/Grow/Shrink/Wrap/Basis, alignItems/Self/Content, justifyContent/Items/Self |
| Grid | gridTemplateColumns/Rows, gridAutoFlow, gridColumn/RowStart/End, gap, columnGap, rowGap |
| 盒模型 | width, height, min/maxWidth/Height, padding(4边), margin(4边), boxSizing |
| 定位 | top, right, bottom, left, zIndex |
| 视觉 | backgroundColor, backgroundImage/Size/Position/Repeat, opacity, mixBlendMode, filter, backdropFilter |
| 边框 | borderWidth/Style/Color(4边), borderRadius(4角), outlineWidth/Style/Color |
| 文字 | fontFamily/Size/Weight/Style/Stretch, letterSpacing, lineHeight, textAlign/Transform/DecorationLine/Shadow, whiteSpace, writingMode |
| 溢出 | overflow/X/Y, clipPath |
| 变换 | transform, transformOrigin, translate, rotate, scale |
| 阴影 | boxShadow |
| 其他 | content, visibility, aspectRatio, objectFit, containerType |

### 边框优化 (第 1320-1324 行)
borderWidth 为默认值时，同时删除对应 borderStyle/borderColor。

### Placeholder 伪元素 (第 1143-1147 行)
input/textarea 额外提取 `::placeholder` computed styles。

### Grid 声明值 (第 1253-1305 行)
`captureDeclaredStyles` 选项开启时，遍历 `document.styleSheets` 提取 CSS **声明值**（非 computed），因为 computed 中 `1fr` 已被解析为绝对像素值。

---

## 4. Transform 处理

`Et()` (第 798-818 行): 将 CSS 四个独立变换属性组合为单一 DOMMatrix:
```
translate(origin) * translate * rotate * scale * transform * translate(-origin)
```

`At()` (第 823 行): 检测旋转/倾斜时 (`matrix.b/c > 1e-6`)，额外计算四边形 quad 坐标 → Figma relativeTransform。

---

## 5. 资源处理

### 图片 — `ge` 类 (第 297 行)
- `addImage(url)`: fetch → blob, AVIF/HEIF/HEIC 自动转码为 PNG (canvas drawImage + toBlob)
- `skipRemoteAssetSerialization`: 非本地资源只保存 URL

### 视频
- canvas 截取当前帧为 PNG
- 无 crossOrigin 时：创建带 `crossOrigin="anonymous"` 的克隆 video + `requestVideoFrameCallback`

### Canvas
- 直接 `toBlob("image/png")`

### 字体 — `me` 类 (第 160 行)
- **Canvas 宽度检测法**: 对比 monospace/sans-serif/serif 三种 fallback 渲染 "mmmmmmmmmmlli" 的宽度
- fontStretch % → 关键字映射: 50%→ultra-condensed, 75%→condensed, 100%→normal 等
- 收集所有 face: { fontWeight, fontStyle, fontStretch, fontSize }

### 序列化 (第 882-922 行)
blob → `FileReader.readAsDataURL` → base64

---

## 6. 通信机制

### A. 剪贴板 (`at()`, 第 4138 行)
```html
<span data-h2d="<!--(figh2d)BASE64_DATA(/figh2d)-->"></span>
```
作为 `text/html` ClipboardItem 写入。Figma 粘贴时识别 `<!--(figh2d)` 标记。
要求 `document.hasFocus()`。

### B. HTTP POST (`hn()`, 第 4070 行)
```
POST /capture/{captureId}/submit
Body: { captureId, payload: jsonString, captureIndex }
```
60 秒超时 (AbortController)，支持多次追加捕获 (nextCaptureId)，返回 claimUrl/fileUrl。

**无 WebSocket，无 postMessage。**

---

## 7. 数据格式

### 顶层 JSON
```typescript
{
  root: ElementNode | TextNode,
  documentTitle?: string,
  documentRect: { x, y, width, height },  // scrollWidth/Height
  viewportRect: { x, y, width, height },  // viewport
  devicePixelRatio: number,
  assets: { [url]: { url, blob: { type, base64Blob } | null } },
  fonts: { [family]: { familyName, faces, usages[] } },
  experimental?: { reactFiberTree: ReactFiberNode }
}
```

### ElementNode
```typescript
{
  nodeType: 1,
  id: "h2d-node-N",
  tag: "DIV",
  attributes: { alt?, href?, id?, role?, type? },
  styles: { [cssProperty]: string },           // 仅非默认值
  rect: { x, y, width, height, cssWidth, cssHeight, quad? },
  childNodes: (ElementNode | TextNode)[],
  content?: string,                             // SVG outerHTML
  placeholderUrl?: "rasterized:N",              // Canvas
  pseudoElementStyles?: { placeholder: {...} },
  owningReactComponent?: string,
  sources?: SourceLocation[],
  relativeTransform?: { a, b, c, d, e, f },
  declaredStyles?: { [gridProp]: string },
}
```

### TextNode
```typescript
{
  nodeType: 3,
  id: "h2d-node-N",
  text: string,
  rect: { x, y, width, height },
  lineCount: number,
  sources?: SourceLocation[]
}
```

---

## 8. React 集成

| 功能 | 函数 | 行号 | 说明 |
|------|------|------|------|
| Fiber 查找 | `H()` | 45 | 遍历 DOM 属性找 `__reactFiber$xxx` (React 18+) |
| Props 提取 | `Ne()` | 50 | `pendingProps` / `memoizedProps` (删除 children) |
| 源码位置 | `Re()` | 129 | `data-fg-*` 属性 → SourceLocation (Code Connect 数据源) |
| 组件名 | `yt()` | 532 | 沿 `_debugOwner` / `return` 链向上查找 |
| Fiber 树 | `je()` | 527 | 递归输出 `{ h2dId, name, fiberTag, props, children }` |

---

## 9. UI 浮动工具栏

- **Shadow DOM 隔离** (第 3458 行): `attachShadow({ mode: "closed" })`
- **弹簧物理动画** (第 3301-3338 行): `F = -k*x - b*v` (k=400, b=28)
- **元素选择模式**: 悬停高亮 + CSS 选择器路径生成 (#id > .class > tag:nth-of-type)
- **i18n**: 28 种语言 (第 1707-2925 行)
- **响应式**: 窗口宽度 < 540px 隐藏按钮文字

---

## 10. 关键设计决策

### 巧妙之处
1. **差值样式**: ~150 属性只输出有差异的，大幅压缩 payload
2. **rAF 门控** + 10 秒超时 + visibility API 感知
3. **AVIF/HEIF 转码**: canvas 中转为 PNG (Figma 后端不支持这些格式)
4. **Video 帧精确捕获**: `requestVideoFrameCallback` + `seeked` 双重确认
5. **连续文本合并**: `hr()` 生成器合并相邻 TEXT_NODE
6. **剪贴板 HTML 注释**: `<!--(figh2d)base64(/figh2d)-->` 绕过限制
7. **Grid 声明值**: 额外遍历 stylesheets 保留 `fr`/`auto`/`minmax` 语义

### 局限性
1. CORS 限制 — 跨域资源可能无法 fetch
2. 伪元素 — 只有 `::placeholder`，无 `::before`/`::after`
3. 动画 — 捕获当前帧，动画中间状态取决于时机
4. iframe — 不穿透
5. 超时 — 复杂页面 10 秒限制
6. React only — fiber 只支持 React 18+

---

## 对我们插件的借鉴

| 方向 | 具体价值 |
|------|---------|
| 反向验证 | 生成 Figma 设计 → 导出网页 → capture.js 捕获 → 对比 JSON diff |
| 样式映射字典 | `Mt` 变量 (第 1434-1585 行) 是 CSS→Figma 属性映射的现成参考 |
| Transform | `Et()` 展示 CSS transform → DOMMatrix → Figma relativeTransform 的完整链路 |
| 剪贴板通道 | `<!--(figh2d)-->` 方案可用于我们的插件与外部工具通信 |
| 字体检测 | Canvas measureText 对比法，不依赖 document.fonts API |
