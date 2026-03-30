# JSON 基础认知

> 学习路径：[1 TypeScript 基础](typescript-symbol-flags.md) → **[2] 本文** → [3 系统与运行环境](system-and-runtime-fundamentals.md) → [4 节点模型与序列化管线](figma-node-and-serialization-pipeline.md)
>
> 索引：[学习笔记导航](learning-index.md)

## JSON 是什么

JSON（JavaScript Object Notation）——一种用文本描述数据的格式。

## 两种容器

```json
{ }    // 对象——用 key 取值
[ ]    // 数组——用位置取值
```

整个 JSON 就是这两种容器互相嵌套。

## 六种值

```json
"hello"     // 字符串——文字，必须有双引号
42          // 数字——没引号
true        // 布尔值——真或假，只有 true / false
null        // 空——什么都没有
{ }         // 对象——里面装键值对
[ ]         // 数组——里面装一串值
```

## 组合规则

- 对象里是 **key: value** 成对出现，key 必须是字符串
- 数组里是 **value, value, value** 排列，没有 key
- value 可以是六种中的任何一种
- 像套娃一样嵌套，但积木只有六块

## 访问方式

用 `.` 进对象，`[数字]` 进数组，逐层往下找：

```json
{
  "data": {
    "id": "1285:42259",
    "name": "Login Card",
    "type": "frame",
    "created": 12,
    "children": [
      "Title#1285:42260",
      "Email Field#1285:42261",
      "Password Field#1285:42265",
      "Sign In Button#1285:42269"
    ]
  }
}
```

```typescript
response.data              // 拿到整个 data 对象
response.data.name         // "Login Card"
response.data.children     // 拿到整个数组
response.data.children[0]  // "Title#1285:42260"（从 0 开始数）
```

链越长定位越精确，但越脆弱——中间任何一层缺失就断了。
用 `?.` 可选链防护：`response.data?.children?.[5]?.name`

## 替换内容

```typescript
// 知道位置 → 直接改
data.users[0].name = "Charlie";

// 不知道位置 → 遍历找
for (const user of data.users) {
  if (user.name === "Bob") user.age = 31;
}
```

## data 包一层的原因

把"你要的内容"和"请求状态"分开：

```json
{
  "data": { "name": "Login Card", "type": "frame" },
  "error": null,
  "status": 200
}
```

不是必须叫 `data`，有的 API 叫 `result`、`payload`，意思一样。

## Object vs Array 对比

| | Object `{}` | Array `[]` |
|---|---|---|
| 按 key/ID 查找 | 直接取，O(1) | 要遍历，O(n) |
| 按顺序遍历 | 不保证顺序 | 天然有序 |
| 知道有几个 | `Object.keys().length` | `.length` |
| 对 LLM | 都是逐 token 阅读，没有 O(1) vs O(n) 区别 |

## 实际例子：Figma 渐变

多个色标（stop）用数组描述：

```json
{
  "type": "GRADIENT_LINEAR",
  "stops": [
    { "position": 0,    "color": { "r": 1, "g": 0, "b": 0, "a": 1 } },
    { "position": 0.5,  "color": { "r": 1, "g": 1, "b": 0, "a": 1 } },
    { "position": 1,    "color": { "r": 0, "g": 0, "b": 1, "a": 1 } }
  ]
}
```

- 每个 stop = 渐变编辑器上的一个色标
- `position` = 位置（0 起点，1 终点）
- `color` = RGBA 颜色值（r 红 g 绿 b 蓝 a 透明度）

## name#id 寻址方案讨论

### 现状：name#id 拼接

```json
"children": ["Title#1285:42260", "Email Field#1285:42261"]
```

用 `#` 拼接节点名和 Figma ID，靠正则 `(.+)#(\d+:\d+)$` 拆分。

### 问题

1. **解析 bug**：如果用户命名节点为 `Test#99:100`，正则会匹配错误
   - 虽然概率低，但用户输入不可控（导入、复制粘贴、非英语命名）
   - 静默出错，难排查
2. **多了 parseRef() 解析逻辑**：拼接省了 token，但代码多了解析步骤
3. **name 可变**：用户可以改名，拼接串会变，旧引用失效

### 替代方案对比

```
// 方案 A（现状）：name#id 拼接
"children": ["Title#1285:42260", "Email Field#1285:42261"]
// 省 token，但需要解析，有极端 bug

// 方案 B：{ name, id } 分开
"children": [{ "name": "Title", "id": "1285:42260" }]
// 无歧义，但 token 多 ~50%

// 方案 C：ID 做 key，name 做 value
"children": { "1285:42260": "Title", "1285:42261": "Email Field" }
// 不用解析，不怕改名，token 差不多，直接按 ID 定位
```

### name 和 ID 各自的作用

- **name** → 给 LLM 看，理解节点是什么（"Title" 比 "1285:42260" 有意义）
- **ID** → 给程序用，精确定位节点（不可变，Figma 生成）
- 执行修改时程序只需要 ID，name 在执行阶段没用

### 结论

ID 做 key 最可靠——不用解析，不怕改名，直接定位。name 放在 value 里给人/LLM 看。

## Bug: inspect 两个模式都丢失 component/instance 类型信息

NodeSerializer.mapFigmaType() 将 COMPONENT/INSTANCE/COMPONENT_SET 全部映射为 FRAME，
类型信息在 NodeLayer 中间格式阶段就已丢失。

jsonNodeSerializer.ts 第 453-460 行的 detail 模式有 component/instance 类型检查：
```typescript
if (node.type === 'COMPONENT' as any) result.type = 'component';
```
但这是**死代码**——因为 NodeSerializer 已将 type 改为 'FRAME'，检查永远为 false。

| 模式 | component 显示为 | instance 显示为 |
|---|---|---|
| tree（骨架） | frame | frame |
| detail（完整） | frame（死代码，检查不到） | frame（死代码，检查不到） |

**影响**：LLM 在任何模式下都无法识别 component/instance 节点，
无法做出复用决策（如用 instance 引用已有 component，而不是重新创建）。

**根因**：NODE_TYPES 常量（figma-api.ts）不包含 COMPONENT/INSTANCE/COMPONENT_SET，
mapFigmaType() 将它们映射为 FRAME，NodeLayer 中间格式无法表达这些类型。

**修复方向**：
- 方案 A：在 NODE_TYPES 中增加 COMPONENT/INSTANCE/COMPONENT_SET 类型
- 方案 B：NodeLayer 增加 originalType 字段保留原始 Figma 类型
- 方案 C：jsonNodeSerializer 直接从原始 Figma 节点读取类型（绕过 NodeLayer）

相关代码：
- `nodeSerializer.ts` 第 186-205 行 mapFigmaType()（类型丢失源头）
- `figma-api.ts` 第 305-315 行 NODE_TYPES（缺少 component/instance）
- `jsonNodeSerializer.ts` 第 453-460 行（死代码）
- `jsonNodeSerializer.ts` 第 109-119 行 TAG_MAP（tree 模式映射）

## 读取链路三层截断瓶颈

inspect 返回数据经过三层，每层都在截断，叠加后效果不可预测：

```
inspectHandler:       depth = 参数 || 5，上限 Math.min(参数, 10)
NodeSerializer:       maxDepth, maxChildrenPerLevel, maxTotalNodes
JsonNodeSerializer:   MAX_DEPTH=4, MAX_CHILDREN=15
```

实际效果：嵌套超过 4 层就看不到（JsonNodeSerializer 硬限制）。

**问题**：
1. LLM 很少主动调第二次 inspect 往下看
2. 即使逐层看，每次都消耗 token + 工具调用，效率低
3. 多次 inspect 后，早期内容在上下文里注意力已分散
4. 三层各自截断，开发者难以预测最终输出

**根因**：一次 inspect 混合了结构（谁包含谁）和属性（长什么样），
两者混在一起导致必须截断，否则 token 爆炸。

**改进方向**：骨架与属性彻底分离
- 全量骨架：整棵树只返回 type + name + id，不管多深 token 都很少，不需要截断
- 按需 detail：指定某个节点看完整属性
- 现在的 tree 模式带了 summary、role、size 等属性信息，所以也膨胀需要截断——骨架不够骨架

相关代码：
- `inspectHandler.ts` 第 24 行 depth 限制
- `nodeSerializer.ts` SerializationOptions（maxDepth/maxChildrenPerLevel/maxTotalNodes）
- `jsonNodeSerializer.ts` 第 21-22 行 MAX_DEPTH=4, MAX_CHILDREN=15

## NodeSerializer 完整分析

### 架构角色

NodeSerializer 是读取链路的第一层——从 Figma 活节点提取数据，输出 NodeLayer 中间格式。

```
Figma 活节点（SceneNode）
    ↓ extractFigmaNodeData()    从活节点解耦为普通 JS 对象（断开画布绑定）
    ↓ mapFigmaType()            映射节点类型（14种→9种）
    ↓ PROPS 遍历 + 属性转换     约 50 个属性逐个提取
    ↓ pruneDefaults             删除默认值
    ↓ 递归子节点 + 三道截断
NodeLayer { type, id, props, children }
```

### 两个入口

| 入口 | 截断 | 删默认值 | 谁用 |
|---|---|---|---|
| `serialize()` | 不截断（全部 Infinity） | 不删 | 调试用（main.ts），不暴露给 LLM |
| `serializeWithCompression()` | 截断 | 删 | inspect 工具，暴露给 LLM |

完整版 `serialize()` 能看到全部节点数据，但不给 LLM 用——因为复杂页面可能 50K+ token。

### extractFigmaNodeData — 解耦活节点

从 Figma 活节点批量读属性，转成普通 JS 对象。解决两个问题：
1. 活节点有 getter/方法/画布绑定，后续处理不应该依赖这些
2. `figma.mixed`（文本范围样式不统一）转成字符串 `'mixed'`，摆脱 Figma API 依赖

### 属性提取 — 四条路径

遍历 PROPS（约 50 个属性名），按 Figma API 返回的数据类型分路处理：

| 返回类型 | 属性 | 处理方式 |
|---|---|---|
| `number` / `string` / `boolean` | width, layoutMode, opacity 等 ~45 个 | PropertyTransformer 通用处理 |
| `Array<Paint>` | fills, strokes | 直接取原始值，留给 JsonNodeSerializer 转换 |
| `Array<Effect>` | effects | 直接取原始值 |
| `Object` 带 unit | lineHeight, letterSpacing | AUTO 跳过，对象取 `.value` |

判断标准来自 Figma Plugin API 文档的返回类型定义，不是人为判断。

### 三道子节点截断

截断只影响子节点数量，不影响当前节点属性（属性始终完整）：

| 截断 | 条件 | 结果 |
|---|---|---|
| 第 1 道 | `nodeCount >= maxTotalNodes` | 所有子节点不展开，标记 `_truncatedChildren` |
| 第 2 道 | 子节点数 > `maxChildrenPerLevel` | 超出的变骨架（id + type + name） |
| 第 3 道 | 递归途中 nodeCount 超了 | 剩余的变骨架 |

骨架节点保留：id（可深入查看）、type、name、_childCount（下面还有多少）。

### Bug: GROUP/SECTION 不应合并为 FRAME

`mapFigmaType()` 将 GROUP 和 SECTION 映射为 FRAME，但它们的可操作属性不同：

| 属性 | FRAME | GROUP | SECTION |
|---|---|---|---|
| auto layout | 有 | 没有 | 没有 |
| fills | 有 | 没有 | 有限 |
| strokes | 有 | 没有 | 没有 |
| cornerRadius | 有 | 没有 | 没有 |
| effects | 有 | 没有 | 没有 |
| padding | 有 | 没有 | 没有 |

LLM 如果以为 GROUP 是 FRAME，可能尝试设置 auto layout、padding 等，不会生效或报错。

相关代码：
- `nodeSerializer.ts` 第 186-205 行 mapFigmaType()
- `figmaNodeData.ts` extractFigmaNodeData()
- `figma-api.ts` PROPS（约 50 个属性定义）
- `figma-api.ts` NODE_TYPES（9 种类型定义）

## 术语

| 术语 | 含义 | 例子 |
|------|------|------|
| key（键） | 左边的名字 | `"name"`, `"type"`, `"children"` |
| value（值） | 右边的内容 | `"Login Card"`, `12`, `[...]` |
| 键值对 | 一组 key: value | `"name": "Login Card"` |
| 嵌套 | 对象/数组里面还有对象/数组 | `data` 里面有 `children` 数组 |
