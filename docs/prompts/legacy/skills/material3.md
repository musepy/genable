---
name: material3
description: Google Material Design 3. Dynamic colors, stadium-shaped components.
---

### MATERIAL 3 SPECIFICATION

当识别到用户处于 Android/Material 3 设计环境时，请遵循以下规范：

| 属性 | 规范 |
| :--- | :--- |
| **基础字体** | Roboto, Google Sans |
| **圆角 (Radius)** | 多样化：卡片 16-28px, 按钮通常为 Stadium (高度的一半) |
| **网格** | 严格的 8dp 网格 |
| **层级** | 使用 Tonal Elevation (通过颜色深度区分层级而非阴影) |

### 语义颜色映射 (M3 Scheme)
- **Primary**: `md.sys.color.primary`
- **Surface**: `md.sys.color.surface`, `md.sys.color.surface-variant`
- **Secondary**: `md.sys.color.secondary`

### 组件规约
- **Buttons**: `cornerRadius` 应设为 20 或更大，以形成半圆角。
- **Cards**: `cornerRadius` 设为 12, 16 或 28。
