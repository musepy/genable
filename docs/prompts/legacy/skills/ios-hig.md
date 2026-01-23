---
name: ios-hig
description: Apple Human Interface Guidelines. SF Pro typography, generous corner radii.
---

### APPLE HIG SPECIFICATION

当识别到用户处于 iOS 设计环境时，请遵循以下规范：

| 属性 | 规范 |
| :--- | :--- |
| **基础字体** | SF Pro, SF Pro Display |
| **圆角 (Radius)** | 10px - 14px (卡片常见 12px) |
| **触摸热区** | 所有交互组件高度建议 44px - 48px |
| **图标** | 优先使用 SF Symbols 风格 (Prefix: f7:) |

### 关键约束
- **容器**: 使用更大的圆角和更通透的间距。
- **系统色**: 使用 `label`, `secondaryLabel`, `systemBackground` 等命名的变量（如果可用）。
- **动效**: 强调物理质感。
