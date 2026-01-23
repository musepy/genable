---
description: 开发 UI 功能时必须遵循的工作流 (跨模型一致性保障)
---

# UI Development Workflow

> **目的**: 确保任何 AI 助手在帮助开发此项目时，都能遵循一致的设计思考和代码规范。

---

## 1️⃣ 理解意图 (Intent Understanding)

**问自己**: 用户要完成什么任务？

```
任务类型判定:
├─ 新增 UI ─→ 需要设计新组件/页面
├─ 修改 UI ─→ 需要理解现有实现
└─ 删除 UI ─→ 需要确认依赖关系
```

**必须确认**:
- [ ] 用户任务的核心意图
- [ ] 影响范围 (单组件 / 跨组件 / 全局)
- [ ] 是否有 Figma 设计稿可参考

---

## 2️⃣ 设计体验 (UX Design)

**问自己**: 如何让用户最快完成任务？

### 状态流转设计
```
Empty State ─→ Active State ─→ Loading ─→ Success / Error
     ↑                                         │
     └─────────────── Reset ───────────────────┘
```

### 交互模式选择
| 触发方式 | 适用场景 |
|---------|---------|
| Click | 主要操作、导航 |
| Hover | 预览、Tooltip |
| Keyboard | 可访问性、快捷操作 |
| Drag | 排序、调整 |

### 列表项状态粒度
| 状态类型 | 推荐方案 | 示例 |
|---------|---------|------|
| 列表项独立状态 | `Set<id>` 或 `Map<id, state>` | 展开/收起、选中 |
| 与数据绑定的状态 | 内嵌到数据结构中 | `message.rawOutput` |
| 全局配置 | 单一 state | `theme`, `apiKey` |

**❌ 反模式**: 用单一 `boolean` 控制多个列表项的 toggle
```typescript
// ❌ 所有项共享同一个 expand 状态
const [isExpanded, setIsExpanded] = useState(false)
{items.map(item => <Card expanded={isExpanded} />)}

// ✅ 每项独立追踪
const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
{items.map(item => <Card expanded={expandedIds.has(item.id)} />)}
```

**必须确认**:
- [ ] 需要哪些状态？
- [ ] 状态之间如何流转？
- [ ] 边界情况如何处理？
- [ ] 列表项是否需要独立状态？

---

## 3️⃣ 遵循系统 (Design System Compliance)

**问自己**: 如何用设计系统表达？

### 必须使用的 Token 文件
- `src/ui/tokens.ts` - 设计令牌 (颜色、间距、尺寸)

### Token 使用规则

**✅ 正确做法**:
```typescript
style={{
  padding: tokens.space.md,
  color: tokens.colors.foreground,
  borderRadius: tokens.radius.md,
}}
```

**❌ 禁止做法**:
```typescript
style={{
  padding: 16,           // 硬编码间距
  color: '#333333',      // 硬编码颜色
  borderRadius: '8px',   // 硬编码圆角
}}
```

### 间距系统 (Base-4)
| Token | 值 | 用途 |
|-------|---|------|
| `space.xs` | 4px | 图标间隙 |
| `space.sm` | 8px | 行内元素 |
| `space.md` | 16px | 组件内边距 |
| `space.lg` | 24px | 区块间距 |
| `space.xl` | 32px | 页面边距 |

### 颜色语义
| 语义 | Token | 用途 |
|------|-------|------|
| 背景 | `colors.background` | 页面背景 |
| 前景 | `colors.foreground` | 主要文字 |
| 卡片 | `colors.card` | 卡片容器 |
| 静音 | `colors.muted` | 次要背景 |
| 主色 | `colors.primary` | CTA按钮 |

---

## 4️⃣ 选型执行 (Implementation)

**问自己**: 用什么组件实现最贴切？

### 组件选型决策树
```
需要什么元素？
├─ 触发操作 ─→ Button (primary/secondary/ghost)
├─ 输入数据 ─→ Input / Textarea / Select
├─ 展示内容 ─→ Card / List / Table
├─ 反馈状态 ─→ Badge / Toast / Loading
└─ 导航切换 ─→ Tabs / Popover / Dialog
```

### 代码风格规范

**声明式命名**: 描述"是什么"而非"做什么"
```typescript
// ✅ 好的命名
const MessageBubble = () => ...
const ModelSelector = () => ...

// ❌ 差的命名
const HandleClick = () => ...
const DoSubmit = () => ...
```

**CSS-in-JS 格式**: 使用对象而非字符串
```typescript
// ✅ 对象形式
style={{ display: 'flex', gap: tokens.space.sm }}

// ❌ 字符串形式
style="display: flex; gap: 8px;"
```

**组件结构**: JSX 与样式分离
```typescript
// ✅ 推荐结构
const containerStyle: React.CSSProperties = {
  display: 'flex',
  padding: tokens.space.md,
};

return <div style={containerStyle}>...</div>;
```

---

## 🔄 变更检查清单

在完成 UI 变更后，必须检查：

- [ ] **Token 使用**: 没有硬编码的颜色、间距、尺寸
- [ ] **暗色模式**: 组件在 light/dark 模式下都正常
- [ ] **状态完整**: 所有状态 (idle/hover/active/disabled) 都已处理
- [ ] **可访问性**: 交互元素有明确的视觉反馈
- [ ] **文档更新**: 按 Strange Loop 协议更新相关文档

---

## 📚 参考资源

- 设计令牌: `src/ui/tokens.ts`
- 样式函数: `src/ui/styles.ts`
- 导航指南: `.agent/workflows/codebase-navigation.md`
