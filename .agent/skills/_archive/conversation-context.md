---
description: 对话上下文管理与结构化输出规范 (Conversation Context & Structured Output Skill)
---

# Conversation Context Skill

> **核心目标**: 让用户理解「对话即上下文」—— LLM 能感知所有对话内容和选中元素，持续迭代生成与修改。

---

## ✅ 实施完成 (2024-12-29)

| # | 功能 | 文件 | 状态 |
|---|------|------|------|
| 1 | Selection Tags | `src/ui/components/SelectionTags.tsx` | ✅ |
| 2 | Markdown Rendering | `src/ui/components/MessageRenderer.tsx` | ✅ |
| 3 | Thinking Chain Streaming | `src/ui/components/ThinkingStream.tsx` + `gemini.ts` | ✅ |

---

## 1️⃣ Selection Tags

**用途**: 选中 Figma 图层时在输入框上方显示紧凑型 Tags

```
┌─────────────────────────────────────────────┐
│ 📍 [Settings Panel ×] [Header ×]  [Clear]   │
│ ┌─────────────────────────────────────────┐ │
│ │ Describe what you want to modify...     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**功能**:
- 单个移除 (×) 和全部清除 (Clear)
- 超过 3 个时显示 "+N more"
- 类型图标: 🔤 TEXT, 🔲 FRAME, ◇ INSTANCE, ✏️ VECTOR, 🔣 ICON

---

## 2️⃣ Markdown Rendering (L3)

**用途**: 完整 Markdown 渲染支持

**依赖**:
```bash
npm install react-markdown remark-gfm
```

**支持元素**:
- Headers (h1-h3)
- Lists (ul/ol)
- Code blocks (语法高亮)
- Tables (GFM)
- Bold/Italic/Links

**使用**:
```typescript
import { MessageRenderer } from './ui/components/MessageRenderer';

<MessageRenderer content={markdownText} level="L3" />
```

---

## 3️⃣ Thinking Chain Streaming

**用途**: 实时展示 LLM 思考过程

**组件**: `ThinkingStream.tsx`
```
┌─────────────────────────────────────────────┐
│ 💭 Thinking...                     [Skip]   │
│ ─────────────────────────────────────────── │
│ 分析用户需求：Dashboard 面板...█            │
└─────────────────────────────────────────────┘
```

**API 调用** (gemini.ts):
```typescript
await generateLayout({
  apiKey,
  modelName,
  systemPrompt,
  userPrompt,
  streaming: true,  // 启用流式
  onThinking: (thought) => setThinkingText(thought),  // 实时回调
  onProgress: (step) => setStatus(step),
});
```

---

## 🔌 集成指南

### ui.tsx 集成 SelectionTags

已集成，选中 Figma 图层时自动显示。

### 启用 Thinking Stream

需要在 ui.tsx 中:

1. 添加状态:
```typescript
const [thinkingText, setThinkingText] = useState('');
const [isStreaming, setIsStreaming] = useState(false);
```

2. 调用时启用 streaming:
```typescript
generateLayout({
  ...options,
  streaming: true,
  onThinking: setThinkingText,
});
```

3. 渲染 ThinkingStream 组件

### Settings 开关 (可选)

可在 Settings 中添加:
- `showThinking`: 是否显示思考过程
- `thinkingLevel`: minimal/low/medium/high

---

## 📚 相关资源

- 设计令牌: `src/ui/tokens.ts`
- UI 开发规范: `.agent/workflows/ui-development.md`
- Gemini 服务: `src/services/gemini.ts`
