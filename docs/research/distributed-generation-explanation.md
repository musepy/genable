# 分布式生成（Distributed Generation）说明

> **创建日期**: 2025-01-22  
> **目的**: 解释分布式生成模型的概念和实现

---

## 📖 什么是分布式生成？

**分布式生成（Distributed Generation）** 是一种**多阶段思考模型**，将 UI 生成过程分解为多个独立的阶段，每个阶段专注于不同的设计维度。

### 核心思想

**传统单阶段生成**：
```
用户输入 → [一个巨大的 Prompt] → LLM → 完整 UI JSON
```

**分布式生成**：
```
用户输入 → [阶段1: 需求分析] → [阶段2: 结构规划] → [阶段3: 布局计算] → [阶段4: 样式注入] → [阶段5: 最终生成] → 完整 UI JSON
```

---

## 🔄 5 阶段流程

### 阶段 1: REQUIREMENT（需求分析）
**目标**: 理解用户意图，确定语义类型

**输入**: 用户提示（如 "创建一个设置面板"）

**输出**:
```json
{
  "semantic": "CARD",
  "intent": "创建一个设置面板，包含通知开关、主题选择等",
  "hypothesis": "用户需要一个垂直布局的卡片容器"
}
```

**作用**: 为后续阶段提供语义上下文

---

### 阶段 2: STRUCTURE（结构规划）
**目标**: 规划 UI 的层次结构（不包含样式和尺寸）

**输入**: 阶段1的输出

**输出**:
```json
{
  "type": "FRAME",
  "children": [
    { "type": "TEXT", "role": "title" },
    { "type": "FRAME", "role": "content-row", "children": [...] }
  ]
}
```

**作用**: 定义组件层次关系，不涉及具体尺寸和样式

---

### 阶段 3: LAYOUT（布局计算）
**目标**: 分配物理布局属性（宽度、高度、间距、布局模式）

**输入**: 阶段2的结构

**输出**:
```json
{
  "type": "FRAME",
  "props": {
    "width": 400,
    "height": 580,
    "padding": 24,
    "gap": 24,
    "layoutMode": "VERTICAL",
    "layoutSizingHorizontal": "FIXED",
    "layoutSizingVertical": "FIXED"
  },
  "children": [...]
}
```

**作用**: 确定布局和尺寸，但不涉及颜色、字体等视觉样式

---

### 阶段 4: STYLE（样式注入）
**目标**: 添加视觉样式（颜色、圆角、字体等）

**输入**: 阶段3的布局

**输出**:
```json
{
  "type": "FRAME",
  "props": {
    "width": 400,
    "layoutMode": "VERTICAL",
    "fills": ["#FFFFFF"],
    "cornerRadius": 12,
    "strokes": ["#E4E4E7"],
    "strokeWeight": 1
  },
  "children": [...]
}
```

**作用**: 添加视觉样式，使用设计系统 token 或具体值

---

### 阶段 5: GENERATE（最终生成）
**目标**: 合并所有阶段的数据，生成符合 NodeLayer Schema 的最终 JSON

**输入**: 阶段4的样式化数据

**输出**: 完整的 NodeLayer JSON，符合 FigmaDSL 规范

**作用**: 确保输出格式正确，所有属性都在 `props` 对象中

---

## 🎯 优势

### 1. **关注点分离**
- 每个阶段专注于一个设计维度
- 降低 LLM 的认知负担
- 提高生成质量

### 2. **渐进式验证**
- 每个阶段都可以进行验证
- 早期发现问题，减少重试成本
- 支持阶段级别的反馈循环

### 3. **可调试性**
- 可以查看每个阶段的输出
- 更容易定位问题
- 支持阶段级别的优化

### 4. **灵活性**
- 可以跳过某些阶段（如果已有部分数据）
- 可以重新执行特定阶段
- 支持增量生成

---

## ⚠️ 当前状态

### 实现位置
- **文件**: `src/skills/llm-client/distributed/distributedGenerator.ts`
- **类型定义**: `src/skills/llm-client/distributed/types.ts`

### 使用情况
- 在 `useChat.ts` 中，通过 `enableDistributed` 标志控制
- 默认可能未启用，使用传统的单阶段生成

### 与单阶段生成的关系
- **单阶段生成**: 直接生成完整的 NodeLayer JSON
- **分布式生成**: 分5个阶段逐步构建，最终合并为 NodeLayer JSON
- 两者最终都输出相同的 NodeLayer 格式

---

## 🔍 关键差异

| 方面 | 单阶段生成 | 分布式生成 |
|------|-----------|-----------|
| **Prompt 复杂度** | 高（包含所有信息） | 低（每个阶段专注一个方面） |
| **Token 使用** | 一次性大量 | 分散到多个阶段 |
| **验证时机** | 最终验证 | 每阶段验证 |
| **调试难度** | 高（黑盒） | 低（可查看中间结果） |
| **生成速度** | 快（一次调用） | 慢（多次调用） |
| **质量** | 依赖 prompt 质量 | 分阶段优化，可能更稳定 |

---

## 📝 注意事项

1. **属性兼容性**：
   - 分布式生成的 LAYOUT 阶段可能输出 `primaryAxisSizingMode` 和 `counterAxisSizingMode`
   - 但这些属性需要转换为 `layoutSizingHorizontal` 和 `layoutSizingVertical`
   - 当前实现中这些属性已被移除

2. **性能考虑**：
   - 分布式生成需要多次 LLM 调用
   - 总 token 使用量可能更高
   - 但可能提高生成质量

3. **适用场景**：
   - 复杂 UI：分布式生成可能更好
   - 简单 UI：单阶段生成更快
   - 需要调试时：分布式生成更友好

---

## 🔗 相关文件

- `src/skills/llm-client/distributed/distributedGenerator.ts` - 主实现
- `src/skills/llm-client/distributed/types.ts` - 类型定义
- `src/features/chat/useChat.ts` - 使用入口
- `src/skills/llm-client/generator.ts` - 单阶段生成（对比）
