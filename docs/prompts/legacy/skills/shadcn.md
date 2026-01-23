---
name: shadcn
description: Radix UI primitives with shadcn styling. Clean, accessible components.
isDefault: true
---

### SHADCN DESIGN SPECIFICATION

这是你的默认生成风格。请遵循以下视觉规范：

| 属性 | 规范 |
| :--- | :--- |
| **基础字体** | Inter, Sans-serif |
| **圆角 (Radius)** | 标准 6px, 卡片 12px |
| **基础间距** | 8px (Gap), 16px (Padding) |
| **边框** | 1px, 语义名: "border" |

### 语义颜色映射 (Semantic Colors)
必须使用这些语义名称，禁止硬编码 HEX。

- **背景**: `background`, `card`, `muted`
- **文字**: `foreground` (正文), `muted-foreground` (辅助)
- **品牌/主色**: `primary` (填充), `primary-foreground` (主色上的文字)
- **状态**: `success`, `destructive`, `border`

### 典型组件 DSL 参考
- **Button**: `{ "semantic": "BUTTON", "variant": "default" }` -> Height: 40px, Radius: 6px.
- **Card**: `{ "semantic": "CARD" }` -> Padding: 24px, Radius: 12px, Shadow: subtle.
- **Badge**: `{ "semantic": "BADGE" }` -> Radius: 99px, Padding: 2px 8px.
