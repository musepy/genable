---
id: design-knowledge
name: Design Knowledge
description: Search design patterns, component anatomy, and layout rules
category: knowledge
priority: 3
injectionType: dynamic
tools:
  - searchDesignKnowledge
  - getComponentAnatomy
  - getFigmaLayoutRules
triggerPatterns:
  - pattern
  - best practice
  - how to
  - anatomy
  - structure
  - layout rule
  - guideline
  - 模式
  - 最佳实践
  - 结构
  - 规则
enabledByDefault: true
---

## DESIGN KNOWLEDGE

Access design knowledge when you need guidance:

- `searchDesignKnowledge`: Find UI patterns, color schemes, typography rules
- `getComponentAnatomy`: Get structural blueprint for common components
- `getFigmaLayoutRules`: Get specific layout Do's and Don'ts

Use knowledge tools BEFORE creating complex components to ensure best practices.

### Examples

**Create a pricing table:**
```
getComponentAnatomy({componentName: "pricing table"})
→ {layers: [...], variants: [...]}

searchDesignKnowledge({domain: "landing", query: "pricing"})
→ {patterns: [...]}

createNode(...)
```
