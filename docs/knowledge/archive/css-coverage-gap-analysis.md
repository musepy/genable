# CSS 概念覆盖率差距分析 — 网页复刻场景

> 生成日期: 2026-03-20 | 对照 translation-layer-inventory.md 的当前覆盖率

## 背景

当前翻译层为 **"LLM 创造设计"** 优化 — LLM 输出的是设计意图（高层级），shorthand 是 LLM 友好的子集。

但如果目标是 **"抓取网页 → 复刻到 Figma"**，面对的是**浏览器计算后的完整 CSS 属性空间**。这份文档列出所有差距。

---

## 差距详情

### 布局（差距最大的区域）

| CSS 概念 | 当前 | 真实网页频率 | 备注 |
|---------|------|------------|------|
| Flexbox | ✅ | 极高 | — |
| Grid | ❌ | 极高 | 现代页面几乎必用 |
| Block/Inline flow | ❌ | 极高 | 默认文档流，Figma 无对应概念 |
| `display: inline-block` | ❌ | 高 | 需翻译为 auto-layout row + hug |
| `display: table` | ❌ | 中 | 表格布局 |
| `position: fixed/sticky` | ❌ | 高 | Figma 无 fixed/sticky |
| `margin` | ❌ | 极高 | Figma 没有 margin！只有 gap 和 padding |
| `float` | ❌ | 低(遗留) | 老页面还有 |
| Multi-column (`columns`) | ❌ | 低 | 杂志式排版 |

### 背景 & 渐变

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| 纯色 `background-color` | ✅ | 极高 | — |
| `linear-gradient` | ❌ | 极高 | Figma 支持 GRADIENT_LINEAR，但 shorthand 没有暴露 |
| `radial-gradient` | ❌ | 高 | Figma 支持 GRADIENT_RADIAL |
| `conic-gradient` | ❌ | 中 | Figma 不原生支持 |
| `background-image: url()` | ✅ | 极高 | image fill |
| `background-size` (cover/contain) | ❌ | 极高 | Figma 有 scaleMode 但没暴露 |
| `background-position` | ❌ | 高 | Figma 有 imageTransform 但没暴露 |
| `background-repeat` | ❌ | 高 | Figma 有 TILE scaleMode |
| 多重背景 (stacked) | ❌ | 中 | Figma fills 数组天然支持，但没翻译 |

### 文字 & 排版

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| font-family/size/weight | ✅ | 极高 | — |
| line-height/letter-spacing | ✅ | 极高 | — |
| text-align | ✅ | 极高 | — |
| text-transform | ✅ | 高 | uppercase/lowercase/capitalize |
| `text-decoration` (underline) | ❌ | 高 | Figma 有 `textDecoration` 但没暴露 |
| `text-shadow` | ❌ | 中 | Figma 不原生支持（需 effect hack） |
| `word-spacing` | ❌ | 低 | Figma 不支持 |
| `text-indent` | ❌ | 低 | Figma 不支持 |
| `white-space: nowrap` | ❌ | 高 | 对应 Figma `textAutoResize` |
| `text-overflow: ellipsis` | ❌ | 高 | 对应 Figma `textTruncation: 'ENDING'` + `maxLines` |
| `font-style: italic` | ⚠️ | 高 | Rich text 有，但 shorthand 没直接暴露 |
| `writing-mode: vertical` | ❌ | 低 | 中日韩竖排 |

### 边框 & 描边

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| border-width/color | ✅ | 极高 | — |
| border-radius | ✅ | 极高 | — |
| `border-style: dashed` | ✅ | 中 | dashPattern |
| `border-style: dotted` | ⚠️ | 中 | 需要特殊 dashPattern 值 |
| `border-style: double/groove/ridge` | ❌ | 低 | 无法用 Figma stroke 表达 |
| `outline` | ❌ | 中 | 不同于 border，不占空间 |
| 四边独立 border-color | ❌ | 中 | Figma 不支持 |

### 变换 & 视觉效果

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| `opacity` | ✅ | 极高 | — |
| `box-shadow` | ✅ | 极高 | — |
| 多重 shadow | ❌ | 高 | Figma effects 数组支持，但解析器只处理单个？ |
| `transform: rotate()` | ❌ | 高 | Figma 有 `rotation` 但没暴露 |
| `transform: scale()` | ❌ | 中 | 翻译为 width/height 缩放 |
| `transform: translate()` | ❌ | 中 | 翻译为 x/y 偏移 |
| `filter: brightness/contrast/saturate` | ❌ | 中 | Figma 不原生支持 |
| `filter: grayscale/sepia` | ❌ | 低 | 同上 |
| `backdrop-filter: blur` | ✅ | 中 | — |
| `mix-blend-mode` | ✅ | 低 | `blend` shorthand |
| `clip-path` | ❌ | 中 | 需翻译为 vector mask |

### 图片

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| `<img>` / `background-image` | ✅ | 极高 | — |
| `object-fit: cover/contain` | ❌ | 极高 | Figma 有 `scaleMode` (FILL/FIT/CROP/TILE) |
| `object-position` | ❌ | 高 | Figma `imageTransform` |
| `aspect-ratio` | ❌ | 高 | `constrainProportions` 不完全等价 |
| `<svg>` 内联 | ⚠️ | 极高 | icon 支持 SVG，但复杂 SVG 有限 |

### 伪元素 & 状态

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| `::before` / `::after` | ❌ | 极高 | 需翻译为真实子节点 |
| `:hover` / `:focus` 状态 | ❌ | 极高 | Figma 用 variant/interaction，静态捕获不需要 |
| `::placeholder` | ❌ | 高 | 输入框占位文字 |

### 单位系统

| CSS 概念 | 当前 | 频率 | 备注 |
|---------|------|------|------|
| `px` | ✅ | 极高 | 直接映射 |
| `%` (width/height) | ⚠️ | 极高 | 只有 `100%` → `FILL`，其他百分比丢失 |
| `em` / `rem` | ❌ | 极高 | 需在捕获时计算为 px |
| `vw` / `vh` | ❌ | 高 | 视口相对，需计算 |
| `calc()` | ❌ | 高 | 需计算为最终值 |
| `var(--custom)` | ❌ | 极高 | CSS 自定义属性，需解析为值或映射到 Figma 变量 |

---

## 差距汇总（按影响面排序）

### Tier 1 — 几乎每个网页都会遇到（必须有）

1. **`margin`** — CSS 最基本的概念，Figma 完全没有。需翻译为 gap 或包裹空 frame
2. **Block/inline flow** — 默认文档流，非 flex/grid 的元素怎么排？
3. **`linear-gradient`** — 按钮、背景、卡片极其常见
4. **`::before/::after`** — 分隔线、装饰元素、图标大量使用
5. **`object-fit: cover`** — 几乎所有图片都需要
6. **`background-size/position`** — 背景图控制
7. **`text-decoration: underline`** — 链接的基本样式
8. **`text-overflow: ellipsis`** — 列表、卡片标题
9. **`transform: rotate`** — 箭头、展开图标、装饰
10. **`white-space: nowrap`** — 按钮、标签

### Tier 2 — 大多数网页会遇到

11. CSS Grid
12. `radial-gradient`
13. 多重 `box-shadow`
14. `font-style: italic`（作为独立属性）
15. `%` 宽度（非 100%）
16. `outline`（focus 样式）
17. `rotation`

### Tier 3 — 特定场景

18. CSS `filter` 系列
19. `clip-path`
20. `writing-mode`
21. `border-style: double/groove`
22. Multi-column layout

---

## 核心洞察：两种场景的本质区别

### LLM 生成设计 vs 网页复刻

| 维度 | LLM 生成设计（当前） | 网页复刻（新场景） |
|------|--------------------|--------------------|
| 输入源 | 设计意图（高层级） | 计算结果（低层级像素值） |
| 属性形态 | 简写 + 设计语义 | 完整 CSS computed style |
| 布局策略 | LLM 直接用 flex，不用 margin | 需处理 margin、block flow、grid |
| 翻译方向 | 简写展开（1 shorthand → N 属性） | 概念翻译（CSS → Figma 不同模型） |
| 复杂度 | 属性映射 | 编译器（CSS Computed Style → Figma Node Tree） |

### 网页复刻需要的不是更多 shorthand

当前所有 shorthand 都是 **LLM 友好的设计语义** → Figma 属性。网页复刻需要的是：

1. **概念翻译层**：`margin` → gap/spacer, `display:block` → column auto-layout, `::before` → 真实子节点
2. **布局计算引擎**：非 flex/grid 的 block flow 需要计算出实际位置
3. **渐变解析器**：CSS `linear-gradient(135deg, #667, #f06)` → Figma GradientPaint
4. **图片适配层**：`object-fit` + `object-position` → Figma `scaleMode` + `imageTransform`
5. **伪元素物化**：`::before { content: ''; width: 1px; background: #ddd }` → 真实 rect 子节点

本质上是一个 **CSS → Figma 编译器**，比当前的属性翻译层复杂一个量级。

### 捕获时机的优势

好消息：抓取网页时，浏览器已经完成了所有 CSS 计算。拿到的是 `getComputedStyle()` 的结果：
- `em`/`rem`/`vw`/`calc()` → 已经是 px 值
- `var(--custom)` → 已经是最终值
- Media query → 已经按当前视口解析
- Cascade/specificity → 已经解析

所以单位系统的差距在抓取场景其实**不需要解决**——浏览器替你算好了。真正要解决的是**概念模型差异**（margin、block flow、伪元素、渐变等 Figma 没有直接对应物的东西）。
