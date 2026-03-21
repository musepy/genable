# 虚拟文件系统：Agent 工具接口设计

> 起源：2026-03-15 讨论。从 "CLI is All Agents Need" 文章出发，推导出虚拟文件系统作为 Figma Agent 工具接口的可能性。

## 背景：CLI 文章的核心论点

文章主张：一个 `run(command="...")` 就够了。所有能力通过 CLI 命令暴露。

三个关键原则：
1. **用 LLM 已经会的语言** — CLI 恰好是训练数据里最密集的工具范式
2. **减少认知负荷** — 1 个工具 + 命令组合 < 15 个独立 schema 的工具选择
3. **启发式导航** — help/error/output format 让 agent 自纠偏，而不是靠 system prompt 塞文档

三个递进的设计手段：
- `--help` → "我能做什么？" → 主动发现
- Error Msg → "做错了怎么办？" → 被动纠偏
- Output Fmt → "做得怎么样？" → 持续学习

双层架构：
- Layer 1: Unix 执行层 — 纯 Unix 语义，命令路由、pipe、chain、exit
- Layer 2: LLM 呈现层 — 为 LLM 认知约束设计，二进制拦截、截断+溢出、元数据

## 第一层分析：为什么 CLI 语法不直接适用 Figma

### 直接适用的
- **渐进式披露** — 我们的 context→outline→inspect 已经是递进发现
- **Error message 纠偏** — 可以做得更好，每个错误应同时包含 "出了什么问题" 和 "该怎么做"
- **Output format 一致性** — 可以加 `[nodes: 3 created | 245ms]` 这样的元数据尾巴

### 不适用的 — Figma 是文章自己承认的反例

> "强类型交互：数据库查询、GraphQL API 等需要结构化输入输出的场景，schema 验证比字符串解析更可靠。"

Figma 场景图是强类型对象图，不是文本流：
```
design({ ops: [{
  type: "frame", layout: "row", alignMain: "spaceBetween",
  width: "fill", height: 64, fills: "#FFFFFF"
}]})
```

CLI flag 语法的问题：
1. **更长** — `--layout row --align-main spaceBetween --width fill` 比 JSON 属性更啰嗦
2. **更脆弱** — 字符串解析 `--fills #FFFFFF` 的边界情况远多于 JSON schema 验证
3. **没有训练数据优势** — LLM 训练数据里没有 "Figma CLI"，但有大量 CSS/design token 的 JSON 结构

**CLI 管道对设计操作没有语义。** 设计操作是有依赖链的树构建，不是可以 pipe 的文本变换。

**文章的本质是：找到 LLM 的 "母语"，然后用那个语言设计工具接口。** 对于系统管理，母语是 CLI。对于 UI 设计，母语是 CSS/设计系统的心智模型。

## 转折点：虚拟文件系统

> 关键问题："如果我们可以有基于文件系统的环境能力呢？"

之前说 "CLI 对 Figma 不适用" 是因为把 CLI 等同于 Unix shell 命令。但如果**把 Figma 场景图投射为虚拟文件系统**，情况完全不同。

### 核心映射：节点 = 目录，属性 = 文件

```
/Page 1/
  /Login Card/
    props.json → { "layout": "column", "width": 400, "fills": "#FFF", "cornerRadius": 16 }
    /Header/
      props.json → { "layout": "row", "width": "fill", "height": 64 }
      /Logo/
        props.json → { "type": "frame", "width": 40, "height": 40 }
      /Title/
        props.json → { "type": "text", "content": "Welcome", "fontSize": 24 }
    /Form/
      props.json → { "layout": "column", "gap": 16, "width": "fill" }
```

目录 = 容器关系（parent/child），`props.json` = 节点属性。**路径即地址，层级即结构** — 不需要 nodeId，不需要 parent 字段。

### 关键优势：LLM 的训练数据直接生效

LLM 训练数据里有**数十亿行**文件系统操作：

```bash
# 导航 — 训练数据：海量
ls /Page 1/                              # → 顶层节点列表
cat /Page 1/Login Card/Header/props.json # → 完整属性

# 搜索 — 训练数据：海量
find /Page 1/ -name "props.json" | xargs grep "fills"
grep -r "fontSize" /Page 1/Login Card/

# 修改 — 训练数据：海量
write /Page 1/Login Card/props.json '{"fills":"#000"}'
mv /Page 1/Login Card/Footer /Page 1/Login Card/Header/
cp /Page 1/Login Card /Page 1/Signup Card
rm /Page 1/Login Card/Footer
```

对比：

| 现在（LLM 需要学） | 虚拟 FS（LLM 已经会） |
|---|---|
| `context()` | `ls /` |
| `outline({ nodeId })` | `tree /Page 1/Card/` |
| `inspect({ nodeId })` | `cat /Page 1/Card/props.json` |
| `design({ ops: [{ delete }] })` | `rm /Page 1/Card/Old` |
| `query({ search: "button" })` | `grep -r "button" /Page 1/` |

### 创建操作：路径隐含了 parent

现在 LLM 创建节点要填 `parent` 字段：
```json
{ "type": "frame", "id": "header", "parent": "login-card", ... }
```

虚拟 FS 中，**路径本身就是 parent 声明**：
```bash
create /Page 1/Login Card/ '{"layout":"column","width":400}'
create /Page 1/Login Card/Header/ '{"layout":"row","width":"fill"}'
create /Page 1/Login Card/Header/Title '{"type":"text","content":"Hello"}'
```

LLM 不需要管理 tempId → realId 映射。**文件系统的层级结构天然表达了树的依赖关系。**

### 管道组合回来了

有了文件系统抽象后：
```bash
# 批量改色
find /Page 1/Login Card/ -name "props.json" -exec grep -l "#666" {} \; | xargs sed 's/#666/#333/g'

# 对比两个组件
diff /Page 1/Card A/props.json /Page 1/Card B/props.json

# 导出结构
tree /Page 1/Login Card/ > structure.txt
```

管道之所以重新有效，是因为**文件系统把设计的树结构降维成了文本路径** — 而文本路径是 Unix 管道能处理的。

### 架构：虚拟 FS 是接口层，不是实现

```
┌──────────────────────────────────────────┐
│  LLM 看到的：虚拟文件系统                    │
│  ls / cat / create / write / rm / mv      │
├──────────────────────────────────────────┤
│  翻译层：path → nodeId，JSON → Figma props  │  ← 新增
│  路径解析 | 属性规范化 | 批量事务             │
├──────────────────────────────────────────┤
│  执行层：Figma Plugin API                   │  ← 不变
│  figma.createFrame() | node.fills = [...]  │
└──────────────────────────────────────────┘
```

LLM 以为自己在操作文件。实际上：
- `ls /Page 1/Card/` → `figma.getNodeById(cardId).children.map(c => c.name)`
- `cat .../props.json` → `extractProps(figma.getNodeById(id))`
- `create /Page 1/Card/ '{...}'` → `figma.createFrame()` + `applyProps()`

**属性规范化（`fills: "#FFF"` → Figma Paint array）留在翻译层**，LLM 继续用 CSS-like 简写。

## 需要面对的问题

### 1) 批量效率
现在一次 `design()` 创建 10 个节点。虚拟 FS 下要 10 条 `create`。但换个角度——我们一直在跟属性遗漏问题斗争。正是因为一次 ops 太多，LLM 注意力分散。每条 `create` 独立，注意力集中，反而可能提升质量。这就是 "分步创建能缓解" 的自然实现。

### 2) 路径特殊字符
Figma 节点名可以是任意字符串。解法：节点名做 slug 化或用 ID 路径 + display name。

### 3) 实现成本
需要新建翻译层：路径解析器、虚拟 FS 状态同步、事务性写入。

## 最深层的洞察

文章说 "CLI is all agents need"，本质在说：**用 LLM 已有的认知图式，而不是发明新的。**

对于 Unix domain，那个图式是 shell 命令。对于**任何树结构 domain**，那个图式是**文件系统** — 因为文件系统是 LLM 训练数据中最普遍的树结构交互范式。

Figma 场景图是一棵树。DOM 是一棵树。AST 是一棵树。文件系统也是一棵树。**把任何树暴露为文件系统，LLM 就自动获得了导航和操作它的全部训练数据。**

这可能不只是对 Figma agent 的优化 — 而是一个通用的 agent 设计模式：**任何结构化数据，投射为虚拟文件系统后，LLM 的操作能力会显著提升。**

## Spike 验证 (2026-03-15)

实现了最小 spike：`ls`/`tree`/`cat` 替代 `context`/`outline`/`inspect`，保留 `design`/`replace`/`query` 不变。

### 改动范围
- `vfs.ts` — ls/cat/tree 工具定义
- `commandRegistry.ts` — 替换命令注册
- `toolCallHandler.ts` — 路径解析器 `resolvePathToNode()` + 3 个 VFS handler
- 周边适配：loopDetector, contextSummarizer, toolResultCleaner, runtimeToolDescriptions

### 路径解析器核心设计
```
resolvePathToNode("/Login Card/Header/Title")
  → segments: ["Login Card", "Header", "Title"]
  → 从 figma.currentPage 开始
  → 找 children 里 name === "Login Card" → 找 "Header" → 找 "Title"
  → 返回 SceneNode

错误时返回可操作信息：
  "Title" not found in "Header". Available: Logo, Nav, Search
```

### 首次 E2E 结果
- Kimi K2.5 模型
- 创建场景：直接用 `design` 创建（合理，页面为空无需读）
- 编辑场景：`design`(失败) → `tree({path:"/"})` → `query(nodes)` → `cat({path:"/1015:9981/"})` → `design`(成功)
- LLM 自然使用了 `tree("/")` 和 `cat` 的路径语法
- 错误后自动走 tree→cat→design 纠偏路径

### 待验证
- 多轮对话中 LLM 是否记住用路径而非名称来 update
- 更复杂的编辑场景（多节点、嵌套深层）
- 与 Gemini Flash 的兼容性（目前只测了 Kimi K2.5）
- `create` 操作是否也应该用路径语法替代 parent 字段

## 启发式错误反馈 + 元数据 (2026-03-15)

落地 CLI 文章的两个核心设计手段：

### 1. 可操作的错误信息

每个错误同时回答 "出了什么问题" 和 "该怎么做"：

```
旧：Node 123:456 not found.
新：Node "123:456" not found. Use ls("/") to discover available nodes.

旧：Tool 'foo' not found in main registry.
新：Unknown command "foo". Available: ls, tree, cat, design, replace, query

旧：A non-empty "ops" string must be provided.
新：No ops provided. Example: card = frame(root, {w:400, h:'hug', bg:'#FFF'})
```

改动的错误点位：
- `resolveSceneNode()` — NODE_NOT_FOUND, INVALID_NODE_TYPE
- `resolvePathToNode()` — PATH_NOT_FOUND (ID/name/mid-path), NOT_A_CONTAINER, INVALID_NODE_TYPE
- `handleToolCall()` — EMPTY_OPS, EXECUTION_ERROR, INVALID_SOURCE, UNKNOWN_TOOL
- `ToolDispatcher` — timeout, NO_TOOL_EXECUTOR, TOOL_EXEC_EXCEPTION

### 2. 元数据脚注 (`_meta`)

每个 tool result 追加 `_meta: "[ok | 245ms]"` 或 `"[err | 50ms]"`：
- LLM 内化成本感知：ls 50ms 很廉价，design 2s 要谨慎
- 一致格式让 LLM 越用越懂系统性能
- 追加在 `toolDispatcher.dispatch()` 清理后，不影响 cleaner 逻辑

### 3. 渐进式帮助改进

`getCommandHelp()` 重构：
- 格式：`command — 一行描述` + 参数 + 用法 + See also
- 新增 `COMMAND_SEE_ALSO` 交叉引用表，引导 LLM 在命令间导航
- `run` 工具描述精简：对齐列，突出 progressive reading 模式

### 设计原则

来自 CLI 文章的三层递进：
1. **`--help` → 主动发现** — 无参调用返回帮助 + See also 交叉引用
2. **Error msg → 被动纠偏** — 每个错误包含恢复动作
3. **Output format → 持续学习** — `_meta` 让 LLM 内化命令成本

## CLI 字符串形式改造 (2026-03-15)

从 JSON 结构化分发转为 CLI 字符串形式。LLM 训练数据里有数十亿行 CLI 命令，这是 LLM 的母语工具接口。

### 接口变化

```
旧：run({command: "ls", args: {path: "/Card/"}})        — JSON 嵌套分发
新：run({command: "ls /Card/"})                           — CLI 字符串
新：run({command: "cat /Card/ -s"})                       — 带 flag
新：run({command: "tree / && cat /Card/Header/"})         — chain
新：run({command: "design", input: "ops multiline..."})   — multiline 内容走 input
```

### 核心组件

**`commandParser.ts`** — 新建，CLI 字符串解析器：
- `tokenize(input)` — 分词，尊重引号
- `parseCommandString(input)` — 支持 `&&` chain 分割
- `mapToToolArgs(parsed, input?)` — 按命令名映射到内部 args schema
- `isOldRunFormat(args)` — 检测旧 JSON 格式（向后兼容）

**`run.ts`** — 工具定义变化：
```typescript
// 旧
{ command: { type: 'string', enum: [...COMMAND_NAMES] }, args: { type: 'object' } }
// 新
{ command: { type: 'string' }, input: { type: 'string' } }
```

**`unwrapRunCommand()`** — 三种路径：
1. **旧格式**：`isOldRunFormat()` → 直接展开（向后兼容）
2. **单命令**：`parseCommandString()` → `mapToToolArgs()` → 标准 unwrap
3. **Chain**：检测到 `&&` → 保持 `name: 'run'`，带 `__chain` 元数据 → `executeChain()` 处理

**`executeChain()`** — 顺序执行 + `&&` 语义：
- 每个命令独立验证 + 独立 IPC 执行
- `&&` 语义：前一个失败 → 后续跳过
- 返回 combined result（单命令时 flatten，多命令时 `{chain: [...]}`)

### 命令 CLI 语法表

| 命令 | CLI 语法 | 内部映射 |
|------|---------|---------|
| ls | `ls /path/` | `{path: "/path/"}` |
| tree | `tree /path/ -d 2` | `{path: "/path/", depth: 2}` |
| cat | `cat /path/ -s` | `{path: "/path/", screenshot: true}` |
| design | `design [-p parentId]` + input | `{ops: input, parentId?}` |
| replace | `replace search rootId props` | `{mode, rootId, properties}` |
| query | `query nodes button` | `{source: "nodes", query: "button"}` |

### 向后兼容

`isOldRunFormat()` 检测旧格式：`command` 是合法命令名 AND `args.args` 存在。
平滑过渡：LLM 可以用新旧两种格式，运行时自动识别。

### 渐进式帮助

`getCommandHelp()` 改为手写 CLI 帮助文本（`COMMAND_CLI_HELP` map）：
- Unix man page 风格：Usage → Flags → Examples → See also
- 比从 schema 自动生成更自然、更有 CLI 训练数据共鸣

### 改动文件清单

- `commandParser.ts` — 新建，CLI 解析器 + 映射器
- `run.ts` — 接口从 `{command enum, args}` 变为 `{command string, input?}`
- `toolDispatcher.ts` — `unwrapRunCommand()` 重写 + 新增 `executeChain()`
- `runtimeToolDescriptions.ts` — `run` 验证简化（不再 enum 校验）
- `commandRegistry.ts` — 手写 CLI 帮助 + See also 交叉引用
- `vfs.ts` — 描述增加 CLI 用法示例
- `unified/index.ts` — 导出 parser

### 架构不变量

- `loopDetector` / `contextSummarizer` 不需要改 — 它们看的是 unwrapped 命令名
- `allowedExecutionToolNames` 自动包含 `COMMAND_NAMES` — 不需要手动维护
- `COMMAND_MAP` 仍然是 single source of truth — 加新命令只需加一行
