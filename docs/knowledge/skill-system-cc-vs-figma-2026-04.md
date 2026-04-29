# Skill System: Claude Code vs Figma AI Generator (2026-04)

## 背景

Figma AI Generator 在 2026-04 新增了 `restyle` skill，目的是引导 LLM 在 "把它做成 Memphis 风格" 这类**模糊改造**指令下使用 inspect → edit 而非 jsx({replaceId}) 重建。skill 写完并按现有规则注入 KNOWLEDGE LIBRARY 菜单后，**实测未被触发**：agent 仍选了 `style:neo-brutalist` + `jsx({replaceId})` 重做整个页面。

诊断发现根因不是 skill description 写得不够好，而是 **figma 把 95+ 条 knowledge entries（含 skill / style / anatomy / guideline / help / reference 六类）一股脑塞进 static system prompt 的 KNOWLEDGE LIBRARY section**，存在两个结构性问题：

1. 注入位置在 system 顶层 → 与 user message 距离远，注意力衰减
2. 95 条同维度并列 → skill (procedural) 与 style (content) 混排，LLM 倾向选 content 类

为找解法，调研了 Anthropic 自家 Claude Code 的 skill 系统，看其如何避免同样的问题。本文记录两套机制的差异及可借鉴的改进方向。

源码路径约定：

- Claude Code: `/Users/daxiaoxiao/Projects/Claudecode source code/claude-code/`
- Figma AI Generator: `/Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator-dogfood/`

下文所有相对路径都以这两个根为基准。

---

## Claude Code 的 skill 加载机制

### 1. Skill 文件结构

CC skill 采用 **目录格式**：`<skills-dir>/<skill-name>/SKILL.md`，目录名即 skill name。bundled skills 来自打包资源，user skills 来自 `~/.claude/skills/`，project skills 来自 `<project>/.claude/skills/`，plugin skills 来自插件清单。

详见 `src/skills/loadSkillsDir.ts:425-431` 列出的目录扫描循环（按目录遍历 `SKILL.md` 文件，目录名即 skill 名）。

frontmatter 字段（`src/skills/loadSkillsDir.ts:185-265` 的 zod schema 定义）：

| 字段 | 必填 | 含义 |
|------|------|------|
| `name` | 是 | 默认取目录名，可显式覆写 |
| `description` | 是 | 用于 skill 菜单展示（LLM 看的） |
| `allowed-tools` | 否 | 工具白名单 |
| `paths` | 否 | 条件激活：当前对话涉及匹配文件时才出现在菜单 |
| 其他自定义字段 | 否 | 忽略 |

### 2. 加载时机：static system prompt vs per-turn user-meta

**关键差异**：CC 的 skill 菜单**不在 static system prompt 里**。system prompt 里只有 13 行关于 SkillTool 的说明（`src/constants/prompts.ts:354-388`），告诉 LLM "skill 是可调用的能力，列表会在 system-reminder 里给你"。

skill 列表在每个 user turn 通过 **system-reminder** 注入（`src/utils/messages.ts:3728-3737`）：用户消息发送时，runtime 把当前可见的 skill 名称+描述包进 `<system-reminder>` 标签，作为 user message 的一部分发出。

具体注入函数：`src/utils/attachments.ts:2641-2751` 的 `getSkillListingAttachments`。

这意味着：

- system prompt 保持稳定 → KV-cache 命中率高
- skill 菜单挨着 user message → 注意力位置近
- skill 列表可以**按需变化**，不会撼动 cache 前缀

### 3. 1% context 预算 + 增量发送

CC 给 skill 菜单的预算是 **当前模型 context window 的 1%**：

```
SKILL_BUDGET_CONTEXT_PERCENT = 0.01
```

定义在 `src/tools/SkillTool/prompt.ts:21`。1% 在 200K 模型上就是 ~2K tokens，与 figma 现在的 KNOWLEDGE LIBRARY 体量接近，但用法不同：

**Bundled 优先**（`src/tools/SkillTool/prompt.ts:97-109`）：当预算不够装下所有 skill 时，先保 bundled（官方打包）skill 的完整 description，再放 user/project/plugin skill。Bundled skill 永远不会被截断。

**降级到 names-only**（`src/tools/SkillTool/prompt.ts:122-141`）：如果完整 description 还是装不下，把 non-bundled skill 降级为只显示 `name`（不显示 description）。这告诉 LLM "这些 skill 存在但没空间介绍，按需 invoke 自己看"。

**增量发送**（`src/utils/attachments.ts:2700-2730`）：runtime 维护一个 `sentSkillNames` set，记录本会话已发送过描述的 skill。后续 turn 只发新增 skill 的描述，已发的只发 name。极大减少重复 token。

### 4. /command 与 LLM 调用 SkillTool 的统一展开路径

CC 让 skill 既能被用户显式触发，也能被 LLM 自主调用，**走同一段展开代码**：

- 用户输入 `/restyle` → `src/utils/processUserInput/processSlashCommand.tsx:827-919` 把 `/foo` 解析为 `SkillTool.invoke({ skillName: "foo" })`，进入正常 tool 调用流程
- LLM 输出 `tool_use(SkillTool, {skillName: "foo"})` → 同样进入 SkillTool

SkillTool 的执行（`src/tools/SkillTool/SkillTool.ts:122-289` 的 fork 实现）：

1. 读取 `<skill-dir>/SKILL.md` 全文
2. 把内容塞进 `contextModifier`（`src/tools/SkillTool/SkillTool.ts:778-805`），作为后续 turn 的 context 注入
3. 标记 `invokedSkill` 状态（`src/utils/compact.ts:218` 在 compact 时还原此状态）

`/foo` 与 LLM 自调用共用展开路径见 `src/tools/SkillTool/SkillTool.ts:635-643`：两条入口最终都调用同一个 dispatcher。

### 5. allowed-tools 的实际生效

skill frontmatter 的 `allowed-tools` 字段会**加白名单**到当前 turn 的工具集：

- 例如 `database-migration` skill 声明 `allowed-tools: [Bash, Read]`
- 用户调用 `/database-migration` 后，本次 turn 的工具集会临时加上 Bash/Read，即使 settings.json 里没默认许可

实现：`src/tools/SkillTool/SkillTool.ts:778-805` 的 contextModifier 把 allowed-tools 合并进 permissions。

这是 CC 独有的**权限分级**：高风险 skill 可以"按使用激活权限"，平时不开。

### 6. paths 条件激活

CC 最接近"关键词触发"的机制是 **paths frontmatter**：

```yaml
---
name: react-component-builder
description: Build React components following project conventions
paths: ["src/**/*.tsx", "src/**/*.jsx"]
---
```

实现：`src/skills/loadSkillsDir.ts:159-178` 加载 paths 字段；`src/skills/loadSkillsDir.ts:997-1058` 的 `filterSkillsByConditions` 把当前 turn 涉及的文件路径与 skill paths 做 glob 匹配。**不匹配的 skill 不会出现在菜单**。

注意：是 runtime 决定**菜单可见性**，不是决定 invoke。LLM 仍然自己选择是否调。这避免了"关键词硬触发"的脆弱性，同时压缩了菜单噪音。

### 7. Bundled 永不被截断特权

如前述（第 3 节），bundled skill 在预算紧张时仍保留完整 description。这本质是"官方背书的高优先级 skill 集合"机制——保证核心能力的引导稳定。`src/tools/SkillTool/prompt.ts:97-109` 是这条规则的代码体现，不是配置项，是硬编码的安全网。

另外 `src/tools/SkillTool/prompt.ts:189-191` 写了 BLOCKING REQUIREMENT：当 LLM 即将执行被 skill 覆盖的操作时，**必须先 invoke skill 读完 SKILL.md** 再继续。这是从 prompt 层强制 skill 的优先级。

---

## Figma AI Generator 的当前形态

### 1. 6 个 skill

`.agent/skills/<id>/SKILL.md` 目录下：design-knowledge、rich-text、design-system、agent-page、component-set、restyle（2026-04 新增）。

### 2. frontmatter 约定

字段：`id`、`name`、`description`。约束：description **必须以 "Use when ..." 开头**（这是项目内部约定，不是 zod 校验）。没有 `allowed-tools`、`paths` 等字段。

### 3. 渲染机制：build-time scan

构建时 `tools/generate-knowledge-index.js` 扫描 6 个内容源（guideline/help/skill/style/anatomy/reference），产出：

- `src/generated/knowledge-index.json`（搜索索引）
- `src/generated/knowledge-content.json`（内容主体）

skill 与 style/anatomy 等其他 5 类**走同一管道**，没有特殊待遇。

### 4. surface injection

`src/engine/llm-client/context/knowledgeLibrarySection.ts` 在 static system prompt 拼装时把所有 entries 渲染成 markdown 菜单。关键常量：

- `MAX_DESC_LEN = 150`（每条描述截断到 150 字符）
- `CATEGORY_ORDER` 定义六类的展示顺序

这一步把 95+ 条全量塞进 system prompt 顶层，单次注入约 **2.4K tokens**。

### 5. 全量进 static system prompt

注入位置：`src/engine/llm-client/context/system.ts` 的 `buildStaticSystemPrompt()`。一旦构造完成，整个会话期间这块菜单都不会变。

后果：

- KV-cache 友好（永不变）
- 但 **95 条同维度并列**，没有 bundled 优先、没有 paths 过滤、没有增量
- 注意力位置远（system 顶层 → user message 之间隔了 conversationHistory + turnMessages）

### 6. 没有的能力

| 缺失能力 | CC 对应实现 |
|----------|------------|
| /command 显式触发 | `src/utils/processUserInput/processSlashCommand.tsx:827-919` |
| paths 条件激活 | `src/skills/loadSkillsDir.ts:997-1058` |
| allowed-tools 权限激活 | `src/tools/SkillTool/SkillTool.ts:778-805` |
| 增量发送（sentSkillNames diff） | `src/utils/attachments.ts:2700-2730` |
| Bundled 优先级 | `src/tools/SkillTool/prompt.ts:97-109` |
| 显式 SkillTool（与 /command 共展开） | `src/tools/SkillTool/SkillTool.ts:635-643` |

figma 的 skill 调用入口是 `knowledge({action: "read", id: "skill:restyle"})`——和 style/anatomy 用同一个 tool，没有为 skill 单独建 tool。

涉及的源码：

- `src/engine/agent/tools/unified/jsTool.ts`
- `src/engine/agent/tools/unified/jsx.ts`
- `src/engine/llm-client/context/knowledgeLibrarySection.ts`
- `src/prompts/SYSTEM.md`（无 skill 特殊指引）
- `.agent/skills/restyle/SKILL.md`（新增的 restyle skill 内容）

---

## 关键差异表格

| 维度 | Claude Code | Figma AI Generator | 影响 |
|------|------------|--------------------|----|
| static system prompt 含 skill 菜单 | 否，仅 13 行 SkillTool 指引 | 是，95+ 条 ~2.4K tokens | figma 的 system prompt 与会话状态绑得过紧（虽然事实上不变，但概念上"菜单"应该是 turn-local） |
| 菜单注入位置 | per-turn user-meta（system-reminder） | static system prompt 顶层 | figma 注意力被 conversationHistory + turnMessages 稀释 |
| 预算控制 | 1% context, bundled 优先, 降级 names-only | 一刀切 150 char × 95 条 | figma 没有优先级；高价值 skill 与低价值 style 同等待遇 |
| 增量发送 | sentSkillNames diff，旧 skill 只发 name | 无（每次全量重发） | figma 重复 token；好在 KV-cache 命中所以实际影响小 |
| /command 显式触发 | ✓ `/foo` 展开 SKILL.md | ✗ | figma 无显式触发通道，全靠 LLM 自决 |
| LLM 调 SkillTool | ✓ 与 /foo 同展开路径 | ✗ 用 `knowledge({read})` | figma 入口与 style/anatomy 混用，无类型区分 |
| 关键词触发 | ✗（LLM 自决） | ✗（LLM 自决） | 一致——这是好的设计 |
| 路径条件激活 | paths frontmatter glob | ✗ | figma 无运行时菜单过滤 |
| allowed-tools 权限激活 | ✓ skill 临时加白名单 | ✗ | figma 无权限分级 |

---

## 实证：失败案例（trigger-1777434916318）

### 场景

第一轮：用户让 agent 做一个 portfolio page，agent 用 jsx 创建完成。
第二轮：用户发 **"把它做成 Memphis 那种视觉语言"**。

期望：触发新加的 `skill:restyle`（即 inspect 现有节点 → edit 改外观，保留结构）。

实际：agent 调 `knowledge({action: "read", id: "style:neo-brutalist"})`，然后 `jsx({replaceId: "..."})` **整页重建**。

### 分析

第一版 restyle SKILL.md 的 description 写了 419 字符。`MAX_DESC_LEN=150` 把它截到 150，**关键的 trigger 信号词**（"restyle"、"reskin"、"把它做成"、"keep structure"）全部丢失。LLM 在菜单里只看到一句没头没尾的解释。

第二版改进 description 到 152 字符（几乎不被截断），关键词都保住。但实测仍然没触发——LLM 在菜单里看到 25 条 style entries 时，自然倾向选其中一个（比如 `style:neo-brutalist`），因为：

1. style entries **数量多**（25 条 vs skill 6 条），先验概率高
2. style entries 是 **content**（直接给视觉规范），LLM 当作"答案"
3. skill 是 **procedural**（教怎么做），需要 LLM 先识别"这是个流程问题"才会调

这是 **注意力竞争 + 类型分类缺失** 的双重问题。

### 验证路径

trigger ID `trigger-1777434916318` 的结果文件存在 `/tmp/figma-bridge/results/`（如已被清理可重跑）。验证可以再发一次相同 prompt，观察 toolCallDetails 中第一个 knowledge 调用的 id。

---

## 改进方向（按 ROI 排序）

### 1. 菜单从 static system → per-turn user-meta

仿 CC `<system-reminder>` 模式。每个 user turn 在 turnMessages 头部注入一段菜单 message：

```ts
{ role: "user", content: "<skill-listing>...菜单...</skill-listing>\n\n实际用户内容" }
```

代价：~30 行代码改动（拆 `knowledgeLibrarySection.ts` 的输出位置；agent runtime 在 turn assemble 时插入）。

收益：

- system prompt KV-cache 重新稳定（不依赖 95 条 entries 是否变动）
- 注意力位置紧贴 user message
- 后续可加增量（仅发新 turn 涉及的 entry）

### 2. 分级预算 + bundled/skill 优先

仿 `SKILL_BUDGET_CONTEXT_PERCENT=0.01` 思路：

- skill 类（6 条）：**完整 description 不截断**
- guideline / help（21 条）：保持现有 150 char
- style / anatomy / reference（68 条）：进一步缩到 80 char 或仅显示 name + 一句 hint

实现位置：`src/engine/llm-client/context/knowledgeLibrarySection.ts`，按 category 分桶给不同 MAX_DESC_LEN。

收益：skill 在菜单里的"信息密度"显著高于 style，LLM 更容易识别"这是工作流问题"。

### 3. paths-equivalent 条件激活

figma 没有 file paths，但有等价信号可以做菜单可见集合控制：

- `selection`：当前用户选中节点的类型（FRAME / TEXT / INSTANCE）
- 上一轮 inspect / jsx 调用的目标节点 id 与类型
- prompt 中的 deictic 引用（"把它"、"这个"、"它现在"）→ 强信号说明是 modify 任务

runtime 把这些信号映射到一个 "可见菜单" 子集，比如：

- 检测到 deictic 引用 + 上一轮有创建过节点 → restyle skill 提到菜单顶部、neo-brutalist 等 style entry 降级
- 全新会话第一句话 → restyle 隐藏，style entries 正常展示

实现需要新建 `src/engine/agent/skills/menuFilter.ts`，输入 `(turnContext, allEntries)`，输出 `visibleEntries`。约 50-80 行。

### 不做的方向

- ✗ **不引入 prompt 关键词检测**：复杂度 O(语言)，中文/英文/混合语都得维护正则表
- ✗ **不修每个 style entry 加 procedural 提示**：复杂度 O(95)，且违反"内容与流程分层"原则
- ✗ **不在 SYSTEM.md 加 RESTYLE 等场景规则**：违反"SOP-as-skill"哲学（April 2026 已删 SOP.md，把 SOP 内容拆进 help: 知识条目）

---

## 附：源码引用速查

### Claude Code

- `src/skills/loadSkillsDir.ts:425-431` — 目录格式扫描
- `src/skills/loadSkillsDir.ts:185-265` — frontmatter zod schema
- `src/skills/loadSkillsDir.ts:159-178` — paths 字段加载
- `src/skills/loadSkillsDir.ts:997-1058` — paths conditional 过滤
- `src/tools/SkillTool/SkillTool.ts:635-643` — /command 与 LLM 调用共展开路径
- `src/tools/SkillTool/SkillTool.ts:778-805` — contextModifier + allowed-tools
- `src/tools/SkillTool/SkillTool.ts:122-289` — fork 实现
- `src/tools/SkillTool/prompt.ts:21` — `SKILL_BUDGET_CONTEXT_PERCENT = 0.01`
- `src/tools/SkillTool/prompt.ts:97-109` — bundled 优先级
- `src/tools/SkillTool/prompt.ts:122-141` — names-only 降级
- `src/tools/SkillTool/prompt.ts:189-191` — BLOCKING REQUIREMENT
- `src/utils/messages.ts:3728-3737` — skill_listing → system-reminder
- `src/utils/attachments.ts:2641-2751` — `getSkillListingAttachments`
- `src/utils/attachments.ts:2700-2730` — sentSkillNames 增量
- `src/utils/processUserInput/processSlashCommand.tsx:827-919` — `/foo` 展开
- `src/constants/prompts.ts:354-388` — system prompt 中关于 SkillTool 的 13 行
- `src/utils/compact.ts:218` — invokedSkill compact 还原

### Figma AI Generator

- `src/engine/agent/tools/unified/jsTool.ts` — js 工具定义
- `src/engine/agent/tools/unified/jsx.ts` — jsx 工具定义
- `src/engine/llm-client/context/knowledgeLibrarySection.ts` — KNOWLEDGE LIBRARY 渲染 (`MAX_DESC_LEN=150`, `CATEGORY_ORDER`)
- `src/engine/llm-client/context/system.ts` — `buildStaticSystemPrompt()`
- `src/prompts/SYSTEM.md` — 静态 system prompt 主体
- `.agent/skills/restyle/SKILL.md` — 2026-04 新增的 restyle skill
- `src/generated/knowledge-index.json` — 构建产物：搜索索引
- `src/generated/knowledge-content.json` — 构建产物：内容主体
- `tools/generate-knowledge-index.js` — 构建脚本

---

## 总结

CC 把 skill 当作 **"按需激活的工具"**：菜单走 turn-local，预算分级，bundled 优先，paths 过滤，权限可激活，/command 与 LLM 调用同入口。

figma 把 skill 当作 **"知识条目的一个类别"**：与 style/anatomy 共用 knowledge tool，全量塞 system prompt，无类型分级，无条件过滤。

restyle skill 不触发的根因不是 description 写得不好，而是**结构性的注意力竞争**——25 条 style entries 把 6 条 skill 淹没了。修 description 是局部解，分类型预算 + per-turn 注入是结构解。

---

## Update 2026-04-29: Phase 1 实施 + E2E 验证 + 残留发现

基于上文"改进方向 (1) (2)"做了实施，跑了 4 次 E2E 测试。第 4 次成功触发 skill:restyle。本节记录实施细节、测试对比、SOP 遵循度、和后续发现的 jsx 工具 bug。

### 已落地的代码改动（5 文件）

| 文件 | 改动 |
|------|------|
| `src/engine/llm-client/context/knowledgeLibrarySection.ts` | 改函数化 `renderKnowledgeMenu()`；6 类分级预算（skill/help 200 字符全描述，guideline 150，style/anatomy/reference 60 字符仅 name）；CATEGORY_ORDER 把 skill 提到第一位；preamble 加"REQUIRED selection rule"——existing canvas → skill: 优先；fresh → style: 优先 |
| `src/engine/llm-client/context/system.ts` | `buildStaticSystemPrompt` 加 `includeMenu?: boolean` 参数；默认 true（subtask 兼容） |
| `src/engine/services/AgentOrchestrator.ts` | 主运行时两处 `buildStaticSystemPrompt` 调用都传 `{includeMenu: false}` |
| `src/engine/agent/agentRuntime.ts` | `run()` 每 turn 在 user prompt 之前注入菜单（`<system-reminder>` 包裹的 user-meta message）。每 turn 重新注入而非仅 first turn——避免菜单被 turn 1 历史推远导致 attention 衰减 |
| `src/engine/agent/tools/unified/jsx.ts` | description 加 effects 类属性（blur/bgblur）+ layoutPositioning + 装饰层 anti-pattern 提示 + 全 frame bg 渐变指南 |

外加：新增 `.agent/skills/restyle/SKILL.md`（5 phase SOP + KNOWN PITFALLS 表 + call budget）。

### 实测：菜单 token 预算变化

```
旧（uniform 150 char × 95 entries）：约 14K chars / 3.5K tokens，全在 static system prompt
新（分级预算）：约 7.5K chars / 1.9K tokens，移到 per-turn user-meta
```

skill section（6 entries × 200 char）：1142 chars，占新预算 15%——skill 现在拿到了不成比例的注意力分配，与其工作流性质匹配。

skill:restyle description 改写后 152 chars，几乎完整入 menu（之前 419 chars 截到 150，全部 trigger 关键词丢失）。

### 4 次 turn 2 实验对比表

第一轮都是相同的 portfolio 创建 prompt（多段复杂规格）；第二轮都是相同的模糊 Memphis prompt：*"它现在太干净了。把它做成早期 MTV 频道包装、Memphis Group、九十年代后现代杂志封面那种视觉语言..."*

| # | 实验 | calls | 时长 | 路径 | skill 触发 | jsx markup |
|---|------|-------|------|------|-----------|-----------|
| 1 | glassmorphism prompt（skill 不存在） | 26 | 542s | knowledge + jsx + **17 次 js 修复** | n/a | 9.3KB + 大量 js |
| 2 | Memphis（skill 存在但 description 419 字符被截到 150） | 3 | 281s | knowledge(style:neo-brutalist) + jsx replaceId | ❌ | **21KB**（重建） |
| 3 | Memphis（description 改短到 152 字符） | 3 | 292s | 同上 | ❌ | **21KB**（重建） |
| 4 | Memphis（**菜单移 user-meta + 分级预算 + 强 preamble + 每 turn 注入**） | 18 | 491s | knowledge(skill:restyle) + inspect + edit×3 + jsx 装饰 + move_node×4 | **✅** | **2.3KB**（仅装饰） |

**测试 4 的胜利点**：
- skill:restyle 终于被读 ✓
- jsx markup 21KB → 2.3KB（**90% 节省**）
- portfolio 全部内容（"Marcus Chen" / 技能项 / 项目名 / 联系方式）原地保留
- 走 inspect→edit 路径，不是重建

**测试 4 的残留问题**：18 calls 仍多于理想 5-8。根因不是 LLM 不遵循 SOP（见下节），是 jsx 工具的 group 子节点 bug。

### SOP 逐 phase 遵循度（测试 #4 评分：3/5 phases）

读 `.agent/skills/restyle/SKILL.md` 与测试 #4 的 18 个 tool calls 对照：

| Phase | 状态 | 证据 |
|-------|------|------|
| 1. inspect 全树 | ✓ | call #8 `inspect({node, facets:["all"], depth:8})`，~92K chars 返回 |
| 2. 按层分类 | ✓ | 后续 edit 全部只动 `bg/fill/font/stroke/rounded` 视觉 token，不碰 `characters`/`layoutMode` |
| 3. batch edit | △ | 拆成 3 次 edit（call #9/#10/#11），SOP 推荐 1-2 次 batch。可能触达 token cap |
| 4. 装饰层 + ABSOLUTE | ✗ | LLM **完全遵循 SOP** 写了 `layoutPositioning='absolute'`，但 jsx 返回 `created: 1` 只创建了 group 容器节点，**17 个装饰子元素 0 创建** |
| 5. verify reconcile | △ | finalText 声称"装饰几何已完成（旋转方块/圆点/斜条纹）"但实际画面没渲染——违反 SOP "不要声称没添加的特性" |

### 关键发现：jsx 工具的 group 子节点丢失 bug

测试 #4 的 jsx 装饰层调用 (`call #12`) 返回：
```json
{"id":"1848:2451","name":"Decorations","type":"frame","created":1,"createdIds":["1848:2451"]}
```

只创建了 group 容器一个节点。LLM 写的 17 个装饰子元素（每个都正确加了 `layoutPositioning='absolute'`）**全部被 jsx 编译器吞掉**。LLM 看不到装饰，错误归因为"层级问题" → 4 次 move_node + 1 次 js insertChild 错误。

**这不是 SOP 缺漏**，是 jsx 工具对 `<group layoutPositioning='absolute'>` 容器的子节点处理 bug。建议：
1. 修 jsx 工具的 group 子节点处理（独立任务，影响所有装饰场景）
2. SKILL.md 加防御性提示（diff 形式）：
   ```diff
   +**Add decorations as direct siblings of root, NOT wrapped in `<group>`**.
   +After jsx call, verify response `created` count equals shapes you wrote.
   +If `created: 1` but you wrote N shapes, children were skipped — re-emit flat.
   ```

### 6 类 knowledge 分类决策表

测试观察印证了一个判断：**skill 与其他 5 类本质不同**——skill 是 procedural（加载后规约 agent 后续动作序列），其他是 declarative（只灌信息）。未来新 entries 应按下表分类：

| 内容形态 | 类别 | 准则 |
|---------|------|------|
| 多步工作流 + tool 顺序 + anti-pattern + call budget | **skill** | 加载后规约动作序列 |
| 单一行为约束（"X 时优先 Y 不要 Z"） | **help** | 比 skill 轻，无完整 SOP |
| 产品类型页面骨架（landing/dashboard/login） | **guideline** | 整页 layout 模板 |
| 命名 aesthetic 的 token 集（color/font/shadow） | **style** | 视觉决策表，无动作 |
| 单组件 part 组成（按钮/卡片/tab） | **anatomy** | 静态结构参考 |
| 查找性事实（API limit / property 列表 / error code） | **reference** | 纯查询 |

**长期建议**：当 skill 数量 ≥ 8（目前 6），考虑把 skill 提一级工具，knowledge 留给 declarative 5 类。

### CC Skill 工具入口对比 + 迁移建议

| 维度 | CC `Skill({skill:"X"})` | figma `knowledge({action:"read", id:"skill:X"})` |
|------|------------------------|---------------------------------------------------|
| 入口层级 | 1 级（工具名 = 语义） | 3 级（工具+action+id 前缀） |
| 参数 | `{skill, args?}` 2 参 | `{action, id, query?, category?}` 4 参 |
| 心智模型 | "调用一个 skill" | "查 knowledge 库，按 id 读，id 前缀是 skill:" |
| LLM 失误率 | 低 | 中（action 容易遗漏） |
| 工具数量成本 | +1 工具 | 0 |

CC SkillTool 源码：
- `src/tools/SkillTool/SkillTool.ts:291-298` — schema `{skill: string, args?: string}`
- `src/tools/SkillTool/SkillTool.ts:342` — runtime description 极短：`Execute skill: ${skill}`
- `src/tools/SkillTool/prompt.ts:173-196` — invocation prompt 含 BLOCKING REQUIREMENT

**建议**：**不立刻迁移**，6 个月观察期 + 加 thin alias。
- 当前 6 个 skill 数量太少，独立工具收益小
- 测试 #4 已证明 `knowledge({action:"read", id:"skill:..."})` 入口可用
- 加 thin alias `skill({id, args?})` 作为 wrapper，让 LLM 两种入口都能用，迁移成本极低
- 观察 6 个月：如果 LLM 用 `skill()` 触发率比 `knowledge({skill:})` 高 30%+，再废弃后者

### 下一步 follow-up

按 ROI：
1. **修 jsx 工具的 `<group layoutPositioning='absolute'>` 子节点丢失 bug**——影响所有装饰层场景，不止 restyle
2. **加 `skill` thin alias 工具**——低成本，让入口更清晰
3. **paths-equivalent 条件激活（改进方向 #3）**——让菜单只显示当前 selection / inspect 节点类型相关的 skill，进一步降 token 预算
