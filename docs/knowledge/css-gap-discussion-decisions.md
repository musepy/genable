# CSS 覆盖差距讨论记录 — 逐条决策

> 讨论日期: 2026-03-20 | 基于 css-coverage-gap-analysis.md 的差距清单

## 总览

| # | 主题 | 决策 | 复杂度 |
|---|------|------|--------|
| 1.1 | margin | 策略已明确，待实现 | 中（翻译规则） |
| 1.2 | Block/Inline flow | 策略已明确 | 低（已有能力覆盖） |
| 1.3 | linear-gradient | 需渐变解析器 | 中 |
| 1.4 | ::before/::after | 现有原语覆盖，需翻译规则 | 低 |
| 1.5 | object-fit | 加 fit shorthand | 低 |
| 1.6 | background-size/position | 与 1.5 合并 | — |
| 1.7 | text-decoration | 加 decoration shorthand | 极低 |
| 1.8 | text-overflow: ellipsis | 加 truncate/maxLines shorthand | 低 |
| 1.9 | transform: rotate | 加 rotate shorthand | 极低 |
| 1.10 | white-space | 加 whiteSpace shorthand | 极低 |
| 2.1 | CSS Grid | LLM 展开 + 宏展开双路 | 高（新架构层） |
| 2.2 | radial-gradient | 与 1.3 合并，四种渐变一起做 | — |
| 2.3 | 多重 box-shadow | 已支持（分号分隔） | 无需改动 |
| 2.4 | font-style: italic | 字体三轴独立暴露 | 中 |
| 2.5 | % 宽度 | 搁置（Figma 硬限制） | — |
| 2.6 | outline | 基础用 OUTSIDE stroke，含 offset 需宏展开 | 中 |
| 2.7 | rotation | 与 1.9 重复 | — |
| 3 | filter/clip-path/等 | mask 提升 Tier 2，其余搁置 | — |

---

## Tier 1 详细决策

### 1.1 — margin 翻译策略 ✅

CSS margin 在 Figma 中没有对应概念，但现有工具箱够用：

| CSS margin 用法 | Figma 翻译 | 关键属性 |
|----------------|-----------|---------|
| 同级等间距 | 父 frame `gap` | `itemSpacing` |
| 负 margin（重叠） | 父 frame **负 gap** | `itemSpacing: -N` + `itemReverseZIndex`（Canvas stacking）控制谁在上 |
| 某元素独特间距 | **wrapper frame**，用 wrapper 的 padding 或 gap 表达 margin | 不能用 spacer，会和统一 gap 冲突 |
| `margin: 0 auto` | 父 `align:'center'` | `counterAxisAlignItems: 'CENTER'` |
| 绝对定位 + margin | `positioning: ABSOLUTE` + **constraints** | pin top/bottom/left/right/scale |
| margin collapse | CSS 特有行为：相邻垂直 margin 取较大值而非累加 | Figma 的 gap 不存在 collapse，无需翻译 |

**结论**: 缺的不是 Figma 能力，是翻译规则。待实现。

### 1.2 — Block/Inline flow 布局 ✅

| CSS display | Figma 翻译 |
|-------------|-----------|
| `block` | 父 frame `layout:'column'` + 子 `w:'fill'` |
| `inline` | 父 frame `layout:'row'` + `wrap:'wrap'` + 子 `w:'hug'` |
| `inline-block` | 同 inline，但子可指定固定 width/height |
| 混合（block 里有 inline） | 外层 column，文本行包在 row-wrap frame 里 |

文字级 inline（bold/color/link）→ rich text（已有）。盒子级 inline → row-wrap。文字 + inline 盒子混排 → 拆多节点 row-wrap。

### 1.3 + 2.2 — 渐变（四种类型统一解析器）✅

Figma 支持四种渐变类型：

| Figma type | CSS 对应 |
|-----------|---------|
| `GRADIENT_LINEAR` | `linear-gradient` |
| `GRADIENT_RADIAL` | `radial-gradient` |
| `GRADIENT_ANGULAR` | `conic-gradient` |
| `GRADIENT_DIAMOND` | ❌ 无 CSS 对应（Figma 独有） |

**解析器完整规格**:
1. 四种类型：linear / radial / angular / diamond
2. 多 stop：任意数量
3. 每 stop 三属性：position(%) + color(hex 或 $variable) + opacity(%)
4. 变量绑定：`$varName` → `setBoundVariableForPaint`
5. gradientTransform：类型 + 角度 → 2x3 仿射矩阵（四种类型各有不同计算）

**Shorthand**: 直接用 CSS 原文语法写在 `fill` shorthand 里，不另造简化版：
```
fill:'linear-gradient(135deg, $colors/primary 0%, #764ba2 100% 50%)'
fill:'diamond-gradient(#000, #667eea 50%, #764ba2)'
```

### 1.4 — ::before/::after 伪元素 ✅

伪元素物化为真实节点，用现有原语：

| 伪元素用途 | Figma 节点 |
|-----------|-----------|
| 分隔线 | `line`（支持 dash/strokeCap） |
| 色块装饰 | `rect` |
| 文本内容 | `text` |
| 图标 | SVG `vector` |
| 图片 | `frame` + IMAGE fill |

定位策略：
- Flow（参与文档流）→ 普通子节点，`::before` 排第一个，`::after` 排最后
- Overlap（脱离流）→ `positioning:'ABSOLUTE'`，**父必须是 auto-layout**，否则需 wrapper frame
- 全覆盖（CSS `inset: 0`）→ `constraints:'STRETCH,STRETCH'`

**image 节点底层应是 frame + IMAGE fill**（不是 rect），frame 可有子节点。

引号装饰：flow 场景用 column + padding；overlap 场景用绝对定位 + `constraints:'MIN,MIN'` + x/y 偏移。

### 1.5 + 1.6 — object-fit / background-size/position ✅

在 Figma 里前景图和背景图都是 frame 的 `fills` 里的 IMAGE paint，同一套机制：

| Shorthand | 展开为 | CSS 对应 |
|-----------|--------|---------|
| `fit:'cover'` | `scaleMode: 'FILL'` | `object-fit: cover` / `background-size: cover` |
| `fit:'contain'` | `scaleMode: 'FIT'` | `object-fit: contain` / `background-size: contain` |
| `fit:'none'` | `scaleMode: 'CROP'` | `object-fit: none` |
| `fit:'tile'` | `scaleMode: 'TILE'` | `background-repeat: repeat` |

`imagePos`（object-position → imageTransform 矩阵）复杂度高，后续再加。

### 1.7 — text-decoration ✅

加一个 shorthand：

| Shorthand | 展开为 | 值 |
|-----------|--------|---|
| `decoration` | `textDecoration` | `'underline'` → `UNDERLINE`, `'strikethrough'` → `STRIKETHROUGH`, `'none'` → `NONE` |

极小改动。

### 1.8 — text-overflow: ellipsis ✅

| Shorthand | 展开为 | 示例 |
|-----------|--------|------|
| `truncate` | `textTruncation: 'ENDING'` + `textAutoResize: 'NONE'` | `truncate:true` — 单行截断 |
| `maxLines` | `maxLines` + 自动注入 `textTruncation: 'ENDING'` | `maxLines:2` — 多行截断 |

`maxLines` 走依赖门控（设了 maxLines 自动注入 textTruncation）。

### 1.9 — transform: rotate ✅

| Shorthand | 展开为 | 注意 |
|-----------|--------|------|
| `rotate` | `rotation` | CSS 顺时针正 → Figma 逆时针正，需取反 |

加到 `NUMERIC_PROPS`。极小改动。

### 1.10 — white-space ✅

用 CSS 命名：

| Shorthand | 展开为 |
|-----------|--------|
| `whiteSpace:'nowrap'` | `textAutoResize: 'WIDTH_AND_HEIGHT'` |
| `whiteSpace:'normal'` | `textAutoResize: 'HEIGHT'` |
| `whiteSpace:'pre'` | 保留换行 |

---

## Tier 2 详细决策

### 2.1 — CSS Grid ✅

两条路并行：

**路线 A — LLM 自己展开（简单场景）**：prompt 教 LLM "Grid = row frames 嵌套"

**路线 B — 宏展开（复杂场景）**：`layout:'grid' cols:3 gap:16` → 自动生成多 frame action

翻译规则：
- 等宽列 → `layout:'row'` + 所有子 `w:'fill'`
- 混合列宽（`200px 1fr 300px`）→ 固定 + fill + 固定
- 多行 → column 包 row
- 跨列 → 嵌套合并

**需要新的 action 级展开层**（当前只有 property 级 shorthand 展开）。

### 2.3 — 多重 box-shadow ✅

**已支持**。`effectSpec.parseXml()` 用 `;` 分号分隔多个 shadow。inset 前缀 → INNER_SHADOW。shadow + blur 通过 effect merge pre-pass 合并。无额外工作。

### 2.4 — font-style: italic（字体三轴）✅

字体有三个独立概念：

| 轴 | CSS | 传统字体 | 可变字体 |
|----|-----|---------|---------|
| **Weight** | `font-weight: 600` | 离散：映射到命名 style | 连续：数值轴 100–900 |
| **Italic** | `font-style: italic` | 离散：style 字符串拼 `Italic` | 开关 |
| **Slant** | `font-style: oblique 12deg` | 不支持 | 连续：数值轴（倾斜角度） |

**Italic ≠ Slant**：Italic 是设计师专门画的斜体字形，Slant 是机械倾斜。

**DSL 设计**：LLM 统一写 CSS 语义（`weight:600 italic:true slant:12`），handler 层查字体类型自动分发——可变字体→数值轴，传统字体→映射到最近命名 style 拼接。

Font family 支持 `$variable` 绑定。

### 2.5 — % 宽度（非 100%）⏸️ 搁置

Figma `layoutGrow` 只有 0/1（不支持权重比例），非 100% 百分比无原生支持。
- 网页抓取 → 根据父 frame 算一次固定像素值
- LLM 生成 → FILL 等分覆盖绝大多数需求

Figma 硬限制，不投入。

### 2.6 — outline ✅

两档方案：

| 场景 | 翻译 |
|------|------|
| `outline` 无 offset | `strokeAlign: 'OUTSIDE'` 即可 |
| `outline` + `outline-offset` | 宏展开：生成 wrapper frame（`positioning:ABSOLUTE`, `constraints:STRETCH`, 圆角=主元素圆角+offset, stroke, 无fill） |

**Variant 的 focus/hover 状态是刚需**，完整方案（含 offset）归入宏展开层统一实现。

### 2.7 — rotation ⏸️ 与 1.9 重复

---

## Tier 3 决策

| CSS 特性 | 决策 | 原因 |
|---------|------|------|
| CSS `filter` 系列 | ⏸️ 搁置 | Figma 不原生支持 |
| `clip-path` / mask | **提升到 Tier 2** | 圆形裁切、不规则卡片、gradient mask + blendmode 效果实用 |
| `writing-mode: vertical` | ⏸️ 搁置 | Figma 不支持（降级方案：每字符 `\n` + `textAlign:'CENTER'`） |
| `border-style: double/groove` | ⏸️ 搁置 | Figma stroke 无法表达 |
| Multi-column | ⏸️ 搁置 | 类似 Grid 的宏，低频 |

### Mask/Clip-path（提升到 Tier 2）

Figma 有 `isMask: true` 能力，可翻译的场景：

| CSS 特性 | Figma 实现 |
|---------|-----------|
| `clip-path: circle(50%)` | ellipse + `isMask:true`（或直接 frame + `cornerRadius:9999` + image fill） |
| `clip-path: polygon(...)` | vector path + `isMask:true` |
| `-webkit-mask-image: linear-gradient(...)` | 带渐变 fill 的 rect + `isMask:true`（alpha mask） |
| `background-clip: text` | text 作为 mask 裁切背景图 |

**待确认**：`vector` 节点是否支持 SVG path data（`M 0 0 L 100 100`）直接输入。

### 其他已有能力覆盖

| 概念 | 实现 |
|------|------|
| ASCII art | text 节点 + `font:'monospace'` |
| Unicode 符号 | text 节点 `characters` |
| Monospace 代码块 | text 节点 + mono 字体 |

---

## 架构影响总结

### 需要的新 shorthand（属性级，改动小）

`fit`, `decoration`, `truncate`, `maxLines`, `rotate`, `whiteSpace`, `italic`, `slant`, `outline`

### 需要的新解析器

- **渐变解析器**：CSS gradient 语法 → Figma GradientPaint（4 种类型 + 多 stop + $variable + opacity）

### 需要的新架构层（宏展开）

以下特性需要 **1 声明 → N 节点** 的宏展开能力，当前 shorthand 系统（1:1 属性映射）无法处理：

1. **CSS Grid** → 自动生成行/列 frame
2. **outline + offset** → 自动生成 wrapper frame
3. **伪元素物化** → 自动生成装饰子节点（属于翻译规则层面，不一定需要宏）

### 需要的 handler 层增强

- **字体 handler**：统一处理 weight/italic/slant，自动判断可变字体 vs 传统字体分发
- **渐变 handler**：paintHandler 扩展支持 gradient paint

### 搁置（Figma 硬限制或低频）

`%` 宽度（非 100%）、CSS filter 系列、writing-mode、border-style 特殊值、multi-column
