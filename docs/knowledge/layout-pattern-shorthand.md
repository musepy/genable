# Layout Pattern Shorthand — 方法论

## 核心问题

LLM 要管一堆有隐式依赖的原子属性。漏一个就出 bug，我们就加一条验证规则。永远补不完。

典型例子：一个水平排列的 navbar frame 需要写 6 个属性：
```
frame(parent, {layout:'row', w:'fill', height:'hug', bg:'transparent', alignItems:'center', gap:16})
```
其中 `layout:'row'` 必须配 `height:'hug'`，`w:'fill'` 必须有 auto-layout 父节点，`bg:'transparent'` 是容器的正确默认值——这些都是隐式依赖，LLM 在长 ops 里注意力分散时很容易漏掉。

## 解决思路

给 LLM pattern 而不是原子属性。LLM 只选一个**结构意图**，展开由 runtime 保证正确：

```
// LLM 现在要写 6 个属性，漏一个就 bug
frame(parent, {layout:'row', w:'fill', height:'hug', bg:'transparent', alignItems:'center', gap:16})

// 有了 pattern，LLM 只选意图
frame(parent, {pattern:'row-fill', alignItems:'center', gap:16})
// runtime 自动展开 → layout:row, w:fill, height:hug, bg:transparent
```

LLM 的错误空间从 N 个属性的排列组合缩小为从几个已验证 pattern 里选一个。

## 当前 Pattern 定义

| pattern | 展开 |
|---------|------|
| `row` | layout:row + w:hug + h:hug + transparent bg |
| `column` | layout:column + w:hug + h:hug + transparent bg |
| `row-fill` | layout:row + **w:fill** + h:hug + transparent bg |
| `column-fill` | layout:column + w:hug + **h:fill** + transparent bg |
| `stack` | layout:none（绝对定位，无 auto-layout） |

## 设计原则

### 1. Pattern 是默认值，不是强制值
显式属性始终覆盖 pattern 默认值：
```
frame(parent, {pattern:'row', fill:'#FFFFFF'})
// → layout:row + hug + 白色背景（不是 transparent）
```

### 2. 展开在 normalizeProps() step 0
插入位置在所有 CSS→Figma 翻译规则之前，pattern 展开的值（`layout:'row'`、`width:'hug'`）继续走同一套翻译链，无需重复逻辑。

### 3. Transparent bg 的特殊处理
如果 LLM 已经设置了 `fill`/`fills`，跳过 pattern 的 `background:'transparent'` 默认值，避免覆盖显式颜色。

### 4. 命名语义化
Pattern 名称描述**结构意图**，而不是属性集合：
- `row` = 水平排列容器
- `row-fill` = 填满父容器宽度的水平排列容器
- `stack` = 层叠容器（绝对定位）

## 方法论推广

这个思路可以推广到其他"属性簇"——只要满足：
1. 一组属性有隐式依赖关系
2. 存在几个高频组合覆盖大多数场景
3. LLM 在这里有明确的遗漏模式

例如未来可以考虑的 pattern：
- 文字排版：`pattern:'heading'` → size:24 + weight:SemiBold + fill:#111827
- 分割线：`pattern:'divider'` → layout:none + w:fill + h:1 + fill:#E5E7EB
- 按钮容器：`pattern:'btn'` → row + hug + p:'10 16' + corner:8

## 实现位置

- `src/domain/node-normalizers.ts` — `LAYOUT_PATTERNS` 定义 + step 0 展开逻辑
- `src/engine/flat/flatOpsParser.ts` — `findKeySep` 支持 `stack` 作为 unquoted 值
- `src/engine/agent/tools/unified/design.ts` — tool description 里的 Shorthands 文档
