# 子 Agent 架构对比：Claude Code vs Genable

> 日期: 2026-04-10
> 来源: Claude Code 源码分析 (`/Users/daxiaoxiao/Projects/Claudecode source code/claude-code/src/tools/AgentTool/`)
> 对标: `src/engine/agent/subtask/` 目录

## 核心设计理念的差异

| 维度 | Claude Code | Genable (我们的插件) |
|------|-------------|-------------------|
| 设计哲学 | 父子**几乎同构** — 子 Agent 是"小号的主 Agent" | 父子**角色分化** — 子 Agent 是特化的"工人" |
| 类型系统 | **开放注册** — 内置 + 用户自定义 markdown agent | **硬编码枚举** — `create` / `audit` / `token` 三种 |
| 工具策略 | 默认 **`tools: ['*']`**（全部工具） | 默认 **白名单过滤**（每种类型各 8-13 个工具） |
| 系统 prompt | 子 Agent 有**自己的完整系统 prompt** | 子 Agent = `rolePreamble` + 父级 base prompt |
| 运行模式 | 同步 / 异步 / 后台 / worktree 隔离 / 远程 | 仅同步 |

---

## 1. Agent 类型定义

### Claude Code: 开放式 `AgentDefinition`

```typescript
// 来源: src/tools/AgentTool/loadAgentsDir.ts
// 用户可以通过 .claude/agents/*.md 创建任意数量的自定义 Agent
type AgentDefinition = {
  agentType: string           // 任意字符串标识符
  whenToUse: string           // LLM 路由提示
  tools?: string[]            // 可以是 ['*'] = 全部工具
  disallowedTools?: string[]  // denylist 方式
  model?: string              // 可以指定不同模型
  permissionMode?: string     // 独立权限模式
  maxTurns?: number           // 迭代上限
  skills?: string[]           // 预加载的 skills
  mcpServers?: McpServerSpec[] // 独立 MCP 服务器
  hooks?: HooksSettings       // 生命周期钩子
  memory?: 'user' | 'project' | 'local'  // 持久化记忆
  isolation?: 'worktree' | 'remote'      // 运行隔离
  background?: boolean        // 后台运行
  getSystemPrompt(): string   // 完整的系统 prompt
}
```

内置 Agent 类型（`src/tools/AgentTool/built-in/`）：
- `general-purpose` — 默认通用 Agent，`tools: ['*']`，系统 prompt 仅 ~20 行
- `Explore` — 只读研究 Agent（省略 CLAUDE.md 和 gitStatus 以节省 token）
- `Plan` — 规划 Agent（同样省略 CLAUDE.md）
- `verification` — 验证 Agent
- `claude-code-guide` — 引导 Agent
- `statusline-setup` — 状态栏设置 Agent

### Genable: 封闭式 `AgentTypeDefinition`

```typescript
// 来源: src/engine/agent/subtask/agentTypes.ts
type AgentTypeDefinition = {
  name: string               // 'create' | 'audit' | 'token'
  whenToUse: string
  rolePreamble: string       // 拼接到 base prompt 前面
  tools: string[]            // 硬编码白名单
  maxIterations: number      // 8-15
}
```

**关键差异**: Claude Code 的 Agent 是**完整的、独立的实体**，有自己的系统 prompt、模型、权限、记忆。Genable 的 Agent 更像是**同一个 Agent 的不同"帽子"** — 用 rolePreamble 换了人格，但底层共享同一套 base prompt。

---

## 2. 父子"距离"对比

### Claude Code: 父 ≈ 子（最小差异）

```
┌───────────────┐     ┌───────────────────┐
│  Parent Agent  │     │   Child Agent      │
│               │     │                   │
│ System prompt │ ←→  │ 独立 system prompt │  ← 完全独立
│ All tools     │     │ tools: ['*']      │  ← 默认也是全部
│ Full context  │     │ 空白上下文         │  ← 不继承对话
│ Model X       │     │ Model X 或自定义   │  ← 可以不同
│ Permission Y  │     │ Permission Y 或自定义│ ← 可以不同
│ Thinking: ON  │ vs  │ Thinking: OFF     │  ← 唯一刻意区别
└───────────────┘     └───────────────────┘
```

**唯二的刻意限制**:
1. **Thinking 默认关闭** — 控制 token 成本（但 fork 模式会继承父级 thinking）
2. **上下文不继承** — 子 Agent 从零开始（但 fork 子 Agent 继承全部上下文）

子 Agent 能做的事和父 Agent **几乎完全一样**，包括它甚至可以**再次调用 Agent 工具生成孙子 Agent**。

### Genable: 父 >> 子（显著差异）

```
┌──────────────────┐     ┌────────────────────┐
│   Parent Agent    │     │   Child Agent       │
│                  │     │                    │
│ Full system prompt│ ←→  │ rolePreamble + base │ ← 受限 prompt
│ ALL tools (20+)  │     │ 8-13 tools only    │ ← 白名单过滤
│ Full context     │     │ 空白上下文          │ ← 不继承
│ 无限迭代          │     │ 8-15 次迭代上限     │ ← 硬编码限制
│ 可创建子任务      │ vs  │ 不能再创建子任务     │ ← 明确禁止
│ 全能              │     │ "你是子任务"        │ ← 角色锁定
└──────────────────┘     └────────────────────┘
```

---

## 3. 上下文隔离策略

### Claude Code: `createSubagentContext` — 精细控制（opt-in 共享）

```typescript
// 来源: src/utils/forkedAgent.ts L345-462
const agentCtx = createSubagentContext(parentCtx, {
  options: agentOptions,          // 独立的工具池、模型
  agentId: newId,                 // 独立 ID
  messages: initialMessages,      // 空白对话
  readFileState: freshCache,      // 隔离的文件缓存
  abortController: newController, // 独立取消控制
  shareSetAppState: !isAsync,     // 同步子 Agent 共享状态
  shareSetResponseLength: true,   // 共享响应指标
});
```

**隔离策略按运行模式逐项选择**：

| 共享项 | 同步 Agent | 异步 Agent | Fork Agent |
|--------|-----------|-----------|-----------|
| setAppState | ✅ 共享 | ❌ no-op | ❌ no-op |
| AbortController | ✅ 共享 | ❌ 独立 | ❌ 独立 |
| readFileState | 克隆 | 克隆 | ✅ 克隆自父 |
| System prompt | 独立 | 独立 | ✅ 继承父级 |
| Thinking config | ❌ 关闭 | ❌ 关闭 | ✅ 继承 |
| 对话上下文 | ❌ 空白 | ❌ 空白 | ✅ 继承全部 |

### Genable: `SubtaskContext` — 一刀切

```typescript
// 来源: src/engine/agent/subtask/executor.ts
const childContext: SubtaskContext = {
  depth: parentDepth + 1,        // 深度跟踪
  maxDepth: 2,                    // 最大 2 层
  agentType: resolvedType,        // 类型定义
  tools: parentTools,             // 从父级过滤
  provider: parentProvider,       // 共享 LLM provider
  ipcBridge: parentBridge,        // 共享 Figma IPC
  maxIterations: Math.min(...),   // 计算预算
  isParentCanceled: () => ...,    // 取消级联
};
```

Genable 的隔离是 binary 的（所有子 Agent 都用同样的隔离策略），Claude Code 则是 adaptive 的（根据 agent 类型和运行模式动态调整共享粒度）。

---

## 4. Fork 模式（Claude Code 独有）

Claude Code 有两种子 Agent 模式：

| | 新建 Agent (`subagent_type=xxx`) | Fork (`subagent_type` 省略) |
|---|---|---|
| 上下文 | **空白** — 从零开始 | **继承** — 复制父级全部对话 |
| 系统 prompt | Agent 自己的 prompt | **父级的** prompt（100% 相同） |
| Thinking | 关闭 | **继承父级**设置 |
| 目的 | 需要专家角色 | 研究/实现的上下文卸载 |
| Prompt Cache | 独立缓存 | **共享父级缓存** |

Fork 模式的核心目标是 **prompt cache 复用** — 通过保持与父级完全一致的 system prompt + tools + thinking config，让子 Agent 的 API 请求前缀和父级完全相同，命中 Anthropic API 的 prompt cache。这在 34M+/周的 Explore spawn 规模下节省大量 token。

Genable 没有 fork 概念，所有子 Agent 都从零上下文开始。

---

## 5. 递归策略

### Claude Code: 自然递归

```
Parent → Agent(general-purpose) → Agent(test-runner) → ...
```
- 子 Agent 默认拥有 Agent 工具，可以**无限嵌套**（除了 fork 不能自己再 fork）
- 没有明确的深度限制（靠工具池和 token 预算自然收敛）

### Genable: 受控递归

```
Parent → subtask(create) → [不能再创建 subtask]
```
- `maxDepth: 2` 硬限制
- rolePreamble 明确写了 "Do NOT create subtasks — you ARE the subtask"
- 通过预算递减保护: `maxIterations = parentRemaining / 2`

---

## 6. 重要实现细节

### Claude Code 的 token 成本优化

1. **Explore/Plan Agent 省略 CLAUDE.md** — 只读 Agent 不需要 commit/PR/lint 规则，节省 ~5-15 Gtok/周
2. **Explore/Plan 省略 gitStatus** — 如果需要 git 信息，自己跑 `git status`
3. **Fork prompt cache sharing** — 和父级完全一致的请求前缀
4. **ONE_SHOT_BUILTIN_AGENT_TYPES** — Explore/Plan 跳过 agentId/SendMessage/usage trailer，节省 ~135 chars × 34M/周

### Claude Code 的 Agent 生命周期

```
AgentTool.call()
  → resolveAgentType / select AgentDefinition
  → buildSystemPrompt (独立完整的 prompt)
  → createSubagentContext (按模式隔离)
  → runAgent (启动 query loop)
    → initializeAgentMcpServers (连接 agent 专属 MCP)
    → registerFrontmatterHooks (注册生命周期钩子)
    → preloadSkills (预加载 skills)
    → query() loop
  → finalizeAgentTool (整理结果返回父级)
```

### Genable 的 Subtask 生命周期

```
subtask tool called
  → resolveAgentType('create' | 'audit' | 'token')
  → filter tools by whitelist
  → prepend rolePreamble to base system prompt
  → new AgentRuntime (child)
  → childRuntime.run(prompt)
  → return { result, rootNodeIds, stats }
```

---

## 7. 设计取舍总结

### Claude Code 的选择
- **最大灵活性** — Agent 和人类可以自由定义新的 Agent 类型
- **最小差异** — 子 Agent 几乎等同于父 Agent，降低了"角色切换"的认知成本
- **成本敏感优化** — fork + prompt cache sharing 是在规模化后优化 token 成本的产物
- **信任 LLM** — 相信模型能正确理解何时该停止递归和用什么工具

### Genable 的选择
- **强制分工** — 通过硬编码的工具白名单和 rolePreamble 确保每个子 Agent 只做它该做的事
- **安全边界** — 严格的深度限制和 "你是子任务" 的身份锚定防止子 Agent 失控
- **简单可控** — 在 Figma canvas 操作的场景下，三种角色已经覆盖了主要需求
- **代码约束替代模型判断** — 减少 LLM 出错空间

两者差异反映了不同的**信任模型**和**操作风险**：
- Claude Code 操作代码文件（git 可回退），放心让子 Agent 自由发挥
- Genable 直接操作 Figma canvas（不可逆），用更严格的约束减少子 Agent 失控风险

---

## 关键源码索引

### Claude Code
| 文件 | 职责 |
|------|------|
| `src/tools/AgentTool/AgentTool.tsx` | 主入口 — 工具定义、调用路由、fork/spawn/async 分支 |
| `src/tools/AgentTool/runAgent.ts` | 子 Agent 运行器 — 构建 context、query loop |
| `src/tools/AgentTool/loadAgentsDir.ts` | `AgentDefinition` 类型 + markdown agent 解析 |
| `src/tools/AgentTool/builtInAgents.ts` | 内置 Agent 注册 |
| `src/tools/AgentTool/prompt.ts` | Agent 工具的 prompt 构建 |
| `src/tools/AgentTool/forkSubagent.ts` | Fork 模式实现 |
| `src/utils/forkedAgent.ts` | `createSubagentContext` — 上下文隔离核心 |
| `src/tools/AgentTool/built-in/*.ts` | 各内置 Agent 定义 |

### Genable
| 文件 | 职责 |
|------|------|
| `src/engine/agent/subtask/agentTypes.ts` | 三种 Agent 类型定义 + registry |
| `src/engine/agent/subtask/executor.ts` | 子 Agent 执行器 |
| `src/engine/agent/subtask/types.ts` | SubtaskContext 类型 |
| `src/engine/agent/tools/unified/subtask.ts` | subtask 工具定义 |
| `src/engine/agent/agentRuntime.ts` | 主运行时（注册 subtask executor）|
