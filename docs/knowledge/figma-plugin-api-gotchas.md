# Figma Plugin API Gotchas (来源: Figma MCP figma-use skill)

> 原始来源: https://github.com/figma/mcp-server-guide/blob/main/skills/figma-use/references/gotchas.md
> 采集日期: 2026-03-25

## 1. `resize()` 重置 sizing 模式为 FIXED

`resize(w, h)` 会静默重置 `primaryAxisSizingMode` 和 `counterAxisSizingMode` 为 FIXED。

```js
// WRONG — resize() 在 sizing mode 之后调用，HUG 被覆盖
frame.layoutMode = 'VERTICAL'
frame.primaryAxisSizingMode = 'AUTO'  // hug
frame.resize(300, 10)  // BUG: 两个轴都被重置为 FIXED！高度锁死 10px

// ESPECIALLY DANGEROUS — 只关心一个轴时传垃圾值
comp.layoutSizingVertical = 'HUG'
comp.resize(280, 1)  // BUG: HUG 被重置，高度锁死 1px

// CORRECT — 先 resize，再设 sizing mode
frame.layoutMode = 'VERTICAL'
frame.resize(300, 40)  // 合理的默认值
frame.counterAxisSizingMode = 'FIXED'  // 宽度固定 300
frame.primaryAxisSizingMode = 'AUTO'   // 高度 hug — 这次能生效
```

**规则**: 永远不要在 resize() 里给打算 HUG 的轴传垃圾值（0 或 1）。先 resize 再设 sizing mode。

## 2. FILL 必须在 appendChild 之后，且父级必须有 auto-layout

FILL 只在 auto-layout 子节点上合法。不满足条件时 **Figma 直接 throw error**，不是静默回退。

```js
// WRONG — 没有 auto-layout 父节点时设 FILL
const child = figma.createFrame()
child.layoutSizingVertical = 'FILL'  // ERROR: throws!
parent.appendChild(child)

// WRONG — 根节点（Page 子节点）设 FILL
const root = figma.createFrame()
root.layoutMode = 'VERTICAL'
root.layoutSizingHorizontal = 'FILL'  // ERROR: Page 没有 auto-layout!

// CORRECT — 先 appendChild，再设 FILL
const child = figma.createFrame()
parent.appendChild(child)            // parent 必须已有 layoutMode
child.layoutSizingVertical = 'FILL'  // OK

// CORRECT — 根节点用 HUG（自身有 auto-layout 即可）
const root = figma.createFrame()
root.layoutMode = 'VERTICAL'
root.layoutSizingHorizontal = 'HUG'  // OK — HUG 只要求 self 有 auto-layout
```

**FILL vs HUG 的前提条件不同**：
- `FILL`: 需要 **parent** 有 auto-layout → 根节点不能用
- `HUG`: 需要 **self** 有 auto-layout → 根节点可以用（只要自己设了 layoutMode）
- `FIXED`: 无限制 → 任何地方都能用

## 3. HUG 父容器会压缩 FILL 子节点

HUG 父容器无法给 FILL 子节点有意义的尺寸，子节点会坍缩为最小尺寸。

```js
// WRONG — 父容器 HUG，子节点 FILL = 坍缩
parent.layoutSizingHorizontal = 'HUG'
child.layoutSizingHorizontal = 'FILL'  // 坍缩到最小！

// CORRECT — 父容器 FIXED 或 FILL，子节点 FILL 才能扩展
parent.resize(400, 50)
parent.layoutSizingHorizontal = 'FIXED'
child.layoutSizingHorizontal = 'FILL'  // 扩展到 400px
```

## 4. `counterAxisAlignItems` 不支持 'STRETCH'

```js
// WRONG
comp.counterAxisAlignItems = 'STRETCH'  // 不存在！

// CORRECT — 用 'MIN' + 子节点 FILL
comp.counterAxisAlignItems = 'MIN'
comp.appendChild(child)
child.layoutSizingHorizontal = 'FILL'  // 垂直布局拉伸宽度
child.layoutSizingVertical = 'FILL'    // 水平布局拉伸高度
```

## 5. 颜色是 0-1 范围

```js
// WRONG
node.fills = [{ type: 'SOLID', color: { r: 255, g: 0, b: 0 } }]

// CORRECT
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
```

## 6. Fills/Strokes 是只读数组

```js
// WRONG — 原地修改不生效
node.fills[0].color = { r: 1, g: 0, b: 0 }

// CORRECT — clone, 修改, 重新赋值
const fills = JSON.parse(JSON.stringify(node.fills))
fills[0].color = { r: 1, g: 0, b: 0 }
node.fills = fills
```

## 7. effects 必须有 visible 和 blendMode

```js
// WRONG
frame.effects = [{ type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.1}, offset: {x:0,y:4}, radius: 24 }]

// CORRECT
frame.effects = [{
  type: 'DROP_SHADOW',
  color: {r:0, g:0, b:0, a:0.1},
  offset: {x:0, y:4},
  radius: 24,
  visible: true,
  blendMode: 'NORMAL'
}]
```

## 8. `lineHeight` / `letterSpacing` 必须是对象

```js
// WRONG
style.lineHeight = 24
style.letterSpacing = 0

// CORRECT
style.lineHeight = { value: 24, unit: 'PIXELS' }
style.lineHeight = { unit: 'AUTO' }                   // auto
style.lineHeight = { value: 150, unit: 'PERCENT' }    // 150%
style.letterSpacing = { value: 0, unit: 'PIXELS' }
style.letterSpacing = { value: -0.5, unit: 'PIXELS' } // tight
```

适用于 TextStyle 和 TextNode。

## 9. Font style 名称不确定 — 必须探测

`"SemiBold"` 和 `"Semi Bold"` 是不同的字符串，不同文件可能不同。

```js
// WRONG — 猜测 style 名称
await figma.loadFontAsync({ family: 'Inter', style: 'SemiBold' })

// CORRECT — 探测可用的 style
const candidates = ['SemiBold', 'Semi Bold', 'Semibold']
for (const style of candidates) {
  try {
    await figma.loadFontAsync({ family: 'Inter', style })
    break
  } catch (_) {}
}
```

## 10. `layoutGrow` + HUG 父容器 = 内容压缩

```js
// WRONG — layoutGrow 在 HUG parent 下不扩展反而收缩
parent.primaryAxisSizingMode = 'AUTO'  // hug
content.layoutGrow = 1  // BUG: 内容被压缩！

// CORRECT — layoutGrow 只在 FIXED sizing 父容器下有效
parent.primaryAxisSizingMode = 'FIXED'
parent.resizeWithoutConstraints(300, 500)
content.layoutGrow = 1  // 正确扩展
```

## 11. setBoundVariableForPaint 返回新 paint

```js
// WRONG — 忽略返回值
figma.variables.setBoundVariableForPaint(paint, 'color', colorVar)
node.fills = [paint]  // paint 没变！

// CORRECT — 捕获返回的新 paint
const boundPaint = figma.variables.setBoundVariableForPaint(paint, 'color', colorVar)
node.fills = [boundPaint]
```

## 12. Variable collection 初始有 1 个 mode

```js
// 新 collection 已有一个 mode，重命名它而不是新增
const coll = figma.variables.createVariableCollection('Colors')
coll.renameMode(coll.modes[0].modeId, 'Light')  // 重命名 'Mode 1'
const darkId = coll.addMode('Dark')
```

## 13. combineAsVariants 需要 ComponentNode

```js
// WRONG — 传 Frame
figma.combineAsVariants([frame1], figma.currentPage)  // Error!

// CORRECT — 传 Component
figma.combineAsVariants([comp1, comp2], figma.currentPage)
```

## 14. Page 切换必须用 async

```js
// WRONG — sync setter 抛错
figma.currentPage = targetPage

// CORRECT
await figma.setCurrentPageAsync(targetPage)
```

## 15. 新节点默认在 (0,0) 会重叠

直接 appendChild 到 page 的顶层节点全在 (0,0) 重叠。子节点由父容器定位，不需要处理。

```js
// CORRECT — 顶层节点扫描已有内容边界后放置
let maxX = 0
for (const child of page.children) {
  maxX = Math.max(maxX, child.x + child.width)
}
frame.x = maxX + 100
```

## 16. 必须返回所有创建/修改的节点 ID

```js
// WRONG
return { nodeId: frame.id }  // 丢失子节点 ID

// CORRECT
return {
  createdNodeIds: [frame.id, rect.id, text.id],
  rootNodeId: frame.id
}
```

## 17. figma.notify() 抛 "not implemented" [仅 js tool sandbox]

```js
// WRONG
figma.notify('Done!')  // 抛错

// CORRECT
return 'Done!'
```

## 18. getPluginData / setPluginData 不可用 [仅 js tool sandbox]

```js
// WRONG
node.setPluginData('key', 'value')

// CORRECT — 用 sharedPluginData（需要 namespace）
node.setSharedPluginData('ns', 'key', 'value')
```

## 19. Script 必须有返回值

```js
// WRONG
figma.createRectangle()  // 调用方得不到信息

// CORRECT
const rect = figma.createRectangle()
return { nodeId: rect.id }
```

## 20. setBoundVariable 只支持 SOLID paint

Gradient/Image paint 不支持颜色变量绑定。

## 21. 每个 component 需要显式设置 variable mode

```js
// WRONG — 所有 variant 用默认 mode
// CORRECT
component.setExplicitVariableModeForCollection(colorCollection, targetModeId)
```

## 22. TextStyle.setBoundVariable 在 headless 不可用

`use_figma` / MCP 环境下调用会抛 "not a function"。节点级 `node.setBoundVariable()` 可用。

## 23. COLOR variable 值用 {r,g,b,a}（带 alpha）

```js
// Paint color: {r, g, b}（无 alpha，opacity 是 paint 属性）
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]

// Variable value: {r, g, b, a}（alpha 映射到 paint opacity）
colorVar.setValueForMode(modeId, { r: 1, g: 0, b: 0, a: 1 })
```

## 24. combineAsVariants 在 headless 不自动布局

variant 全堆在 (0,0)，需要手动计算网格位置和 resizeWithoutConstraints。

## 25. 节点位置不会在 reparent 后自动重置

```js
// WRONG — 以为 appendChild 后位置重置
node.x = 500; node.y = 500
section.appendChild(node)  // 仍在 (500, 500)！

// CORRECT
section.appendChild(node)
node.x = 80; node.y = 80
```

## 26. Section 不自动调整大小

```js
section.appendChild(someNode)
section.resizeWithoutConstraints(
  Math.max(someNode.width + 100, 800),
  Math.max(someNode.height + 100, 600)
)
```

## 27. Variable collection mode 数量有 plan 限制

- Free: 1 mode
- Professional: 最多 4 modes
- Organization/Enterprise: 40+ modes

## 28. Variables 默认 ALL_SCOPES

```js
// WRONG — 出现在所有属性选择器
// CORRECT — 限制范围
bgColor.scopes = ['FRAME_FILL', 'SHAPE_FILL']
textColor.scopes = ['TEXT_FILL']
spacing.scopes = ['GAP']
primitive.scopes = []  // 隐藏
```

## 29. 空 fills 节点无法绑定变量

```js
// WRONG — fills 为空，无法绑定
comp.fills = []

// CORRECT — 先加占位 SOLID fill 再绑定
const basePaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
const boundPaint = figma.variables.setBoundVariableForPaint(basePaint, 'color', colorVar)
comp.fills = [boundPaint]
```

## 30. detachInstance() 会使祖先节点 ID 失效

嵌套 instance 内调 `detachInstance()` 可能导致父 instance 也被 detach（从 INSTANCE 变 FRAME），ID 变了。

```js
// WRONG — detach 后用缓存的 parent ID
const parentId = parentInstance.id
nestedChild.detachInstance()
figma.getNodeByIdAsync(parentId)  // null！ID 变了

// CORRECT — 从稳定的非 instance frame 重新查找
nestedChild.detachInstance()
const parent = stableFrame.findOne(n => n.name === 'ParentName')
```

## 31. CSS variable 名称不能有空格

```js
// WRONG
`var(--${name.replace(/\//g, '-').toLowerCase()})`  // 空格残留

// CORRECT
`var(--${name.replace(/[\s\/]+/g, '-').toLowerCase()})`
```

## 32. Mode 名称必须有语义

```js
// WRONG — 留着 'Mode 1'
// CORRECT
coll.renameMode(coll.modes[0].modeId, 'Light')
// 单 mode collection 用 'Default'
```

## clipsContent 默认裁剪导致视觉缺失

`clipsContent` 默认 `true`——Frame 会裁剪所有超出边界的内容。

**被裁掉的常见情况**：
- 子节点的**阴影/发光效果**超出 Frame 边界 → 看不见
- **文字不换行**（长文本/单行）超出 Frame 宽度 → 被截断
- 子节点 **FILL 尺寸**溢出 → 超出部分被裁

```js
// 卡片有阴影 → clipsContent 必须关
const card = figma.createFrame()
card.clipsContent = false  // 阴影才能露出来
card.effects = [{ type: 'DROP_SHADOW', ... }]

// 图片/头像容器 → clipsContent 保持开（裁成形状）
const avatar = figma.createFrame()
avatar.clipsContent = true  // 裁成圆形
avatar.cornerRadius = 50
```

**判断规则**：
- 有阴影/发光效果 → `clipsContent = false`
- 卡片、弹窗、下拉菜单 → `false`（效果要露出来）
- 图片容器、头像、遮罩 → `true`（故意裁剪成形状）
- 内容可能溢出但不想截断 → `false`

**LLM 影响**：LLM 几乎不会主动设 `clipsContent: false`，导致阴影被默默裁掉——属于属性遗漏问题。

## 34. setBoundVariable('characters') 与 node.characters 互斥

两者是模式切换，不能共存：
- `node.characters = "xxx"` → 静默解除 variable 绑定，`boundVariables` 变为 `{}`
- `setBoundVariable('characters', strVar)` → 覆盖静态文本，节点变为 variable 驱动

**最后写入的操作决定模式，解绑不报错。**

```js
// 绑定后赋值 → 绑定丢失
text.setBoundVariable('characters', strVar)
text.characters = "override"  // boundVariables.characters 消失

// 赋值后绑定 → 静态值被覆盖
text.characters = "static"
text.setBoundVariable('characters', strVar)  // 文本变为 variable 值
```

⚠️ executor 中如果 `characters` 赋值和 `setBoundVariable` 在同一批次，必须保证 bind 在 characters 之后。

## 35. isExposedInstance 写入前置条件

`isExposedInstance` 只能写在 ComponentNode/ComponentSetNode 的直接子 InstanceNode（primary instance）上，且有额外前置条件：

```js
// WRONG — 没有 componentPropertyReferences，报错
instance.isExposedInstance = true
// Error: "Can only expose instances that have exposed nested instances
//         or children with component property references."

// CORRECT — 先绑定 component property，再 expose
comp.addComponentProperty("label", "TEXT", "default")
textChild.componentPropertyReferences = { characters: "label#1:2" }
instance.isExposedInstance = true  // ✅
```

inherited instance（id 含 `;`，如 `I1491:180;1487:183`）写入直接抛异常：
`"Can only expose primary instances."`
