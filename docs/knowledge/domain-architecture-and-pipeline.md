# Domain 目录架构与属性管线

2026-03-28 架构分析。domain/ 目录的文件职责、管线三层、IR 过时状态、以及文本解析 vs 代码模板的架构对比。

## 学习路径

```
前置：属性注册表与 LLM 边界、JSX Pipeline Deep Dive
本篇：domain/ 文件职责 → 管线三层 → IR 过时分析 → 架构演进方向
后续：figma-constraint-rule-taxonomy.md（约束规则散布）
```

## domain/ 目录文件清单

4 个文件，各自职责清晰：

| 文件 | 职责 | 现状 |
|---|---|---|
| `design-ir.ts` | 类型定义（PaintValue, EffectValue, UnitValue 等） | 基本过时，已从 git 删除 |
| `property-specs.ts` | 属性规格表（PropertySpec 接口，toFigma/fromFigma 转换） | paint/effect 的 toFigma 已退化为恒等变换 |
| `node-normalizers.ts` | 输入验证纠错（LLM 输出 → 合法 Figma 值） | 活跃使用 |
| `gradient-parser.ts` | CSS 渐变字符串 → Figma GradientPaint 格式转换 | 活跃使用，含三角函数计算 |

## 管线三层

LLM 输出的 JSX 属性值经过三层处理后写入 Figma：

```
Layer 1: expandShorthands()        — CSS 名字 → Figma 名字
          例: bg → fills, radius → cornerRadius

Layer 2: property-specs / handlers — 值格式转换
          例: "#FF0000" → { r: 1, g: 0, b: 0 }
          例: "linear-gradient(135deg, ...)" → GradientPaint

Layer 3: nodeFactory               — 写入 Figma API
          applyProps() → handler 分发 → (node as any)[key] = value
```

关键点：Layer 1 是**语法糖**（让 LLM 写更短的属性名），Layer 2 是**格式转换**（CSS/人类可读 → Figma 对象），Layer 3 是**执行**。

## design-ir.ts 过时分析

IR（Intermediate Representation）层定义了中间类型，但大部分已无存在必要：

| IR 类型 | 对应 Figma 类型 | 转换逻辑 | 结论 |
|---|---|---|---|
| `PaintValue` | `Paint` | **已删除** — paint 直通 Figma 格式 | 过时 |
| `EffectValue` | `Effect` | **已删除** — effect 直通 Figma 格式 | 过时 |
| `UnitValue` | `{ value: number, unit: string }` | 与 Figma 格式完全相同 | 中间类型无必要 |
| `ConstraintValue` | `Constraints` | 与 Figma 格式完全相同 | 中间类型无必要 |
| `FontNameValue` | `FontName` | `{ family, style }` — 与 Figma 相同 | 中间类型无必要 |

**核心发现**：当 IR 类型和目标类型完全一样时，IR 层只是多了一次无意义的类型包装。paint/effect 的删除证明了这一点。

## PropertySpec 的 toFigma/fromFigma

`property-specs.ts` 中每个属性定义一个 `PropertySpec`，包含 `toFigma()` 和 `fromFigma()` 方法。

对于 paint 和 effect，这两个方法已退化为恒等变换：

```typescript
// paintSpec.toFigma — 实质是 identity function
toFigma(value: Paint[]): Paint[] {
  return value;  // 直接返回，无任何转换
}
```

**真正需要计算的只有 3 个地方**：

1. **hex → RGB**：`"#FF0000"` → `{ r: 1, g: 0, b: 0 }`（÷255 归一化）
2. **gradientTransform**：角度 → 2x3 变换矩阵（三角函数 sin/cos）
3. **lineHeight 倍数检测**：`24` on fontSize `16` → `{ value: 150, unit: "PERCENT" }`（判断是像素还是倍数）

其余所有 toFigma 要么是恒等变换，要么是简单的字段重命名。

## 文本解析 vs 代码模板：架构对比

这是两种根本不同的方式来处理 "LLM 输出 → Figma 节点" 这个问题。

### 我们的做法：文本解析

```
LLM 写 JSX 字符串
  ↓ parseJsx()          — 手写 parser（正则 + 状态机）
JsxNode[] 树
  ↓ nodeFactory          — 遍历树，创建 Figma 节点
Figma SceneNode
```

LLM 输出的是**纯文本标记**，由我们的 parser 解析。LLM 必须记住属性值的字符串格式。

### OpenPencil 的做法：代码模板 + 编译执行

```
LLM 写 JSX 字符串
  ↓ 拼入代码模板         — 模板提供 h() 函数和工具函数
  ↓ sucrase 编译         — JSX → h() 调用（纯语法变换，无 React 依赖）
  ↓ new Function() 执行  — JS 运行，调用 h() 构建虚拟 DOM
VNode 树 (= {type, props, children})
  ↓ render()             — 遍历树，创建 Figma 节点
Figma SceneNode
```

### 产出相同，能力不同

两种方式最终产出相同的东西：`{type, props, children}` 树。但代码模板方式让 LLM 能：

1. **写表达式**：`w={items.length * 80}` — 文本解析只能写字面值
2. **调工具函数**：`fills={gradient(135, ['#667eea', 0])}` — 函数返回完整 Figma 对象
3. **用变量**：`const brandColor = '#667eea'` 然后多处引用

### 对 LLM 的认知影响

| 维度 | 文本解析（我们） | 代码模板（OpenPencil） |
|---|---|---|
| 渐变 | LLM 记字符串格式：`"linear-gradient(135deg, #667eea 0%)"` | LLM 调函数：`gradient(135, ['#667eea', 0])` |
| 复杂属性 | LLM 记 JSON 结构：`fills={[{type:'SOLID',color:{r:1,g:0,b:0}}]}` | LLM 调函数：`solid('#FF0000')` |
| 认知负担 | "记格式" — 需要精确的字符串语法 | "调函数" — 只需知道函数签名 |

LLM 从**"记格式"**变成**"调函数"**——后者更接近 LLM 的自然能力（代码生成）。

### expandShorthands 的位置

expandShorthands（`bg` → `fills`、`radius` → `cornerRadius`）不能简单删除——简写对 LLM 减少 token 和遗漏很重要。但在代码模板架构下，简写可以换成**模板注入的工具函数**：

```typescript
// 当前：expandShorthands 在 runtime 做字符串替换
// bg="red" → fills=[{type:'SOLID',color:{r:1,g:0,b:0}}]

// 代码模板：工具函数在 LLM 代码中直接可用
// fills={solid('red')}  — solid() 是注入的工具函数
```

简写仍然存在，只是从**解析器层的别名映射**变成了**代码层的工具函数**。

### 关键前提

代码模板方案需要验证一个前提：**Figma sandbox 中 `new Function()` 是否可用**。

Figma 插件的 sandbox 是受限环境（没有 DOM，没有 Node.js API），`new Function()` 可能被禁用。如果不可用，需要寻找替代的代码执行方式（如 sucrase 编译到可解释的 AST）。

## Figma 约束规则散布

Figma 的隐式约束规则（如 "FILL sizing 需要 parent 有 auto-layout"）散在 5 个文件中：

- `node-normalizers.ts` — 输入验证
- `LayoutValidator.ts` — layout 约束
- `nodeFactory.ts` — 创建时的隐式修正
- `handlers/*.ts` — handler 级别的条件逻辑
- `property-specs.ts` — spec 级别的条件

详见 `figma-constraint-rule-taxonomy.md` 的完整分类。

## 设计原则

## 模板架构设计

详细的 5 层模板函数清单见 [template-architecture-design.md](template-architecture-design.md)。

## 设计原则

> "简化是语法糖，不是能力阉割"

JSX 属性应该支持完整的 Figma 对象格式。简写（`bg`、`radius`）是为了让常见 case 更简洁，但 LLM 必须能够在需要时写出完整的 Figma 对象（如复杂渐变、多层 effect）。如果简写层吃掉了完整格式的表达能力，那就是**能力阉割**而不是**语法糖**。
