# Claude Code Prompt 设计 Pattern 提取

> 来源: Claude Code `src/constants/prompts.ts`, `systemPromptSections.ts`, `promptCacheBreakDetection.ts`
> 日期: 2026-04-13
> 适用范围: 任何 agent 项目（Figma 插件、CLI agent、MCP server 等）

---

## Pattern 1: System Prompt 分层设计

### 核心思想

System prompt 不是一个大字符串，而是按**关注点分层组装**。每一层有独立的 cache 行为。

### 实现

```
STATIC 层（boundary 之前，所有用户共享 KV-cache）
├── Identity    — 身份定义
├── System      — 工具执行规则、权限、hooks
├── Doing Tasks — 工作风格、验证要求、安全
├── Actions     — 风险评估框架
├── Tools       — 工具使用偏好
├── Tone        — 输出格式规则（无 emoji、file:line 引用）
└── Efficiency  — 输出长度控制

═══ SYSTEM_PROMPT_DYNAMIC_BOUNDARY ═══

DYNAMIC 层（boundary 之后，每 session 独立）
├── Session Guidance — 技能发现、验证 gate
├── Memory           — 持久记忆
├── Language         — 用户语言偏好
├── Output Style     — 自定义风格
├── MCP Instructions — MCP 工具说明
├── Scratchpad       — 临时工作区
├── Token Budget     — token 支出目标
└── Brief            — 自主模式简报
```

### 为什么有效

1. **KV-cache 复用**: Static 层 hash 不变 → 所有用户共享缓存 → API 成本降低
2. **精准失效**: Dynamic 层变化只影响单个 session，不会 break 全局缓存
3. **工具独立**: Tool schemas 作为独立 block，工具增删时不重建整个 prompt

### 迁移建议

- 将"你是谁 + 你知道什么 + 你的规则"放入 STATIC 层
- 将"当前 session 状态 + 动态配置"放入 DYNAMIC 层
- 用显式 boundary marker（字符串常量）分隔两层

---

## Pattern 2: Section 级 Memoization

### 核心思想

不是整个 system prompt 缓存，而是**每个 section 独立缓存**。计算一次，后续直接复用。

### 实现

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

### 为什么有效

- 大部分 dynamic section 首次计算后不变
- 只有真正变化的 section（如 MCP）才每轮重算
- 避免整个 prompt 重建 → 减少 API latency

### 迁移建议

- 为每个 section 实现缓存逻辑
- 用 `DANGEROUS_` 前缀标记危险 section，强制写理由
- Section hash 变化时才重算

---

## Pattern 3: Cache Break Detection

### 核心思想

事后监控 cache 失效，诊断是否"意外 break"。

### 实现

```typescript
// Phase 1 (pre-call): hash(system prompt + tools + schemas) → 存快照
recordPromptState()

// Phase 2 (post-call): 比较 cache_read_tokens 差异
checkResponseForCacheBreak()
// 阈值: drop >5% AND >2000 tokens → cache break 警报
```

### 跟踪维度（12个）

- prompt hash、tool schemas、model、fast mode、betas
- cache_control scope、MCP 状态、session 状态等

### 为什么有效

- 发现无意引入的 cache breaker（如 timestamp、random ID）
- 数据驱动优化：知道哪个改动浪费了多少 tokens
- 调试文件：生成 diff 用于分析

### 迁移建议

- 在 API call 前后记录 prompt hash 和 cache_read_tokens
- 设置阈值（如 >5% + >2000 tokens）触发警报
- 跟踪关键维度，生成可读的 diff 文件

---

## Pattern 4: Tone 规范

### 核心思想

输出格式是独立层级，不混入其他规则。

### 规则

```
Tone — 格式规则（无 emoji、file:line 引用）
```

### 为什么有效

- **无 emoji**: CLI 输出在 monospace font，emoji 会破坏排版
- **file:line 引用**: 用户可点击跳转，提高交互效率
- **独立层级**: Tone 规则不污染 Identity/Doing Tasks 层

### 迁移建议

- 将输出格式规则单独成层
- 明确禁止 emoji（除非用户要求）
- 强制 `file:line` 格式（如 `src/foo.ts:42`）

---

## Pattern 5: 验证 Gate 写在 Dynamic 层

### 核心思想

强制性验证规则放在 **session guidance**（dynamic），而非 static。

### 实现

```typescript
// 位于 getSessionSpecificGuidanceSection()
"when non-trivial implementation happens on your turn,
 independent adversarial verification must happen
 before you report completion"
```

### 为什么有效

- **可条件开启**: 通过 feature flag（如 `VERIFICATION_AGENT`）控制
- **不污染 static**: Static 层应该是身份 + 知识，不是流程控制
- **语气区分**: "must happen" vs "should" — 强制性验证

### 迁移建议

- 将 gate 规则（如"创建后必须验证"）放在 dynamic 层
- 用 "must happen" 措辞，而非建议性语气
- Gate 可以通过 feature flag 条件开启

---

## Pattern 6: Sticky Latch

### 核心思想

某些状态一旦开启，session 内不再翻转 → 避免 cache break。

### 实现

```typescript
// AFK mode、overage state 等 — 开启后 session 内不变
previousState: {
  afkMode: boolean,  // sticky — once true, stays true
  overage: boolean,  // sticky — once true, stays true
}
```

### 为什么有效

- 防止状态反复切换导致 prompt hash 变化
- 一旦进入特殊模式，后续所有 turn 都在该模式下运行
- 减少 cache break

### 迁移建议

- 标记哪些状态是 "sticky"（如 debug mode、careful mode）
- Sticky 状态只在 `/clear` 或 session 结束时重置
- 非-sticky 状态可以每轮变化

---

## Pattern 7: 工具描述与 System Prompt 分离

### 核心思想

每个工具有独立的 `prompt.ts`，不在 system prompt 里硬编码。

### 实现

```
工具目录结构:
src/tools/
├── BashTool/
│   └── prompt.ts       ← 工具专属说明
├── FileReadTool/
│   └── prompt.ts
└── ...
```

### 组装

```typescript
// serializeTools() 在拼装时注入
serializeTools(availableTools)  // → 加入 system prompt 末尾
```

### 为什么有效

- 工具增删不影响 system prompt hash（独立 block）
- 每个工具可以独立迭代 prompt
- 支持动态工具集（如 MCP 工具）

### 迁移建议

- 每个工具自带 `description` 或 `prompt.ts`
- `serializeTools()` 在 runtime 组装，而非硬编码
- Tool schemas 作为独立 API block

---

## Pattern 8: Doing Tasks 规则集

### 核心思想

工作风格规则是独立层级，语气区分"强制"vs"建议"。

### 规则示例

```
- Minimize output tokens while maintaining helpfulness
- Only address the specific query, avoid tangential info
- One word answers are best where possible
- No preamble or postamble
- No text before/after response (e.g. "The answer is...")
```

### 为什么有效

- **语气梯度**: MUST → MUST NOT → SHOULD → AVOID
- **示例驱动**: 提供正面和负面示例
- **量化指标**: "fewer than 4 lines"（而非"简洁"）

### 迁移建议

- 建立语气梯度词汇表（MUST/NEVER/AVOID/SHOULD）
- 用示例而非抽象描述
- 用量化指标（如"4 lines"、"200ms"）

---

## Pattern 9: Delta Attachment（通知式变更）

### 核心思想

Dynamic 层变化用 attachment 通知，不重建整个 system prompt。

### 实现

```typescript
// MCP 指令变化 → 通过 attachment 通知
// 不重建 system prompt
getMcpInstructionsDeltaAttachment()
```

### 为什么有效

- 避免 MCP 连接/断开导致 cache break
- Attachment 是 turn message 层，不影响 system prompt
- 保持 prompt hash 稳定

### 迁移建议

- 动态内容变化优先用 attachment（turn message）
- 只有核心身份变化才重建 system prompt
- Attachment 是增量通知，非全量重建

---

## Pattern 10: System Prompt 描述 WHAT & WHY，不描述 HOW

### 核心思想

System prompt 是规则/身份/知识，不是步骤。

### 实现

```typescript
// ✅ 正确: 规则（WHAT & WHY）
"Don't add features that weren't requested."
"NEVER commit changes unless the user explicitly asks."

// ❌ 错误: 步骤（HOW）
"First read the file, then run tests, then commit."
```

### HOW 来自哪里

- **Skills**: 动态加载的 SOP 文件（如 SKILL.md）
- **Tool descriptions**: 每个工具自带的 prompt.ts

### 为什么有效

- System prompt 保持稳定（不依赖具体流程）
- Skills 可以按场景加载（不同 SOP）
- 工具说明独立迭代

### 迁移建议

- System prompt 只写"你是谁 + 你知道什么 + 你的规则"
- 流程控制（HOW）用单独的 SOP 文件
- 工具使用说明写在工具定义里

---

## 使用建议

### 高 ROI Pattern（优先迁移）

| Pattern | ROI | 迁移成本 | 适用场景 |
|---------|-----|---------|---------|
| Pattern 1 (分层设计) | ⭐⭐⭐⭐⭐ | 中 | 所有 agent |
| Pattern 4 (Tone 规范) | ⭐⭐⭐⭐⭐ | 低 | CLI/终端 agent |
| Pattern 8 (Doing Tasks 规则) | ⭐⭐⭐⭐⭐ | 低 | 所有 agent |
| Pattern 5 (验证 Gate dynamic) | ⭐⭐⭐⭐ | 中 | 需要 gate 的 agent |
| Pattern 7 (工具描述分离) | ⭐⭐⭐⭐ | 中 | 多工具 agent |

### 中 ROI Pattern（有 KV-cache 时迁移）

| Pattern | ROI | 迁移成本 | 适用场景 |
|---------|-----|---------|---------|
| Pattern 2 (Section Memoization) | ⭐⭐⭐⭐ | 高 | 有 KV-cache 的 provider |
| Pattern 3 (Cache Break Detection) | ⭐⭐⭐ | 高 | 大规模部署 |
| Pattern 6 (Sticky Latch) | ⭐⭐⭐ | 中 | 有状态切换的 agent |
| Pattern 9 (Delta Attachment) | ⭐⭐⭐ | 高 | MCP/动态工具 |

### 低 ROI Pattern（可选）

| Pattern | ROI | 迁移成本 | 适用场景 |
|---------|-----|---------|---------|
| Pattern 10 (WHAT & WHY) | ⭐⭐⭐ | 低 | 已有 SOP 分离的项目 |

---

## 参考源码位置

- `src/constants/prompts.ts` — 分层组装、boundary marker
- `src/constants/systemPromptSections.ts` — Section memoization
- `src/utils/promptCacheBreakDetection.ts` — Cache break 监控
- `src/tools/*/prompt.ts` — 工具描述分离

---

## 已在本项目应用的 Pattern

| Pattern | 本项目实现 | 状态 |
|---------|-----------|------|
| Pattern 1 | `SYSTEM.md` + `SOP.md` + dynamic layers | ✅ 已应用 |
| Pattern 4 | Tone 规则在 SYSTEM.md 外层 | ⚠️ 部分应用（无显式 Tone 层） |
| Pattern 5 | `describe` gate 在 SOP.md | ✅ 已应用 |
| Pattern 7 | 每个工具自带 description | ✅ 已应用 |
| Pattern 10 | SYSTEM.md (WHAT) + SOP.md (HOW) | ✅ 已应用 |

待迁移：Pattern 2/3（KV-cache 优化）、Pattern 8（量化语气规则）