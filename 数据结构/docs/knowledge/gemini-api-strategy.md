# Gemini API 战略与项目适用性分析

> **创建日期**: 2026-01-14
> **版本**: 1.0
> **适用范围**: Figma AI Generator Plugin

---

## 1. 五大战略对齐点

### 1.1 Structured Output (responseSchema) - 与 SSOT 强相关

| 能力 | 我们的现状 | Gemini API 解决方案 | 价值 |
| :-- | :-- | :-- | :-- |
| **DSL 输出格式** | LLM 输出 JSON，格式不稳定 | `responseSchema` 强制 JSON 结构 | **根治 Token 格式不一致** |
| **Token 命名** | LLM 自由输出 `$background` 或 `surface-card` | Schema 定义 `enum: ["$background", "$foreground"]` | **SSOT: Schema 成为唯一真理** |
| **类型安全** | 依赖 PostProcessor 修复 | 模型级约束，输出即合法 | **Fail Fast: 移除 ACL 层** |

**核心价值**: 将 Token Registry 的定义作为 `responseSchema` 的 `enum`，LLM 只能输出合法 Token。

---

### 1.2 Function Calling - 工具链路优化

| 能力 | 我们的现状 | Gemini API 解决方案 | 价值 |
| :-- | :-- | :-- | :-- |
| **组件查询** | Prompt 中硬编码组件列表 | 定义 `lookupComponent(name)` 函数 | **动态获取最新组件库** |
| **Token 解析** | LLM 猜测 Token → ACL 翻译 | 定义 `resolveToken(semantic)` 函数 | **LLM 主动查询正确 Token** |
| **Icon 获取** | LLM 输出 `mdi:google` → 渲染时验证 | 定义 `lookupIcon(name)` | **减少无效请求** |

**注意**: Function Calling 在 Thinking Mode (2.5 Pro) 下受限，2.5 Flash / 3.x 完整支持。

---

### 1.3 Context Caching - 性能与成本优化

| 能力 | 我们的现状 | Gemini API 解决方案 | 价值 |
| :-- | :-- | :-- | :-- |
| **System Prompt** | 每次请求发送 ~3800 tokens | Explicit Caching 缓存 | **节省 ~75% tokens 成本** |
| **设计系统配置** | 每次重新发送 constraints | 缓存设计系统规则 | **首次冷启动后提速** |
| **多轮对话** | History 线性增长 | Implicit Caching 自动复用前缀 | **多轮对话成本下降** |

**实施条件**: 
- Explicit Caching: min 4096 tokens (2.5 Pro) / 1024 tokens (2.5 Flash)
- Implicit Caching: 自动启用，无需配置

---

### 1.4 Grounding - 真实世界数据接入

| 能力 | 潜在应用 | 价值 |
| :-- | :-- | :-- |
| **Google Search Grounding** | "设计一个像 Linear 的 Dashboard" | **设计参考不再依赖训练数据** |
| **Custom API Grounding** | 连接 Figma 官方 Component Library | **实时获取最新组件** |

---

### 1.5 Safety Settings - 生产化准备

| 配置 | 推荐值 | 说明 |
| :-- | :-- | :-- |
| `HARM_CATEGORY_*` | `BLOCK_ONLY_HIGH` | 允许创意自由，仅阻止明确有害内容 |

---

## 2. Gemini 模型能力矩阵

| 能力 | 2.5 Pro | 2.5 Flash | 3 Pro | 3 Flash | 备注 |
| :-- | :--: | :--: | :--: | :--: | :-- |
| **Structured Output** | ✅ | ✅ | ✅ | ✅ | 全系列支持 |
| **Function Calling** | ⚠️ | ✅ | ✅ | ✅ | 2.5 Pro Thinking 受限 |
| **Context Caching (Explicit)** | ✅ 4096 | ✅ 1024 | ✅ | ✅ | 3.x 内置支持 |
| **Context Caching (Implicit)** | ✅ 自动 | ✅ 自动 | ✅ 自动 | ✅ 自动 | 全系列自动 |
| **Thinking Control** | `thinkingBudget` | `thinkingBudget` | `thinkingLevel` | `thinkingLevel` | 3.x 更精细 |
| **Grounding (Search)** | ✅ | ✅ | ✅ | ✅ | 全系列支持 |
| **Generative UI** | ❌ | ❌ | ✅ | ✅ | **3.x 新能力** |
| **稳定性** | ✅ 生产可用 | ✅ 生产可用 | ⚠️ Preview | ⚠️ Preview | 2.5 更稳定 |

---

## 3. 项目适用性分析

### 3.1 当前痛点与 API 解决方案映射

| 痛点 | 根因 | API 解决方案 | 优先级 |
| :-- | :-- | :-- | :-- |
| Black Card (颜色渲染失败) | Token 格式不一致 | `responseSchema` + `enum` | **P0** |
| 设计系统误切换 | `detectSystem` 过度智能 | 用户设置 SSOT + 显式传递 | P1 |
| 生成速度慢 | 重复发送 System Prompt | Context Caching | P1 |
| Token 类型推断失败 | LLM 猜测而非查询 | Function Calling | P2 |

### 3.2 推荐行动优先级

| 优先级 | 措施 | 模型兼容性 | 预期收益 | 状态 |
| :-- | :-- | :-- | :-- | :-- |
| **P0** | `responseSchema` 约束 DSL | 全兼容 | 根治 Token 格式问题 | ✅ 已实施 |
| **P1** | Explicit Context Caching | 全兼容 | 降低 ~75% 输入成本 | 待定 |
| **P2** | Function Calling (Icon) | 3.x / 2.5 Flash | 减少无效 Icon 请求 | 待定 |
| **P3** | Grounding (设计参考) | 全兼容 | 增强设计质量 | 待定 |

---

## 4. Gemini 3.x 关键新能力

### 4.1 Thinking Level 精细控制

```typescript
const config = {
  thinkingLevel: "high"  // "minimal" | "low" | "medium" | "high"
};
```

- 2.5: 只能控制 `thinkingBudget` (token 数量)
- 3.x: 可设置语义级别，更直观

### 4.2 更好的长上下文利用

- 同样 1M tokens，3.x 在检索任务上提升 **60%** (26.3% vs 16.4%)

### 4.3 Generative UI 原生支持

- 可直接生成 UI 布局、交互元素、图表
- 不仅是文本，还包括结构化界面描述

---

## 5. Generative UI 实现路径

### 5.1 方法 1: Structured Output (推荐)

与我们当前 DSL 架构完全兼容：

```typescript
const generationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["FRAME", "TEXT", "VECTOR"] },
      props: {
        type: "object",
        properties: {
          name: { type: "string" },
          fills: { 
            type: "array", 
            items: { type: "string", enum: ["$background", "$foreground", "$primary"] } 
          },
          layout: { type: "string", enum: ["HORIZONTAL", "VERTICAL"] }
        }
      },
      children: { type: "array", items: { "$ref": "#" } }
    }
  }
};
```

**优势**: 
- 无需改变渲染管线
- Token Registry 成为 Schema 的 `enum`，SSOT 自动实现

### 5.2 方法 2: Direct Code Generation

Gemini 3 可直接生成 HTML/CSS/JSX：

```
Prompt: "Make an interactive login form"
Output: 完整的前端代码
```

**适用场景**: Web 前端直接渲染，不适合 Figma 插件

### 5.3 方法 3: A2UI Framework (参考)

Google Research 的 [A2UI](https://a2ui.org) 框架：
- 定义 "A2UI JSON" 消息格式
- 类似我们的 DSL，目标是 Web Components

---

## 6. 实施路线图

```
Phase 1: P0 - responseSchema 约束
├── 从 Token Registry 生成 JSON Schema
├── 修改 useChat.ts 添加 generationConfig
└── 验证: LLM 只输出合法 Token

Phase 2: P1 - Context Caching
├── 创建 System Prompt 缓存
├── 在 API 调用时引用缓存
└── 验证: 监控 token 使用量下降

Phase 3: P2 - Function Calling (可选)
├── 定义 lookupIcon 函数
├── 在 Flash 模型上测试
└── 验证: Icon 查询准确率提升

Phase 4: P3 - Gemini 3 迁移 (长期)
├── 等待 3.x GA 稳定
├── 评估 Generative UI 原生模式
└── 考虑 Agentic 多步迭代
```

---

## 7. 参考资源

- [Gemini API Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini API Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini API Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini 3 Thinking](https://ai.google.dev/gemini-api/docs/thinking)
