# Vercel AI SDK — Figma Sandbox 前置评估

> 日期: 2026-03-31 | 测试环境: worktree 隔离构建
> SDK 仓库: [vercel/ai](https://github.com/vercel/ai) (MIT 协议, 开源)

## 命名约定

本文档中的"SDK 测试方案"编号（S1/S2/S3）与重构计划 Phase 2 的方案编号（P2-A/P2-B）是不同层级：

| 编号 | 含义 |
|------|------|
| **P2-A** | 重构计划 Phase 2 方案 A：内化 formatResponse/formatToolResults，不引入外部 SDK |
| **P2-B** | 重构计划 Phase 2 方案 B：用 Vercel AI SDK LanguageModel 适配现有 Provider |
| **S1** | SDK 引入方式 1：@ai-sdk/provider type-only（零 runtime） |
| **S2** | SDK 引入方式 2：ai core + @ai-sdk/google（全量 SDK） |
| **S3** | SDK 引入方式 3：仅 @ai-sdk/google provider（无编排层） |

P2-B 需要 S1/S2/S3 之一来实现。本文档评估 S1-S3 的可行性，最终决定 P2-A vs P2-B。

## 基线

| 指标 | 值 |
|------|---|
| main.js (sandbox bundle) | 646 KB |
| ui.js (UI bundle) | 1,420 KB |
| 构建工具 | esbuild via @create-figma-plugin/build |
| 平台 target | neutral (browser iframe) |
| Figma sandbox 限制 | 无 Node.js API、禁止 `import()`/`eval()`/`new Function()` |

## 三种 SDK 引入方式测试结果

| 方案 | 构建? | main.js 大小 | 增量 | 可行性 |
|------|-------|-------------|------|--------|
| **S1: @ai-sdk/provider (type-only)** | ✅ | 646 KB | **+76 bytes** | ✅ 零成本 |
| **S2: ai + @ai-sdk/google (stub oidc)** | ✅ | 1,252 KB | **+635 KB (+98%)** | ❌ 翻倍 |
| **S3: @ai-sdk/google only** | ✅ | 1,078 KB | **+457 KB (+71%)** | ❌ 太重 |

## 关键发现

### 1. `ai` core 无法直接用于 Figma sandbox

**BLOCKER**: `ai` → `@ai-sdk/gateway` → `@vercel/oidc` → Node.js `fs`/`path`/`os`。
- Stub 掉 `@vercel/oidc` 可以绕过，但 `ai` core 有动态 `import()` 会被 Figma sandbox sanitizer 破坏
- 即使 stub 成功，ai core 自身增加 ~178KB

### 2. Zod v4 是隐藏成本

`@ai-sdk/google` hard-import `zod/v4`，单独贡献 ~200KB+ minified。
- 项目已有 `valibot`（~5KB），引入 zod 是重复
- 无法 tree-shake 掉——`@ai-sdk/google` 内部用于 schema validation

### 3. @ai-sdk/provider 接口包是零成本

`@ai-sdk/provider` 只导出 TypeScript 类型（`LanguageModelV2`/`LanguageModelV3`），编译后完全擦除。
可以用它的类型定义写 adapter，但不使用任何 SDK runtime。

### 4. Sandbox sanitizer 兼容性

`@ai-sdk/google` 单独使用时无新增被禁 pattern。
`ai` core 有 1 个 `import()` 会被 sanitizer 改写为 `imp_ort()` → 运行时崩溃。

## 方案评估

### S1: Type-only adapter（可选的零成本补充）

```
成本: +76 bytes
做法: npm install @ai-sdk/provider (type-only)
     自己实现 LanguageModelV2 接口，内部调现有 Gemini provider
价值: 代码结构符合 Vercel 生态标准，未来可平滑迁移
风险: 接口可能与 ai core 的实际调用约定有细微差异（无 runtime 验证）
```

### S2: 全量 SDK（不可行）

```
成本: +635 KB (+98%)
做法: stub @vercel/oidc, alias 绕过
价值: 可用 generateText/streamText，但我们已有等效实现
风险: 动态 import 被 sanitizer 破坏、bundle 翻倍、维护 stub 兼容性
```

### S3: 只用 @ai-sdk/google provider（不推荐）

```
成本: +457 KB (+71%)
做法: npm install @ai-sdk/google, 用其 createGoogleGenerativeAI()
价值: 替代自建 Gemini provider，格式化/streaming 由 SDK 处理
风险: zod v4 与现有 valibot 重复、bundle 增 71%、仍需自建 generateText 等编排
```

## 结论

| 维度 | 判定 |
|------|------|
| **Figma sandbox 兼容性** | @ai-sdk/google ✅, ai core ❌ (需 stub + sanitizer 风险) |
| **Bundle 可接受性** | S1 ✅, S2/S3 ❌ (增量 > 50%) |
| **替代现有实现的价值** | 低 — 已有完整的 Gemini provider + streaming + tool 编排 |
| **总体建议** | **不采用 SDK runtime**（P2-B 不可行），走 **P2-A（内化 format 方法）** |

## 对重构计划的影响

Phase 2.2（Vercel AI SDK LanguageModel 适配）结论：
- **P2-B（SDK 适配）标记为 NOT VIABLE** — S2 sandbox 不兼容 + bundle 翻倍，S3 bundle +71%
- **P2-A（内化 formatResponse/formatToolResults）确认为正确路线**
- 可选零成本补充：S1 路线引入 `@ai-sdk/provider` 类型定义做接口对齐
