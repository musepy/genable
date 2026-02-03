# 术语常量架构综合参考指南

> 基于 `terminology-constants-architecture.md` 的深度分析与整理

---

## 目录

1. [术语词典（字母顺序）](#1-术语词典字母顺序)
2. [常量目录](#2-常量目录)
3. [架构模式映射](#3-架构模式映射)
4. [不一致性标记](#4-不一致性标记)
5. [合并建议](#5-合并建议)
6. [功能域快速查找索引](#6-功能域快速查找索引)
7. [生命周期管理与过时信息防范](#7-生命周期管理与过时信息防范)

---

## 1. 术语词典（字母顺序）

### A

#### Agent（智能体）
- **定义**: AI Agent 架构中的自主决策和执行实体
- **技术标识符**: `AI_TERMS.AGENT` → `'agent'`
- **UI 键名**: `UI_TERM_KEYS.AGENT` → `'terms.agent'`
- **日志前缀**: `LOG_PREFIXES.AGENT` → `'[Agent]'`
- **交叉引用**: 
  - 相关: [`LLM`](#llm), [`Model`](#model), [`Tool Calling`](#tool-calling)
  - 使用位置: `engine/agent/`, 日志输出

#### Anthropic
- **定义**: LLM 服务提供商之一，提供 Claude 系列模型
- **技术标识符**: `PROVIDER_NAMES.ANTHROPIC` → `'Anthropic'`
- **相关模型家族**: [`CLAUDE_3`](#claude-3), [`CLAUDE_3_5`](#claude-3-5)

#### Azure OpenAI
- **定义**: 微软 Azure 平台上的 OpenAI 服务
- **技术标识符**: `PROVIDER_NAMES.AZURE` → `'Azure OpenAI'`

### C

#### Claude 3
- **定义**: Anthropic 的 Claude 第三代模型家族
- **技术标识符**: `MODEL_FAMILIES.CLAUDE_3` → `'claude-3'`
- **提供商**: [`Anthropic`](#anthropic)

#### Claude 3.5
- **定义**: Anthropic 的 Claude 3.5 模型家族（3代的优化版本）
- **技术标识符**: `MODEL_FAMILIES.CLAUDE_3_5` → `'claude-3.5'`
- **提供商**: [`Anthropic`](#anthropic)

### G

#### Gemini
- **定义**: Google 的生成式 AI 模型家族及品牌名称
- **技术标识符**: `PROVIDER_NAMES.GEMINI` → `'Gemini'`
- **UI 键名**: `UI_TERM_KEYS.PROVIDER_GEMINI` → `'terms.providers.gemini'`
- **相关模型家族**: [`GEMINI_1_5`](#gemini-1-5), [`GEMINI_2_5`](#gemini-2-5), [`GEMINI_3`](#gemini-3)
- **交叉引用**: [`Google AI`](#google-ai)

#### Gemini 1.5
- **定义**: Gemini 1.5 系列模型
- **技术标识符**: `MODEL_FAMILIES.GEMINI_1_5` → `'gemini-1.5'`

#### Gemini 2.5
- **定义**: Gemini 2.5 系列模型
- **技术标识符**: `MODEL_FAMILIES.GEMINI_2_5` → `'gemini-2.5'`

#### Gemini 3
- **定义**: Gemini 3.0+ 系列模型，支持思考模式
- **技术标识符**: `MODEL_FAMILIES.GEMINI_3` → `'gemini-3'`
- **特性**: 支持 [`Thinking Mode`](#thinking-mode)

#### Generative AI（生成式 AI）
- **定义**: 能够生成新内容（文本、图像、代码等）的人工智能技术领域
- **技术标识符**: `AI_TERMS.GENERATIVE_AI` → `'generative AI'`
- **UI 键名**: `UI_TERM_KEYS.GENERATIVE_AI` → `'terms.generativeAi'`
- **默认标签**: `'Generative AI'` (EN) / `'生成式 AI'` (ZH)
- **交叉引用**: [`LLM`](#llm)（子集关系）

#### Google AI
- **定义**: Google 的 AI 服务总称
- **技术标识符**: `PROVIDER_NAMES.GOOGLE_AI` → `'Google AI'`
- **交叉引用**: [`Gemini`](#gemini)（具体产品）

#### GPT-4
- **定义**: OpenAI 的 GPT-4 模型家族
- **技术标识符**: `MODEL_FAMILIES.GPT_4` → `'gpt-4'`
- **提供商**: [`OpenAI`](#openai)

#### GPT-4o
- **定义**: OpenAI 的 GPT-4o 多模态模型家族
- **技术标识符**: `MODEL_FAMILIES.GPT_4O` → `'gpt-4o'`
- **提供商**: [`OpenAI`](#openai)

### I

#### Inference（推理）
- **定义**: 模型基于输入生成输出的计算过程
- **技术标识符**: `AI_TERMS.INFERENCE` → `'inference'`
- **使用上下文**: 性能监控、资源计量

### J

#### JSON Mode
- **定义**: 模型输出结构化 JSON 格式的能力
- **技术标识符**: `MODEL_CAPABILITIES.JSON_MODE` → `'json-mode'`
- **类型**: 模型能力标签

### L

#### LLM（Large Language Model / 大语言模型）
- **定义**: 基于海量文本训练的大型神经网络模型，用于理解和生成自然语言
- **技术标识符**: `AI_TERMS.LARGE_LANGUAGE_MODEL` → `'LLM'`
- **UI 键名**: `UI_TERM_KEYS.LLM` → `'terms.llm'`
- **日志前缀**: `LOG_PREFIXES.LLM` → `'[LLM]'`
- **默认标签**: `'Large Language Model'` (EN) / `'大语言模型'` (ZH)
- **交叉引用**: [`Generative AI`](#generative-ai)（父集）, [`Model`](#model), [`Provider`](#provider)

### M

#### Model（模型）
- **定义**: 经过训练的机器学习模型实例
- **技术标识符**: `AI_TERMS.MODEL` → `'model'`
- **UI 键名**: `UI_TERM_KEYS.MODEL` → `'terms.model'`
- **默认标签**: `'Model'` (EN) / `'模型'` (ZH)
- **交叉引用**: [`LLM`](#llm)（特定类型）, [`Model Family`](#model-family)

#### Model Family（模型家族）
- **定义**: 具有共同架构基础的模型分组（如 GPT-4、Gemini-3）
- **类型定义**: `ModelFamily` = `typeof MODEL_FAMILIES[keyof typeof MODEL_FAMILIES]`
- **包含**: [`GEMINI_1_5`](#gemini-1-5), [`GEMINI_2_5`](#gemini-2-5), [`GEMINI_3`](#gemini-3), [`GPT_4`](#gpt-4), [`GPT_4O`](#gpt-4o), [`CLAUDE_3`](#claude-3), [`CLAUDE_3_5`](#claude-3-5)

### O

#### OpenAI
- **定义**: LLM 服务提供商，GPT 系列模型开发者
- **技术标识符**: `PROVIDER_NAMES.OPENAI` → `'OpenAI'`
- **UI 键名**: `UI_TERM_KEYS.PROVIDER_OPENAI` → `'terms.providers.openai'`
- **相关模型家族**: [`GPT_4`](#gpt-4), [`GPT_4O`](#gpt-4o)

### P

#### Provider（提供商）
- **定义**: 提供 LLM API 服务的公司或平台
- **技术标识符**: `AI_TERMS.PROVIDER` → `'provider'`
- **日志前缀**: `LOG_PREFIXES.PROVIDER` → `'[Provider]'`
- **类型定义**: `ProviderName` = `typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES]`
- **包含**: [`Gemini`](#gemini), [`OpenAI`](#openai), [`Anthropic`](#anthropic), [`Azure`](#azure-openai), [`Google AI`](#google-ai)

### S

#### Streaming（流式输出）
- **定义**: 模型响应逐字/逐段实时返回的模式
- **技术标识符**: 
  - `AI_TERMS.STREAMING` → `'streaming'`
  - `MODEL_CAPABILITIES.STREAMING` → `'streaming'`
  - `UI_TERM_KEYS.STREAMING` → `'terms.features.streaming'`
- **⚠️ 注意**: 存在重复定义，见[不一致性标记](#4-不一致性标记)

### T

#### Thinking Mode（思考模式）
- **定义**: Gemini 3.0+ 支持的逐步推理模式
- **技术标识符**: 
  - `AI_TERMS.THINKING_MODE` → `'thinking mode'`
  - `MODEL_CAPABILITIES.THINKING` → `'thinking'`
- **UI 键名**: `UI_TERM_KEYS.THINKING_MODE` → `'terms.thinkingMode'`
- **默认标签**: `'Thinking Mode'` (EN) / `'思考模式'` (ZH)
- **⚠️ 注意**: 键名与能力标签命名不一致

#### Tool Calling（工具调用）
- **定义**: 模型调用外部函数/API 的能力（Function Calling）
- **技术标识符**: 
  - `AI_TERMS.TOOL_CALLING` → `'tool calling'`
  - `MODEL_CAPABILITIES.TOOL_USE` → `'tool-use'`
- **UI 键名**: `UI_TERM_KEYS.TOOL_CALLING` → `'terms.features.toolCalling'`
- **日志前缀**: `LOG_PREFIXES.TOOL` → `'[Tool]'`
- **⚠️ 注意**: 命名不一致（calling vs use）

### V

#### Vision（视觉）
- **定义**: 模型理解和处理图像输入的能力
- **技术标识符**: `MODEL_CAPABILITIES.VISION` → `'vision'`
- **类型**: 模型能力标签

---

## 2. 常量目录

### 2.1 核心术语常量 (`core.ts`)

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `AI_TERMS.GENERATIVE_AI` | `string` | `'generative AI'` | 技术描述、文档 | 行业通用术语，小写符合自然语言习惯 |
| `AI_TERMS.LARGE_LANGUAGE_MODEL` | `string` | `'LLM'` | 技术描述、类型定义 | 标准缩写，大写符合技术规范 |
| `AI_TERMS.AGENT` | `string` | `'agent'` | Agent 架构、日志 | 通用术语，小写 |
| `AI_TERMS.MODEL` | `string` | `'model'` | 通用引用 | 最简形式 |
| `AI_TERMS.PROVIDER` | `string` | `'provider'` | 提供商相关逻辑 | 通用术语 |
| `AI_TERMS.INFERENCE` | `string` | `'inference'` | 性能监控、资源计量 | 技术术语 |
| `AI_TERMS.THINKING_MODE` | `string` | `'thinking mode'` | Gemini 3.0+ 特性描述 | 产品特性名称 |
| `AI_TERMS.TOOL_CALLING` | `string` | `'tool calling'` | Function Calling 描述 | 行业通用术语 |
| `AI_TERMS.STREAMING` | `string` | `'streaming'` | 流式输出描述 | 标准技术术语 |

#### 日志前缀常量

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `LOG_PREFIXES.AGENT` | `string` | `'[Agent]'` | Agent 模块日志 | 方括号标识，首字母大写 |
| `LOG_PREFIXES.LLM` | `string` | `'[LLM]'` | LLM 客户端日志 | 标准缩写 |
| `LOG_PREFIXES.PROVIDER` | `string` | `'[Provider]'` | 提供商实现日志 | 通用标识 |
| `LOG_PREFIXES.FIGMA` | `string` | `'[Figma]'` | Figma 适配器日志 | 平台标识 |
| `LOG_PREFIXES.RENDER` | `string` | `'[Render]'` | 渲染引擎日志 | 功能模块标识 |
| `LOG_PREFIXES.TOOL` | `string` | `'[Tool]'` | 工具调用日志 | 功能模块标识 |

#### 类型定义

| 类型名 | 定义 | 用途 |
|--------|------|------|
| `AiTermKey` | `keyof typeof AI_TERMS` | 术语键名类型 |
| `AiTermValue` | `typeof AI_TERMS[AiTermKey]` | 术语值类型 |
| `LogPrefix` | `typeof LOG_PREFIXES[keyof typeof LOG_PREFIXES]` | 日志前缀类型 |

#### 辅助函数

| 函数名 | 签名 | 用途 |
|--------|------|------|
| `isAiTerm` | `(value: string) => value is AiTermValue` | 运行时类型守卫 |
| `logWithPrefix` | `(prefix: LogPrefix, message: string) => string` | 格式化日志消息 |

---

### 2.2 提供商术语常量 (`providers.ts`)

#### 提供商名称

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `PROVIDER_NAMES.GEMINI` | `string` | `'Gemini'` | Gemini 提供商实现 | 官方品牌名 |
| `PROVIDER_NAMES.GOOGLE_AI` | `string` | `'Google AI'` | Google AI 服务引用 | 官方服务名 |
| `PROVIDER_NAMES.OPENAI` | `string` | `'OpenAI'` | OpenAI 提供商实现 | 官方品牌名 |
| `PROVIDER_NAMES.ANTHROPIC` | `string` | `'Anthropic'` | Anthropic 提供商实现 | 官方品牌名 |
| `PROVIDER_NAMES.AZURE` | `string` | `'Azure OpenAI'` | Azure 服务引用 | 完整服务名 |

#### 模型家族

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `MODEL_FAMILIES.GEMINI_1_5` | `string` | `'gemini-1.5'` | 模型版本标识 | API 标准格式（小写+连字符） |
| `MODEL_FAMILIES.GEMINI_2_5` | `string` | `'gemini-2.5'` | 模型版本标识 | API 标准格式 |
| `MODEL_FAMILIES.GEMINI_3` | `string` | `'gemini-3'` | 模型版本标识 | API 标准格式 |
| `MODEL_FAMILIES.GPT_4` | `string` | `'gpt-4'` | 模型版本标识 | API 标准格式 |
| `MODEL_FAMILIES.GPT_4O` | `string` | `'gpt-4o'` | 模型版本标识 | API 标准格式 |
| `MODEL_FAMILIES.CLAUDE_3` | `string` | `'claude-3'` | 模型版本标识 | API 标准格式 |
| `MODEL_FAMILIES.CLAUDE_3_5` | `string` | `'claude-3.5'` | 模型版本标识 | API 标准格式 |

#### 模型能力标签

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `MODEL_CAPABILITIES.THINKING` | `string` | `'thinking'` | 能力检测、UI 筛选 | 简洁标签 |
| `MODEL_CAPABILITIES.VISION` | `string` | `'vision'` | 能力检测、UI 筛选 | 简洁标签 |
| `MODEL_CAPABILITIES.TOOL_USE` | `string` | `'tool-use'` | 能力检测、UI 筛选 | 连字符格式 |
| `MODEL_CAPABILITIES.STREAMING` | `string` | `'streaming'` | 能力检测、UI 筛选 | 与 AI_TERMS 重复 |
| `MODEL_CAPABILITIES.JSON_MODE` | `string` | `'json-mode'` | 能力检测、UI 筛选 | 连字符格式 |

#### 类型定义

| 类型名 | 定义 | 用途 |
|--------|------|------|
| `ProviderName` | `typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES]` | 提供商名称类型 |
| `ModelFamily` | `typeof MODEL_FAMILIES[keyof typeof MODEL_FAMILIES]` | 模型家族类型 |
| `ModelCapability` | `typeof MODEL_CAPABILITIES[keyof typeof MODEL_CAPABILITIES]` | 模型能力类型 |
| `ProviderConfig` | `interface { name: ProviderName; families: ModelFamily[]; apiEndpoint: string; }` | 提供商配置结构 |

#### 辅助函数

| 函数名 | 签名 | 用途 |
|--------|------|------|
| `isSupportedProvider` | `(name: string) => name is ProviderName` | 验证提供商有效性 |
| `getProviderSlug` | `(name: ProviderName) => string` | 转换为 API 标识符（小写+连字符） |

---

### 2.3 UI 术语常量 (`ui.ts`)

#### i18n 键名映射

| 常量名 | 类型 | 值 | 使用上下文 | 选择原理 |
|--------|------|-----|------------|----------|
| `UI_TERM_KEYS.GENERATIVE_AI` | `string` | `'terms.generativeAi'` | i18n 翻译键 | 点分命名空间 |
| `UI_TERM_KEYS.LLM` | `string` | `'terms.llm'` | i18n 翻译键 | 简洁键名 |
| `UI_TERM_KEYS.AGENT` | `string` | `'terms.agent'` | i18n 翻译键 | 简洁键名 |
| `UI_TERM_KEYS.MODEL` | `string` | `'terms.model'` | i18n 翻译键 | 简洁键名 |
| `UI_TERM_KEYS.THINKING_MODE` | `string` | `'terms.thinkingMode'` | i18n 翻译键 | camelCase 键名 |
| `UI_TERM_KEYS.PROVIDER_GEMINI` | `string` | `'terms.providers.gemini'` | i18n 翻译键 | 嵌套命名空间 |
| `UI_TERM_KEYS.PROVIDER_OPENAI` | `string` | `'terms.providers.openai'` | i18n 翻译键 | 嵌套命名空间 |
| `UI_TERM_KEYS.STREAMING` | `string` | `'terms.features.streaming'` | i18n 翻译键 | 功能命名空间 |
| `UI_TERM_KEYS.TOOL_CALLING` | `string` | `'terms.features.toolCalling'` | i18n 翻译键 | 功能命名空间 |

#### 默认标签（i18n 降级）

| 键 | 值 | 用途 |
|----|-----|------|
| `UI_TERM_KEYS.GENERATIVE_AI` | `'Generative AI'` | 英文默认显示 |
| `UI_TERM_KEYS.LLM` | `'Large Language Model'` | 英文默认显示 |
| `UI_TERM_KEYS.AGENT` | `'AI Agent'` | 英文默认显示 |
| `UI_TERM_KEYS.MODEL` | `'Model'` | 英文默认显示 |
| `UI_TERM_KEYS.THINKING_MODE` | `'Thinking Mode'` | 英文默认显示 |
| `UI_TERM_KEYS.PROVIDER_GEMINI` | `'Gemini'` | 英文默认显示 |
| `UI_TERM_KEYS.PROVIDER_OPENAI` | `'OpenAI'` | 英文默认显示 |
| `UI_TERM_KEYS.STREAMING` | `'Streaming'` | 英文默认显示 |
| `UI_TERM_KEYS.TOOL_CALLING` | `'Tool Calling'` | 英文默认显示 |

#### 类型定义

| 类型名 | 定义 | 用途 |
|--------|------|------|
| `UiTermKey` | `typeof UI_TERM_KEYS[keyof typeof UI_TERM_KEYS]` | UI 术语键类型 |

#### 辅助函数

| 函数名 | 签名 | 用途 |
|--------|------|------|
| `getTermLabel` | `(key: UiTermKey, translations?: Record<string, string>) => string` | 获取带降级的标签 |

---

## 3. 架构模式映射

### 3.1 整体架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI 层 (UI Layer)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Components │  │   i18n.ts   │  │    DEFAULT_LABELS       │  │
│  │             │  │             │  │    UI_TERM_KEYS         │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
│         │                │                                       │
│         └────────────────┘                                       │
│                   │                                              │
│                   ▼                                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  术语键名 (UI_TERM_KEYS) → i18n 翻译 → 用户界面文本       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 技术标识符
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      引擎层 (Engine Layer)                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   llm-client    │  │  agentRuntime   │  │  figma-adapter  │  │
│  │                 │  │                 │  │                 │  │
│  │ PROVIDER_NAMES  │  │  LOG_PREFIXES   │  │  LOG_PREFIXES   │  │
│  │ MODEL_FAMILIES  │  │   AI_TERMS      │  │   (FIGMA)       │  │
│  │ MODEL_CAPABILITIES│  │               │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│         │                    │                    │              │
│         └────────────────────┼────────────────────┘              │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  技术术语 (AI_TERMS) → 日志、配置、类型定义               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 统一导出
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   常量层 (Constants Layer)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  core.ts │  │providers.ts│  │ ui.ts  │  │ figma.ts │        │
│  │          │  │          │  │          │  │(planned) │        │
│  │AI_TERMS  │  │PROVIDER_ │  │UI_TERM_  │  │NODE_TYPES│        │
│  │LOG_PREFIX│  │  NAMES   │  │  KEYS    │  │LAYOUT_   │        │
│  │          │  │MODEL_    │  │DEFAULT_  │  │  MODES   │        │
│  │          │  │FAMILIES  │  │ LABELS   │  │          │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 组件交互边界

#### 边界 A: UI 层 ↔ i18n 层
- **治理常量**: `UI_TERM_KEYS`, `DEFAULT_LABELS`
- **交互模式**: UI 组件通过 `UI_TERM_KEYS` 获取 i18n 键，i18n 系统返回翻译文本
- **类型约束**: `UiTermKey` 确保键名类型安全

#### 边界 B: i18n 层 ↔ 引擎层
- **治理常量**: `AI_TERMS`（技术标识符）
- **交互模式**: 引擎层使用技术术语常量，i18n 层提供用户友好显示
- **映射关系**: `AI_TERMS.LLM` ↔ `UI_TERM_KEYS.LLM` ↔ `t.terms.llm`

#### 边界 C: 引擎层内部
- **治理常量**: `PROVIDER_NAMES`, `MODEL_FAMILIES`, `MODEL_CAPABILITIES`, `LOG_PREFIXES`
- **交互模式**: 
  - Provider 实现使用 `PROVIDER_NAMES` 标识自身
  - ModelFilter 使用 `MODEL_FAMILIES` 进行筛选
  - 日志系统使用 `LOG_PREFIXES` 统一格式

#### 边界 D: 常量层 ↔ 类型系统
- **治理模式**: `as const` + 类型推导
- **交互模式**: 所有常量对象使用 `as const` 断言，导出派生类型
- **类型守卫**: `isAiTerm()`, `isSupportedProvider()` 提供运行时验证

### 3.3 数据流向图

```
用户界面显示
     ▲
     │ 翻译后文本
     │
i18n.ts ───────────────────────┐
     ▲                         │
     │ UI_TERM_KEYS            │ DEFAULT_LABELS
     │                         │
     │    ┌─────────────┐      │
     └────┤  ui.ts      ├──────┘
          │ UI_TERM_KEYS│
          │DEFAULT_LABELS│
          └──────┬──────┘
                 │
                 │ 技术标识符
                 ▼
          ┌─────────────┐
          │  core.ts    │
          │  AI_TERMS   │
          │LOG_PREFIXES │
          └──────┬──────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌───────┐   ┌────────┐   ┌─────────┐
│Agent  │   │ LLM    │   │ Figma   │
│Runtime│   │Client  │   │Adapter  │
└───────┘   └────────┘   └─────────┘
    ▲            ▲            ▲
    │            │            │
    └────────────┼────────────┘
                 │
          ┌─────────────┐
          │providers.ts │
          │PROVIDER_    │
          │  NAMES      │
          │MODEL_       │
          │FAMILIES     │
          └─────────────┘
```

---

## 4. 不一致性标记

### 4.1 命名不一致

| 问题 | 位置 | 现状 | 建议 |
|------|------|------|------|
| **LLM 术语键名不匹配** | `AI_TERMS` vs `UI_TERM_KEYS` | `LARGE_LANGUAGE_MODEL` vs `LLM` | 统一使用 `LLM` 或 `LARGE_LANGUAGE_MODEL` |
| **Thinking 命名差异** | `AI_TERMS` vs `MODEL_CAPABILITIES` | `THINKING_MODE` vs `THINKING` | 统一后缀，建议都用 `_MODE` 或都不用 |
| **Tool 命名差异** | `AI_TERMS` vs `MODEL_CAPABILITIES` | `TOOL_CALLING` vs `TOOL_USE` | 统一动词，建议都用 `CALLING` 或 `USE` |

### 4.2 值格式不一致

| 问题 | 位置 | 现状 | 建议 |
|------|------|------|------|
| **大小写混合** | `AI_TERMS` | `'generative AI'` (小写), `'LLM'` (大写) | 统一规范：技术缩写大写，描述性文本小写 |
| **API 标识符格式** | `MODEL_FAMILIES` | `'gemini-2.5'` (连字符) | 与提供商常量 `'Gemini'` 格式不一致，但这是有意为之（API vs 显示） |
| **空格 vs 连字符** | `AI_TERMS` vs `MODEL_CAPABILITIES` | `'thinking mode'` vs `'thinking'` | 能力标签使用简洁形式，描述使用完整形式 |

### 4.3 重复定义

| 问题 | 位置 | 现状 | 风险 |
|------|------|------|------|
| **STREAMING 重复** | `AI_TERMS` 和 `MODEL_CAPABILITIES` | 两者都定义了 `STREAMING` | 维护时需要同步更新两处 |

### 4.4 缺失定义

| 问题 | 位置 | 影响 |
|------|------|------|
| **figma.ts 未完整定义** | 文档提及但未展示完整内容 | Figma 相关术语可能散落在代码中 |
| **UI_TERM_KEYS 不完整** | 缺少 `PROVIDER_ANTHROPIC`, `PROVIDER_AZURE` | 多语言支持可能不完整 |

---

## 5. 合并建议

### 5.1 高优先级合并

#### 建议 1: 统一 Streaming 定义
**现状**: `AI_TERMS.STREAMING` 和 `MODEL_CAPABILITIES.STREAMING` 值相同

**建议方案**:
```typescript
// 在 core.ts 中定义基础术语
export const AI_TERMS = {
  STREAMING: 'streaming',
  // ...
} as const;

// 在 providers.ts 中引用
export const MODEL_CAPABILITIES = {
  STREAMING: AI_TERMS.STREAMING,  // 引用而非重复定义
  // ...
} as const;
```

**收益**: 单一数据源，减少维护成本

---

#### 建议 2: 统一 Tool 相关命名
**现状**: `TOOL_CALLING` (AI_TERMS) vs `TOOL_USE` (MODEL_CAPABILITIES)

**建议方案**:
```typescript
// 方案 A: 统一使用 TOOL_CALLING
export const MODEL_CAPABILITIES = {
  TOOL_CALLING: 'tool-calling',  // 改为 calling
  // ...
} as const;

// 方案 B: 明确区分语义
// AI_TERMS.TOOL_CALLING = 'tool calling'  // 概念描述
// MODEL_CAPABILITIES.TOOL_USE = 'tool-use'  // 能力标签
```

**推荐**: 方案 B，保留语义差异但文档化说明

---

#### 建议 3: 统一 Thinking 命名
**现状**: `THINKING_MODE` (AI_TERMS) vs `THINKING` (MODEL_CAPABILITIES)

**建议方案**:
```typescript
// 统一为 THINKING_MODE
export const MODEL_CAPABILITIES = {
  THINKING_MODE: 'thinking-mode',  // 添加 _MODE 后缀
  // ...
} as const;
```

---

### 5.2 中优先级合并

#### 建议 4: 统一 LLM 键名
**现状**: `AI_TERMS.LARGE_LANGUAGE_MODEL` vs `UI_TERM_KEYS.LLM`

**建议方案**:
```typescript
// 方案 A: AI_TERMS 也使用 LLM
export const AI_TERMS = {
  LLM: 'LLM',  // 改为 LLM
  // ...
} as const;

// 方案 B: 保留差异，添加映射注释
// LARGE_LANGUAGE_MODEL 用于完整描述
// LLM 用于 UI 键名（简洁）
```

**推荐**: 方案 A，保持一致性

---

#### 建议 5: 补充缺失的 UI 键
**现状**: `UI_TERM_KEYS` 缺少部分提供商

**建议添加**:
```typescript
export const UI_TERM_KEYS = {
  // 现有...
  PROVIDER_ANTHROPIC: 'terms.providers.anthropic',
  PROVIDER_AZURE: 'terms.providers.azure',
  PROVIDER_GOOGLE_AI: 'terms.providers.googleAi',
  
  // 模型家族（如需要显示）
  MODEL_FAMILY_GEMINI: 'terms.modelFamilies.gemini',
  MODEL_FAMILY_GPT: 'terms.modelFamilies.gpt',
  MODEL_FAMILY_CLAUDE: 'terms.modelFamilies.claude',
} as const;
```

---

### 5.3 低优先级（可选）优化

#### 建议 6: 创建术语映射表
为跨文件引用的术语创建显式映射：

```typescript
// src/constants/terms/mappings.ts
export const TERM_MAPPINGS = {
  // AI_TERMS → UI_TERM_KEYS
  'AI_TERMS.GENERATIVE_AI': 'UI_TERM_KEYS.GENERATIVE_AI',
  'AI_TERMS.LLM': 'UI_TERM_KEYS.LLM',
  // ...
  
  // AI_TERMS → MODEL_CAPABILITIES
  'AI_TERMS.STREAMING': 'MODEL_CAPABILITIES.STREAMING',
  // ...
} as const;
```

**收益**: 便于静态分析和文档生成

---

## 6. 功能域快速查找索引

### 6.1 按功能域索引

#### 🔧 AI/LLM 核心功能
| 需求 | 使用常量 | 文件位置 |
|------|----------|----------|
| 获取 LLM 技术术语 | `AI_TERMS.LARGE_LANGUAGE_MODEL` | `core.ts` |
| 获取 Agent 标识 | `AI_TERMS.AGENT` | `core.ts` |
| 获取生成式 AI 描述 | `AI_TERMS.GENERATIVE_AI` | `core.ts` |
| 类型守卫检查 | `isAiTerm()` | `core.ts` |
| 获取日志前缀 | `LOG_PREFIXES.LLM`, `LOG_PREFIXES.AGENT` | `core.ts` |

#### 🏢 提供商管理
| 需求 | 使用常量 | 文件位置 |
|------|----------|----------|
| 获取提供商名称 | `PROVIDER_NAMES.GEMINI`, etc. | `providers.ts` |
| 验证提供商有效性 | `isSupportedProvider()` | `providers.ts` |
| 获取 API 标识符 | `getProviderSlug()` | `providers.ts` |
| 获取模型家族 | `MODEL_FAMILIES.GEMINI_2_5`, etc. | `providers.ts` |
| 检查模型能力 | `MODEL_CAPABILITIES.THINKING`, etc. | `providers.ts` |

#### 🎨 UI/国际化
| 需求 | 使用常量 | 文件位置 |
|------|----------|----------|
| 获取 i18n 键名 | `UI_TERM_KEYS.LLM`, etc. | `ui.ts` |
| 获取默认英文标签 | `DEFAULT_LABELS[UI_TERM_KEYS.LLM]` | `ui.ts` |
| 带降级的标签获取 | `getTermLabel()` | `ui.ts` |
| 翻译术语 | `t.terms.llm` (via i18n.ts) | `i18n.ts` |

#### 📝 日志记录
| 需求 | 使用常量 | 文件位置 |
|------|----------|----------|
| Agent 模块日志 | `LOG_PREFIXES.AGENT` | `core.ts` |
| LLM 客户端日志 | `LOG_PREFIXES.LLM` | `core.ts` |
| 提供商日志 | `LOG_PREFIXES.PROVIDER` | `core.ts` |
| Figma 适配器日志 | `LOG_PREFIXES.FIGMA` | `core.ts` |
| 渲染引擎日志 | `LOG_PREFIXES.RENDER` | `core.ts` |
| 工具调用日志 | `LOG_PREFIXES.TOOL` | `core.ts` |
| 格式化日志 | `logWithPrefix()` | `core.ts` |

### 6.2 按文件位置索引

| 文件 | 包含常量 | 主要用途 |
|------|----------|----------|
| `core.ts` | `AI_TERMS`, `LOG_PREFIXES` | AI 核心术语、日志前缀 |
| `providers.ts` | `PROVIDER_NAMES`, `MODEL_FAMILIES`, `MODEL_CAPABILITIES` | 提供商和模型管理 |
| `ui.ts` | `UI_TERM_KEYS`, `DEFAULT_LABELS` | UI 显示和国际化 |
| `figma.ts` | `NODE_TYPES`, `LAYOUT_MODES` (计划中) | Figma 相关术语 |
| `index.ts` | 统一导出所有术语 | 便捷导入 |

### 6.3 按类型索引

| 类型 | 定义位置 | 用途 |
|------|----------|------|
| `AiTermKey` | `core.ts` | AI 术语键名类型 |
| `AiTermValue` | `core.ts` | AI 术语值类型 |
| `LogPrefix` | `core.ts` | 日志前缀类型 |
| `ProviderName` | `providers.ts` | 提供商名称类型 |
| `ModelFamily` | `providers.ts` | 模型家族类型 |
| `ModelCapability` | `providers.ts` | 模型能力类型 |
| `ProviderConfig` | `providers.ts` | 提供商配置接口 |
| `UiTermKey` | `ui.ts` | UI 术语键类型 |

### 6.4 快速决策流程图

```
需要术语常量？
    │
    ├─► 用于技术实现/日志？
    │       └─► 使用 AI_TERMS (core.ts)
    │
    ├─► 用于提供商/模型管理？
    │       └─► 使用 PROVIDER_NAMES / MODEL_FAMILIES (providers.ts)
    │
    ├─► 用于 UI 显示？
    │       └─► 使用 UI_TERM_KEYS + i18n (ui.ts)
    │
    └─► 需要日志前缀？
            └─► 使用 LOG_PREFIXES (core.ts)
```

---

## 7. 生命周期管理与过时信息防范

### 7.1 问题分析

原始架构文档中的 `MODEL_FAMILIES` 和模型相关常量存在以下风险：

1. **硬编码过时信息**: 如 `CLAUDE_3_5`, `GEMINI_2_5` 等具体版本号可能随时间过时
2. **缺乏生命周期标识**: 无法区分活跃、遗留和已弃用的模型
3. **维护成本高**: 每次模型更新都需要修改代码并重新部署

### 7.2 推荐的模型目录结构

采用生命周期分层的模型目录管理：

```typescript
// src/constants/terms/modelCatalog.ts

import { PROVIDER_NAMES } from './providers';

/**
 * 模型生命周期状态
 * - active: 活跃模型，UI 默认显示，推荐使用
 * - legacy: 遗留模型，仅做兼容，UI 隐藏或折叠
 * - deprecated: 已弃用，代码中保留引用防止报错，但运行时禁止调用
 */
export type ModelLifecycle = 'active' | 'legacy' | 'deprecated';

/**
 * 模型目录 - 按提供商组织的模型生命周期管理
 * 
 * ⚠️ 注意：此配置应定期与提供商 API 文档同步
 * 建议：每季度审查一次，移除已弃用模型，更新遗留模型状态
 */
export const MODEL_CATALOG = {
  [PROVIDER_NAMES.OPENAI]: {
    active: ['gpt-4o', 'gpt-4o-mini'],
    legacy: ['gpt-4-turbo'], // 兼容但不推荐
    deprecated: ['gpt-4', 'gpt-3.5-turbo'], // 保留引用但禁止调用
  },
  [PROVIDER_NAMES.ANTHROPIC]: {
    active: ['claude-3-5-sonnet-latest', 'claude-3-opus-latest'],
    legacy: ['claude-3-sonnet-20240229'],
    deprecated: [],
  },
  [PROVIDER_NAMES.GEMINI]: {
    active: ['gemini-2.0-flash', 'gemini-2.0-pro'],
    legacy: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    deprecated: ['gemini-1.0-pro'],
  },
} as const;

/**
 * 获取指定提供商的所有可用模型（活跃 + 遗留）
 */
export function getAvailableModels(provider: typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES]): string[] {
  const catalog = MODEL_CATALOG[provider as keyof typeof MODEL_CATALOG];
  if (!catalog) return [];
  return [...catalog.active, ...catalog.legacy];
}

/**
 * 检查模型是否已弃用
 */
export function isDeprecatedModel(
  provider: typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES], 
  modelId: string
): boolean {
  const catalog = MODEL_CATALOG[provider as keyof typeof MODEL_CATALOG];
  if (!catalog) return false;
  return catalog.deprecated.includes(modelId);
}

/**
 * 获取模型的生命周期状态
 */
export function getModelLifecycle(
  provider: typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES],
  modelId: string
): ModelLifecycle | null {
  const catalog = MODEL_CATALOG[provider as keyof typeof MODEL_CATALOG];
  if (!catalog) return null;
  
  if (catalog.active.includes(modelId)) return 'active';
  if (catalog.legacy.includes(modelId)) return 'legacy';
  if (catalog.deprecated.includes(modelId)) return 'deprecated';
  return null;
}
```

### 7.3 与 MODEL_FAMILIES 的关系

```typescript
// 方案 A: MODEL_FAMILIES 仅保留家族标识（稳定）
export const MODEL_FAMILIES = {
  GPT_O: 'gpt-o',        // o1, o3 等系列
  GPT_4O: 'gpt-4o',      // 4o 系列
  CLAUDE_3: 'claude-3',  // Claude 3 家族
  CLAUDE_3_5: 'claude-3.5', // Claude 3.5 家族
  GEMINI_2: 'gemini-2',  // Gemini 2 家族
} as const;

// 方案 B: 完全移除 MODEL_FAMILIES，仅使用 MODEL_CATALOG
// 推荐：当模型版本频繁更新时采用
```

### 7.4 动态配置建议

对于频繁变化的模型列表，建议采用外部配置：

```typescript
// src/config/modelRegistry.ts
// 从 JSON 文件或远程 API 加载模型配置

interface ModelRegistryConfig {
  lastUpdated: string;
  models: Record<string, {
    provider: string;
    lifecycle: ModelLifecycle;
    capabilities: string[];
    maxTokens: number;
  }>;
}

// 本地缓存，定期同步
const MODEL_REGISTRY: ModelRegistryConfig = {
  lastUpdated: '2026-01-29',
  models: {
    // 动态加载的模型配置
  },
};
```

### 7.5 迁移检查清单

- [ ] 审查现有 `MODEL_FAMILIES` 中的硬编码版本号
- [ ] 识别哪些模型信息是稳定的（家族名称）vs 易变的（具体版本）
- [ ] 实现 `MODEL_CATALOG` 生命周期管理
- [ ] 添加模型弃用警告机制
- [ ] 建立定期审查流程（建议每季度）
- [ ] 考虑从外部配置加载模型列表

---

## 附录 A: 完整常量值速查表

### AI_TERMS
```typescript
{
  GENERATIVE_AI: 'generative AI',
  LARGE_LANGUAGE_MODEL: 'LLM',
  AGENT: 'agent',
  MODEL: 'model',
  PROVIDER: 'provider',
  INFERENCE: 'inference',
  THINKING_MODE: 'thinking mode',
  TOOL_CALLING: 'tool calling',
  STREAMING: 'streaming',
}
```

### LOG_PREFIXES
```typescript
{
  AGENT: '[Agent]',
  LLM: '[LLM]',
  PROVIDER: '[Provider]',
  FIGMA: '[Figma]',
  RENDER: '[Render]',
  TOOL: '[Tool]',
}
```

### PROVIDER_NAMES
```typescript
{
  GEMINI: 'Gemini',
  GOOGLE_AI: 'Google AI',
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  AZURE: 'Azure OpenAI',
}
```

### MODEL_FAMILIES
```typescript
{
  GEMINI_1_5: 'gemini-1.5',
  GEMINI_2_5: 'gemini-2.5',
  GEMINI_3: 'gemini-3',
  GPT_4: 'gpt-4',
  GPT_4O: 'gpt-4o',
  CLAUDE_3: 'claude-3',
  CLAUDE_3_5: 'claude-3.5',
}
```

### MODEL_CAPABILITIES
```typescript
{
  THINKING: 'thinking',
  VISION: 'vision',
  TOOL_USE: 'tool-use',
  STREAMING: 'streaming',
  JSON_MODE: 'json-mode',
}
```

### UI_TERM_KEYS
```typescript
{
  GENERATIVE_AI: 'terms.generativeAi',
  LLM: 'terms.llm',
  AGENT: 'terms.agent',
  MODEL: 'terms.model',
  THINKING_MODE: 'terms.thinkingMode',
  PROVIDER_GEMINI: 'terms.providers.gemini',
  PROVIDER_OPENAI: 'terms.providers.openai',
  STREAMING: 'terms.features.streaming',
  TOOL_CALLING: 'terms.features.toolCalling',
}
```

---

*文档生成时间: 基于 terminology-constants-architecture.md 分析*
*版本: 1.0*
