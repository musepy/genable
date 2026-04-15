# Figma Plugin API 读取能力 + Registry 索引设计

## 1. Figma Plugin API 读取方法全览

### Node Lookup（按 ID）

| 方法 | 作用域 | 说明 |
|------|--------|------|
| `figma.getNodeById(id)` | 全文档 | 同步，O(1) 哈希查找 |
| `figma.getNodeByIdAsync(id)` | 全文档 | 异步版本，推荐使用 |
| `node.getPluginData(key)` | 单节点 | 读取插件存储的 metadata |

### Search / Find

| 方法 | 作用域 | 说明 |
|------|--------|------|
| `node.findAllWithCriteria(criteria)` | 子树 | 原生 C++ 按类型预过滤，最快批量查找 |
| `node.findAll(callback)` | 子树 | JS callback 过滤，灵活但慢 |
| `node.findOne(callback)` | 子树 | 返回第一个匹配 |
| `node.findChildren(callback)` | 仅直接子节点 | 不递归 |
| `node.findChild(callback)` | 仅直接子节点 | 返回第一个匹配 |

### 属性访问

| 属性 | 说明 |
|------|------|
| `node.children` | 直接子节点数组（每次访问 = 1 次 IPC） |
| `node.parent` | 父节点引用 |
| `node.id` / `node.name` / `node.type` | 基础属性，同步读取 |
| `node.absoluteTransform` | 绝对位置矩阵 |
| `node.absoluteBoundingBox` | 绝对边界框 |

### 性能排序

```
getNodeByIdAsync(id)           ← 最快，哈希查找
findAllWithCriteria({types})   ← 原生 C++，有类型预过滤
findAll(cb) / findOne(cb)      ← 原生 C++，但 callback 在 JS 执行
findChildren(cb)               ← 单层，快但范围有限
递归 node.children             ← 最慢，N 个节点 = N 次 IPC
```

## 2. findAllWithCriteria 详解

### 签名
```ts
node.findAllWithCriteria(criteria: { types: NodeType[] }): SceneNode[]
```

### 限制
- criteria 参数**只支持 `types` 一个字段**
- 无法按 name、visible、width 等属性过滤
- 返回扁平数组，**丢失层级关系**
- 要重建树需额外读 `node.parent.id`（每个节点 1 次同步 IPC）

### 与 findAll 对比
```ts
// findAll — 灵活，慢（每个节点 JS↔C++ 来回）
figma.currentPage.findAll(n => n.name === 'Card' && n.visible)

// findAllWithCriteria — 不灵活，快（C++ 内部过滤，一次性返回）
figma.currentPage.findAllWithCriteria({ types: ['FRAME', 'TEXT'] })
```

## 3. 同步 vs 异步

Figma Plugin API 大部分属性是**同步阻塞式 IPC**：

```ts
node.width       // 同步，立即返回，但阻塞等 IPC 结果
node.fills       // 同步
node.layoutMode  // 同步
```

少数异步 API：
```ts
figma.getNodeByIdAsync(id)    // 异步
node.exportAsync(settings)     // 导出图片
figma.loadFontAsync(font)      // 加载字体
```

**无法 Promise.all 并行读属性**——属性是同步的，没有 Promise 可并行。
Promise.all 只能并行多个 `getNodeByIdAsync`。

## 4. 核心瓶颈分析

当前 `inspect("/")` 的调用链：
```
inspect({node: "/"})
  → resolvePathToNode("/") → figma.currentPage
  → page.children.map(child =>
      NodeSerializer.serializeWithCompression(child, {maxDepth: 5})  ← 递归遍历子树
      → JsonNodeSerializer.serialize(...)  ← 转 skeleton JSON
    )
```

瓶颈：`NodeSerializer.serializeWithCompression` 递归遍历 children，每个节点读属性，都是 IPC。

## 5. Registry 索引设计

### 核心思路
创建时顺手写入 Map（nodeFactory 已持有所有数据），后续读取查 Map 代替遍历。

### 数据模型
```ts
type IndexRecord = {
  id: string        // 创建后永不变
  name: string      // 仅 rename 会变
  type: string      // 创建后永不变
  parentId: string   // reparent 会变
  childIds: string[] // reparent/delete 会变
}

const registry = new Map<string, IndexRecord>()
```

### CRUD 稳定性分析

| 操作 | id | name | type | parentId | childIds |
|------|-----|------|------|----------|----------|
| Create | 不变 | 不变 | 不变 | 不变 | 不变 |
| Read | 不变 | 不变 | 不变 | 不变 | 不变 |
| Update (edit) | 不变 | 可能改 | 不变 | 不变 | 不变 |
| Delete (rm) | 整条删 | - | - | - | - |
| Move (mv) | 不变 | 不变 | 不变 | **改** | 两父 **改** |
| Copy (cp) | 新 ID | 可能改 | 不变 | 新父 | 新子 IDs |

### 用户直接操作的影响

| 用户操作 | id | name | type | parentId | childIds |
|---------|-----|------|------|----------|----------|
| 改颜色/字号/间距 | - | - | - | - | - |
| 改文案 | - | - | - | - | - |
| 改大小 | - | - | - | - | - |
| 重命名 | - | **过期** | - | - | - |
| 拖到另一个 frame | - | - | - | **过期** | **过期** |
| 删除 | **悬空** | - | - | - | 父 **过期** |
| Group/Ungroup | - | - | - | **过期** | **过期** |

**Figma 没有 `onNodeChanged` 事件——用户直接操作无法被插件感知。**

### 两模式策略

**微调模式**（结构不变，高频场景）：
- 存完整 5 字段
- inspect("/") → 查 registry → 完整 skeleton → 0 IPC
- 适用：用户说"把标题改大一点"，agent 反复 inspect 同一棵树

**重构模式**（结构可能变）：
- 只信 `{id, name, type}`
- 树关系每次现读
- 适用：用户手动拖拽重组后再让 agent 调整

### 写入时机

| 阶段 | API | 额外成本 |
|------|-----|---------|
| 创建时 | 无额外（nodeFactory 已有数据） | 0 IPC |
| 冷启动 | `findAllWithCriteria` 一次性扫描 | 1 次原生调用 + N 次 parent 读取 |
| 修改时 | 无额外（edit/run 已有数据） | 0 IPC |
| 读 skeleton | 纯 Map 查询 | 0 IPC |
| 读详情 | `getNodeByIdAsync` | 1 IPC |

### 降级策略

```ts
function resolveFromRegistry(id: string): SceneNode | null {
  const node = await figma.getNodeByIdAsync(id)
  if (!node) {
    registry.delete(id)  // 已被删除，清理索引
    return null
  }
  // 验证是否还在当前页面
  let parent = node.parent
  while (parent && parent.type !== 'PAGE') parent = parent.parent
  if (parent !== figma.currentPage) {
    registry.delete(id)  // 跨页了，清理索引
    return null
  }
  return node
}
```

### 与 Open Pencil 类架构的本质区别
- Open Pencil: Map IS 数据库（唯一数据源，所有操作经过它，天然一致）
- 我们: Map = 二级索引（Figma 引擎是数据源，用户可绕过插件直接改，可能漂移）
- 结论：不追求绝对一致，接受"大部分时候省掉遍历，偶尔 miss 时单次回退"
