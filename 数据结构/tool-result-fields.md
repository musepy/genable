# Tool Result 字段清单 — LLM 呈现层 (Layer 2)

> 每个命令返回给 LLM 的字段，以及被 `KEEP_FIELDS` 过滤掉的内部字段。
>
> 源码：`src/engine/agent/tools/unified/presentation.ts`

---

## 设计原则

```
executor 原始结果 → presentForLLM() → stripForLLM() → LLM 上下文
                    ├─ exit code        ├─ KEEP_FIELDS 白名单过滤
                    ├─ stderr 提取      └─ 空数组/空对象跳过
                    ├─ overflow 截断
                    └─ binary 拦截
```

- **高频命令**（mk、ls、cat）：严格过滤，只保留 LLM 需要行动的字段
- **低频命令**（var、comp、js）：未注册 KEEP = 全透传，调用次数少，token 开销可接受
- 所有命令都附加 `_meta`（exit code + 耗时）和可选 `_stderr`

---

## 1. Write 命令

### mk — 创建/更新节点（upsert）

**KEEP**: `['idMap', 'created', 'failed', 'errors', 'degraded', 'degradedHint']`

| 字段 | LLM 可见 | 类型 | 含义 |
|------|---------|------|------|
| `idMap` | ✅ | `{ "Card": "100:5", "Title": "100:6" }` | 名字→Figma ID 映射，后续操作必须靠它引用节点 |
| `created` | ✅ | `number` | 成功创建的节点数 |
| `failed` | ✅ | `number` | 失败的节点数 |
| `errors` | ✅ | `[{ op: string, error: string }]` | 哪个节点因什么原因失败（最多 8 条） |
| `degraded` | ✅ | `string[]` | 降级创建的节点名（节点在，但属性不全） |
| `degradedHint` | ✅ | `string` | 修复指引："Use edit to apply their intended styles" |
| `defaultsApplied` | ❌ | `[{ property, value, node, reason }]` | 编译器自动补的属性（sizing/clips 等） |
| `warnings` | ❌ | `[{ node, warnings[] }]` | 非 default 类型的运行警告 |
| `warningCount` | ❌ | `number` | 警告总数 |
| `violations` | ❌ | `[{ code, severity, node, message, fix? }]` | postOp 验证违规（TEXT_OVERFLOW 等） |
| `nodeLimitWarning` | ❌ | `string` | 超过软创建上限的提醒 |
| `renamed` | ❌ | `{ "Card": "Card_2" }` | 同名节点自动去重后的映射 |

**三种结局**：
- ✅ 成功 → `idMap` + `created`
- ⚠️ 降级 → `idMap` + `degraded`（节点创建了但属性不全）
- ❌ 失败 → `failed` + `errors`（节点未创建）

### cp — 克隆节点

**KEEP**: `['idMap']`

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `idMap` | ✅ | 克隆出的新节点 ID |
| 其他 executor 字段 | ❌ | 全部剥离 |

### rm — 删除节点

**KEEP**: `['deleted']`

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `deleted` | ✅ | 删除的节点数 |

### mv — 移动/重命名

**KEEP**: `['id', 'name']`

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `id` | ✅ | 节点 Figma ID |
| `name` | ✅ | 当前名字 |
| `oldName` | ❌ | 旧名 |
| `newName` | ❌ | 新名 |
| `renamed` | ❌ | 是否改了名（boolean） |
| `moved` | ❌ | 是否换了父节点 |
| `reordered` | ❌ | 是否调了顺序 |
| `newParent` | ❌ | 新父节点名 |
| `index` | ❌ | 新位置索引 |

---

## 2. Read 命令

### ls — 列出子节点

**KEEP**: `['listing']`

| 字段 | LLM 可见 | 类型 | 含义 |
|------|---------|------|------|
| `listing` | ✅ | `string` | 格式化文本，每行一个子节点（名字、类型、尺寸、布局） |
| `path` | ❌ | `string` | 查询路径 |
| `container` | ❌ | `string` | 容器名 |
| `count` | ❌ | `number` | 子节点数 |
| `footer` | ❌ | `string` | `[5 items | page: "xxx"]` 汇总行 |

**listing 单行格式**：
```
Card/                    frame    400×600  layout:column  gap:16
Title                    text     380×32   "Welcome to..."
```

### tree — 结构骨架

**KEEP**: `['tree']`

| 字段 | LLM 可见 | 类型 | 含义 |
|------|---------|------|------|
| `tree` | ✅ | `string` | 树形文本或 XML 骨架 |
| `path` | ❌ | `string` | 查询路径 |
| `suggestedReads` | ❌ | `string[]` | 建议深入查看的子树路径 |

**tree 文本格式**（页面级）：
```
Page 1/ (page, 3 children)
├── Card/ (frame 400×600, layout:column)
│   ├── Header/ (frame 400×80, layout:row)
│   └── Body/ (frame 400×520, layout:column)
└── Footer (text 200×24 "Copyright")
```

### cat — 完整属性

**KEEP**: `['tree', '__image']`

| 字段 | LLM 可见 | 类型 | 含义 |
|------|---------|------|------|
| `tree` | ✅ | `string` | XML/FlatOps 格式的完整属性 |
| `__image` | ✅ | `{ mimeType, data }` | base64 截图（需 `-s` flag） |
| `path` | ❌ | `string` | 查询路径 |
| `hint` | ❌ | `string` | 大节点时的导航建议 |
| `pattern` | ❌ | `string` | glob 模式（glob 模式时） |
| `matches` | ❌ | `number` | 匹配数（glob 模式时） |
| `nodes` | ❌ | `array` | 匹配节点详情（glob 模式时） |

**大节点自动降级**：超过 `AUTO_DEGRADE_CHARS` 时，`tree` 从完整 XML 退化为结构骨架，并附带 hint。

---

## 3. Search & Replace 命令

### grep — 搜索

**KEEP**: `['results', 'properties']`

两种模式，返回不同字段：

**节点搜索模式**（`grep Button`）：

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `results` | ✅ | `[{ id, name, type, x, y, width, height }]`（最多 20 条） |
| `total` | ❌ | 总匹配数 |
| `truncated` | ❌ | 是否截断 |

**属性发现模式**（`grep /Card/ fillColor,fontSize`）：

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `properties` | ✅ | `{ fillColor: ["#FFF","#000"], fontSize: [14, 24] }` |

### sed — 批量替换

**KEEP**: `['replaced', 'details']`

| 字段 | LLM 可见 | 含义 |
|------|---------|------|
| `replaced` | ✅ | 总替换数 |
| `details` | ✅ | `{ fillColor: 12, fontSize: 3 }` 按属性统计 |

---

## 4. Knowledge 命令

### man — 帮助/文档

**KEEP**: `null`（全透传）

返回 markdown 文本，不做任何过滤。

---

## 5. 全透传命令（未注册 KEEP_FIELDS）

以下命令在 `KEEP_FIELDS` 中没有注册，`stripForLLM()` 对 `undefined` 直接 pass through。

### var — 变量管理

| 子命令 | 返回结构 |
|--------|---------|
| `var ls` | 集合列表、每个集合的变量名/类型/值 |
| `var mk` | 创建的变量 ID + 名字 |
| `var mk --collection` | 创建的集合 ID + modes |
| `var bind` | 绑定结果（节点 ID + 属性 + 变量名） |
| `var alias` | 别名关系（semantic → primitive） |

### comp — 组件管理

| 子命令 | 返回结构 |
|--------|---------|
| `comp create` | 组件 ID + 名字 |
| `comp combine` | 变体集 ID + 包含的变体 |
| `comp prop` | 添加的属性名 + 类型 |
| `comp ls` | 组件属性列表 + 变体列表 |
| `comp instance` | 实例 ID |

### js — 执行 JavaScript

返回 `serializeValue()` 处理后的结果：
- Figma 节点 → `{ id, type, name, width, height, x, y, childCount }`
- 数组 → 最多 100 项
- 对象 → 最多 3 层递归
- 原始值 → 直接返回

### more — 分页输出

返回截断内容的下一页。

---

## 6. 公共附加字段

所有命令经过 `presentForLLM()` 后都会附加：

| 字段 | 来源 | 含义 |
|------|------|------|
| `_meta` | `formatMeta()` | `"[exit:0 \| 320ms]"` — exit code + 耗时 |
| `_stderr` | `extractStderr()` | 命令失败时的错误原因（可选） |

---

## 7. Overflow 与 Binary 守卫

对 `listing` 和 `tree` 两个文本字段应用：

```typescript
const TEXT_FIELDS = ['listing', 'tree'] as const;
cleaned.data[field] = guardBinary(truncateOverflow(cleaned.data[field], hint));
```

| 守卫 | 触发条件 | 处理 |
|------|---------|------|
| `truncateOverflow` | 超过 200 行 | 截断 + 写入 `/tmp` + 追加导航提示 |
| `guardBinary` | null byte / 非法 UTF-8 / 控制字符 >10% | 替换为错误信息 + 引导命令 |

**Overflow 提示**（按命令定制）：
```typescript
ls:   'Use tree -d 2 for overview or cat /path/ for specific node.'
tree: 'Use cat /path/ for specific subtree.'
cat:  'Use tree to discover structure, then cat specific children.'
grep: 'Narrow the search query or target a specific path.'
```

---

## 8. Legacy 兼容

旧工具名在 `KEEP_FIELDS` 中仍有注册，防止旧版 session 中的结果穿透：

```typescript
design: ['idMap', 'created', 'edited', 'deleted', 'failed', 'errors', 'degraded', 'degradedHint'],
edit:   ['idMap', 'edited', 'failed', 'errors', 'changeSummary'],
create: ['idMap'],
```
