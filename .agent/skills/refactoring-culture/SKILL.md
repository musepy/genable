---
name: refactoring-culture
description: AI-Native refactoring evolution - from labor-driven to intent and verification driven. Use when discussing refactoring strategies, evaluating code debt, or deciding whether to rewrite. Keywords: refactor, rewrite, testing, verification, AI-native, technical debt.
---

# AI-Native 重构演进 (Software 3.0)

> **触发时机**: 讨论重构策略、评估代码债务、决定是否重写时自动应用

> "在 LLM 时代，重构不再是一个阶段，而是一个原子操作。"

## 1. 范式转移：从 Software 2.0 到 3.0

传统的重构（基于有限人力、高风险手工操作）在 AI 辅助开发时代已显得过于沉重。我们需要转向 **意图与验证驱动** 的重构模式。

| 维度 | 旧范式 (Handcoded) | 新范式 (AI-Native) |
|------|-------------------|-------------------|
| **成本** | 数小时/数天 (昂贵) | 数分钟/数秒 (廉价) |
| **触发** | 定期冲刺/爆发后修复 | Tidy-as-you-go (原子操作) |
| **重心** | 代码优雅 (Elegance) | 标准化 (Standardization) |
| **瓶颈** | 编写代码 (Coding) | 验证行为 (Verification) |
| **目标** | 人类可读 (Human Readable) | 上下文优化 (Context Optimization) |

---

## 2. AI-Native 重构核心原则

### A. 重构廉价化 (Zero-cost Refactoring)
不必积攒痛苦到"Code Yellow"才解决。利用 Agent 的极速重构能力，将重构作为每个 Feature 的前置或随手动作。
- **操作**: "在你开始新功能前，先将周围的代码重构以符合 [新模式]。"

### B. 常规化胜过优雅 (Standardization > Elegance)
AI 时代，过度"聪明"或"独特"的代码是债务。
- **原则**: 遵循最通用的设计模式（即使略显冗余），这能极大提高 LLM 的理解准确率，减少 Token 处理时的模糊语义和幻觉。

### C. 验证是核心 (Testing is the new Coding)
当重构成本趋于零时，唯一的瓶颈是**验证**。
- **准则**: 只要有 100% 的自动化测试覆盖，就可以进行**无情重构 (Merciless Refactoring)**。重构代码的行为不再是风险，缺乏测试才是。

### D. 上下文优化 (Context Optimization)
重构不仅是为了维护，更是为了**给 AI 减负**。
- **目标**: 减少无关 Token，消除命名冲突，扁平化过深的抽象，让 Agent 能够在更小的 Context Window 里做出正确的决策。

### E. 无情重写 (Disposable Code / Re-implementation)
不要试图修补 LLM 生成的屎山。
- **模式**: 如果一个模块逻辑混乱，直接提供 Requirement + Tests 给 LLM，要求 "Re-implement this from scratch"。新生成的结构通常比修复旧结构更干净、更符合当前 context。

---

## 3. 工作流：Tidy-as-you-go

### 第一步：意图声明
明确告诉 Agent 你想要达到的架构目标，而不是具体的修改步骤。
> "重构 postProcessor.ts，将其逻辑拆分为声明式的插件系统，以降低 AI 修改规则时的上下文负担。"

### 第二步：建立安全网 (Snapshot/Unit Tests)
在修改前，必须有存量逻辑的验证手段。
- 录制输入输出快照。
- 确保核心路径覆盖。

### 第三步：极速原子重构
让 Agent 执行重构，通常在几分钟内完成。
- **反馈循环**: 运行测试 -> 报错 -> AI 修复 -> 运行测试。

### 第四步：上下文验证
重构后，不仅检查代码逻辑，更要检查：
- 文件是否更短？
- 语义是否更明确？
- AI 是否能更容易地在此基础上增加新规则？

---

## 4. 快速检查列表 (AI-Native 版)

- [ ] 是否减少了 AI 处理该模块所需的 Token 负担？
- [ ] 逻辑是否足够扁平，让 AI 不必在多个文件间穿梭理解？
- [ ] 是否有足够的测试覆盖，支持我进行"一键重写"？
- [ ] 该重构是否优化了 Agent 的"理解效率"？
