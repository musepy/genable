# Figma 节点模型与序列化管线

> 学习路径：[1 TypeScript 基础](typescript-symbol-flags.md) → [2 JSON 与数据格式](json-basics.md) → [3 系统与运行环境](system-and-runtime-fundamentals.md) → **[4] 本文**
>
> 索引：[学习笔记导航](learning-index.md)

## 节点的身份

每个节点是内存中的活对象，有多个属性：

```
唯一的：    id ("1:2")      → 内存索引的 key，不会变
分类的：    type ("FRAME")   → 节点类型，会重复
可重复的：  name ("Card")    → 用户可改，可同名
描述性的：  width, fills ... → 具体长什么样
```

name 和 ID 不是"对应"关系——是同一个对象上的两个属性，就像人既有名字又有身份证号。

## getNodeById 的原理

Figma 内部维护哈希表（推断，Figma 闭源）：

```
"1:2" → 内存地址 0x7B30 → Card 对象
"1:3" → 内存地址 0x7C44 → Header 对象
```

每次创建节点，自动登记到索引表。删除时移除。
所以 `getNodeById("1:2")` 是直接查表跳转，O(1)，不需要遍历。

只有按名字找时才需要遍历（Figma 没有 `getNodeByName`）。

### ID 格式 "1:2"

具体含义 Figma 未公开。只需知道：唯一、不变、原样传回去就能定位。

## 获取一棵树

只需要根节点，顺着 children 递归：

```typescript
function getTree(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    children: node.children?.map(child => getTree(child))
  }
}
```

不需要提前知道所有 ID，有根节点就能拿到整棵树。

### 根节点

根是宿主直接给你的起点，不需要"找"：

```
文件系统的根：  /                     操作系统给你
Figma 的根：   figma.currentPage     Figma 给你
```

### Page 也是节点

Figma 里一切都是节点，只是 type 不同：

```
DOCUMENT（文档节点）
  └── PAGE（页面节点）← figma.currentPage
        ├── FRAME
        │     ├── TEXT
        │     └── FRAME
        └── FRAME
```

Page 和 Frame 的区别只是能做什么（Page 没有填充、圆角等）。

## 工具的本质：定位 + 操作

所有写入工具都是同一个模式：

```
edit  = getNodeById(id) + 改属性
jsx   = createFrame/Text + 设属性
run rm = getNodeById(id) + 删除
run mv = getNodeById(id) + 改 parent
```

### Agent 怎么知道改哪个节点

LLM 从文本中拿不到 ID，需要通过其他方式获取：

1. **记忆**：刚创建的，上下文里还有 ID
2. **查看**：inspect 看画布，从名字推断
3. **选区**：用户在 Figma 里选中了，系统直接给 agent

创建后拿到 ID 就够了。但 LLM 上下文有限，ID 可能被压缩掉，所以 inspect 存在的意义是"忘了可以再看"。

## LLM 输出是文本，插件执行代码

```
LLM 输出：  edit({ node: "Card#1:2", fill: "#FF0000" })  ← 文本
插件解析：  ref.split("#")[1] → "1:2"                     ← 提取 ID
插件执行：  figma.getNodeById("1:2").fills = [...]         ← 代码执行
Figma：    检测到 fills 变了 → 重新渲染画布                ← 自动
```

### Figma 怎么检测属性变了

推断：node.fills 是 setter，赋值动作本身触发通知（markDirty），不是扫描检测。
这就是"活对象"——赋值有副作用，不只是存数据。

## 序列化管线问题

### 现状：两步翻译 + 中间格式

```
活对象 → NodeSerializer → NodeLayer → JsonNodeSerializer → JSON 给 LLM
          （提取数据）     （中间格式）   （重命名精简）
```

NodeLayer 是类型定义（模具），不是程序。规定了数据长什么样：
`{ type, id, props: {...}, children: NodeLayer[] }`

### 问题 1：中间格式多余

NodeLayer 只有 JsonNodeSerializer 一个消费者。两步可以合成一步：

```
现在：活对象 → NodeSerializer → NodeLayer → JsonNodeSerializer → JSON
合并：活对象 → 一步到位 → JSON
```

### 问题 2：Page 绕过了 NodeSerializer

Page 在 inspectHandler 里手动处理，其他节点走 NodeSerializer。
同样是活对象，处理方式不统一。改序列化逻辑要改多处，漏改就不一致。

原因：PAGE 不在 NODE_TYPES 里，mapFigmaType() 不认识它。是历史遗留，不是有意设计。

### 问题 3：三层截断应该是工具参数

```
现在：三层各有硬编码，LLM 说 depth=8 实际只能看到 4 层
应该：LLM 传一个 depth，一个地方执行
```

### 问题 4：白名单导致遗漏

```
现在（白名单）：手动列 50 个属性 → Figma 加新属性就丢了
改进（黑名单）：列出不要的，其余全要 → 新属性自动包含
```

## 白名单 → 黑名单 改进

### 黑名单分类

```typescript
export const BLACKLIST = new Set([
  // 方法（动作，不是状态，LLM 不需要看）
  'resize', 'clone', 'exportAsync', ...

  // 只读/计算值（Figma 算出来的，改了也会被覆盖）
  'absoluteRenderBounds', 'absoluteBoundingBox', 'absoluteTransform',
  'fillGeometry', 'strokeGeometry', 'vectorNetwork', ...

  // 废弃
  'horizontalPadding', 'verticalPadding', 'backgrounds', ...

  // 单独处理（不是不要，是在别处已经写入了）
  'id', 'type', 'name', 'parent', 'children', 'removed', 'visible',
]);
```

### 为什么方法不要

方法是动作（"做什么"），属性是状态（"是什么"）。
LLM 看属性了解节点状态，怎么执行是插件的事。

```
LLM 说：  edit({ width: 360 })     ← 只说要什么
插件决定：node.resize(360, 200)    ← 怎么执行
```

### 为什么计算值不要

计算值是 Figma 根据输入值算出来的结果。改结果没意义——下一帧 Figma 会重新算。

```
输入值（你设的）：  x: 50（相对父节点）
计算值（算出来的）：absoluteBoundingBox.x: 150（画布上的绝对位置）
```

LLM 只需要改输入值，结果自动更新。

### 计算值 vs 输入值取决于上下文

同一个属性在不同情况下身份会变：

```
auto layout 内普通子节点：  x, y 是计算值（layout 决定位置）
auto layout 内绝对定位：    x, y 变成输入值（你自己决定位置）

始终是输入值：    fills, cornerRadius, fontSize
始终是计算值：    absoluteRenderBounds, absoluteTransform
看情况的：       x, y
```

## 新属性自动发现

### 三种方式

| 方式 | 过时节点 | 复杂度 |
|---|---|---|
| 手动维护 | 写完就可能过时 | 最低 |
| build time 提取 | Figma 更新后过时，重新 build 恢复 | 中等 |
| runtime 发现 | 不会过时 | 最高 |

### Runtime 自动学习链路

```
Figma 加了新属性
  → inspect 读到（不在黑名单，不过滤）
  → 不在已知列表 → 标记 _newProps
  → 请求 Figma API 文档
  → 摘要注入 agent 上下文
  → agent 学会读和写
  → 新属性加入已知列表
```

三类属性：
1. **已知属性**：正常处理
2. **黑名单**：确定不需要的，过滤掉
3. **未知属性**：新的，标记 → 查文档 → 学会 → 变成已知

从被动（等人更新代码）变成主动（自己发现、自己学、自己用）。

### 读 vs 写的自动能力差异

```
读（inspect）：可以自动看到新属性（黑名单过滤，其余全要）
写（edit）：   需要三个条件都满足
  1. LLM 知道属性存在（训练数据）
  2. LLM 知道怎么用（训练数据）
  3. handler 能处理（插件代码）
```

读可以自动跟进，写基本需要人介入——除非用 runtime 自动学习链路。
