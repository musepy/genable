---
name: layout-generation
description: 基于 Agent 意图生成复杂的 Figma 布局与组件
version: 1.0.0
---

# Skill: 布局生成 (layout-generation)

## 核心目标
通过自然语言指令生成符合设计规范、具备 Auto Layout 的 Figma 结构。

## 适用场景
1. **从零到一**：根据“我要一个登录页面”生成完整框架。
2. **快速原型**：生成典型的 UI 模式（如 Hero Section, Feature Cards）。
3. **结构调整**：将选中的单列列表重构为三栏网格。

## 核心技术
- **Generator**: 执行基于 Gemini 的流式推导。
- **Layout-Engine (Linting)**：生成后的实时检查，确保没有语义缺失。
- **ConstraintValidator**: 验证父子容器的缩放规则（Fill/Hug/Fixed）。

## 关键规则
- **Auto Layout 优先**：禁止生成非 Auto Layout 的容器。
- **语义覆盖**：所有文本和图标必须有明确的语义标注，方便后续代码转换。
- **层次限制**：避免过度嵌套，保持图层面板简洁易读。
