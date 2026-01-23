---
name: radix-floating-layer
description: Radix floating layer specification for Popover/Tooltip/Dropdown positioning and collision detection. Use when using Popover/Tooltip/Dropdown, solving positioning issues, or handling overflow clipping. Keywords: popover, tooltip, dropdown, floating, portal, collision, positioning.
---

# Radix Floating Layer

> **触发时机**: 使用 Popover/Tooltip/Dropdown、解决定位问题、处理 overflow 剪裁时自动应用

**来源**: Radix Primitives + Floating UI 官方文档

---

## 1️⃣ 官方定义

### Floating UI (底层引擎)
> "Floating UI is a library that helps you create 'floating' elements such as tooltips, popovers, dropdowns."
> 
> **两个核心功能**:
> 1. **Positioning**: 将绝对定位元素锚定到参考元素
> 2. **Interactions**: 管理复杂的交互行为

### Radix Portal
> "Renders a React subtree in a different part of the DOM."
> 
> - 默认追加到 `document.body`
> - 可自定义 `container`

---

## 2️⃣ Radix 设计原则 (官方)

| 原则 | 说明 |
|------|------|
| **Accessible** | 遵循 WAI-ARIA，处理 aria/role/focus/keyboard |
| **Unstyled** | 无默认样式，完全控制外观 |
| **Opened** | 开放架构，可包装每个部件添加事件/props/refs |
| **Uncontrolled** | 默认非受控但可受控，内部处理状态 |

---

## 3️⃣ Popover API (官方)

```tsx
<Popover.Root>
  <Popover.Trigger />
  <Popover.Portal>      {/* 脱离 DOM 层级 */}
    <Popover.Content
      side="bottom"       {/* top | right | bottom | left */}
      sideOffset={4}
      align="start"       {/* start | center | end */}
      avoidCollisions     {/* 自动避免碰撞 */}
      collisionPadding={8}
    >
      <Popover.Arrow />
      <Popover.Close />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
```

### Content 关键属性

| 属性 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `side` | enum | "bottom" | 相对触发器的位置 |
| `sideOffset` | number | 0 | 距离触发器的间距 |
| `align` | enum | "center" | 对齐方式 |
| `avoidCollisions` | boolean | true | **碰撞检测** |
| `collisionPadding` | number | 0 | 距边界的安全距离 |
| `sticky` | "partial" / "always" | "partial" | 滚动时行为 |

---

## 4️⃣ Floating UI Middleware (官方)

Positioning 通过 **middleware 管道** 计算：

```
computePosition() 
  → placement (初始位置)
  → middleware[] (按顺序执行)
  → 返回最终坐标
```

### 推荐顺序

```typescript
const middleware = [
  offset(),        // 1. 偏移 (必须第一个)
  flip(),          // 2. 翻转
  shift(),         // 3. 平移
  arrow(),         // 4. 箭头 (靠后)
  hide(),          // 5. 隐藏 (最后)
];
```

---

## 5️⃣ 常见问题诊断

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Popover 被截断 | 父容器 `overflow: hidden` | 使用 Portal 或移除 overflow |
| 位置偏移 | 手动 CSS 定位 | 使用声明式 `side`/`align` API |
| 碰撞失效 | 未使用 Portal | 添加 `<Popover.Portal>` |

### 快速修复检查

```
是否使用 Portal？ 
  ├─ 否 → 添加 <Popover.Portal>
  └─ 是 → 检查 collisionPadding 配置

父容器有 overflow: hidden？
  ├─ 是 → 移除或改用 Portal
  └─ 否 → 检查 z-index
```
