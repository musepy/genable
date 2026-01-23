---
description: 新功能调试与验证流程 (Feature Debug & Verification Workflow)
---

# Feature Debug Workflow

> **目的**: 确保新开发的 UI 组件能正确集成到插件使用流程中并可验证。

---

## ✅ 集成状态 (已完成)

| # | 功能 | 集成 | 验证 |
|---|------|------|------|
| 1 | Selection Tags | ✅ | ⬜ |
| 2 | Markdown Rendering | ✅ | ⬜ |
| 3 | Thinking Stream | ✅ | ⬜ |

---

## 🧪 验证步骤

### 启动开发环境

```bash
cd "/Users/daxiaoxiao/Projects/figma gen plugin/figma-ai-generator"
npm run dev
```

### 1. Selection Tags 验证

1. 打开 Figma Desktop → Plugins → Development → AI Generator
2. 选中画布上的元素 (Frame/Text/Rectangle 等)
3. ✅ 验证: 输入框上方显示 `📍 [Element Name ×]`
4. ✅ 验证: 点击 × 移除单个, 点击 Clear 清除全部

### 2. Markdown Rendering 验证

1. 生成一个设计 (如 "Create a dashboard")
2. ✅ 验证: 回复中的列表正确渲染为 `<li>`
3. ✅ 验证: 代码块有背景色和等宽字体

### 3. Thinking Stream 验证

1. 发送复杂 prompt
2. ✅ 验证: 生成时显示 `💭 Thinking...`
3. ✅ 验证: 文字实时流式出现
4. ✅ 验证: 点击 Skip 可隐藏

### 4. Debug Features 验证

1. 展开 "Show Raw" 视图 (如果可见)
2. ✅ 验证: 展开后页面滚动正常，不卡顿
3. ✅ 验证: 能够滚动到底部查看完整 Raw 内容

---

## 🔧 问题排查

### Selection Tags 不显示

- [ ] Console: `selectionStyles.selectionNodes` 是否有数据
- [ ] Figma 主线程是否发送 `SEND_SELECTION_STYLES`

### Markdown 渲染异常

- [ ] `react-markdown` 依赖是否安装
- [ ] 尝试降级到 `level="L1"`

### Thinking 不显示

- [ ] `streaming: true` 是否传递
- [ ] LLM 输出是否有 JSON 前的文本内容

---

## 📚 相关资源

- 功能实现: `.agent/workflows/conversation-context.md`
- UI 规范: `.agent/workflows/ui-development.md`
