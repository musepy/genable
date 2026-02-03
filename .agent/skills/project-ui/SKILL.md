---
id: project-ui-context
name: Project UI Context
description: Query project UI components and design tokens for consistent design generation
category: context
priority: 2
injectionType: dynamic
tools:
  - getProjectUIContext
  - getDesignSystemTokens
  - listProjectComponents
triggerPatterns:
  - button
  - header
  - card
  - input
  - component
  - 组件
  - 按钮
  - 卡片
  - design system
  - 设计系统
  - match.*style
  - 风格.*一致
  - existing.*ui
  - 现有.*ui
enabledByDefault: true
---

## PROJECT UI CONTEXT

This project has existing UI components defined in code. Before creating new designs:

1. **Query Components First**: Use `getProjectUIContext` to understand existing component structure
2. **Use Design Tokens**: Use `getDesignSystemTokens` to get colors, spacing, typography
3. **Match Patterns**: Generated designs should match the project's established patterns

**When to use these tools:**
- Creating buttons, headers, cards, inputs → Query the component first
- Unsure about spacing/colors → Get design tokens
- Need to match existing style → List and inspect components

### Examples

**Create button matching project style:**
```
getProjectUIContext({component: "Button"})
→ {props: [...], figmaMapping: {...}}

createNode({...based on mapping...})
```

**创建符合设计系统的卡片:**
```
getDesignSystemTokens({tokenType: "all"})
getProjectUIContext({component: "Card"})
createNode(...)
```
