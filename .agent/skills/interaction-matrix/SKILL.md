---
name: interaction-matrix
description: UI interaction state matrix and feedback conventions. Use when designing component interactions, adding hover/click effects, or reviewing interaction completeness. Keywords: click, hover, focus, keyboard, animation, interaction, state.
---

# Interaction Matrix

> **触发时机**: 设计组件交互、添加 hover/click 效果、审查交互完整性时自动应用

---

## 📊 组件交互矩阵

| 组件 | Click | Hover | Focus | Keyboard | 动画 |
|------|:-----:|:-----:|:-----:|:--------:|------|
| Header (New Chat) | ✅ | opacity | - | - | `crisp` |
| Header (Theme) | ✅ | opacity | - | - | `crisp` |
| PromptInput | Submit | - | - | Cmd+Enter | `scale` |
| ModelPopover | Open/Select | bg | - | Enter | `popoverIn` |
| ThinkingCard | Expand | - | - | - | `max-height` |
| PromptChips | Select | pause | - | - | `marquee` |
| SelectionTags | Delete/Clear | - | - | - | `crisp` |
| Input | - | - | border | - | `border-color` |
| Button | ✅ | opacity | - | - | `crisp` |

---

## 🖱️ Click 交互 (17处)

| 组件 | 元素 | 动作 |
|------|------|------|
| Header | New Chat | 开始新对话 |
| Header | Theme Toggle | 切换主题 |
| PromptInput | Submit | 提交 prompt |
| ModelPopover | Trigger | 打开弹窗 |
| ModelPopover | Model Item | 选择模型 |
| ModelPopover | Settings | 打开设置 |
| ThinkingCard | Header | 展开/折叠 |
| PromptChips | Chip | 选择预设 |
| SelectionTags | X | 删除 tag |
| SelectionTags | Clear | 清除全部 |

---

## 🎨 Hover CSS 类

| 类名 | 效果 | 用途 |
|------|------|------|
| `.ghost-btn:hover` | opacity: 0.6 | Header 按钮 |
| `.icon-btn:hover` | opacity: 0.6 | 图标按钮 |
| `.popover-item:hover` | bg: muted | 列表项 |
| `.chip:hover` | bg + border | Chips |
| `.submit-btn-active:hover` | scale(1.1) | Submit |
| `.interactive:hover` | opacity: 0.85 | 通用 |
| `.marquee-container:hover` | paused | 滚动暂停 |

---

## ⌨️ Keyboard 交互

| 组件 | 按键 | 动作 |
|------|------|------|
| PromptInput | `Cmd/Ctrl+Enter` | 提交 |
| ModelPopover | `Enter` | 保存 API Key |
| ModelSelector | `Enter/Space` | 选择 |
| IconDiagnostics | `Enter` | 测试查找 |

---

## 🔄 状态反馈 Token

| 状态 | 反馈 | Duration |
|------|------|----------|
| Idle | 默认 | - |
| Hover | opacity/bg/scale | `--duration-fast` |
| Active | opacity 0.4 | `--duration-fast` |
| Focus | border: ring | `--duration-normal` |
| Disabled | opacity: 0.5 | - |
| Loading | spin/pulse | infinite |
| Expanded | max-height | `--duration-slow` |
