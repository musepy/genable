# 工具架构重构计划

> Status: 设计阶段
> Date: 2026-03-30
> Related: [执行管线](execution-pipeline.md) | [OpenPencil 架构](openpencil-tool-architecture.md)

## 问题

`run` 工具混杂了 5 种不同关注点（结构/搜索/知识/脚本/设计系统），commandParser 中 15 个命令有 13 个是遗留的，CLI 字符串接口对 LLM 不友好。

## 文档索引

| 文档 | 内容 |
|------|------|
| [tool-refactoring-overview.md](tool-refactoring-overview.md) | **总览** — 4 个核心问题诊断、命令使用频率分析、3 种重构方案(A/B/C)对比、OpenPencil 启示 |
| [tool-refactoring-option-a.md](tool-refactoring-option-a.md) | **方案 A 详细设计** — search/structure/knowledge 三工具 Schema、模式推断算法、数据流对比（CLI vs 结构化）、Figma API 映射、代码改动清单、迁移路径 |
| [openpencil-tool-architecture.md](openpencil-tool-architecture.md) | **OpenPencil 总览** — 23 core / 93 total 工具清单、4 阶段工作流、48 条 lint 规则、与我们的对比 |
| [openpencil-deep-dive.md](openpencil-deep-dive.md) | **OpenPencil 深度剖析** — render 代码执行机制、setter 返回回执模式(4种)、getter 三层深度、Vercel AI SDK adapter、batch_update JSON 妥协、noop 检测 |
| [openpencil-qa-session2.md](openpencil-qa-session2.md) | **OpenPencil Q&A 第二轮** — adapter 处理流程代码、params→schema 转换链、noop 定义来源、JSON.stringify 对比原理、坐标/自动布局、JSX 标签 vs params、new Function 原理、Figma 节点闪烁替代方案 |
| [questioning-feedback.md](questioning-feedback.md) | **提问技巧反馈** — 评分 7.5→7.8、术语精确度改进、提问结构化模板、进步路径 |
| [openpencil-qa-session3.md](openpencil-qa-session3.md) | **OpenPencil Q&A 第三轮** — 回调/钩子/注册概念、工具定义三要素通用性、=== 引用比较、默认行为机制、坐标系统、替换策略解耦、LLM 认知负担、同层错误设计 |
| [contrastive-grounding.md](contrastive-grounding.md) | **概念对照桥** — 10 个核心概念的"OpenPencil ↔ 我们的代码"双栏对照、对照式学习方法论、触发提问词 |

## 方案概览

```
方案 A（推荐）: 提升高频命令为 first-class 工具
  4 → 7 工具: +search +structure +knowledge, run 瘦身

方案 B: 按领域分组
  4 → 6 工具: +canvas +system, run 仅保留 scripting

方案 C: 仅清理遗留
  仍然 4 工具，从 commandParser 删除 13 个死分支
```

## 待确认决策

- [ ] 选择重构方案（A / B / C / 混合）
- [ ] search.replace 格式：结构化 JSON vs 简化文本
- [ ] structure.clone overrides：JSON object 直传 vs 旧文本解析
- [ ] knowledge 工具名：knowledge / guide / docs / man
- [ ] CLI 旧路径是否保留兼容

## 代码文件导航

```
Sandbox 端（工具定义 + 调度）
  src/engine/agent/tools/unified/run.ts        ← run 定义（待瘦身）
  src/engine/agent/tools/unified/index.ts      ← 工具注册（待加新工具）
  src/engine/agent/tools/unified/commandParser.ts  ← CLI 解析（待清理遗留）
  src/engine/agent/toolDispatcher.ts           ← 调度层

Main 端（Figma 命令执行）
  src/ipc/commands/index.ts            ← dispatch table（待加新路由）
  src/ipc/commands/searchHandlers.ts   ← grep/sed 实现（复用，不改）
  src/ipc/commands/writeHandlers.ts    ← mv/rm/cp 实现（复用，不改）
```
