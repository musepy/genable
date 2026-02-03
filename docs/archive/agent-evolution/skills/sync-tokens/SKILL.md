---
name: sync-tokens
description: 同步 Figma 变量 (Variables) 与本地 Tokens 的核心技能
version: 1.0.0
---

# Skill: 同步 Tokens (sync-tokens)

## 核心目标
打破 Figma 设计稿与代码实现之间的高墙。该技能允许 Agent 自动化地同步颜色、间距、圆角等基础原子样式。

## 适用场景
1. **注入样式**：当用户给了一段 CSS 或 JSON，需要将其转化为 Figma 变量。
2. **提取样式**：当用户想要导出 Figma 里的最新变量作为配置文件。
3. **修复与对齐**：当发现 Figma 变量命名不规范或引用断开时。

## 核心工具与 API
- `DesignSystemManager.sync(modes)`: 将解析后的模式同步到 Figma。
- `TokenParser.parse(cssString)`: 解析 CSS 系统变量。
- `TokenParser.parseJSON(json)`: 支持 DTCG 标准的 JSON 解析。

## 关键规则 (精髓)
- **多模式支持**：必须同时处理 `Light` 和 `Dark` 等不同模式的变量映射。
- **Alias 解析**：Agent 必须能识别 `{colors.blue.500}` 这种引用语法，并在同步前验证其有效性。
- **语义化命名**：优先使用 `semantic-` 前缀来组织变量，而非原始的 HSL/Hex 值。

## 脚本参考 (Tool-Script)
Agent 可以调用 `scripts/` 下的工具来辅助复杂同步：
- `generate_console_import.js`: 用于在大规模导入时生成控制台可运行的代码。
- `console_import_tokens.js`: (即将迁移) 核心同步逻辑片段。
