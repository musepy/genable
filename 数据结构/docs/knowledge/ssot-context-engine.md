# SSOT Context Engine 知识库

> **Purpose**: 沉淀 DSL 生成链路的架构知识，解决 LLM 输出不确定性问题  
> **Created**: 2026-01-14  
> **Tags**: `architecture`, `ssot`, `llm-prompt`, `parser`

---

## 1. 问题定义：三种方言现象

### 1.1 现象描述

同一版本代码连续生成三次，LLM 产出三种不同的 DSL 风格：

| 方言 | 示例 | 解析器状态 | 视觉结果 |
| :--- | :--- | :--- | :--- |
| **极简风 (Hyper-short)** | `:g24`, `:stroke(#hex)` | ❌ Dead Letter | 布局坍塌，无间距无边框 |
| **Tailwind 风 (Mixed)** | `:bg-#F3F4F6`, `:bold/24` | ❌ Dead Letter | 样式缺失，背景色丢失 |
| **标准风 (Standard)** | `:gap24`, `:#ffffff` | ✅ Parsed | 完美渲染 |

### 1.2 根因分析

**核心问题：Prompt 和 Parser 学习的"规则书"不是同一本**

```
┌─────────────────────────────────────────────────────────────┐
│ skillLoader.ts - DSL_V6_TEMPLATE                            │
│ (LLM 看到的规则)                                             │
│ - "This compact notation reduces token usage by 60-80%"     │
│ - 定义: gap<N>, p<N>, r<N>                                  │
└─────────────────────────────────────────────────────────────┘
                        ↓ 不同步 ↓
┌─────────────────────────────────────────────────────────────┐
│ registry.ts - SHORTHAND_REGISTRY                            │
│ (Parser 使用的规则)                                          │
│ - 定义: gap<N>, g<N>, p<N>, bg-#<hex>                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 三种方言的诱因

| 方言 | 源头文件 | 诱因 |
| :--- | :--- | :--- |
| **极简风** | `skillLoader.ts` L42 | Prompt 强调 "compact notation"，LLM 自作聪明进一步压缩 |
| **Tailwind 风** | `contextBuilder.ts` L172 | 默认注入 `'Tailwind CSS'`，触发 LLM 的 Tailwind 训练记忆 |
| **标准风** | `skillLoader.ts` L65 | LLM 严格遵循 Few-shot Example 表格 |

---

## 2. 解决方案：Declarative Context Engine

### 2.1 核心理念

将 System Prompt 从"一坨字符串"重构为 **声明式 Section 组合**：

- 每个 Section 有唯一 ID、优先级、依赖声明
- 所有 Section 从统一的 Registry 读取规则
- 运行时按优先级排序组装

### 2.2 架构示意

```
Truth Sources (SSOT)
├── registry.ts          → generateDSLCheatSheet()
├── designSystemLoader.ts → getSkillInstructions()
├── tokenSlot.ts         → getPromptSnippet()
└── ragService.ts        → getGoldenTemplates()
         │
         ▼
┌─────────────────────────────────────────┐
│      PROMPT_SECTION_REGISTRY            │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ role   │ │ design │ │ tokens │ ...  │
│  │ p:10   │ │ p:20   │ │ p:30   │      │
│  └────────┘ └────────┘ └────────┘      │
└─────────────────────────────────────────┘
         │
         ▼
    composeSystemPrompt()
         │
         ▼
    [System Prompt] → [LLM] → [DSL Output]
                                   │
                                   ▼
                              [Parser]
                                   │
                           SHORTHAND_REGISTRY
                           (同一份 registry.ts)
```

### 2.3 核心接口

```typescript
// src/services/context/sectionRegistry.ts

export interface PromptSection {
  id: string;                                    // 唯一标识
  priority: number;                              // 排序优先级 (越小越靠前)
  dependencies: string[];                        // 显式依赖声明
  builder: (deps: PromptDependencies) => string; // 内容生成器
  enabled?: (flags: FeatureFlags) => boolean;    // 条件启用
}

export const PROMPT_SECTION_REGISTRY: PromptSection[] = [
  { id: 'role', priority: 10, dependencies: [], builder: buildRoleSection },
  { id: 'design-system', priority: 20, dependencies: ['designSystemContext'], builder: buildSkillSection },
  { id: 'available-tokens', priority: 30, dependencies: ['tokenSlot'], builder: (deps) => deps.tokenSlot.getPromptSnippet() },
  { id: 'dsl-specification', priority: 100, dependencies: ['shorthandRegistry'], builder: generateDSLCheatSheet },
];
```

```typescript
// src/services/context/promptComposer.ts

export function composeSystemPrompt(deps: PromptDependencies, flags: FeatureFlags): string {
  return PROMPT_SECTION_REGISTRY
    .filter(s => !s.enabled || s.enabled(flags))
    .sort((a, b) => a.priority - b.priority)
    .map(s => s.builder(deps))
    .filter(Boolean)
    .join('\n\n');
}
```

---

## 3. Slot 分类体系

### 3.1 四层 Slot 架构

| 层级 | 类别 | Slot 列表 | 变化频率 | SSOT 来源 |
| :--- | :--- | :--- | :--- | :--- |
| **L1** | Static | `role`, `constraints`, `dsl-spec` | 编译时 | 代码常量 / `registry.ts` |
| **L2** | Session | `design-system`, `available-tokens`, `library-components` | 每会话 | `designSystemLoader`, `tokenSlot`, `ragService` |
| **L3** | Turn | `user-intent`, `selection-context`, `conversation-history` | 每轮 | 运行时输入 |
| **L4** | Derived | `component-knowledge`, `rag-templates`, `style-dna` | 计算得出 | 依赖其他 Slot |

### 3.2 Slot 依赖关系

```
Independent Slots (无依赖)
├── role
├── dsl-spec
└── constraints

Session Slots
├── design-system
├── available-tokens
└── library-components

Turn Slots
├── user-intent ──────────┬──▶ component-knowledge (Derived)
│                         └──▶ rag-templates (Derived)
├── selection-context ────────▶ style-dna (Derived)
└── conversation-history

Derived Dependencies:
design-system ────────────────▶ rag-templates (过滤范围)
available-tokens ─────────────▶ style-dna (约束可选值)
```

---

## 4. 冲突解决机制

### 4.1 优先级层级

当多个 Slot 提供同一属性的不同值时：

```
USER_EXPLICIT        [最高] 用户本轮明确说 "圆角改成 16px"
    ↓
SELECTION_CONTEXT    [次高] 选中节点的实际属性 (所见即所得)
    ↓
STYLE_MEMORY         [中]   用户历史使用的风格 (学习偏好)
    ↓
DESIGN_SYSTEM        [次低] 设计规范的默认值
    ↓
HARD_DEFAULTS        [最低] 代码兜底默认值
```

### 4.2 冲突解决示例

| 属性 | Design System | Selection Context | Style Memory | 解决结果 |
| :--- | :--- | :--- | :--- | :--- |
| `cornerRadius` | 10px (iOS HIG) | 8px (选中节点) | 12px (历史) | **8px** (Selection wins) |
| `primaryColor` | Blue 500 | - | #2563EB | **#2563EB** (Memory wins) |

---

## 5. 工程原则符合性

### 5.1 当前违规矩阵

| 环节 | 文件 | 违反原则 | 问题 | 严重性 |
| :--- | :--- | :--- | :--- | :---: |
| Prompt 定义 | `skillLoader.ts` | **SSOT** | DSL 规则定义两份，不同步 | **P0** |
| Context 构建 | `contextBuilder.ts` L172 | **DIP** | 硬编码 `'Tailwind CSS'` | **P1** |
| Prompt 约束 | `contextBuilder.ts` L337 | **Coherence** | 同时要求 "semantic tokens" 但 Example 用 hex | **P1** |
| Prompt 模板 | `skillLoader.ts` L42 | **Clarity** | 强调 "compact" 诱导 LLM 过度压缩 | **P2** |

### 5.2 目标原则符合性

| 原则 | 实现方式 |
| :--- | :--- |
| **SSOT** | 每种规则只定义一次。Prompt 和 Parser 都从同一 Registry 读取。 |
| **OCP** | 新增 Slot 只需在 Registry 添加一条记录，无需修改 Composer。 |
| **SRP** | 每个 Slot Builder 只负责生成自己的 Section 内容。 |
| **DIP** | Slot Builder 依赖抽象接口 (`PromptDependencies`)，而非具体实现。 |
| **Explicit Deps** | 每个 Section 显式声明 `dependencies`，因果关系可追溯。 |

---

## 6. Parser 的角色演化

### 6.1 旧角色：守门员 (Gatekeeper)

```
:gap24 → ✅ 通行
:g24   → ❌ 拦截 (Dead Letter)
:bg-#  → ❌ 拦截 (Dead Letter)
```

**问题**: 只有 ~33% 概率生成正确 UI

### 6.2 新角色：翻译官 (Universal Adapter)

```
:gap24 → 查 SHORTHAND_REGISTRY → gap: 24 → ✅
:g24   → 查 SHORTHAND_REGISTRY → gap: 24 → ✅
:bg-#  → 查 SHORTHAND_REGISTRY → fill: # → ✅
```

**收益**: ~100% 概率生成正确 UI

### 6.3 关键代码位置

- **Registry 定义**: `src/services/dsl/registry.ts`
- **Parser 消费**: `src/services/dsl/shorthands.ts` → `expandProp()`
- **Prompt 生成**: `registry.ts` → `generateDSLCheatSheet()`

---

## 7. 实施路线图

| 阶段 | 任务 | 优先级 | 状态 |
| :--- | :--- | :---: | :---: |
| **Phase 1** | `dsl-spec` Section SSOT 同步 | P0 | 🔲 待执行 |
| **Phase 2** | 创建 `sectionRegistry.ts` + `promptComposer.ts` | P1 | 🔲 待执行 |
| **Phase 3** | 迁移 `design-system` Section | P1 | 🔲 待执行 |
| **Phase 4** | 迁移 `available-tokens` Section | P2 | 🔲 待执行 |
| **Phase 5** | 迁移剩余 Session/Turn Slots | P2 | 🔲 待执行 |
| **Phase 6** | 添加 `conversation-history` Section | P3 | 🔲 待执行 |

---

## 8. 关键决策记录

### 8.1 为什么选择 Registry 模式而非 Prompt Template 修改？

| 方案 | 优点 | 缺点 |
| :--- | :--- | :--- |
| **修改 Prompt Template** | 快速 | 治标不治本，新规则仍需双更新 |
| **Registry 模式** | SSOT，可扩展，可测试 | 需要重构 |

**决策**: 采用 Registry 模式，符合 OCP 和 SSOT。

### 8.2 为什么 Parser 要兼容多种方言？

遵循 **Postel's Law** (鲁棒性原则):
> "Be conservative in what you send, be liberal in what you accept."

LLM 的输出天然具有不确定性。与其用 Prompt Engineering 强制 LLM "不犯错"，不如让 Parser 聪明到能理解各种"方言"。

---

## 9. 相关文件索引

| 文件 | 职责 | 关联 Section |
| :--- | :--- | :--- |
| `src/services/dsl/registry.ts` | DSL 规则定义 | `dsl-specification` |
| `src/services/dsl/shorthands.ts` | Parser 入口 | - |
| `src/skills/skillLoader.ts` | Prompt 模板 (待重构) | `dsl-specification`, `design-system` |
| `src/contextBuilder.ts` | Context 组装 (待重构) | 所有 Sections |
| `src/services/designSystemLoader.ts` | 设计系统规则 | `design-system` |
| `src/services/tokenSlot.ts` | Token 约束 | `available-tokens` |

---

## 10. 术语表

| 术语 | 定义 |
| :--- | :--- |
| **Slot** | Prompt 中的一个信息槽位，对应一类输入数据 |
| **Section** | Prompt 中的一个结构化段落，由 Slot Builder 生成 |
| **Dead Letter** | Parser 无法识别的 DSL 指令，被静默丢弃 |
| **Dialect** | LLM 生成的 DSL 变体风格 |
| **SSOT** | Single Source of Truth，单一真相源 |
| **Registry** | 声明式规则配置集合 |
