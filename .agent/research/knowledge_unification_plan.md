# 知识合一实施计划 (Knowledge Unification)

## 问题诊断

当前存在 **"知识双轨制"** 冲突：

| 来源 | 注入位置 | 覆盖范围 | 精细度 |
|:---|:---:|:---:|:---:|
| `SHADCN_PRESET` | P45 `buildKnowledgeSection` | 2 组件 | ✅ 含 variants |
| `ANATOMY_REGISTRY` | P47.5 `buildStructuralAnatomySection` | 20+ 组件 | ❌ 仅结构 |

**后果**: 同一组件（如 Button）在 Prompt 中收到两套冲突模版。

---

## 设计原则

1. **SSOT (Single Source of Truth)**: 组件定义必须唯一
2. **SOLID/OCP**: 扩展 Anatomy 而非修改 Section 逻辑
3. **KERNEL**: 最小化变更范围，保持类型兼容

---

## 变更方案

### 1. 合并数据源

#### [MODIFY] [anatomyRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/anatomyRegistry.ts)

将 `SHADCN_PRESET` 中的 `variants` 合并到对应组件：

```typescript
// 现状 (Anatomy)
'button': {
    structure: { ... },
    defaultProps: { padding: 12, ... }
}

// 合并后
'button': {
    name: 'Button',
    category: 'Inputs',
    description: 'Interactive element for actions',
    structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['icon?', 'label', 'icon?'] },
    defaultProps: { ... },
    variants: {
        default: { fills: ['solid'], color: 'solid-foreground', padding: [8, 16], height: 40 },
        secondary: { ... },
        outline: { ... },
        // ...
    }
}
```

### 2. 废弃旧入口

#### [MODIFY] [sectionRegistry.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/services/context/sectionRegistry.ts)

- **删除**: `buildKnowledgeSection` 及其注册项
- **增强**: `buildStructuralAnatomySection` 输出 variants 信息

### 3. 标记废弃

#### [MODIFY] [shadcn.ts](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator/src/knowledge/libraries/shadcn.ts)

添加 `@deprecated` JSDoc，保留文件但不再使用。

---

## 验证标准

1. `npm run build` 零错误
2. Prompt 中同一组件不再出现重复模版
3. `button` 意图能正确触发 variants 输出

---

## 风险评估

| 风险 | 缓解措施 |
|:---|:---|
| 合并遗漏 variants | 逐字段对比并验证 |
| 破坏现有检索 | 保持小写 key 格式兼容 |
