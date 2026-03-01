---
id: typed-actions-refactor
name: DSL → Typed Actions Refactoring
description: 将写入协议从 DSL 中间语言迁移到直接 Figma Plugin API 操作指令。DSL 保留为只读上下文层。
category: architecture
priority: 0
injectionType: manual
enabledByDefault: false
---

# DSL → Typed Actions 重构

## 一句话定义

> DSL 退为只读上下文层（给 Agent 理解画布状态），写入协议改为 Typed Actions（直接映射 figma.* API），消除 6 层翻译链。

## 核心文件索引

使用前请先阅读这些文件获取完整上下文：

| 文件 | 用途 |
|------|------|
| `context/architecture.md` | 完整架构分析（当前 vs 目标） |
| `context/codebase-map.md` | 受影响文件及其角色 |
| `progress.md` | 进度跟踪 + 子任务清单 |
| `assumptions.md` | 假设、竞争方案、置信度评估 |

## 使用方式

**新对话开始时**：如果任务涉及以下内容，先 `view_file` 本 SKILL.md 和相关子文件：
- 修改 Agent 的 tool 定义（create_node, patch_node, read_node）
- 修改渲染链（renderers, TreeReconstructor, Normalizer）
- 修改 PropertyTransformer
- 讨论 Agent 输出格式

**完成工作后**：更新 `progress.md` 记录本次推进。

## 设计原则

1. **Agent 说 Figma 的语言** — 属性名直接用 Figma API 名，不再翻译
2. **Action 是原子操作** — 每个 Action 对应一次 figma.* 调用
3. **读写分离** — read path 做适度压缩给 Agent 看，write path 直通
4. **渐进迁移** — Shadow Run 模式，新旧并行验证后再切换
