---
id: design-knowledge
name: Design Knowledge
description: Search design patterns, component anatomy, and layout rules
category: knowledge
priority: 3
injectionType: dynamic
tools:
  - query_knowledge
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

- `query_knowledge(source="knowledge", query="...")`: Find UI patterns, color schemes, typography rules, component anatomy, layout rules

Use `query_knowledge` BEFORE creating complex components to ensure best practices.

### Examples

**Create a pricing table:**
```
query_knowledge({ source: "knowledge", query: "pricing table anatomy" })
→ { results: [...] }

build_design({ "operations": [...] })
```
