---
name: ui-capture
description: 实时捕捉浏览器 UI 并映射为 Figma 节点的技能
version: 1.0.0
---

# Skill: UI 捕捉 (ui-capture)

## 核心目标
实现从生产环境 UI 到 Figma 设计稿的“一键搬家”，通过 DOM 序列化保持高保真度。

## 适用场景
1. **逆向建模**：将现有的网页组件快速转化为 Figma 组件库。
2. **高保真反馈**：在 Figma 中基于真实的页面状态（如包含实时数据的表格）进行设计修改。

## 核心技术
- **DomCapture**: 运行在用户浏览器侧的脚本，负责计算 Computed Styles。
- **TokenResolver**: 将原始颜色值自动匹配回设计系统中的 Token 名称。
- **RenderOrchestrator**: 在 Figma 端执行 DSL 的重建。

## 关键规则
- **去绝对化**：Agent 在重建时应优先识别 Flex 布局，而非使用绝对定位。
- **资产转换**：SVG 路径应被解析为 Figma 矢量节点，位图应转换为 Figma Paints。
- **环境隔离**：该技能需要浏览器端与 Figma 插件端的双向配合。
