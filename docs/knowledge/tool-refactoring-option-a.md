# 方案 A 详细设计：提升高频命令为 First-Class 工具

> Date: 2026-03-30
> Status: 设计完成，待确认
> Parent: [工具重构总览](tool-refactoring-overview.md)
> Related: [执行管线](execution-pipeline.md) | [OpenPencil 架构](openpencil-tool-architecture.md)

## 设计目标

将 `run` 中的高频命令提升为独立工具，使 LLM 用结构化 JSON 调用，而不是拼接 CLI 字符串。

### 当前 → 目标

```
当前（4 工具）                    目标（7 工具）
─────────────                    ─────────────
jsx                              jsx          （不变）
inspect                          inspect      （不变）
edit                             edit         （不变）
run(15 子命令)         →         search       （grep + sed 合并）
                                 structure    （mv + rm + cp 合并）
                                 knowledge    （man 提升）
                                 run          （瘦身：js, var, comp, more）
```

---

## 一、Schema 设计

### 1. `search` 工具 — 搜索与批量替换

合并 `grep`（搜索节点 + 发现属性）和 `sed`（批量替换）。

**为什么合并？** grep 和 sed 是天然成对的工作流：先 grep 发现值，再 sed 替换。合并后 LLM 可以在一个工具的上下文中完成整个流程，减少工具切换。

```typescript
// src/engine/agent/tools/unified/search.ts
export const searchDefinition: ToolDefinition = {
  name: 'search',
  category: 'read',
  executionStrategy: 'parallel',
  display: { displayName: 'Search', group: 'read' },
  description: `Search nodes and properties, or batch-replace values.

Three modes:
  find     — search nodes by name/type (default)
  discover — discover property values in a subtree
  replace  — batch search-and-replace properties

Examples:
  search({query: "Button"})
  search({query: "frame", scope: "Card#1:2"})
  search({node: "Card#1:2", props: ["fillColor", "fontSize"]})
  search({node: "Card#1:2", replace: {"fillColor": [{"from": "#FFF", "to": "#000"}]}})`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — matches node name or type. Triggers find mode.',
      },
      scope: {
        type: 'string',
        description: 'Limit search to subtree. "name#id" format. Default: entire page.',
      },
      node: {
        type: 'string',
        description: 'Target node ref ("name#id"). Required for discover/replace modes.',
      },
      props: {
        type: 'array',
        description: 'Properties to discover. Triggers discover mode.',
        items: { type: 'string' },
      },
      replace: {
        type: 'object',
        description: 'Replacement rules: {"propName": [{"from": value, "to": value}]}.',
      },
    },
  },
};
```

#### 模式推断算法

```typescript
function inferSearchMode(args: SearchArgs): 'find' | 'discover' | 'replace' {
  if (args.replace && args.node) return 'replace';   // 最高优先级
  if (args.props && args.node)   return 'discover';
  return 'find';                                      // 默认
}
```

#### LLM 调用对比

| 操作 | 旧方式 (CLI) | 新方式 (结构化) |
|------|-------------|----------------|
| 搜索节点 | `run({command: "grep Button"})` | `search({query: "Button"})` |
| 限制范围 | `run({command: "grep frame"})` | `search({query: "frame", scope: "Card#1:2"})` |
| 发现属性 | `run({command: "grep Card#1:2 fillColor,fontSize"})` | `search({node: "Card#1:2", props: ["fillColor", "fontSize"]})` |
| 批量替换 | `run({command: "sed Card#1:2 fillColor:#FFF/#000"})` | `search({node: "Card#1:2", replace: {"fillColor": [{"from": "#FFF", "to": "#000"}]}})` |

---

### 2. `structure` 工具 — 节点树结构操作

合并 `mv`（移动/重命名）、`rm`（删除）、`cp`（克隆）。

**为什么合并？** 这三个操作都是"改变节点树的结构"，参数模式相似（source/dest），且互斥。合并后 LLM 的工具选择更清晰：创建用 `jsx`，修改属性用 `edit`，改结构用 `structure`。

```typescript
// src/engine/agent/tools/unified/structure.ts
export const structureDefinition: ToolDefinition = {
  name: 'structure',
  category: 'modify',
  executionStrategy: 'sequential',
  display: { displayName: 'Structure', group: 'design' },
  description: `Modify the design tree structure — move, delete, or clone nodes.

Actions:
  move   — move or rename a node
  delete — remove a node and its children
  clone  — deep-copy a node with optional overrides

Examples:
  structure({action: "delete", node: "Card#1:2"})
  structure({action: "move", node: "Title#1:3", dest: "Footer#1:4"})
  structure({action: "move", node: "Title#1:3", name: "NewTitle"})
  structure({action: "move", node: "Item#1:5", index: 0})
  structure({action: "clone", node: "Card#1:2", dest: "Card/Hover", overrides: {bg: "#EEE"}})
  structure({action: "delete", node: "/Card/Placeholder*"})`,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"move", "delete", or "clone"',
        enum: ['move', 'delete', 'clone'],
      },
      node: {
        type: 'string',
        description: 'Target node ref ("name#id" or glob pattern like "/Card/Old*")',
      },
      dest: {
        type: 'string',
        description: 'Destination (move: new parent; clone: destination path)',
      },
      name: {
        type: 'string',
        description: 'New name (move: rename without changing parent)',
      },
      index: {
        type: 'number',
        description: 'Reorder position among siblings (move only)',
      },
      overrides: {
        type: 'object',
        description: 'Property overrides for clone. Supports "Child.prop": value.',
      },
    },
    required: ['action', 'node'],
  },
};
```

#### LLM 调用对比

| 操作 | 旧方式 (CLI) | 新方式 (结构化) |
|------|-------------|----------------|
| 删除 | `run({command: "rm Card#1:2"})` | `structure({action: "delete", node: "Card#1:2"})` |
| glob 删除 | `run({command: "rm /Card/Old*"})` | `structure({action: "delete", node: "/Card/Old*"})` |
| 重命名 | `run({command: "mv OldTitle#1:2 /Card/NewTitle"})` | `structure({action: "move", node: "OldTitle#1:2", name: "NewTitle"})` |
| 移动 | `run({command: "mv Logo#1:3 Footer#1:4"})` | `structure({action: "move", node: "Logo#1:3", dest: "Footer#1:4"})` |
| 克隆 | `run({command: "cp Card#1:2 /Card/Hover/ {bg:#EEE}"})` | `structure({action: "clone", node: "Card#1:2", dest: "/Card/Hover/", overrides: {bg: "#EEE"}})` |

---

### 3. `knowledge` 工具 — 知识查询

提升 `man` 为独立工具。纯知识查询，与画布操作无关。

```typescript
// src/engine/agent/tools/unified/knowledge.ts
export const knowledgeDefinition: ToolDefinition = {
  name: 'knowledge',
  category: 'knowledge',
  executionStrategy: 'parallel',
  display: { displayName: 'Knowledge', group: 'knowledge' },
  description: `Query design guidelines, style guides, and help documentation.

Examples:
  knowledge({topic: "components"})
  knowledge({source: "guidelines", topic: "dashboard"})
  knowledge({source: "style-tags"})
  knowledge({source: "style", tags: "dark-mode,minimal"})`,

  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: '"help" (default), "guidelines", "style-tags", or "style"',
        enum: ['help', 'guidelines', 'style-tags', 'style'],
      },
      topic: {
        type: 'string',
        description: 'Help topic or guidelines context',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated style tags (style source only)',
      },
    },
  },
};
```

---

### 4. 瘦身后的 `run`

仅保留 `js`, `var`, `comp`, `more` 四个低频/power 命令。

---

## 二、算法设计：数据流

### 当前数据流 (以 grep 为例)

```
LLM: run({command: "grep Button"})
  │
  ├─ [Sandbox] toolDispatcher.dispatch()
  │   └─ unwrapRunCommand()                   ← CLI 解析
  │       └─ parseCommandString("grep Button")
  │           └─ mapToToolArgs({name:"grep", pos:["Button"]})
  │               → {query: "Button", mode: "nodes"}
  │
  ├─ [Sandbox] ipcBridge.callTool("grep", {query, mode})  ← IPC
  │
  ├─ [Main]   dispatchCommand("grep", {query, mode})
  │   └─ handleGrep({query: "Button", mode: "nodes"})
  │       └─ figma.currentPage.findAll(...)     ← Figma API
  │
  └─ [Sandbox] presentForLLM(result)
```

### 方案 A 数据流 (以 search 为例)

```
LLM: search({query: "Button"})
  │
  ├─ [Sandbox] toolDispatcher.dispatch()
  │   └─ tc.name === "search"   ← 直接匹配，无 CLI 解析
  │      args 已是结构化 JSON
  │
  ├─ [Sandbox] ipcBridge.callTool("search", {query})  ← IPC
  │
  ├─ [Main]   dispatchCommand("search", args)
  │   └─ handleSearch(args)            ← 新薄路由层
  │       └─ mode = inferSearchMode()  → "find"
  │       └─ handleGrep({query, mode}) ← 复用！
  │
  └─ [Sandbox] presentForLLM(result)
```

### 核心原则：新工具 = 薄路由层 + 复用现有 handler

`handleSearch` **不重写** grep/sed 的逻辑，只做参数变换后调用现有 handler：

```typescript
// src/ipc/commands/searchAdapter.ts
import { handleGrep, handleSed } from './searchHandlers';

export async function handleSearch(params: any): Promise<ToolResponse> {
  const mode = inferSearchMode(params);
  
  switch (mode) {
    case 'find':
      return handleGrep({
        query: params.query,
        path: params.scope || '/',
        mode: 'nodes',
      });
      
    case 'discover':
      return handleGrep({
        path: params.node,
        properties: params.props,
        mode: 'properties',
      });
      
    case 'replace':
      return handleSed({
        path: params.node,
        replacements: params.replace,
      });
  }
}
```

```typescript
// src/ipc/commands/structureAdapter.ts
import { handleMv, handleRm, handleCp } from './writeHandlers';

export async function handleStructure(params: any): Promise<ToolResponse> {
  switch (params.action) {
    case 'delete':
      return handleRm({ path: params.node });
      
    case 'move': {
      const destPath = params.dest 
        || buildRenamePath(params.node, params.name);
      return handleMv({
        sourcePath: params.node,
        destPath,
        at: params.index,
      });
    }
      
    case 'clone':
      return handleCp({
        sourcePath: params.node,
        destPath: params.dest,
        propsRaw: params.overrides
          ? serializeOverrides(params.overrides)
          : undefined,
      });
  }
}

function buildRenamePath(nodeRef: string, newName: string): string {
  // "Title#1:3" + "NewTitle" → "/NewTitle"
  // 保持相同父级，只改名
  const parts = nodeRef.split('/');
  parts[parts.length - 1] = newName;
  return parts.join('/');
}

function serializeOverrides(obj: Record<string, any>): string {
  return '{' + Object.entries(obj)
    .map(([k, v]) => `${k}:${v}`)
    .join(',') + '}';
}
```

---

## 三、Figma API 接口映射

### search → Figma API

| search 模式 | Figma API 调用 | 现有 handler |
|-------------|---------------|-------------|
| `find({query})` | `figma.currentPage.findAll(n => n.name.includes(query))` | `handleGrep` |
| `discover({node, props})` | `getNodeByIdAsync(id)` → 递归遍历 → 读取属性 | `handleGrep(mode:properties)` |
| `replace({node, replace})` | `getNodeByIdAsync(id)` → 递归遍历 → 写属性 | `handleSed` |

### structure → Figma API

| structure 动作 | Figma API 调用 | 现有 handler |
|---------------|---------------|-------------|
| `delete({node})` | `node.remove()` | `handleRm` → `deleteNode()` |
| `move({node, dest})` | `parent.appendChild(node)` 或 `insertChild(idx)` | `handleMv` |
| `move({node, name})` | `node.name = newName` | `handleMv` |
| `clone({node, dest})` | `node.clone()` + `parent.appendChild` + `applyProps` | `handleCp` → `cloneNode()` |

### knowledge → 无 Figma API

`knowledge` 在 Sandbox 端执行（同 `man`），不经过 IPC，不调用 Figma API。

---

## 四、代码改动清单

### 新增文件

| 文件 | 层级 | 说明 |
|------|------|------|
| `src/engine/agent/tools/unified/search.ts` | Sandbox | search 工具定义 |
| `src/engine/agent/tools/unified/structure.ts` | Sandbox | structure 工具定义 |
| `src/engine/agent/tools/unified/knowledge.ts` | Sandbox | knowledge 工具定义 |
| `src/ipc/commands/searchAdapter.ts` | Main | 薄路由到 handleGrep/handleSed |
| `src/ipc/commands/structureAdapter.ts` | Main | 薄路由到 handleMv/handleRm/handleCp |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/engine/agent/tools/unified/index.ts` | unifiedTools 加入 3 个新工具 |
| `src/engine/agent/tools/unified/run.ts` | description 瘦身 |
| `src/engine/agent/tools/unified/commandParser.ts` | 删除 13 个遗留命令分支 |
| `src/engine/agent/tools/runtimeToolDescriptions.ts` | 更新验证规则 |
| `src/ipc/commands/index.ts` | COMMAND_HANDLERS 加入 search/structure |
| `src/engine/agent/toolDispatcher.ts` | allowedToolNames 加入新工具 |

### 不变文件

| 文件 | 说明 |
|------|------|
| `src/ipc/commands/searchHandlers.ts` | handleGrep/handleSed — 被复用，不改 |
| `src/ipc/commands/writeHandlers.ts` | handleMv/handleRm/handleCp — 被复用，不改 |
| `src/ipc/commands/jsxHandler.ts` | 不涉及 |
| `src/ipc/commands/editHandler.ts` | 不涉及 |
| `src/ipc/commands/inspectHandler.ts` | 不涉及 |

---

## 五、向后兼容与迁移

### Phase 1: 双入口并存

- 添加 search/structure/knowledge 工具定义 + 路由适配
- `run` 保持原样，CLI 路径仍然工作
- LLM 在 system prompt 中被引导使用新工具

### Phase 2: 软禁用旧路径

- 从 `run.ts` description 中移除 grep/sed/mv/rm/cp/man 的描述
- CLI 路径仍然可用（不报错），但 LLM 不再被提示使用

### Phase 3: 清理遗留

- 从 commandParser.ts 删除 13 个遗留命令分支
- `run` 瘦身到仅 js/var/comp/more

---

## 六、风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 工具选择困难（7 tools vs 4） | 中 | description 明确分工，category 引导 |
| prompt token 增加 | 低 | +800 (新 schema) - 500 (run 瘦身) = 净增 ~300 |
| structure overrides 解析 | 低 | 复用 parsePropString |
| 旧 prompt 兼容 | 低 | Phase 1 双入口并存 |

---

## 待确认的设计决策

1. **search.replace 格式**：结构化 `[{"from": "#FFF", "to": "#000"}]` vs 简化 `"#FFF → #000"` — token 消耗 vs 清晰度
2. **structure.clone overrides**：JSON object 直传 vs 旧文本格式 `parsePropString` 
3. **knowledge 工具名**：`knowledge` / `guide` / `docs` / `man`
