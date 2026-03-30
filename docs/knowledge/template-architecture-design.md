# 模板架构设计：从文本解析到代码执行

2026-03-28 架构设计。5 层模板函数清单，~22 个函数 + 14 个常量替代 ~1200 行 parser 代码，还多了 6 个新能力函数。

## 学习路径

```
前置：domain-architecture-and-pipeline.md（管线三层、文本解析 vs 代码模板对比）
本篇：5 层模板函数清单 → 替代关系 → LLM 输出示例 → 前提条件
后续：实现验证（Figma sandbox new Function() 可用性测试）
```

## 概述

LLM 输出 JSX 形式的字符串，拼入代码模板，sucrase 编译，JS 执行，得到虚拟 DOM 树，遍历创建 Figma 节点。

模板注入的每个函数就是 LLM 能用的能力。不需要写 parser，加一个函数就是加一个能力。

总共 ~22 个函数 + 14 个常量，替代 ~1200 行 parser 代码，还多了 6 个新能力函数。

## 第 1 层：节点类型（14 个常量，从 PROPERTY_REGISTRY 派生）

```javascript
const Frame = 'FRAME', Text = 'TEXT', Rectangle = 'RECTANGLE'
const Ellipse = 'ELLIPSE', Line = 'LINE', Star = 'STAR'
const Polygon = 'POLYGON', Vector = 'VECTOR', Group = 'GROUP'
const Section = 'SECTION', Component = 'COMPONENT', Instance = 'INSTANCE'
const BooleanOperation = 'BOOLEAN_OPERATION', ComponentSet = 'COMPONENT_SET'
```

- 不是函数，是常量。LLM 写 `<Frame>` 编译后变成 `__h('FRAME', ...)`
- 来源：PROPERTY_REGISTRY 的 14 个节点类型，单一来源

## 第 2 层：计算工具（6 个函数，替代 property-specs + gradient-parser ~700 行）

```javascript
hexToRgb(hex)              // '#FF0000' → {r:1, g:0, b:0}
rgb(r, g, b, a?)           // rgb(255, 0, 0) → {r:1, g:0, b:0, a:1}
solid(hex, opts?)          // solid('#F00') → {type:'SOLID', color:{...}, opacity:1}
                           // solid('#F00', {blendMode:'MULTIPLY'}) → 完整能力不阉割
gradient(angle, ...stops)  // gradient(135, ['#667eea',0], ['#764ba2',1])
                           // → 含 angleToMatrix 三角函数计算
shadow(x, y, blur, spread, color, opts?)  // 有名参数，不用记逗号分隔顺序
blur(radius)               // → {type:'LAYER_BLUR', radius, visible:true}
bgblur(radius)             // → {type:'BACKGROUND_BLUR', radius, visible:true}
```

核心价值：LLM 从"记格式"变成"调函数"。`shadow(x, y, blur, spread, color)` 比 `"0,4,24,0,#000"` 直观。

`solid()` 的 opts 参数保证完整能力（blendMode, visible, opacity），简化是语法糖不是能力阉割。

## 第 3 层：设计快捷方式（~10 个函数，替代 expandShorthands ~430 行）

```javascript
col(gap?)                  // col(16) → {layoutMode:'VERTICAL', itemSpacing:16}
row(gap?)                  // row(8) → {layoutMode:'HORIZONTAL', itemSpacing:8}
pad(all)                   // pad(16) → 四边相同
pad(v, h)                  // pad(12, 16) → 上下/左右
pad(t, r, b, l)            // pad(10, 20, 30, 40) → 四个方向
sizeFill()                 // → {layoutSizingHorizontal:'FILL', layoutSizingVertical:'FILL'}
sizeHug()                  // → {layoutSizingHorizontal:'HUG', layoutSizingVertical:'HUG'}
fillH() / fillV()          // 单方向
hugH() / hugV()            // 单方向
align(cross)               // align('center') → {counterAxisAlignItems:'CENTER'}
align(main, cross)         // 双值
```

简写对 LLM 很重要——减少 token、减少遗漏。

expandShorthands 不是删掉，是换实现方式（从 parser 变成模板函数）。

## 第 4 层：设计系统接入（3 个函数，新能力）

```javascript
$var(path)                 // $var('colors/brand/primary') → 绑定 Figma variable
instance(name, overrides?) // instance('Button', {text:'Submit', size:'large'})
style(name)                // style('heading/h1') → 引用已有 style
```

现在的文本解析架构做不到——字符串里没法表达变量绑定。

代码执行天然支持函数调用，这些能力自然可用。

## 第 5 层：画布感知（3 个函数，新能力）

```javascript
find(selector)             // find('Card#1:2') → 返回节点属性
contrast(fg, bg)           // contrast('#FFF', '#000') → 21
concentric(inner, padding) // concentric(12, 8) → 20（同心圆角）
context()                  // → {viewport, selection, page}
```

让 LLM 能基于画布现状做决策，而不是盲写。

## LLM 输出示例

```jsx
<Frame {...col(16)} {...pad(24)} fills={[solid('#FFFFFF')]} cornerRadius={12}
       effects={[shadow(0, 4, 24, 0, '#0000001A')]}>
  <Text fontSize={24} fontWeight="Bold" fills={[solid('#111827')]}>
    Sign In
  </Text>
  <Frame {...row(8)} {...pad(12)} cornerRadius={8}
         strokes={[solid('#D0D5DD')]} {...fillH()}>
    <Text fontSize={14} fills={[solid('#9CA3AF')]}>
      email@example.com
    </Text>
  </Frame>
  <Frame {...row()} {...pad(12)} fills={[solid('#4F46E5')]} cornerRadius={8}
         {...align('center', 'center')} {...fillH()}>
    <Text fontSize={16} fontWeight="Bold" fills={[solid('#FFFFFF')]}>
      Sign In
    </Text>
  </Frame>
</Frame>
```

## 替代关系总结表

| 层 | 函数数量 | 替代什么 | 代码量变化 | 性质 |
|---|---|---|---|---|
| 第 1 层 | 14 个常量 | jsxParser 的 VALID_TAGS | - | 必须有 |
| 第 2 层 | 6 个函数 | property-specs + gradient-parser (~700 行) | -700 行 → ~60 行 | 替代现有 |
| 第 3 层 | ~10 个函数 | expandShorthands (~430 行) | -430 行 → ~50 行 | 替代现有 |
| 第 4 层 | 3 个函数 | 现在做不到 | 新增 ~30 行 | 新能力 |
| 第 5 层 | 3 个函数 | 现在做不到 | 新增 ~30 行 | 新能力 |

## 前提条件

- 验证 Figma sandbox（iframe）中 `new Function()` 可用性
- sucrase ~50KB 的 bundle 大小对插件包体的影响
- nodeFactory + propertyDependencies + handlers 层不变，只改 LLM 输出到虚拟 DOM 树这段
