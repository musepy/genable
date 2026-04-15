# 工具架构重构：`run` 管路混杂问题分析

> Date: 2026-03-30
> Status: 分析完成，方案 A 详细设计完成
> Related: [方案 A 详细设计](tool-refactoring-option-a.md) | [学习笔记索引](../learning-index.md)

## 当前架构

```
LLM 看到 4 个工具
├── jsx({markup})          → 创建节点树
├── inspect({node, mode})  → 读取节点
├── edit({node, props})    → 修改属性
└── run({command, input})  → ⚠ 所有其他操作的 CLI 壳
     ├── mv   → 移动/重命名
     ├── rm   → 删除
     ├── cp   → 克隆
     ├── grep → 搜索
     ├── sed  → 批量替换
     ├── man  → 文档/指南
     ├── js   → 执行 JS
     ├── var  → 变量管理（ls/mk/bind/alias 4 个子命令）
     ├── comp → 组件管理（create/combine/prop/ls/instance 5 个子命令）
     └── more → 分页
```

## 4 个核心问题

### 问题 1：`run` 混杂了完全不同的关注点

| 关注点 | 命令 | 性质 |
|--------|------|------|
| 结构操作 | mv, rm, cp | 写操作，改变节点树 |
| 搜索发现 | grep, sed | 读+写，跨子树操作 |
| 知识查询 | man | 纯读，不涉及画布 |
| 脚本执行 | js | escape hatch，任意代码 |
| 设计系统 | var, comp | 独立领域，各自有子命令体系 |
| 分页 | more | 辅助工具 |

这些命令之间没有内在关联，仅因"不是 jsx/inspect/edit"而被塞进同一个 `run`。

### 问题 2：CLI 解析层的复杂度

```
commandParser.ts  — 683 行，处理：
  - 引号解析、花括号匹配
  - 链式操作符（&&, ||, ;, |）
  - 管道数据注入
  - 别名展开（fill → fillColor/textColor）
  - 15+ 命令的 mapToToolArgs switch 分支
```

CLI 字符串接口对 LLM 并不友好：
- LLM 更擅长输出结构化 JSON，而不是拼接 CLI 字符串
- CLI 语法的引号、空格、转义是 LLM 常见错误源
- `commandParser` 的 switch 分支每加一个命令就膨胀

### 问题 3：大量遗留命令仍在 parser 中

`commandParser.ts` 的 `mapToToolArgs` 里仍包含：

| 遗留命令 | 说明 | 状态 |
|---------|------|------|
| `ls` | 列目录 | 被 `inspect` 取代 |
| `tree` | 树视图 | 被 `inspect(mode:"tree")` 取代 |
| `cat` | 详细属性 | 被 `inspect(mode:"detail")` 取代 |
| `mk` | 创建节点 | 被 `jsx` 取代，已在 DEPRECATED_COMMANDS |
| `design` | 批量 flat ops | 遗留格式 |
| `replace` | 搜索替换 | 被 `sed` 取代 |
| `query` | 知识查询 | 被 `man` 取代 |
| `mkdir` | 创建 frame | 被 `jsx` 取代 |
| `mktext` | 创建 text | 被 `jsx` 取代 |
| `write` | 写属性 | 被 `edit` 取代 |
| `ln` | 组件实例 | 被 `comp instance` 取代 |
| `token` | token 系统 | 已在 DEPRECATED_COMMANDS |
| `render` | 缩进标记 | 已在 DEPRECATED_COMMANDS |

**15 个命令中有 13 个是遗留的**。实际活跃的只有 10 个。

### 问题 4：双重间接

```
LLM: run({command: "var mk colors/bg COLOR #FFF"})
  → unwrapRunCommand()         // CLI string → parsed command
  → mapToToolArgs()            // parsed → {subcommand:'mk', variable:'colors/bg',...}
  → executeTool()              // local executor 或 IPC
  → ipcBridge.callTool('var', args)
```

如果 `var` 是独立工具，LLM 直接输出结构化 JSON，省去整个 CLI 解析层。

---

## 现有命令的使用频率分析

```
高频（每次设计任务必用）
  jsx      ████████████████  创建
  inspect  ████████████████  验证
  edit     ████████████      修复

中频（每 2-3 次任务用一次）
  grep     ████████          搜索节点
  rm       ██████            删除旧节点
  mv       ████              重命名/移动
  man      ████              查询指南
  
低频（特定场景）
  sed      ██                批量替换属性
  cp       ██                克隆变体
  js       ██                escape hatch
  var      █                 设计系统变量
  comp     █                 组件化
  more     █                 分页
```

---

## 重构方案

### 方案 A：提升高频命令为 first-class 工具 → [详细设计](tool-refactoring-option-a.md)

将 `grep+sed`, `mv+rm+cp`, `man` 从 `run` 中提取，合并为 3 个语义工具：

```
LLM 看到 7 个工具
├── jsx          → 创建（不变）
├── inspect      → 读取（不变）
├── edit         → 修改属性（不变）
├── search       → grep + sed 合并（find/discover/replace 三模式）
├── structure    → mv + rm + cp 合并（move/delete/clone 三动作）
├── knowledge    → man 提升
└── run          → 瘦身：js, var, comp, more
```

| 优点 | 缺点 |
|------|------|
| 高频操作有结构化参数，LLM 更少出错 | 工具数从 4 增加到 7 |
| `run` 大幅瘦身，只剩真正的 power 操作 | 需要更新 system prompt |
| 渐进式——不破坏现有 run CLI 接口 | search/structure 是人为聚合 |

### 方案 B：按领域分组

```
LLM 看到 6 个工具
├── jsx          → 创建（不变）
├── inspect      → 读取（不变）
├── edit         → 修改（不变）
├── canvas       → 画布结构操作（move/delete/clone/search/replace）
├── system       → 设计系统（var-ls/mk/bind, comp-create/combine/...）
└── run          → 仅 js, man, more
```

| 优点 | 缺点 |
|------|------|
| 领域边界清晰 | `canvas` 仍有点大（5 个 actions） |
| 设计系统操作终于有独立入口 | 需要重新设计 action 参数 |
| `run` 极简——只剩 scripting | 中频操作多了一层 action 路由 |

### 方案 C：清理 `run`，保持现有架构

不新增工具，只清理内部：

1. 删除 commandParser 中 13 个遗留命令
2. 简化 commandParser，只保留 10 个活跃命令
3. 清理 runtimeToolDescriptions 中 ls/tree/cat/mk 的验证规则
4. 优化 run description 的分组

| 优点 | 缺点 |
|------|------|
| 改动最小，风险最低 | `run` 仍然是 10 命令的 bag |
| 代码瘦身 ~200-300 行 | 没有解决混杂问题的根源 |
| 不影响 LLM prompt | CLI 解析层仍在 |

---

## 与 OpenPencil 的对比启示

| 维度 | 我们现在 | OpenPencil | 启示 |
|------|---------|-----------|------|
| 工具数 | 4 (+ run 内 10 命令) | 23 core | 他们更细但也成功了 |
| 编辑粒度 | 1 个 edit (batch) | 8 个 setter | 我们的 batch edit 更高效 |
| 验证 | inspect + quality score | describe (48 条 lint) | 我们可以学他们的 lint 集成 |
| 创建 | jsx (JSX 标记) | render (JSX) | 基本相同 |
| CLI shell | `run` 壳 | 无 | 他们直接暴露工具名 |

详见: [OpenPencil 工具架构](openpencil-tool-architecture.md)

---

## 涉及的代码文件地图

```
src/engine/agent/
├── toolDispatcher.ts          ← 调度层（unwrapRunCommand, dispatch, chain）
├── tools/
│   ├── types.ts               ← ToolDefinition, ToolExecutor 类型
│   ├── index.ts               ← agentTools, toolDisplayMap 导出
│   ├── runtimeToolDescriptions.ts ← 运行时验证规则
│   └── unified/
│       ├── index.ts           ← unifiedTools 数组（4 工具）
│       ├── run.ts             ← run 工具定义 + description
│       ├── jsx.ts             ← jsx 工具定义
│       ├── inspect.ts         ← inspect 工具定义
│       ├── edit.ts            ← edit 工具定义
│       ├── commandRegistry.ts ← 命令注册 + help 文本
│       └── commandParser.ts   ← CLI 解析（683 行）

src/ipc/commands/
├── index.ts                   ← COMMAND_HANDLERS dispatch table
├── searchHandlers.ts          ← handleGrep, handleSed
├── writeHandlers.ts           ← handleMk, handleRm, handleMv, handleCp
├── jsxHandler.ts              ← handleJsx
├── inspectHandler.ts          ← handleInspect
├── editHandler.ts             ← handleEdit
├── jsHandler.ts               ← handleJs
├── varHandlers.ts             ← handleVar
├── compHandlers.ts            ← handleComp
└── pathResolver.ts            ← 路径解析
```
