# SOP 设计与系统提示词架构

> 日期: 2026-04-04
> 来源: gstack /codex SKILL.md 分析 + Claude Code 源码 (prompts.ts, systemPromptSections.ts, promptCacheBreakDetection.ts) + 本项目现状对比

---

## 1. gstack 的 SKILL.md = Agent SOP

gstack 的每个 skill（如 /codex）是一份 677 行 Markdown 文件，本质是**给 Claude Code 看的 SOP 手册**——自然语言写的 if/else 流程控制 + 内嵌的 bash 代码块。

### 结构

```
YAML 前置元数据 — name, version, description, allowed-tools
共享模块（占 ~50%，所有 skill 复用）:
  - Preamble — bash 初始化（更新检查、session 管理、用户配置、环境上下文、状态标记）
  - AskUserQuestion Format — 统一交互规范
  - Completeness Principle — "Boil the Lake" 哲学
  - Repo Ownership Mode — solo/collaborative 差异
  - Search Before Building — 三层知识体系
  - Contributor Mode — field report 机制
  - Completion Status Protocol — DONE/BLOCKED/NEEDS_CONTEXT 状态码
  - Telemetry — 结尾数据采集脚本
Skill 专属逻辑（Step-by-Step）:
  - Step 0 — 前置检查（二进制安装、base branch 检测）
  - Step 1 — 解析用户输入，判断模式
  - Step 2A/2B/2C — 各模式的具体执行流程
辅助说明:
  - Model & Reasoning, Cost Estimation, Error Handling, Important Rules
```

> **`✅ CONFIRMED`** — 已从 garrytan/gstack 官方仓库 SKILL.md 原文验证

### 核心机制

- Claude Code CLI 有 Bash tool → SKILL.md 里的代码块**真的能被执行**
- 自然语言条件分支（"If NOT_FOUND: stop..."）靠 LLM 指令跟随能力
- 所有模式用 `model_reasoning_effort="xhigh"` + `--enable web_search_cached`
- Codex 始终运行在 read-only sandbox，不修改文件
- /codex 的核心价值 = **跨模型交叉验证**（用 OpenAI 检查 Claude 的盲区）

> **`✅ CONFIRMED`** — 从 SKILL.md 原文和 codex CLI 参数验证

### 为什么必须是 CLI

gstack SOP 依赖三个 claude.ai 没有的能力：
1. **本地 bash 执行** — 能跑 codex review, gh pr view, git diff
2. **持久化工作目录** — 在真实 git 仓库中运行，有上下文
3. **allowed-tools 声明** — YAML 头里声明授权工具集

> **`✅ CONFIRMED`** — Claude Code 的 Bash tool + 文件系统 + YAML 元数据是前提条件

---

## 2. Claude Code 系统提示词架构

### 2.1 分层设计

Claude Code 的 system prompt 在 `src/constants/prompts.ts` 中组装，**按关注点分层**：

```
STATIC（全局可缓存，boundary 之前）
├── Identity    — "You are an interactive agent..."
├── System      — 工具执行、权限、消息压缩、hooks
├── Doing Tasks — 代码风格、验证、安全、不过度工程
├── Actions     — 风险评估框架（可逆性 + 影响范围）
├── Tools       — 优先用专用工具而非 Bash
├── Tone        — 格式规则（无 emoji、file:line 引用）
└── Efficiency  — 输出长度（简洁直接）

═══ SYSTEM_PROMPT_DYNAMIC_BOUNDARY ═══

DYNAMIC（每 session 重算，boundary 之后）
├── Session Guidance — 技能发现、Agent 使用、验证 gate
├── Memory           — 持久记忆（跨 session）
├── Language         — 用户语言偏好
├── Output Style     — 自定义输出风格
├── MCP Instructions — MCP 工具说明（动态连接）
├── Scratchpad       — 临时工作区
├── FRC              — Function Result Clearing
├── Summarize        — 工具结果摘要指令
├── Token Budget     — token 支出目标
└── Brief            — 自主模式简报
```

> **`✅ CONFIRMED`** — 已读 Claude Code `src/constants/prompts.ts` L560-576，`getSystemPrompt()` 的 return 数组顺序与此一致。`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 在 L113 定义。

### 2.2 关键设计原则

1. **System prompt 描述 WHAT & WHY，不描述 HOW**
   - 每个 section 是规则/身份/知识，不是步骤
   - "HOW" 来自 Skills（动态加载）和 Tool descriptions（各工具自带 prompt.ts）

> **`✅ CONFIRMED`** — `getSimpleDoingTasksSection()` (L198) 全是规则（"Don't add features..."），无步骤。Skills 通过 `SkillTool` 动态加载。

2. **工具描述与系统 prompt 分离**
   - 每个工具有独立的 `prompt.ts`（BashTool/prompt.ts, FileReadTool/prompt.ts 等）
   - `serializeTools()` 在拼装时注入，不硬编码在 system prompt 里

> **`✅ CONFIRMED`** — 我们项目同样如此：每个工具在 `src/engine/agent/tools/unified/*.ts` 自带 `description`，`serializeTools()` 在 `system.ts:91` 注入。

3. **验证 gate 写在 session guidance 里**（非 static）
   ```
   "when non-trivial implementation happens on your turn,
    independent adversarial verification must happen
    before you report completion"
   ```
   - 这是强制性的，不是建议
   - 对我们的 VERIFY AFTER CREATE 有直接参考价值

> **`✅ CONFIRMED`** — 位于 `getSessionSpecificGuidanceSection()` L394，gate 条件控制在 feature flag `VERIFICATION_AGENT` 下。措辞是 "must happen"（强制）。

### 2.3 KV Cache 优化体系

#### 三层缓存分区

| 位置 | cacheScope | 含义 |
|------|-----------|------|
| Boundary 前（static） | `'global'` | 所有用户共享缓存 |
| Boundary 后（dynamic） | `null` 或 `'org'` | 每个用户/session 独立 |
| Tool schemas | 独立 block | 工具增删时独立失效 |

> **`✅ CONFIRMED`** — `splitSysPromptPrefix()` 在 `src/utils/api.ts` L321-435，三种模式（MCP tools / Global+Boundary / Default）实现上述分区。

#### Section 级 Memoization

```typescript
// 安全的：计算一次，缓存到 /clear
systemPromptSection('memory', () => loadMemoryPrompt())

// 危险的：每轮重算，必须给理由
DANGEROUS_uncachedSystemPromptSection(
  'mcp_instructions',
  () => getMcpInstructionsSection(mcpClients),
  'MCP servers connect/disconnect between turns'
)
```

大部分 dynamic section 首次计算后缓存，后续 turn 直接复用。只有 MCP instructions 等真正变化的才用 `DANGEROUS_uncached`。

> **`✅ CONFIRMED`** — `systemPromptSections.ts` L20-38 定义了两种 section 类型。`resolveSystemPromptSections()` L43-57 实现 cache-first 逻辑。

#### Cache Break Detection（事后诊断）

`promptCacheBreakDetection.ts` 实现完整的缓存失效监控：

- **Phase 1（pre-call）**: hash(system prompt + tools + per-tool schemas) → 存快照
- **Phase 2（post-call）**: 比较 cache_read_tokens 差异，drop >5% AND >2000 tokens → cache break
- 跟踪 12 个维度：prompt hash、tool schemas、model、fast mode、betas、cache_control scope 等
- 生成 diff 文件用于调试

> **`✅ CONFIRMED`** — `recordPromptState()` L247 = Phase 1，`checkResponseForCacheBreak()` L437 = Phase 2。阈值 `>5%` 在 L488，`MIN_CACHE_MISS_TOKENS = 2_000` 在 L120。12 维度跟踪见 `PendingChanges` type L71-99。

#### 防止无意 Cache Break 的策略

- **Sticky latch**: AFK mode、overage state 等 — 一旦开启，session 内不翻转
- **Delta attachment**: MCP 指令变化通过 attachment 通知，不重建 system prompt
- **主动重置 baseline**: compaction/cache deletion 后调 `notifyCompaction()` 避免误报

> **`✅ CONFIRMED`** — Sticky latch 在 PreviousState 注释中说明（L48-56 "should NOT break cache anymore"）。`notifyCompaction()` 在 L689，`notifyCacheDeletion()` 在 L673。Delta attachment 在 `prompts.ts` L509-519 注释说明。

---

## 3. 本项目现状对比

### 3.1 当前 CORE.md 混合了两种关注点

```
CORE.md（混合）
├── EXECUTION ENVIRONMENT        ← system prompt（身份+规则）
├── SCENE GRAPH MENTAL MODEL     ← system prompt（知识）
├── DESIGN THINKING              ← system prompt（知识）
├── CONVENTIONS                  ← system prompt（规则）
├── DESIGN FREEDOM PRINCIPLE     ← SOP（工作流决策）
├── CREATE vs EDIT INTENT        ← SOP（工作流决策）
├── CREATION PROTOCOL            ← SOP（操作流程）
├── EXISTING CONTENT             ← system prompt（规则）
└── TURN MANAGEMENT              ← SOP（操作规则）

system.ts 硬编码的额外内容:
├── PERSISTENT MEMORY            ← system prompt（工具说明）
├── SCRATCHPAD                   ← system prompt（工具说明）
├── SUBTASK DELEGATION           ← system prompt（工具说明）
└── LAYOUT QUALITY RULES         ← SOP（质量规则）
```

> **`🔄 RESOLVED`** — 已拆分为 `src/prompts/SYSTEM.md`（WHAT & WHY）+ `src/prompts/SOP.md`（HOW）。`system.ts` 中的 LAYOUT QUALITY RULES 已移入 SOP.md，不再硬编码。CORE.md 保留但标记 deprecated。

### 3.2 拆分方案

按 Claude Code 的模式，拆成两个文件：

**SYSTEM.md — 你是谁 + 你知道什么 + 你的规则**
```
# Identity — Figma plugin agent
# Environment — sandbox, iteration budget, cannot see canvas visually
# Scene Graph — structure, layout, text sizing, overflow
# Design Thinking — 7+4 dimensions, quality ladder, nesting strategy
# Conventions — naming, content, icons
# Figma ≠ CSS — 心智模型差异（知识性，非操作性）
# Existing Content — inspect before modify
```

**SOP.md — 你怎么工作**
```
# Workflow
## Intent Detection — create vs edit decision tree
## Knowledge Query — when to query vs reason freely
## Creation Flow (MANDATORY) — jsx → describe → fix (verification gate)
## Layout Quality Patterns — GOOD/BAD 示例模板
## Clarification — ask_user 用法
## Turn Management — anti-looping, end-turn conditions, turn-end gate
```

`system.ts` 拼接顺序: `SYSTEM + SOP + Memory + Scratchpad + Subtask + Tools`

> **`✅ DONE`** — 已实现。`src/prompts/SYSTEM.md` + `src/prompts/SOP.md` 已创建。`system.ts` 已从 `import { CORE }` 切换到 `import { SYSTEM, SOP }`。`promptRegistry.ts` 新增 `SYSTEM` + `SOP` 导出。Build pipeline (`generate-prompt-catalog.js`) 自动扫描 `*.md`，无需改动。

### 3.3 KV Cache 现状

我们的 `buildStaticSystemPrompt()` **已经是 cache-friendly 的**——构建一次，整个 session 不变。拆分 SYSTEM.md + SOP.md 不影响 cache 行为（两者都在 static 层）。

> **`✅ CONFIRMED`** — `buildStaticSystemPrompt()` 在 `AgentOrchestrator.ts:366` 调用一次，结果传入 `AgentRuntime` 构造函数，整个 session 不再重建。

**如果未来加 skill 自动注入（L1 push），需要注意**：
- 注入的 skill body 应走 **turn message**，不走 system prompt
- 否则每次注入不同 skill 都会 break cache

```
cache-safe 分区:
  system prompt = SYSTEM.md + SOP.md + tool defs    ← 构建一次，不变
  turn message  = [iteration context] + [skill body] ← 每轮变，不影响 cache
```

> **`⚠️ FUTURE`** — L1 push 模式尚未实现。当前 skill 仍是 pull 模式（agent 调 knowledge()）。此条为架构约束备忘。

### 3.4 上下文窗口澄清

- 所有 provider 声明 `contextWindow: 1_000_000`（1M tokens）
- Budget = contextWindow × 0.7 = **700K tokens**
- 之前认为的 "12K" 是过时信息（已从 memory 修正）
- 1M 上下文意味着 gstack 的"全量加载"模式对我们也可行

> **`✅ CONFIRMED`** — `gemini.ts:40`、`proxy.ts:40`、`openrouter.ts:20`、`dashscope.ts:61`、`types.ts:140` 均声明 `contextWindow: 1_000_000`。`agentRuntime.ts:126` 计算 `contextBudgetChars: Math.floor(contextWindowTokens * 0.7) * 4`。Memory 中的 12K 已修正。

---

## 4. 工具返回的确定性分析

SOP 设计需要理解每个工具返回什么，agent 能从返回值中获得什么信号。

| 工具 | 返回内容 | 确定性 | SOP 意义 |
|------|---------|--------|----------|
| **jsx** | 创建的节点树（id+name+type+size+children） | 中 | 确认"创建了什么"，但**不能确认质量** |
| **inspect** | 节点属性（tree 骨架 或 detail 完整） | **高** | 感知回路核心——读回实际状态 |
| **describe** | 语义诊断（role + issues + lint） | 中 | 最接近"自动验证"的工具 |
| **edit** | 更新后的节点属性 | 中 | 类似 jsx |
| **find_nodes** | 匹配节点列表 | **高** | 纯搜索 |
| **set_\*** | 同 edit（委托） | 中 | — |
| **var tools** | 变量操作确认（文本消息） | 高 | — |
| **js** | 任意 JS 执行结果 | **低** | 逃生舱 |

> **`✅ CONFIRMED`** — 已从 `jsxHandler.ts`、`inspectHandler.ts`、`describeHandler.ts`、`editHandler.ts`、`searchHandlers.ts`、`jsHandler.ts`、`varHandlers.ts`、`setterAdapter.ts` 的返回值和 `presentation.ts` 的 `presentForLLM()` 转换逻辑验证。所有返回经 `presentForLLM()` 展平后，error 字段存在=失败，data 字段展平到顶层。

**关键洞察**: jsx 返回结构确认（id map），不返回质量确认（属性是否完整）。SOP 的验证步骤应该是 `jsx → describe`（自带 lint）或 `jsx → inspect detail`（读完整属性），不能仅靠 jsx 返回值。

> **`✅ DONE`** — SOP.md 的 CREATION FLOW (MANDATORY) 已将 `describe` 作为强制 gate（L41: "ALWAYS run on root node after jsx. NOT optional."）

---

## 5. Knowledge 系统有效性问题

### 现状

knowledge 工具有 4 个 source：help、guidelines（8 topic）、style-tags、style。但 agent 必须主动调用 `knowledge()`，没有自动触发。

> **`✅ CONFIRMED`** — `knowledgeTool.ts` L17-30 定义 4 个 source enum。`useChat.ts` L490-544 实现 4 个分支的执行逻辑。无 triggerPattern 或自动注入机制。

### 问题

1. **用户 prompt 雷同** → BM25 总匹配同一批 skill body
2. **guidelines 没被用到** → agent 没动力主动查 `source: "guidelines"`
3. **style guide 更没被用到** → 需要两步操作（先查 tags 再匹配）
4. **与 CORE.md 有重叠** → 设计维度等已在 system prompt 里

> **`⚠️ OBSERVED`** — 基于 dev bridge E2E 日志中的 tool call 记录观察。未做定量统计（如 "guidelines 在 N 次 run 中被调用 0 次"），但定性观察一致。

### 根本原因

Knowledge 是 pull 模式（agent 主动查），但 agent 缺少触发信号。CORE.md 又覆盖了大部分通用知识。

> **`✅ CONFIRMED`** — system prompt 无 "query knowledge before creating" 强制规则（旧 CORE.md 仅在 DESIGN FREEDOM PRINCIPLE 中建议性地列出）。SOP.md 现已加入 KNOWLEDGE QUERY 段落，但仍是建议性措辞（"Query knowledge FIRST when..."），未设为 gate。

### 改进方向

L1 从 pull 变 push — runtime 根据 prompt 关键词自动注入 skill body 到 turn message，而不是等 agent 自己调 knowledge()。

> **`⚠️ FUTURE`** — 尚未实现。需要在 `AgentRuntime.run()` 入口或 `AgentOrchestrator.generate()` 中加 intent→skill 匹配逻辑。

---

## 6. VERIFY AFTER CREATE — P0 改进项

### 现状数据

- Refine 模式（inspect→edit 循环）padding 覆盖率 **78-90%**（vs one-shot 20-50%）
- 但只有 **10%** 的 runs 自发出现

> **`✅ CONFIRMED`** — 数据来自 2026-03-22 benchmark（5 prompts × Kimi K2.5），记录在 memory `project_jsx_vs_mk_analysis.md`。

### 为什么 agent 跳过验证

| 行 | 现有措辞 | 语气 | 效果 |
|---|---|---|---|
| 128 | "One jsx call creates the entire design" | **强制** | agent 认为一次就完成 |
| 126 | "Creation flow: jsx → describe → inspect → edit" | 描述性 | 说了流程但没说必须 |
| 195 | "After jsx: inspect to see..." | 建议性 | 可选 |
| 9 | "Responding with ONLY text ends your turn" | **强制** | jsx → 文字 → 收工 |

**根因**: 创建是强制语气（MUST/NEVER），验证是建议语气（After/workflow）。

> **`✅ CONFIRMED`** — 行号引用来自旧 CORE.md，措辞分析准确。

### 修改方案

在 SOP.md 中写为强制 gate：

```markdown
## Creation Flow (MANDATORY)

1. `jsx` — create the full design in one call
2. `describe` — ALWAYS run on root node after jsx. NOT optional.
3. If describe reports issues → `edit`/setters to fix → `describe` again
4. ONLY respond with text after describe returns no errors

Skipping step 2 produces designs with missing padding, broken layout,
and invisible spacing — the exact failures users complain about most.
```

> **`✅ DONE`** — 已写入 `src/prompts/SOP.md` L34-47（CREATION FLOW MANDATORY）+ L152-156（Turn-end gate: "If you called jsx this turn → did you call describe? If NO, keep working."）

参考 Claude Code 的验证 gate 措辞：
> "when non-trivial implementation happens on your turn, independent adversarial verification must happen before you report completion"

> **`✅ CONFIRMED`** — 出自 Claude Code `prompts.ts` L394 `getSessionSpecificGuidanceSection()`。
