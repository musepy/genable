# 属性注册表与 LLM 认知边界

> 学习路径：[1 TypeScript 基础](typescript-symbol-flags.md) → [2 JSON 与数据格式](json-basics.md) → [3 系统与运行环境](system-and-runtime-fundamentals.md) → [4 节点模型与序列化管线](figma-node-and-serialization-pipeline.md) → **[5] 本文**
>
> 索引：[学习笔记导航](learning-index.md)

## 两个注册表文件

### figma-property-registry.ts — 字典（Figma 有什么）

自动生成（`npx tsx tools/extract-figma-props.ts`），从 Figma 类型定义文件提取。约 1094 行，结构简单：

| 部分 | 内容 | 来源 |
|---|---|---|
| PROPERTY_REGISTRY | 每种节点类型有哪些属性（~153 个） | 自动生成 |
| BLACKLIST | 不给 LLM 看的属性（~40 个） | 人维护 |
| PROPERTY_META | 属性使用手册（~65 个） | 人维护 |
| FIGMA_TO_DSL | 名字翻译表（如 itemSpacing → gap） | 自动派生 |

这是 **build-time 提取**方案——Figma 更新类型定义后重新跑脚本即可。

### figma-api.ts — 清单（我们用什么）

人工维护，定义插件实际支持的属性子集：

| 部分 | 作用 |
|---|---|
| PROPS | 属性名常量（~60 个），防拼错 + 编辑器自动补全 |
| NODE_TYPES | 节点类型常量（15 种） |
| TEXT_ONLY_PROPS | 只有 TEXT 节点能用的属性集合 |
| TEXT_PROPS_SCHEMA | 给 LLM 看的文字属性描述（工具定义用） |
| KNOWN_PROP_KEYS | 所有可接受的属性 key（写入白名单） |

两者关系：figma-api.ts 从 figma-property-registry.ts 导入，有重叠但职责不同。PROP_METADATA 已标 `@deprecated`，方向是逐步迁移到 registry。

## PROPS 常量的意义

```typescript
export const PROPS = {
  name: 'name',        // 看起来像废话
  layoutMode: 'layoutMode',
  fills: 'fills',
} as const;
```

不是值本身有什么特别，而是给属性名一个**受保护的引用**：
- 字符串 `'layoutMode'` → 拼错了编译器不知道
- 常量 `PROPS.layoutMode` → 拼错了 TypeScript 报错 + 编辑器自动补全

属性名在 5+ 个文件里反复使用，常量把"多次拼写"变成"一次定义 + 多次引用"。

## PROPERTY_META — 属性使用手册

不是程序，是**查询表**。其他代码查它来做纠错和翻译：

```typescript
gap: {
  figmaKey: 'itemSpacing',   // Figma 叫 itemSpacing，我们叫 gap
  type: 'scalar',
  defaultValue: 0,
  min: 0, max: 1000
}
```

### 每个字段的来源

| 字段 | 来源 |
|---|---|
| figmaKey | Figma API 文档（Figma 叫什么名字） |
| type | 类型定义文件（返回什么类型） |
| enumMap | 类型定义文件的联合类型（有哪些选项） |
| defaultValue | 在 Figma 里实际操作观察 |
| min / max | Figma 文档 + 实际测试 |
| valueConstraints | 踩坑经验（如 HUG 需要 auto layout） |

### enumMap 里的别名

LLM 脑子里装的是 CSS，不是 Figma：

```
LLM 习惯写     Figma 认识的
auto          → HUG
stretch       → FILL
```

enumMap 加别名让程序**自动翻译**，LLM 写 CSS 习惯也不报错。

### 谁用 PROPERTY_META

```
propertyTransformer  → opacity: 5 → 查表 max=1 → 夹到 1
nodeFactory          → sizing: 'stretch' → 查 enumMap → 翻译成 'FILL'
LayoutValidator      → HUG 但没 auto layout → 查 valueConstraints → 退回 FIXED
inspectHandler       → opacity: 1 → 查 defaultValue → 是默认值 → 省略
```

没有 PROPERTY_META 也能工作，只是 LLM 犯错时直接报错而不是自动纠正。

## 三类属性

Figma 全部 ~153 个属性分为三类：

```
BLACKLIST（~40个）      → 明确不要（方法、计算值、废弃、交互、内部）
PROPERTY_META（~65个）  → 明确要，带使用手册
灰色地带（~3个）        → 两边都没提到的漏网之鱼
```

实际验证后灰色地带很少：
- `counterAxisAlignContent` — 真正没处理的（wrap 布局交叉轴对齐）
- `instances` — 只读/计算值，应该放进黑名单
- `itemSpacing` — 已通过 gap 的 figmaKey 映射，不算灰色

## LLM 的认知边界

### 读和写用不同的过滤器

```
读（inspect 给 LLM 看）：BLACKLIST 守门
  不在黑名单 → LLM 看得到
  在黑名单 → LLM 看不到

写（LLM 输出，程序执行）：KNOWN_PROP_KEYS 守门（从 PROPERTY_META 派生）
  在里面 → 接受执行
  不在里面 → 丢弃
```

### LLM 看不到的（盲区）

```
override 关系    → 不知道 Instance 哪些属性被改过
组件引用关系     → 不知道谁用了这个 Component（mainComponent, instances）
变量绑定        → 不知道颜色是绑了变量还是写死的（boundVariables）
样式引用        → 不知道字体是绑了样式还是手设的
原型交互        → 不知道点击跳转到哪（reactions）
```

LLM 看到的画布是**简化过的世界**——只有视觉属性，没有关系和绑定。

### 影响

| 场景 | 盲区的影响 |
|---|---|
| 创建新设计 | 影响小（不需要知道已有关系） |
| 微调属性 | 影响小（改颜色、改文字足够） |
| 统一修改组件 | 影响大（不知道 override，部分 Instance 不跟着变） |
| 管理设计系统 | 影响大（不知道变量、样式、组件引用） |

## 粒度太粗：从黑白到分级可见性

当前只有"给/不给"两级，应该是三级：

| 级别 | 属性 | 什么时候给 |
|---|---|---|
| 总是可见 | fills, padding, fontSize... | 每次 inspect 都返回 |
| 按需可见 | overrides, instances, boundVariables | LLM 指定要看时才返回 |
| 永不可见 | absoluteTransform, vectorNetwork | 给了也没意义 |

按需可见的意思：LLM 用 inspect 工具时可以选择要不要看额外信息。创建时不问不给，编辑已有设计时主动查。

## 关键洞察：Figma 面板就是最好的分类

Figma 右侧面板已经分了组：

```
Design 标签页（选中节点时）：
  Position      → x, y, rotation, constraints
  Auto layout   → layoutMode, gap, padding, sizing, clipsContent
  Appearance    → opacity, cornerRadius, blendMode
  Fill          → fills
  Stroke        → strokes
  Effects       → effects

Design 标签页（Page 级）：
  Variables     → 变量
  Styles        → 文字样式

Prototype 标签页：
  reactions, overflow, interactions
```

面板上每个输入框、下拉菜单、复选框背后都对应属性的读写。**面板就是属性注册表的可视化编辑器**，跟插件做的事本质一样——只是面板给人用（可视化），插件给 LLM 用（JSON）。

### 不需要自己造分类

```
现在的做法：
  153 个属性 → 人拍脑袋分黑白 → 漏了属性 → 补 gotchas
  本质上在重新发明 Figma 已经做好的分类

应该的做法：
  面板上有的 → LLM 能看能改
  面板上没有的 → 不给
  面板的分组 → 就是 role
  面板的出现条件（选 Frame 才出 Auto layout）→ 就是按需可见
```

面板能操作什么，LLM 就应该能操作什么——它们操作的是同一张注册表。

## Override 机制

### 什么是 Override

Instance 跟 Component 不一致的地方就是 override：

```
Component "按钮"：蓝色，文字 "Submit"
Instance A：      蓝色，文字 "Cancel"  ← 文字是 override
Instance B：      红色，文字 "Submit"  ← 颜色是 override
```

Figma 允许不一致，这是正常用法。一致的属性跟 Component 同步，不一致的 Instance 自己管。

### Override 的表达方式

不是标记在属性上的（不是 `fills: [红色, override: true]`），而是 Instance 上有一个单独的 `overrides` 字段：

```typescript
instance.overrides → [
  { id: "1:5", overriddenFields: ["characters"] },
  { id: "1:6", overriddenFields: ["fills", "opacity"] }
]
```

只告诉你"谁改了什么"，不告诉你"原来是什么"（要查 Component）。

### Instance 的区分

每个 Instance 是独立节点，有自己的 ID。通过 `mainComponent` 属性指向来源 Component：

```
instanceA.mainComponent → Component "1:10"
instanceB.mainComponent → Component "1:10"
component.instances → [instanceA, instanceB]
```

`mainComponent` 和 `instances` 都在黑名单里——LLM 看到 Instance 像普通 Frame，不知道它跟别的节点有关系。

## Auto Layout 计算顺序

必须先有 auto layout，spacing 才有意义。Figma 的布局计算是顺序的：

```
输入：layoutMode=VERTICAL, paddingTop=16, paddingBottom=16, gap=12
子节点：A(高40), B(高30), C(高50)

计算：
  1. 起始 y = 16（上 padding）
  2. 放 A → y=16
  3. 放 B → y=16+40+12=68（+gap）
  4. 放 C → y=68+30+12=110（+gap）
  5. 总高 = 16+40+12+30+12+50+16 = 176
```

代码写入时 PROP_ORDER 保证 layoutMode 先于 padding/gap——顺序反了 gap 会被忽略。

计算方法是推断的（Figma 闭源），但跟 CSS Flexbox 逻辑一致，可以在画布上验证结果。
