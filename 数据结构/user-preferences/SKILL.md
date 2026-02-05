---
name: user-preferences
description: User preferences and AI interaction conventions including language policy and user profile. Use when determining response language, code comment language, or adapting communication style. Keywords: language, Chinese, English, preferences, communication.
---

# User Preferences

> **Purpose**: 确保 AI 助手以一致的语言标准和交互风格进行协作。

---

## 🌍 语言策略 (Language Policy)

### 对话语言
- **所有 AI 回复**: 简体中文 (Simplified Chinese)

### 代码与工程产物
所有进入代码库的内容必须使用 **English**:
- 源代码和注释
- 文档文件
- Git commits, PRs, issues
- Changelogs 和 release notes
- 错误消息和日志

### 例外
中文仅可存在于 **i18n 本地化资源** 中。开发者面向的文本保持英文。

### 快速参考

| 场景 | 语言 |
|------|------|
| 与用户对话 | 简体中文 |
| 代码注释 | English |
| 变量命名 | English |
| 文档文件 | English |
| Commit 消息 | English |
| i18n 文件 | Chinese OK |

---

## 👤 用户画像 (User Profile)

| 属性 | 值 |
|------|------|
| **语言** | 简体中文 |
| **角色** | 初级前端工程师，具有丰富 UI 设计背景 |
| **偏好风格** | 清晰、具体、实用的解释 |

---

## 💬 交互指南 (Interaction Guidelines)

1. 始终使用简体中文回复
2. 平衡前端开发知识与设计直觉
3. 提供实用、可操作的指导，而非抽象理论
4. 解释复杂概念时使用视觉/设计隐喻
5. 在相关时引用 UI/UX 最佳实践

### ✅ Good Pattern
```
用户问: "什么是 React hooks?"
回答: 简洁解释核心概念，配合具体代码示例，避免深入底层实现细节
```

### ❌ Avoid
- 过于学术化的解释
- 假设用户具备高级后端知识
- 跳过实际示例

---

## 📝 代码示例

### ✅ Correct
```typescript
// Calculate the total price including tax
function calculateTotal(price: number, taxRate: number): number {
  return price * (1 + taxRate);
}
```

### ❌ Incorrect
```typescript
// 计算包含税的总价格
function 计算总价(价格: number, 税率: number): number {
  return 价格 * (1 + 税率);
}
```

---

## 📚 相关资源

- UI 开发规范: `core/ui-development.md`
- 工程原则: `quality/engineering-principles.md`
